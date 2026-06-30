/**
 * safe-meta (2026-06-30) — the highest-yield, clearly-safe daily lever. Non-animal pages
 * mostly have good query-aligned TITLES but TEMPLATED/generic METAS ("Learn about the History
 * of Iran Flags and the X Flag… Discover its symbolism…"). The safe meta is NOT invented: it's
 * derived from the page's OWN opening paragraph, trimmed to a clean ~155-char snippet, and only
 * when that paragraph actually addresses the target query. PURE, deterministic, no LLM, no
 * fabrication. If the page text doesn't support a better meta → emit nothing (never force).
 */

const FILLER_META_LEAD = /^\s*(learn (all )?about|discover|explore|everything you need|all about|welcome to|read (all )?about|find out|complete guide|the complete guide|your (complete )?guide|ultimate guide)/i;
const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "with", "is", "are", "as", "at", "by", "its", "their"]);
const stem = (t: string): string => (t.length > 3 ? t.replace(/s$/, "") : t);
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t)).map(stem);
}
/** Most of the query's content tokens appear in the text (≥60%). */
function containsQuery(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  const q = tokens(query);
  if (q.length === 0) return false;
  const t = new Set(tokens(text));
  const hit = q.filter((tok) => t.has(tok)).length;
  return hit / q.length >= 0.6;
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const MIN_META = 80;
const MAX_META = 160;

/** A meta is WEAK (worth replacing) when it's missing, too short, marketing-filler-led, or
 *  doesn't even contain the target query. A bespoke meta that already carries the query is left
 *  alone. */
export function metaIsWeak(currentMeta: string | null | undefined, query: string): boolean {
  const m = (currentMeta ?? "").trim();
  if (m.length < 40) return true;
  if (FILLER_META_LEAD.test(m)) return true;
  if (!containsQuery(m, query)) return true;
  return false;
}

/** Trim text to a clean meta: prefer ending on a sentence boundary ≤ MAX, else a word boundary. */
function trimToMeta(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_META) return clean;
  const window = clean.slice(0, MAX_META);
  const lastSentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (lastSentence >= MIN_META) return window.slice(0, lastSentence + 1).trim();
  const lastSpace = window.lastIndexOf(" ");
  return window.slice(0, lastSpace > MIN_META ? lastSpace : MAX_META).trim();
}

export type SafeMetaProposal = { proposed: string; sourceText: string; source: "page_opening_paragraph" };

/**
 * Propose a safe, factual meta from the page's own opening paragraph. PURE. Returns null when:
 * the current meta is already strong; there's no opening paragraph to source from; the opening
 * doesn't address the query (don't fabricate); or the result isn't materially better.
 */
export function proposeSafeMeta(input: {
  currentMeta: string | null | undefined;
  openingParagraph: string | null | undefined;
  query: string;
}): SafeMetaProposal | null {
  if (!metaIsWeak(input.currentMeta, input.query)) return null; // current meta is fine
  const opening = (input.openingParagraph ?? "").trim();
  if (opening.length < MIN_META) return null; // no usable factual source → don't invent
  if (!containsQuery(opening, input.query)) return null; // page text doesn't address the query
  if (FILLER_META_LEAD.test(opening)) return null; // opening is itself boilerplate → skip
  const proposed = trimToMeta(opening);
  if (proposed.length < MIN_META || proposed.length > MAX_META) return null;
  if (!containsQuery(proposed, input.query)) return null; // the trimmed snippet must still carry the query
  if (norm(proposed) === norm(input.currentMeta ?? "")) return null; // not merely-different
  return { proposed, sourceText: opening.slice(0, 240), source: "page_opening_paragraph" };
}
