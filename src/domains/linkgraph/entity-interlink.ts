/**
 * entity-interlink (2026-07-03, BEACON_500 R18 / P7, v1 95+112 - entity
 * auto-interlink).
 *
 * PURE / no I/O / no LLM. For a given source page, finds OTHER owned pages whose
 * topic (the N2 ownership-registry's owner topic) is actually MENTIONED in this
 * page's body sample but NOT yet linked, and proposes a contextual internal link
 * FROM the source page TO the destination OWNER page.
 *
 * The trust guarantees, all deterministic:
 *   1. We only ever propose linking to an OWNER page, never a contender. The
 *      caller passes the resolved owner for a topic (reuse resolveOwner from N2);
 *      a page that merely contends for a topic is never a link target - that
 *      would deepen a cannibalization conflict, not fix discovery.
 *   2. The destination topic must be MENTIONED in the source page's real stored
 *      body text (body_paragraph_sample + card_texts), by distinguishing token
 *      (topicTokens from relevance-gate.ts - the same rule the evidence gate +
 *      ownership registry use). A generic-only overlap ("iran" alone) never
 *      qualifies; the topic's distinguishing tokens must appear.
 *   3. The source must NOT already link to the destination (compared against the
 *      source's resolved+canonicalized internal_links). No duplicate link cards.
 *   4. A page never links to itself.
 *
 * This is DISTINCT from the existing internal_link_opportunity trigger (which
 * pairs pages by title/H1 token overlap regardless of whether the topic is on
 * the page body, and does not consult ownership). This one is grounded in the
 * page's ACTUAL body mention of another page's OWNED topic - a tighter, more
 * defensible "you talk about X here, link to your X page" signal. The caller
 * dedupes the two by (source, destination) so no page pair produces two cards.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";

/** A destination owner page + the topic label that resolved it to that owner. */
export type InterlinkDestination = {
  /** The owner page URL (already resolved via N2 - never a contender). */
  ownerUrl: string;
  /** The human topic label the owner owns (e.g. a GSC query or entity name).
   *  Used both to test body mention and to name the anchor. */
  topicLabel: string;
};

export type InterlinkSourcePage = {
  url: string;
  /** The page's real stored body sample (body_paragraph_sample + card_texts,
   *  joined by the caller). Empty/absent -> no mention can be proven -> no card. */
  bodyText: string | null;
  /** The source's OWNED outbound targets, already resolved+canonicalized to the
   *  same node ids the destinations use (so equality is a plain string compare). */
  linkedOwnedUrls: readonly string[];
};

export type InterlinkCandidate = {
  sourceUrl: string;
  destinationUrl: string;
  topicLabel: string;
  /** The distinguishing tokens of the topic that were found in the body - the
   *  proof the topic is genuinely discussed on the source page. */
  matchedTokens: string[];
  /** Suggested descriptive anchor text (the topic label, trimmed). */
  suggestedAnchor: string;
};

/** A topic must contribute at least this many distinguishing tokens for a body
 *  mention to count - a single shared token is too weak to justify a link (and
 *  topicTokens already strips the generic brand terms, so what remains is real). */
export const MIN_TOPIC_TOKENS = 1;

/**
 * Does the source body genuinely mention the destination topic? Returns the
 * matched distinguishing tokens (empty = no real mention). A topic with zero
 * distinguishing tokens (all generic) can never match. When the topic has 2+
 * distinguishing tokens we require ALL of them present (a strict mention of the
 * whole entity, mirroring the registry's subset rule); a single-token topic
 * requires that one token.
 */
export function topicMentionedInBody(
  bodyText: string | null,
  topicLabel: string,
): string[] {
  if (!bodyText || !bodyText.trim()) return [];
  const topicTok = topicTokens(topicLabel);
  if (topicTok.length < MIN_TOPIC_TOKENS) return [];
  const bodyTok = new Set(topicTokens(bodyText));
  if (bodyTok.size === 0) return [];
  const matched = topicTok.filter((t) => bodyTok.has(t));
  if (matched.length !== topicTok.length) return []; // require the WHOLE entity present
  return matched;
}

/**
 * Build interlink candidates for ONE source page against a set of candidate
 * destination owner pages. Pure.
 *
 * Contract (pinned): an empty destinations list, a source with no body text, or
 * a source that already links everything relevant yields []. The caller
 * (loader) is responsible for passing only OWNER destinations (never
 * contenders) and for the global emptiness guard at the tenant level.
 */
export function interlinkCandidatesForPage(
  source: InterlinkSourcePage,
  destinations: readonly InterlinkDestination[],
  opts: { maxPerPage?: number } = {},
): InterlinkCandidate[] {
  const maxPerPage = opts.maxPerPage ?? 3;
  if (!source.url || destinations.length === 0) return [];
  const alreadyLinked = new Set(source.linkedOwnedUrls);

  const out: InterlinkCandidate[] = [];
  const seenDest = new Set<string>();
  for (const dest of destinations) {
    if (!dest.ownerUrl || dest.ownerUrl === source.url) continue; // never self-link
    if (alreadyLinked.has(dest.ownerUrl)) continue; // already links there
    if (seenDest.has(dest.ownerUrl)) continue; // one card per destination
    const matched = topicMentionedInBody(source.bodyText, dest.topicLabel);
    if (matched.length === 0) continue;
    seenDest.add(dest.ownerUrl);
    out.push({
      sourceUrl: source.url,
      destinationUrl: dest.ownerUrl,
      topicLabel: dest.topicLabel,
      matchedTokens: matched,
      suggestedAnchor: dest.topicLabel.trim(),
    });
  }

  // Rank: most distinguishing-token proof first (a fuller mention is a stronger
  // link), then a stable lexicographic tiebreak for determinism.
  out.sort(
    (a, b) =>
      b.matchedTokens.length - a.matchedTokens.length ||
      a.destinationUrl.localeCompare(b.destinationUrl),
  );
  return out.slice(0, Math.max(0, maxPerPage));
}
