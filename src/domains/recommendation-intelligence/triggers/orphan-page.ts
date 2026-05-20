/**
 * 2026-05-20 — Slice 4.5.C.α₃a trigger predicate: `orphan_page`.
 *
 * Cross-snapshot aggregation predicate. Runs ONCE over the full
 * tenant snapshot list (the loader invokes this before the per-
 * snapshot loop, same pattern as α₂'s duplicate-title /
 * duplicate-meta).
 *
 * Definition (operator-locked α₃a): **strict inbound-orphan**.
 * Fires when a snapshot's canonicalized URL has ZERO distinct
 * owned-page inbound links across the rest of the tenant's
 * snapshots. Self-links (a page linking to itself) are excluded.
 * "≤ 1 inbound" tolerance and outbound-under-linked variants are
 * deferred to future slices.
 *
 * Page-type allowlist: homepage / city / service / project / hub.
 * Skips utility / other / technical_asset because:
 *   • utility pages (privacy / about / terms) often have only
 *     footer-only inbound that anchor-text extraction may miss,
 *     producing false positives.
 *   • "other" pages have unknown intent.
 *   • technical_asset is non-HTML.
 *
 * **Global emptiness guard**: if NO snapshot in the tenant has
 * any usable `internal_links` data (i.e., every snapshot's
 * `internal_links` is undefined / empty), the aggregate inbound
 * map is uniformly empty — treating that as "every page is an
 * orphan" would be a false positive across the board. The
 * predicate suppresses ALL emissions in that case and the
 * operator sees zero rows (data unavailable).
 *
 * Emits `add_internal_link` at `confidence: "medium"` so the
 * candidate routes to the main candidates section (not
 * diagnostic_only).
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { addInternalLinkCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

export type OrphanPageInput = {
  tenantId: string;
  snapshots: ReadonlyArray<PageSnapshot>;
  businessConfig: BusinessConfig;
};

/**
 * Resolve a possibly-relative href to a full URL using the source
 * snapshot's URL as the base, then canonicalize. Returns null on
 * any failure. Self-link detection lives at the caller; this
 * helper only normalizes.
 */
function resolveAndCanonicalize(
  href: string,
  sourceUrl: string,
): string | null {
  if (typeof href !== "string" || href.length === 0) return null;
  try {
    const resolved = new URL(href, sourceUrl).toString();
    return canonicalizeCitationUrl(resolved);
  } catch {
    return null;
  }
}

export function orphanPage(
  input: OrphanPageInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshots, businessConfig } = input;

  // Step 1 — index each owned snapshot by its canonical URL and
  // remember the original PageSnapshot for downstream emission.
  // Snapshots whose URL fails canonicalization are dropped: they
  // can't participate as inbound targets either way.
  const snapshotByCanonical = new Map<string, PageSnapshot>();
  for (const snap of snapshots) {
    const canonical = canonicalizeCitationUrl(snap.url);
    if (canonical == null) continue;
    snapshotByCanonical.set(canonical, snap);
  }
  if (snapshotByCanonical.size === 0) return [];

  // Step 2 — build the inbound source set per owned canonical URL.
  // The aggregate also drives the global emptiness guard: if no
  // snapshot resolved any href to another owned snapshot, the
  // tenant's link capture is unusable and we suppress ALL
  // emissions.
  const inboundSources = new Map<string, Set<string>>();
  let totalResolvedInbound = 0;
  for (const snap of snapshots) {
    const sourceCanonical = canonicalizeCitationUrl(snap.url);
    if (sourceCanonical == null) continue;
    const links = snap.internal_links;
    if (!Array.isArray(links) || links.length === 0) continue;
    for (const link of links) {
      const targetCanonical = resolveAndCanonicalize(link.href, snap.url);
      if (targetCanonical == null) continue;
      // Only count links whose target is one of the tenant's
      // own snapshots. External / off-tenant hrefs are ignored.
      if (!snapshotByCanonical.has(targetCanonical)) continue;
      // Skip self-links — a page linking to itself isn't an
      // "inbound" link in the orphan sense.
      if (sourceCanonical === targetCanonical) continue;
      const bucket = inboundSources.get(targetCanonical) ?? new Set<string>();
      bucket.add(sourceCanonical);
      inboundSources.set(targetCanonical, bucket);
      totalResolvedInbound++;
    }
  }

  // Global emptiness guard. If no inbound link in the entire
  // tenant resolved to another owned page, the link-capture data
  // is unusable (every page would falsely register as orphan).
  // Suppress all emissions — operator sees zero orphan rows.
  if (totalResolvedInbound === 0) return [];

  // Step 3 — emit one candidate per allowed-page-type snapshot
  // with zero inbound owned-page links.
  const out: RecommendationCandidateRow[] = [];
  for (const [canonicalUrl, snap] of snapshotByCanonical) {
    if (isNonHtmlAsset(snap.url)) continue;
    const pageType = classifyPageType(snap.url, businessConfig);
    if (
      pageType !== "homepage" &&
      pageType !== "city" &&
      pageType !== "service" &&
      pageType !== "project" &&
      pageType !== "hub"
    ) {
      continue;
    }
    const inboundCount = inboundSources.get(canonicalUrl)?.size ?? 0;
    if (inboundCount > 0) continue;

    const actionType = "add_internal_link" as const;
    const targetUrl = snap.url;
    const topicClusterLabel = "Internal linking";
    const evidenceDetail =
      "0 inbound owned-page links across " +
      String(snapshotByCanonical.size) +
      " tenant snapshots; tenant_inbound_capture_total=" +
      String(totalResolvedInbound);
    const operatorEvidence =
      "internal_links aggregation: page_type=" +
      pageType +
      "; canonicalUrl=" +
      canonicalUrl +
      "; tenant_inbound_capture_nonzero=true; fetched_at=" +
      snap.fetched_at;

    out.push({
      tenant_id: tenantId,
      trigger_signal: "orphan_page",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: evidenceDetail,
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: addInternalLinkCopy(),
      operator_evidence: operatorEvidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snap.fetched_at,
      safety_flags: [],
    });
  }
  return out;
}
