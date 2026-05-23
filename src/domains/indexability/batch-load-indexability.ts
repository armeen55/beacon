/**
 * 2026-05-20 — Slice 4.5.C.α₁ — batch indexability loader.
 *
 * Companion to `load-indexability.ts::loadIndexabilityForUrl`. Loads
 * the tenant's full owned-URL indexability map in ONE substrate
 * pass + N pure `computeIndexability` calls (one per snapshot).
 *
 * Caller: `src/domains/recommendation-intelligence/
 * load-trigger-candidates-for-tenant.ts` invokes this once at loader
 * entry; the 4 Tier-1 indexability predicates each consume
 * `OwnedUrlIndexability` as a PURE input.
 *
 * Why batch (vs N× `loadIndexabilityForUrl`): the per-URL helper
 * wraps each lookup in a distinct `unstable_cache` key, so a tenant
 * with 36 owned pages incurs 36×3 substrate reads on a cold render.
 * This helper does ONE Promise.all over the 4 substrate sources and
 * synthesizes per-URL verdicts via pure `computeIndexability`.
 *
 * Hard contracts:
 *   • Read-only. No paid-API call. No GSC fetch.
 *   • Tenant-scoped at every read boundary.
 *   • Pure result. Returns `Map<canonicalUrl, OwnedUrlIndexability>`
 *     keyed by `canonicalizeCitationUrl`. Snapshots whose URL fails
 *     canonicalization are dropped silently.
 *   • Reuses the helpers from `./load-indexability.ts`
 *     (`normalizeHost`, `nullRobotsFlags`, `buildSitemapSignal`,
 *     `buildRobotsSignal`) — exported in this slice for shared
 *     substrate logic.
 */

import "server-only";

import { computeIndexability } from "./compute-indexability";
import {
  buildRobotsSignal,
  buildSitemapSignal,
  normalizeHost,
} from "./load-indexability";
import type { OwnedUrlIndexability } from "./types";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { readRobotsState } from "@/domains/pages/robots-parser";
import type { PageSnapshot } from "@/domains/pages/types";
import { getBusinessConfig } from "@/lib/business-config";
import { getRepository } from "@/lib/persistence/repositories";

export type IndexabilityBatchOptions = {
  tenantId: string;
  /** Optional pre-loaded snapshot list. When provided, the helper
   *  skips its own `repo.getPageSnapshots()` call and uses the
   *  caller's array directly — avoids the double-read when the
   *  recommendation loader has already fetched snapshots. */
  snapshots?: PageSnapshot[];
  now?: Date | string;
};

/**
 * Load per-URL indexability verdicts for every snapshot belonging
 * to the tenant in ONE substrate pass.
 *
 * Throws if any substrate read throws. The recommendation loader
 * catches this and flips its status to `indexability_unavailable`;
 * the existing 7 α-family predicates still run.
 */
export async function loadIndexabilityBatchForTenant(
  opts: IndexabilityBatchOptions,
): Promise<Map<string, OwnedUrlIndexability>> {
  const { tenantId } = opts;
  const now = opts.now ?? new Date();

  const repo = getRepository().forTenant(tenantId);
  const snapshots =
    opts.snapshots ?? ((await repo.getPageSnapshots()) ?? []);

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return new Map();
  }

  const [reconciliation, robotsState] = await Promise.all([
    repo.getSitemapReconciliation(),
    readRobotsState({ tenantId }),
  ]);

  const cfg = getBusinessConfig(tenantId);
  const tenantDomain = normalizeHost(cfg.domain);

  const out = new Map<string, OwnedUrlIndexability>();
  for (const snap of snapshots) {
    if (snap == null) continue;
    const canonicalUrl = canonicalizeCitationUrl(snap.url);
    if (canonicalUrl == null) continue;

    const sitemap_membership = buildSitemapSignal(
      reconciliation,
      tenantDomain,
      canonicalUrl,
    );
    const robots_txt = buildRobotsSignal(
      robotsState,
      tenantDomain,
      canonicalUrl,
      now,
    );

    const verdict = computeIndexability({
      url: canonicalUrl,
      sitemap_membership,
      robots_txt,
      page_snapshot: {
        http_status: snap.http_status,
        canonical_url: snap.canonical_url,
        has_canonical_mismatch: snap.has_canonical_mismatch,
        robots_meta: snap.robots_meta,
        fetched_at: snap.fetched_at,
        extraction_certainty: snap.extraction_certainty ?? null,
      },
      now,
    });

    out.set(canonicalUrl, verdict);
  }

  return out;
}
