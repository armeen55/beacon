/**
 * buried-page (2026-07-03, BEACON_500 R18 / N23) - internal-authority trigger.
 *
 * THE PLAY: a page that gets REAL Google demand but that the rest of the site
 * either never links to (nothing points at it) or buries many clicks from the
 * homepage. Both cases tell Google the page is an afterthought and cost real
 * discovery. This trigger names those two cases with the page's own impressions
 * as proof and asks for links from related / closer pages.
 *
 * Inputs are the pre-computed internal-authority snapshot (internal-pagerank.ts:
 * per-page orphan status + click-depth) and the tenant's GSC page signals
 * (impressions per page). Both are pure inputs the LOADER pre-reads; this
 * predicate never does I/O (predicate purity invariant).
 *
 * DEMAND GATE: a page must clear MIN_IMPRESSIONS_90D to qualify - Beacon never
 * nags about a low-traffic page's internal links (the fix would not pay for
 * itself). This is what makes the card worth $250: it points at the pages where
 * a link actually moves money.
 *
 * DEDUP: the orphan case overlaps the existing orphan_page predicate (which fires
 * off snapshots for an allowlisted page-type set regardless of demand). This
 * trigger is DEMAND-FIRST and content-library-friendly ("other" pages qualify),
 * so it covers pages orphan_page's page-type allowlist skips. The loader dedupes
 * both by cooldown_key (tenant, action, url), so a page caught by orphan_page
 * never also emits here - one add_internal_link card per page.
 *
 * Never says "orphaned" / "PageRank" / "click-depth" on the customer card (lab
 * words) - the copy says plainly "nothing links to it" / "buried deep".
 *
 * PURE FUNCTION. No em or en dashes anywhere.
 */

import type { PageAuthority } from "@/domains/linkgraph/internal-pagerank";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { buriedNoLinksCopy, buriedTooDeepCopy } from "../customer-copy-templates";

export type BuriedPageInput = {
  tenantId: string;
  /** The internal-authority snapshot's per-page rows (orphan + click-depth). */
  authorities: ReadonlyArray<PageAuthority>;
  /** Per-page 90-day impressions, keyed by the SAME node id the authority rows
   *  use (canonicalized URL). Absent page -> treated as 0 demand -> never fires. */
  impressionsByUrl: ReadonlyMap<string, number>;
  signalAt: string;
  maxEmissions?: number;
};

/** A page needs at least this many 90-day impressions before a buried-page card
 *  is worth showing. Below this the internal-link fix does not pay for itself. */
export const MIN_IMPRESSIONS_90D = 100;
/** A page this many clicks or more from the homepage is "buried deep" (important
 *  pages should be 2-3 clicks from home). */
export const TOO_DEEP_HOPS = 4;
const DEFAULT_MAX_EMISSIONS = 5;

/**
 * @no-classifier-required: consumes the pre-built internal-authority snapshot
 * whose node universe already excluded non-HTML assets (isNonHtmlAsset is
 * applied in internal-pagerank-loader.ts when the nodes are built), so no
 * per-page classification is needed here.
 */
export function buriedPage(input: BuriedPageInput): RecommendationCandidateRow[] {
  const { tenantId, authorities, impressionsByUrl, signalAt } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;

  // Global emptiness guard: an empty authority snapshot means the link graph was
  // unusable (the pure core already suppresses off a zero-edge graph). Nothing
  // to say - byte-identical to before this trigger existed.
  if (authorities.length === 0) return [];

  type Hit = {
    row: PageAuthority;
    impressions: number;
    kind: "no_links" | "too_deep";
  };
  const hits: Hit[] = [];
  for (const row of authorities) {
    const impressions = impressionsByUrl.get(row.url) ?? 0;
    if (impressions < MIN_IMPRESSIONS_90D) continue;
    if (row.orphaned) {
      hits.push({ row, impressions, kind: "no_links" });
    } else if (row.clickDepth != null && row.clickDepth >= TOO_DEEP_HOPS) {
      // Only the too-deep case for a NON-orphan (an orphan is already covered by
      // the no_links card; never emit two cards for the same page).
      hits.push({ row, impressions, kind: "too_deep" });
    }
  }

  // Highest demand first (biggest money at stake), stable url tiebreak.
  hits.sort((a, b) => b.impressions - a.impressions || a.row.url.localeCompare(b.row.url));

  const out: RecommendationCandidateRow[] = [];
  for (const hit of hits.slice(0, max)) {
    const actionType = "add_internal_link" as const;
    const targetUrl = hit.row.url;
    const path = pathOf(targetUrl);
    const topicClusterLabel = "Internal linking";
    const customerCopy =
      hit.kind === "no_links"
        ? buriedNoLinksCopy(path, hit.impressions)
        : buriedTooDeepCopy(path, hit.row.clickDepth!, hit.impressions);
    const evidenceDetail =
      hit.kind === "no_links"
        ? "buried_page kind=no_inbound_links; inbound=0; impressions_90d=" + hit.impressions
        : "buried_page kind=too_deep; click_depth=" +
          String(hit.row.clickDepth) +
          "; impressions_90d=" +
          hit.impressions;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "buried_page",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: evidenceDetail }],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: customerCopy,
      operator_evidence:
        "signal=buried_page; kind=" +
        hit.kind +
        "; url=" +
        hit.row.url +
        "; inbound=" +
        String(hit.row.inboundCount) +
        "; click_depth=" +
        String(hit.row.clickDepth) +
        "; impressions_90d=" +
        String(hit.impressions) +
        "; play=internal_authority",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}

/** Path (or the whole URL when unparseable) for the customer copy. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}
