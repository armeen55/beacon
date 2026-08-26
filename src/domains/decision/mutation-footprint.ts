/** decision/mutation-footprint: THE one answer to "what does this change actually write", used by BOTH the
 *  store that persists a proposal and the queue that serves it. ONE PAGE IS NOT ONE OPPORTUNITY (operator,
 *  2026-08-26): a page may carry 1, 5, 20 or 40 separate ranked changes, so nothing here may key on the page
 *  alone. What two rows can genuinely collide over is the MUTATION each one writes, and a change writes as
 *  many mutations as it has pieces, which is why this returns a SET and not a string.
 *
 *  Before this existed the queue asked a cruder question: does another row on this page carry a bundle? If so
 *  every non-bundle row on that page was dropped before ranking. Live, that hid eight standing rows behind
 *  one table-row bundle, including three the operator had already been shown as Ready: the /farsi-numbers zero
 *  explainer, and the Late Safavid linked paragraph and title. A table row is not a heading, a heading is not
 *  a title, and none of them is a schema block. Two rows overlap when what they WRITE overlaps, never merely
 *  because they land on the same page. */
import type { BundleComponent, BundleComponentKind, ChangeProposal } from "@/domains/decision/contracts";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";

/** WHICH SLOT a piece writes. Kinds sharing a slot really would overwrite each other; kinds in different slots
 *  never can. `body` is deliberately broad: every way of writing prose into a page competes for the same words,
 *  and it is the TOPIC below that separates two sections answering different questions. */
const SLOT_BY_KIND: Record<BundleComponentKind, string> = {
  title: "title", meta: "meta", h1: "h1",
  opening_answer: "body", section: "body", section_add: "body", section_remove: "body", section_rewrite: "body",
  restructure: "body", paragraph_correction: "body", entity_expansion: "body",
  source_pack: "body", factual_correction: "body", source_update: "body",
  table_or_list_add: "table", anchor_text: "anchor",
  internal_links: "link", internal_link_add: "link", internal_link_remove: "link",
  schema: "schema", navigation: "navigation",
  // WHAT TAKES THE WHOLE PAGE takes everything on it. A page being forwarded away, hidden from search, merged
  // into another or rebuilt from the first line down cannot sit beside an instruction to retitle it: the old
  // page-wide rule covered that pair by accident, and dropping it without this would have the queue ask the
  // operator to polish a page it also says to delete.
  canonical: "*", redirect: "*", noindex: "*", consolidation: "*", full_rewrite: "*",
  new_page: "new_page",
};
/** Slots a page has exactly ONE of, so the page and the slot name the whole mutation. Every other slot needs a
 *  discriminator, because a page has as many table rows, anchor labels and links as it has places to put them. */
const SINGLETON_SLOT: ReadonlySet<string> = new Set(["title", "meta", "h1", "schema", "navigation", "*"]);

/** ONE spelling of a page, because the old rule read raw `pagePath` while everything around it normalized
 *  differently, and two spellings of one page silently stopped colliding. Origin off, trailing slash off, lowercase. */
function pageToken(raw: string | null | undefined): string {
  const s = (raw ?? "").trim(); if (!s) return "";
  const path = /^https?:\/\//i.test(s) ? (() => { try { return new URL(s).pathname; } catch { return s; } })() : s.replace(/^[^/]*\.[^/]*(?=\/)/, "");
  return (path.replace(/\/+$/, "") || "/").toLowerCase();
}

/** A STABLE, COLLISION-RESISTANT NAME FOR ONE PLACE ON A PAGE. The old key truncated each piece at 48 characters
 *  and the whole key at 180, and production already held a row sitting exactly on that 180 cap: two genuinely
 *  different link bundles could compute one key and silently retire each other. A digest cannot. */
