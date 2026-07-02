/**
 * dedupe-new-page-cards (2026-07-02, UX0 — New Pages data-correctness) — a PURE final
 * pass over the New Pages board's combined card list (graph-sourced + keyword-gap +
 * wiki-gap) that collapses near-duplicate topics into ONE card. The upstream sources
 * already skip a topic that's a plain substring of an existing one, but that check
 * misses reordered/near-duplicate phrasing ("restaurants in tehran" vs "tehran
 * restaurants") — operator ground-truth found duplicate restaurant queries reaching
 * the board with two DIFFERENT demand numbers from two sources, reading as the app
 * contradicting itself. This normalizes every card's topic to its distinguishing-
 * token set (reusing keyword-match.ts's tenant-agnostic tokenizer) and keeps exactly
 * one card per set: the one with a real (non-null) search volume, else the higher
 * score. PURE / no I/O.
 */
import { topicDistinguishingTokens } from "@/domains/demand/keyword-match";

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

function tokenKey(topic: string): string {
  const t = topicDistinguishingTokens(topic);
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
    const key = tokenKey(card.topic);
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
