/**
 * load-technical-inputs (2026-07-03, BEACON_500 P11) - the pure assembly boundary
 * that turns the signals the trigger loader already read into the input shapes the
 * three technical-SEO engines consume.
 *
 * PURE. Takes ALREADY-LOADED inputs (snapshots with their internal_links, the GSC
 * page signals, and the URL-inspection cache map) and reduces them - it does NO
 * I/O of its own, so it stays testable and adds zero new reads beyond what the
 * loader already pays for (snapshots + GSC are loaded for every other trigger; the
 * inspection map is a small optional read the loader adds once).
 *
 * The canonicalization convention every join uses is the citation-lifecycle
 * canonicalizer, matching how the GSC + snapshot maps are keyed elsewhere.
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { PageSnapshot } from "@/domains/pages/types";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

import type { DeadUrlPageInput } from "./dead-url-recovery";
import type {
  BrokenLinkSourcePage,
  InternalLinkRef,
  TargetLiveness,
} from "./broken-links";
import type { RedirectHygienePageInput } from "./redirect-hygiene";

const canon = (u: string): string => canonicalizeCitationUrl(u) ?? u;

/** One URL-inspection reading, narrowed to the two fields the technical engines
 *  need (coverage_state for the index verdict). Mirrors GscInspectionCacheEntry
 *  without importing the server-only client. */
export type TechnicalInspection = {
  coverageState: string | null;
};

export type AssembledTechnicalInputs = {
  deadUrlPages: DeadUrlPageInput[];
  brokenLinkPages: BrokenLinkSourcePage[];
  redirectPages: RedirectHygienePageInput[];
  /** Canonical-URL -> HTTP status of the owned snapshot, for the broken-link
   *  liveness map (an owned page's own snapshot status is the $0 liveness truth
   *  for links pointing at it). */
  statusByUrl: Map<string, number>;
  /** Canonical-URL -> 90-day impressions, for the trigger adapters' demand
   *  ranking. */
  impressionsByUrl: Map<string, number>;
  /** Every distinct canonical URL that appears as an internal-link TARGET but is
   *  NOT one of our own snapshots (so the trigger's optional live-liveness pass
   *  knows exactly which URLs need a real fetch, capped + polite). */
  unknownLinkTargets: string[];
  /** Owned pages whose stored snapshot status is a redirect (3xx) AND that clear
   *  the demand floor - the ONLY owned URLs worth probing for a multi-hop chain
   *  (a demand page that redirects at all is a chain-collapse candidate; probing
   *  resolves how many hops). Bounded by the demand floor so the live pass stays
   *  small. */
  redirectingOwnedUrls: string[];
};

/** HTTP redirect statuses (a snapshot that reads one of these means the page
 *  itself redirects - a chain-resolution candidate). */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Demand floor for choosing which owned redirecting pages to probe (mirrors the
 *  redirect-hygiene engine's floor). */
const REDIRECT_PROBE_MIN_IMPRESSIONS_90D = 100;

/** Reduce an owned snapshot's own HTTP status to a link-liveness verdict for
 *  links pointing AT it. 4xx/5xx = dead; 2xx/3xx = live; 0/unknown = unknown. */
export function statusToLiveness(httpStatus: number | undefined): TargetLiveness {
  if (httpStatus == null || httpStatus === 0) return "unknown";
  if (httpStatus >= 400) return "dead";
  return "live";
}

/**
 * Assemble every technical-engine input from the pre-loaded signals. Pure. A
 * missing signal for a page degrades that page's optional legs to "unknown"
 * (null) rather than fabricating a value.
 */
export function assembleTechnicalInputs(input: {
  snapshots: ReadonlyArray<PageSnapshot>;
  gscSignals: ReadonlyMap<string, GscPageSignal>;
  /** Canonical-URL -> inspection reading. Empty when no URL-inspection cache
   *  exists for this tenant yet (the index-verdict legs then abstain). */
  inspectionByUrl: ReadonlyMap<string, TechnicalInspection>;
}): AssembledTechnicalInputs {
  const { snapshots, gscSignals, inspectionByUrl } = input;

  const statusByUrl = new Map<string, number>();
  const impressionsByUrl = new Map<string, number>();
  const deadUrlPages: DeadUrlPageInput[] = [];
  const redirectPages: RedirectHygienePageInput[] = [];
  const ownedCanonSet = new Set<string>();
  const redirectingOwned = new Set<string>();

  for (const s of snapshots) {
    const key = canon(s.url);
    ownedCanonSet.add(key);
    statusByUrl.set(key, s.http_status);
    const sig = gscSignals.get(key);
    const impressions90d = sig?.impressions90d ?? 0;
    const clicks90d = sig?.clicks90d ?? 0;
    impressionsByUrl.set(key, impressions90d);
    const inspection = inspectionByUrl.get(key) ?? null;

    deadUrlPages.push({
      url: key,
      httpStatus: s.http_status,
      coverageState: inspection?.coverageState ?? null,
      impressions90d,
      clicks90d,
    });

    redirectPages.push({
      url: key,
      // The pure engine never fabricates a redirect chain; the trigger's
      // optional liveness pass supplies it. Assembly leaves it empty here (the
      // redirect-chain leg then abstains until liveness resolves it). Soft-404
      // still fires off Google's coverage verdict with no live fetch at all.
      redirectChain: [],
      coverageState: inspection?.coverageState ?? null,
      impressions90d,
    });

    // An owned page that itself redirects (3xx snapshot) and carries real demand
    // is worth probing for a multi-hop chain. Non-redirecting pages never get
    // probed (their chain stays empty; the redirect-chain leg abstains).
    if (
      REDIRECT_STATUSES.has(s.http_status) &&
      impressions90d >= REDIRECT_PROBE_MIN_IMPRESSIONS_90D
    ) {
      redirectingOwned.add(key);
    }
  }

  // Broken-link source pages: for each snapshot, resolve + canonicalize its
  // internal links against the source URL as base, drop self-links, dedupe. Only
  // pages that actually have internal-link data contribute (the trigger's global
  // emptiness guard suppresses everything when NO page has link data).
  const brokenLinkPages: BrokenLinkSourcePage[] = [];
  const unknownTargets = new Set<string>();
  for (const s of snapshots) {
    const sourceKey = canon(s.url);
    const raw = s.internal_links ?? [];
    if (raw.length === 0) continue;
    const seen = new Set<string>();
    const links: InternalLinkRef[] = [];
    for (const l of raw) {
      if (l == null || typeof l.href !== "string" || l.href.length === 0) continue;
      let resolved: string | null;
      try {
        resolved = canonicalizeCitationUrl(new URL(l.href, s.url).toString());
      } catch {
        resolved = null;
      }
      if (resolved == null) continue;
      const targetKey = canon(resolved);
      if (targetKey === sourceKey) continue; // self-link
      if (seen.has(targetKey)) continue;
      seen.add(targetKey);
      links.push({ targetUrl: targetKey, anchorText: l.anchor_text ?? "" });
      if (!ownedCanonSet.has(targetKey)) unknownTargets.add(targetKey);
    }
    if (links.length > 0) {
      brokenLinkPages.push({ sourceUrl: sourceKey, links });
    }
  }

  return {
    deadUrlPages,
    brokenLinkPages,
    redirectPages,
    statusByUrl,
    impressionsByUrl,
    unknownLinkTargets: [...unknownTargets].sort(),
    redirectingOwnedUrls: [...redirectingOwned].sort(),
  };
}