function placeToken(text: string | null | undefined): string {
  const flat = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!flat) return "-";
  let h = 0x811c9dc5; for (let i = 0; i < flat.length; i += 1) { h ^= flat.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The one mutation a piece writes: page, slot, and (where a page can have several) which one. */
function componentToken(c: BundleComponent, p: ChangeProposal): string {
  const slot = SLOT_BY_KIND[c.kind] ?? "body", page = pageToken(c.page ?? p.pagePath ?? p.pageUrl);
  if (slot === "new_page") return `new_page::${canonicalQueryKey(p.primaryQuery ?? "")}`;
  if (SINGLETON_SLOT.has(slot)) return `${page}::${slot}`;
  // A SECTION IS NAMED BY THE QUESTION IT ANSWERS, not by where it happens to land: two answers to one question
  // overwrite each other wherever they sit, and two answers to different questions never do.
  if (slot === "body") return `${page}::body::${canonicalQueryKey(p.primaryQuery ?? "")}`;
  return `${page}::${slot}::${placeToken(c.anchorAfter ?? c.where ?? c.after)}`;
}

/** EVERY MUTATION THIS CHANGE WRITES, one token per independently applied edit. A bundle writes one per piece;
 *  an atomic edit writes exactly one; a new page writes its TOPIC and nothing else. PURE, and the ONLY definition
 *  of what a change touches: the store supersedes on it and the queue suppresses on it, so neither can drift.
 *  THE PAGE QUESTION IS ASKED LAST. Asking the components first read a page brief, which carries a title and a
 *  meta for a page that does not exist yet, as writing the title of the empty path: every brief in the account
 *  computed `::title` and collided with every other, so three ready briefs served one. A brief owns a demand,
 *  not a page, and only another brief for that same demand can take it. */
export function mutationFootprint(p: ChangeProposal): ReadonlySet<string> {
  if (p.kind === "new_page" || p.recommendedChange.kind === "new_page") return new Set([`new_page::${canonicalQueryKey(p.primaryQuery ?? "")}`]);
  const parts = p.bundle?.components ?? [];
  if (parts.length > 0) return new Set(parts.map((c) => componentToken(c, p)));
  const page = pageToken(p.pagePath ?? p.pageUrl), field = p.recommendedChange.field;
  if (field === "title" || field === "meta" || field === "h1") return new Set([`${page}::${field}`]);
  return new Set([`${page}::body::${canonicalQueryKey(p.primaryQuery ?? "")}`]);
}

/** Does ONE token cover another: itself, or the whole-page token standing over everything on its page. */
const covers = (a: string, b: string): boolean => a === b || (a.endsWith("::*") && b.startsWith(a.slice(0, -1)));

/** DO THESE TWO CHANGES WRITE ANY OF THE SAME THING. The whole overlap rule, in one line, so no caller invents
 *  its own: a title bundle and a plain title rewrite still collide because both write the title, while a table
 *  row and a heading on one page never do. */
export function footprintsOverlap(a: ChangeProposal, b: ChangeProposal): boolean {
  const left = [...mutationFootprint(a)];
  for (const t of mutationFootprint(b)) if (left.some((l) => covers(l, t) || covers(t, l))) return true;
  return false;
}

/** DOES `a` WRITE EVERYTHING `b` WRITES, so replacing b with a loses none of b's work. The store retires a
 *  neighbour only on this, never on a bare intersection: a title-only rewrite intersects a bundle that also
 *  moves the canonical and adds a link, and letting it supersede that bundle would throw the rest of the
 *  bundle's work away with no receipt saying so. */
export function footprintCovers(a: ChangeProposal, b: ChangeProposal): boolean {
  const left = [...mutationFootprint(a)];
  for (const t of mutationFootprint(b)) if (!left.some((l) => covers(l, t))) return false;
  return true;
}

/** The footprint as ONE string, for the stored `mutation_key` column and its partial unique index. Sorted, so a
 *  bundle that merely reorders its pieces keeps its key. The index is a BACKSTOP against exact duplicates only:
 *  genuine overlap is decided by the two predicates above against the decoded rows, never by comparing this text. */
export function footprintKey(p: ChangeProposal): string {
  return [...mutationFootprint(p)].sort().join("|").slice(0, 180);
}
