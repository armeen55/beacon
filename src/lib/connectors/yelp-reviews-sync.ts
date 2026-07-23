/**
 * On-demand Yelp Fusion review pull → mergeUpsertLocalReviews.
 * Track 1.4e — no background jobs, no auto-sync.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  getYelpConnectorToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import { appendConnectorReviewsImportRun } from "@/lib/connectors/connector-review-import-run";
import { mapYelpReviewToLocalReview } from "@/lib/connectors/yelp-reviews-map";
import type { LocalReview } from "@/lib/local-reviews-types";
import { mergeUpsertLocalReviews } from "@/lib/local-reviews-store";
import { getBusinessProfileForCurrentTenant } from "@/lib/business-config";
import { now } from "@/lib/actions";
import { revalidatePath } from "next/cache";

const YELP_V3 = "https://api.yelp.com/v3";

function safeRevalidatePath(
  path: string,
  type?: "layout" | "page",
): void {
  try {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  } catch {
    /* Outside a Next.js request (e.g. Vitest) — cache revalidation is a no-op. */
  }
}

export type YelpReviewsSyncResult =
  | {
      ok: true;
      imported: number;
      rejected: number;
      partial: boolean;
      warnings: string[];
    }
  | {
      ok: false;
      code: "not_connected" | "invalid_key" | "sync_failed";
      message: string;
    };

type YelpJson = Record<string, unknown>;

async function yelpGet(
  pathWithLeadingSlash: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${YELP_V3}${pathWithLeadingSlash}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { _parseError: true, _raw: text.slice(0, 300) };
    }
  }
  return { ok: res.ok, status: res.status, body };
}

function yelpErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const err = (body as YelpJson).error;
    if (err && typeof err === "object") {
      const msg = (err as YelpJson).description ?? (err as YelpJson).code;
      if (typeof msg === "string") return `${status}: ${msg}`;
    }
  }
  return `${status}`;
}

/**
 * Pull review excerpts for a single Yelp business and merge into local store.
 * Fusion returns a bounded set per request — not a full historical census.
 */
export async function runYelpReviewsSync(): Promise<YelpReviewsSyncResult> {
  const token0 = await getYelpConnectorToken();
  if (!token0) {
    return {
      ok: false,
      code: "not_connected",
      message: "Save a Yelp API key in Settings → Connectors first.",
    };
  }

  const cfg = await getBusinessProfileForCurrentTenant();
  const businessId = (
    cfg.yelpBusinessId?.trim() ||
    token0.business_id?.trim() ||
    ""
  ).trim();

  if (!businessId) {
    return {
      ok: false,
      code: "sync_failed",
      message:
        "Set your Yelp business ID or alias in Settings → Config (Yelp business ID), then sync again.",
    };
  }

  if (token0.business_id !== businessId) {
    await updateConnectorToken("yelp", { business_id: businessId });
  }

  const apiKey = token0.api_key;
  const warnings: string[] = [];
  let partial = false;
  let listingName: string | undefined;

  const bizPath = `/businesses/${encodeURIComponent(businessId)}`;
  const bizRes = await yelpGet(bizPath, apiKey);
  if (bizRes.ok) {
    const b = bizRes.body as YelpJson;
    const n = b.name;
    if (typeof n === "string" && n.trim()) listingName = n.trim();
  } else {
    if (bizRes.status === 401) {
      return {
        ok: false,
        code: "invalid_key",
        message: "Invalid Yelp API key — check the key in Yelp Fusion and try again.",
      };
    }
    partial = true;
    warnings.push(
      `Could not load business details (${bizRes.status} ${yelpErrorMessage(bizRes.body, bizRes.status)}). Review rows will omit listing name.`,
    );
    log.warn("Yelp business details fetch failed", { status: bizRes.status });
  }

  const revPath = `/businesses/${encodeURIComponent(businessId)}/reviews?locale=en_US`;
  const revRes = await yelpGet(revPath, apiKey);

  if (revRes.status === 401) {
    return {
      ok: false,
      code: "invalid_key",
      message: "Invalid Yelp API key — check the key in Yelp Fusion and try again.",
    };
  }

  if (revRes.status === 429) {
    return {
      ok: false,
      code: "sync_failed",
      message:
        "Yelp rate limit reached — wait a few minutes and try Sync now again. No automatic retries.",
    };
  }

  if (!revRes.ok) {
    const msg = yelpErrorMessage(revRes.body, revRes.status);
    log.error("Yelp reviews fetch failed", { status: revRes.status, msg });
    return {
      ok: false,
      code: "sync_failed",
      message: `Sync failed while loading Yelp reviews: ${msg}`,
    };
  }

  const rb = revRes.body as YelpJson;
  const reviews = rb.reviews;
  const mapped: LocalReview[] = [];
  let rejected = 0;

  if (Array.isArray(reviews)) {
    for (const raw of reviews) {
      const m = mapYelpReviewToLocalReview(raw, {
        listingName,
        businessId,
      });
      if (m.ok) mapped.push(m.row);
      else {
        rejected += 1;
        log.debug("Yelp review row rejected", { reason: m.reason });
      }
    }
  }

  const imported = mapped.length;

  try {
    await mergeUpsertLocalReviews(mapped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("mergeUpsertLocalReviews failed after Yelp fetch", { msg });
    return {
      ok: false,
      code: "sync_failed",
      message: `Sync failed while saving reviews: ${msg}`,
    };
  }

  const completedAt = now();
  await updateConnectorToken("yelp", { last_synced_at: completedAt });

  await appendConnectorReviewsImportRun({
    source_system: "connector:yelp",
    idPrefix: "yelp",
    imported,
    skipped: rejected,
    warnings,
    errors: partial ? ["partial_fetch"] : [],
  });

  safeRevalidatePath("/settings/connectors");
  safeRevalidatePath("/local");
  safeRevalidatePath("/prompts");
  safeRevalidatePath("/", "layout");

  log.info("Yelp reviews sync completed", {
    imported,
    rejected,
    partial,
    warningCount: warnings.length,
  });

  return {
    ok: true,
    imported,
    rejected,
    partial,
    warnings,
  };
}
