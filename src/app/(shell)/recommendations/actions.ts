"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  recommendationResponses,
  recordResponse,
  persistResponses,
  ensureRecommendationResponsesSeeded,
} from "@/domains/product/recommendation-response-store";
import { createChangelogEntry } from "@/domains/changelog/actions";
import { updateChangelogHypothesis } from "@/domains/changelog/actions";
import type {
  RecommendationCandidate,
  RecommendationType,
} from "@/domains/recommendations/generate";
import type { SignalType, AssetType } from "@/lib/constants";

/**
 * Server actions for /recommendations (Phase v6 Commit 4, 2026-04-23).
 *
 * Accept / defer / dismiss record operator decisions in the existing
 * recommendation-response store (keyed by stableKey). Accept ALSO stamps
 * a changelog entry when the rec implies an observable site change — the
 * Z-score url-watcher then picks it up and starts watching automatically.
 *
 * The rec payload is passed from the client so this action doesn't need
 * to re-run the generator/prioritizer just to find the rec again.
 */

export type RecommendationActionResponse = {
  success: boolean;
  error?: string;
  changeId?: string;
};

/** A minimal slice of RecommendationCandidate that the client sends back
 *  with the accept action. Decoupling the action from the full candidate
 *  shape makes the client surface stable across small generator tweaks. */
export type RecommendationActionPayload = {
  stableKey: string;
  type: RecommendationType;
  title: string;
  description: string;
  clusterLabel: string | null;
  clusterKind: "geo" | "topic" | null;
};

/** Determine whether an Accept should create a changelog entry. Watch recs
 *  don't — there's no action implied. Other rec types imply an observable
 *  site change. Defer / dismiss always skip the changelog regardless. */
function shouldStampChangelog(type: RecommendationType): boolean {
  return type !== "watch_winning_cluster";
}

/** Map a rec into the shape `createChangelogEntry` expects. No URL target
 *  in v1 — recs don't carry resolved URLs yet. Operator can edit on the
 *  changelog detail page. */
function mapRecToChangelogShape(rec: RecommendationActionPayload): {
  signalType: SignalType;
  assetType: AssetType;
  topicTargeted: string;
  cityTargeted: string | null;
} {
  const isNewPage =
    rec.type === "create_cluster_page" || rec.type === "create_single";
  const signalType: SignalType = isNewPage ? "page" : "content";

  let assetType: AssetType;
  if (rec.clusterKind === "geo") {
    assetType = "city_page";
  } else if (rec.type === "create_cluster_page") {
    assetType = "hub_page";
  } else {
    assetType = "service_page";
  }

  const topicTargeted =
    rec.clusterKind === "topic"
      ? (rec.clusterLabel ?? "prompt cluster")
      : (rec.clusterLabel ?? "prompt decision");
  const cityTargeted =
    rec.clusterKind === "geo" ? (rec.clusterLabel ?? null) : null;

  return { signalType, assetType, topicTargeted, cityTargeted };
}

export async function acceptRecommendation(
  payload: RecommendationActionPayload,
): Promise<RecommendationActionResponse> {
  const action = "acceptRecommendation";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { stableKey: payload.stableKey, type: payload.type },
  });

  await ensureRecommendationResponsesSeeded();
  recordResponse(payload.stableKey, "accepted", {
    targetPageUrl: null,
    patternId: null,
  });
  await persistResponses();

  let changeId: string | undefined;
  if (shouldStampChangelog(payload.type)) {
    const shape = mapRecToChangelogShape(payload);
    const fd = new FormData();
    fd.set("asset_name", payload.title);
    fd.set("change_description", payload.description);
    fd.set("signal_type", shape.signalType);
    fd.set("asset_type", shape.assetType);
    fd.set("topic_targeted", shape.topicTargeted);
    if (shape.cityTargeted) fd.set("city_targeted", shape.cityTargeted);
    fd.set("hypothesis", payload.title);

    const result = await createChangelogEntry(fd);
    if (!result.success) {
      log.error("Action failed", {
        action,
        durationMs: Date.now() - t0,
        error: `changelog creation failed: ${result.error ?? "unknown"}`,
      });
      return {
        success: false,
        error: `Changelog entry failed: ${result.error ?? "unknown error"}`,
      };
    }
    changeId = result.changeId;
    if (changeId) {
      await updateChangelogHypothesis(changeId, payload.title, "recommendation");
    }
  }

  revalidatePath("/recommendations");
  revalidatePath("/", "layout");
  log.info("Action completed", {
    action,
    durationMs: Date.now() - t0,
    params: { changeId: changeId ?? null },
  });
  return { success: true, changeId };
}

export async function deferRecommendation(
  stableKey: string,
): Promise<RecommendationActionResponse> {
  const action = "deferRecommendation";
  const t0 = Date.now();
  log.info("Action started", { action, params: { stableKey } });

  await ensureRecommendationResponsesSeeded();
  recordResponse(stableKey, "deferred");
  await persistResponses();

  revalidatePath("/recommendations");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function dismissRecommendation(
  stableKey: string,
): Promise<RecommendationActionResponse> {
  const action = "dismissRecommendation";
  const t0 = Date.now();
  log.info("Action started", { action, params: { stableKey } });

  await ensureRecommendationResponsesSeeded();
  recordResponse(stableKey, "dismissed");
  await persistResponses();

  revalidatePath("/recommendations");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function undoRecommendationResponse(
  stableKey: string,
): Promise<RecommendationActionResponse> {
  const action = "undoRecommendationResponse";
  const t0 = Date.now();
  log.info("Action started", { action, params: { stableKey } });

  await ensureRecommendationResponsesSeeded();
  const idx = recommendationResponses.findIndex((r) => r.recId === stableKey);
  if (idx >= 0) {
    recommendationResponses.splice(idx, 1);
    await persistResponses();
  }
  revalidatePath("/recommendations");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
