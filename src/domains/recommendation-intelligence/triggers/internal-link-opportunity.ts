/**
 * Internal-link brain slice (2026-06-12 night shift) — cross-page
 * trigger: `internal_link_opportunity`.
 *
 * THE PLAY (sourced; commit message carries the ≥5-source digest):
 * two of the tenant's own pages cover the same topic but the source
 * page never links to the destination — a contextual in-body link
 * from one to the other passes relevance + discovery the destination
 * is currently missing (topic-cluster linking; descriptive anchors
 * per Google's anchor-text guidance).
 *
 * Definition: for an ordered pair (source B → destination A):
 *   • both owned HTML snapshots, A ≠ B;
 *   • B does NOT already link to A (resolved + canonicalized hrefs);
 *   • A's and B's title+h1 token sets share ≥ MIN_SHARED_TOPIC_TOKENS
 *     meaningful tokens AFTER the boilerplate filter (tokens in >50%
 *     of the tenant's pages — brand suffixes — never count);
 *   • ranked by shared-token count, capped at MAX_EMISSIONS per run
 *     (the cap is logged in operator evidence — no silent caps).
 *
 * The candidate TARGETS THE SOURCE PAGE B — that's where the edit
 * lands (orphan_page targets the destination because its evidence is
 * about the destination's missing inbound; here the evidence names a
 * specific edit on a specific page). Suggested anchor = A's h1/title.
 *
 * Page types: every HTML page EXCEPT technical assets participates —
 * unlike orphan_page (whose zero-inbound signal needs a page-type
 * allowlist to avoid utility-page false positives), the topical-match
 * requirement here is itself the noise gate, and content-library
 * tenants (Iranopedia) classify mostly as "other".
 *
 * Global emptiness guard mirrors orphan_page: when NO snapshot has a
 * single resolvable owned-page link, link capture is unusable and
 * "missing link" claims would be false — suppress all emissions.
 *
 * Tokenization mirrors thin-content-overlap exactly (≥4 chars incl.
 * the Persian range, shared stopword set) so "topical" means one
 * thing across the engine.
 *
 * PURE FUNCTION. Pinned by `recommendation-trigger-predicates-purity`
 * + `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { internalLinkOpportunityCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

export type InternalLinkOpportunityInput = {
  tenantId: string;
  snapshots: ReadonlyArray<PageSnapshot>;
  maxEmissions?: number;
};

export const MIN_SHARED_TOPIC_TOKENS = 3;
const DEFAULT_MAX_EMISSIONS = 5;

// Mirrors thin-content-overlap's tokenization.
const GENERIC_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "this", "that", "what",
  "when", "where", "how", "why", "are", "was", "were", "will", "can",
  "about", "into", "near", "best", "guide", "page", "home",
]);

function tokensOf(snap: PageSnapshot): Set<string> {
  const out = new Set<string>();
  for (const raw of `${snap.title ?? ""} ${snap.h1 ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)) {
    if (raw.length >= 4 && !GENERIC_STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Resolve a possibly-relative href against its source page and
 *  canonicalize (mirror of orphan-page's local helper). */
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

export function internalLinkOpportunity(
  input: InternalLinkOpportunityInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshots } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;

  // Owned HTML pages by canonical URL.
  const pages: Array<{ canonical: string; snap: PageSnapshot }> = [];
  for (const snap of snapshots) {
    if (isNonHtmlAsset(snap.url)) continue;
    const canonical = canonicalizeCitationUrl(snap.url);
    if (canonical == null) continue;
    pages.push({ canonical, snap });
  }
  if (pages.length < 2) return [];
  const ownedCanonicals = new Set(pages.map((p) => p.canonical));

  // Outbound owned-link sets per source + the global emptiness guard.
  const outbound = new Map<string, Set<string>>();
  let totalResolved = 0;
  for (const { canonical, snap } of pages) {
    const links = snap.internal_links;
    if (!Array.isArray(links) || links.length === 0) continue;
    const targets = new Set<string>();
    for (const link of links) {
      const target = resolveAndCanonicalize(link.href, snap.url);
      if (target == null || !ownedCanonicals.has(target)) continue;
      if (target === canonical) continue;
      targets.add(target);
      totalResolved++;
    }
    outbound.set(canonical, targets);
  }
  if (totalResolved === 0) return [];

  // Boilerplate tokens (brand suffixes) — document frequency across
  // the tenant's pages, same rule as thin-content-overlap.
  const docFreq = new Map<string, number>();
  for (const { snap } of pages) {
    for (const t of tokensOf(snap)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const isBoilerplate = (t: string) => {
    const n = docFreq.get(t) ?? 0;
    return n >= 3 && n / pages.length > 0.5;
  };
  const topicTokens = pages.map(({ canonical, snap }) => ({
    canonical,
    snap,
    tokens: new Set([...tokensOf(snap)].filter((t) => !isBoilerplate(t))),
  }));

  // Every ordered pair (source B → destination A) where B doesn't
  // already link to A and the topics overlap.
  const pairs: Array<{
    source: (typeof topicTokens)[number];
    dest: (typeof topicTokens)[number];
    shared: string[];
  }> = [];
  for (const source of topicTokens) {
    if (source.tokens.size === 0) continue;
    const linked = outbound.get(source.canonical) ?? new Set<string>();
    for (const dest of topicTokens) {
      if (dest.canonical === source.canonical) continue;
      if (linked.has(dest.canonical)) continue;
      if (dest.tokens.size === 0) continue;
      const shared = [...source.tokens].filter((t) => dest.tokens.has(t));
      if (shared.length < MIN_SHARED_TOPIC_TOKENS) continue;
      pairs.push({ source, dest, shared });
    }
  }
  pairs.sort(
    (a, b) =>
      b.shared.length - a.shared.length ||
      a.source.canonical.localeCompare(b.source.canonical) ||
      a.dest.canonical.localeCompare(b.dest.canonical),
  );

  const out: RecommendationCandidateRow[] = [];
  for (const pair of pairs.slice(0, max)) {
    const actionType = "add_internal_link" as const;
    const targetUrl = pair.source.snap.url; // the page being EDITED
    const destTitle =
      pair.dest.snap.h1 || pair.dest.snap.title || pair.dest.canonical;
    const topicClusterLabel = pair.dest.canonical; // pair identity for dedupe
    out.push({
      tenant_id: tenantId,
      trigger_signal: "internal_link_opportunity",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "internal_link_opportunity shared_topic_tokens=" +
            pair.shared.slice(0, 6).join(",") +
            "; destination=" +
            pair.dest.canonical +
            "; suggested_anchor=" +
            destTitle +
            (pairs.length > max
              ? "; pairs_found=" + pairs.length + " (capped at " + max + ")"
              : ""),
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: internalLinkOpportunityCopy(destTitle),
      operator_evidence:
        "signal=internal_link_opportunity; source=" +
        pair.source.canonical +
        "; destination=" +
        pair.dest.canonical +
        "; shared_tokens=" +
        pair.shared.join(",") +
        "; suggested_anchor=" +
        destTitle +
        "; play=contextual_topic_cluster_link",
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: pair.source.snap.fetched_at,
      safety_flags: [],
    });
  }
  return out;
}
