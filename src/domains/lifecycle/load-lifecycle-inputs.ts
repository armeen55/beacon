/**
 * load-lifecycle-inputs (2026-07-03, BEACON_500 R19 / N24 + N22 + N21) - the
 * pure assembly boundary that turns the signals the trigger loader already read
 * into the input shapes the three lifecycle engines consume.
 *
 * PURE. Takes ALREADY-LOADED inputs (snapshots, GSC page signals, GSC decay
 * signals, the internal-authority snapshot, the sitemap lastmod map, and the
 * ownership registry's gsc_ranks conflicts) and reduces them - it does NO I/O of
 * its own, so it stays testable and adds zero new reads to the render path (the
 * trigger loader already pays for every input elsewhere in the same run).
 *
 * The one canonicalization convention every join uses is the citation-lifecycle
 * canonicalizer, matching how the GSC + authority maps are keyed.
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { PageSnapshot } from "@/domains/pages/types";
import type { GscPageSignal, GscDecaySignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import type { PageAuthority } from "@/domains/linkgraph/internal-pagerank";
import { isDecaying } from "@/domains/recommendation-intelligence/triggers/gsc-decay";
import type { OwnershipRegistry } from "@/domains/ownership/registry";

import type { LifecyclePageInput, LifecycleMergeConflict } from "./content-lifecycle";
import type { JsShellPageInput } from "./js-shell";
import type { TechnicalDemandPageInput } from "./technical-demand";

/** normalized URL (lowercase, no trailing slash) for the sitemap lastmod join -
 *  matches the key the stale-content loader builds. */
function normalizeStaleUrl(raw: string): string {
  return raw.toLowerCase().replace(/\/+$/, "");
}

const canon = (u: string): string => canonicalizeCitationUrl(u) ?? u;

export type AssembledLifecycleInputs = {
  lifecyclePages: LifecyclePageInput[];
  mergeConflicts: LifecycleMergeConflict[];
  jsShellPages: JsShellPageInput[];
  technicalPages: TechnicalDemandPageInput[];
  /** Canonical-URL -> 90-day impressions, for the trigger adapters' demand
   *  ranking. */
  impressionsByUrl: Map<string, number>;
};

/**
 * Assemble every lifecycle-engine input from the pre-loaded signals. Pure. A
 * missing signal for a page degrades that page's optional legs to "unknown"
 * (null) rather than fabricating a value - the classifiers then abstain on that
 * leg, never guess.
 */
export function assembleLifecycleInputs(input: {
  snapshots: ReadonlyArray<PageSnapshot>;
  gscSignals: ReadonlyMap<string, GscPageSignal>;
  gscDecaySignals: ReadonlyMap<string, GscDecaySignal>;
  authorities: ReadonlyArray<PageAuthority>;
  lastmodByUrl: ReadonlyMap<string, string>;
  registry: OwnershipRegistry | null;
}): AssembledLifecycleInputs {
  const { snapshots, gscSignals, gscDecaySignals, authorities, lastmodByUrl, registry } = input;

  // inbound-count lookup from the internal-authority snapshot (canonical key).
  const inboundByUrl = new Map<string, number>();
  for (const a of authorities) inboundByUrl.set(canon(a.url), a.inboundCount);

  const impressionsByUrl = new Map<string, number>();
  const lifecyclePages: LifecyclePageInput[] = [];
  const jsShellPages: JsShellPageInput[] = [];
  const technicalPages: TechnicalDemandPageInput[] = [];

  for (const s of snapshots) {
    const key = canon(s.url);
    const sig = gscSignals.get(key);
    const impressions90d = sig?.impressions90d ?? 0;
    const clicks90d = sig?.clicks90d ?? 0;
    impressionsByUrl.set(key, impressions90d);

    const decay = gscDecaySignals.get(key);
    // demandCollapsed: the split-window decay signal saying it fell off. null
    // when no decay signal exists for this page (the retire leg then abstains).
    const demandCollapsed = decay == null ? null : isDecaying(decay);

    const inbound = inboundByUrl.has(key) ? inboundByUrl.get(key)! : null;
    const lastmod = lastmodByUrl.get(normalizeStaleUrl(s.url)) ?? null;

    lifecyclePages.push({
      url: key,
      impressions90d,
      clicks90d,
      wordCount: s.word_count ?? 0,
      httpStatus: s.http_status,
      inboundCount: inbound,
      lastmod,
      title: s.title,
      h1: s.h1,
      demandCollapsed,
    });

    jsShellPages.push({
      url: key,
      wordCount: s.word_count ?? 0,
      bodyExcerptCount: s.body_paragraph_sample?.length ?? 0,
      hasTitle: (s.title ?? "").trim().length > 0,
      hasH1: (s.h1 ?? "").trim().length > 0,
      httpStatus: s.http_status,
      impressions90d,
    });

    technicalPages.push({
      url: key,
      httpStatus: s.http_status,
      robotsMeta: s.robots_meta,
      hasCanonicalMismatch: s.has_canonical_mismatch === true,
      impressions90d,
    });
  }

  // Merge conflicts from the ownership registry's gsc_ranks conflicts (N2). Each
  // conflict names one owner + its contenders with impression shares; we emit
  // one merge conflict per (owner, contender) so classifyMerge can apply the
  // dominance-ratio gate per pair. Owner share is 1 - the summed contender
  // shares within that conflict (the registry already normalized shares to the
  // combined impressions of the competing set).
  const mergeConflicts: LifecycleMergeConflict[] = [];
  if (registry) {
    for (const entry of registry.conflicts) {
      if (entry.basis !== "gsc_ranks" || !entry.owner || entry.contenders.length === 0) continue;
      const contenderShareTotal = entry.contenders.reduce((sum, c) => sum + c.share, 0);
      const ownerShare = Math.max(0, Math.min(1, 1 - contenderShareTotal));
      for (const c of entry.contenders) {
        mergeConflicts.push({
          ownerUrl: canon(entry.owner),
          foldUrl: canon(c.url),
          ownerShare,
          topicLabel: entry.key,
        });
      }
    }
  }

  return { lifecyclePages, mergeConflicts, jsShellPages, technicalPages, impressionsByUrl };
}
