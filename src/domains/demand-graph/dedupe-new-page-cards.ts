/**
 * dedupe-new-page-cards (2026-07-02, UX0 — New Pages data-correctness) — a PURE final
 * pass over the New Pages board's combined card list (graph-sourced + keyword-gap +
 * wiki-gap) that collapses near-duplicate topics into ONE card. The upstream sources
 * already skip a topic that's a plain substring of an existing one, but that check
 * misses reordered/near-duplicate phrasing ("restaurants in tehran" vs "tehran
 * restaurants") — operator ground-truth found duplicate restaurant queries reaching
 * the board with two DIFFERENT demand numbers from two sources, reading as the app
 * contradicting itself. This normalizes every card's topic to its distinguishing-
 * token set and keeps exactly one card per set: the one with a real (non-null)
 * search volume, else the higher score. PURE / no I/O.
 *
 * FP5b (2026-07-02): the normalizer is now topicTokens from the evidence relevance
 * gate - the SAME normalizer the ownership registry resolves topics with. Unlike the
 * previous keyword-match tokenizer (a naive trailing-s strip: "cities" -> "citie",
 * "city" -> "city"), it singularizes properly ("cities" and "city" both -> "city"),
 * which closes the exact "biggest cities in iran" vs "biggest city in iran"
 * two-separate-to-dos bug. `topicIdentityKey` is exported so every surface that must
 * dedupe against the board (changes-data.ts, the board's excludeTopics prop) keys
 * topics identically.
 */
import { topicTokens } from "@/domains/evidence/relevance-gate";

export type DedupableCard = {
  id: string;
  topic: string;
  searchVolume: number | null;
  score: number;
};

export type DedupeResult<T extends DedupableCard> = {
  kept: T[];
  /** Cards dropped because a near-duplicate topic already won the slot. */
  dropped: { id: string; topic: string; keptInstead: string; reason: string }[];
};

/** ONE topic identity for "is this the same not-yet-built page?" across every surface:
 *  the sorted distinguishing-token set (singularized, generic brand words dropped), or
 *  the exact lowercased string when a label is too generic to tokenize (so two generic
 *  labels never over-collapse). */
export function topicIdentityKey(topic: string): string {
  const t = topicTokens(topic);
  return t.length > 0 ? [...t].sort().join(" ") : topic.trim().toLowerCase();
}

/** Prefer a real DataForSEO search volume over a proxy score; break ties by score. */
function better<T extends DedupableCard>(a: T, b: T): boolean {
  const aHasVol = a.searchVolume != null && a.searchVolume > 0;
  const bHasVol = b.searchVolume != null && b.searchVolume > 0;
  if (aHasVol !== bHasVol) return aHasVol;
  if (aHasVol && bHasVol && a.searchVolume !== b.searchVolume) return (a.searchVolume ?? 0) > (b.searchVolume ?? 0);
  return a.score > b.score;
}

/**
 * Collapse near-duplicate topics (same distinguishing-token set, any word order) to
 * ONE card — the one with a real search-volume number, else the higher score. Order
 * of `kept` follows the FIRST occurrence of each surviving token-key (stable). Cards
 * with no distinguishing tokens at all are never merged with each other (falls back
 * to exact-string identity) so this never over-collapses generic/short labels.
 */
export function dedupeNewPageCards<T extends DedupableCard>(cards: readonly T[]): DedupeResult<T> {
  const byKey = new Map<string, T>();
  const order: string[] = [];
  const dropped: DedupeResult<T>["dropped"] = [];

  for (const card of cards) {
    const key = topicIdentityKey(card.topic);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, card);
      order.push(key);
      continue;
    }
    if (better(card, existing)) {
      byKey.set(key, card);
      dropped.push({
        id: existing.id,
        topic: existing.topic,
        keptInstead: card.topic,
        reason: `duplicate topic ("${existing.topic}" ~ "${card.topic}") — kept the one with ${card.searchVolume != null ? "real search volume" : "the higher score"}`,
      });
    } else {
      dropped.push({
        id: card.id,
        topic: card.topic,
        keptInstead: existing.topic,
        reason: `duplicate topic ("${card.topic}" ~ "${existing.topic}") — kept the one with ${existing.searchVolume != null ? "real search volume" : "the higher score"}`,
      });
    }
  }

  return { kept: order.map((k) => byKey.get(k)!), dropped };
}
