/**
 * Shared /changes row types. Surface collapse (2026-06-15); the raw-change-log timeline and its proof pill
 * were deleted with the legacy proof-timeline subsystem (terminal closure, 2026-08-26): the modern Results
 * surface owns that value, and git history is the archive.
 */
// Client-safe contract seam. This module is imported by interactive controls, so the full Decision facade
// would pull server persistence, scheduling and provider modules into the browser bundle.
import type { BundleComponent, ChangeProposal } from "@/domains/decision";
/** HOW MUCH OF THE RANKED QUEUE ONE SCREEN CARRIES. The queue itself is unlimited; a list of a
 *  hundred and twelve changes is not a decision surface, so the page opens with this many and says
 *  exactly how many are behind it. Shared by the server slice and the client's "Show more". Raised 25 to 100
 *  (operator, 2026-08-30): with production unlimited, 25 hid internal lanes past the first page behind a
 *  headline that counted only rendered rows; 100 keeps every near-term queue whole on first render. */
export const CHANGES_PAGE_SIZE = 100;
/** THE ONE CADENCE SENTENCE, the same on Today, Changes and Results (audit 3.9, 2026-09-14): three different
 *  descriptions of when research runs were shown to the customer (once a day, during signed-in visits, no schedule). */
export const RESEARCH_CADENCE = "Research runs on its own every day; a visit only resumes it.";

/** One acknowledgement for list, detail and batch paths. It names only the measurement state the Shipment
 * actually stored and computes the healthy-path date from the implementation stamp. */
function measurementAcknowledgement(state: string | null | undefined, at: Date = new Date()): string {
  if (state === "insufficient_comparison") return "Recorded. Too few pages on your site can be fairly compared against this one yet, so the reading starts as soon as enough of them have search data.";
  if (state === "measurement_unavailable") return "Recorded. Your search data could not be read just now, so the reading starts as soon as it can be.";
  if (state === "verification_needed") return "Recorded. The page is checked next, and the reading starts from what is found there.";
  const lands = new Date(at.getTime() + 10 * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `Recorded, and the page is being watched. The first reading lands on Results around ${lands}; search data takes a few days to catch up with the live site.`;
}

const DANGEROUS_KINDS = new Set<BundleComponent["kind"]>(["canonical", "redirect", "noindex", "consolidation"]);
const HIGH_STAKES_CLAIM = /\b(law|legal|lawyer|attorney|court|statute|regulation|licen[cs]|liabilit|medical|medicine|doctor|clinical|diagnos|dosage|drug|symptom|treatment|patient|financial|finance|tax|taxes|loan|mortgage|interest rate|investment|insurance|refund|warrant)/i;
/** Browser-safe projection of the canonical Decision danger rule. Unknown future kinds still fail closed through
 * their risk grade; the four structural kinds and high-stakes corrections cannot be downgraded by a stale row. */
function isDangerousComponent(c: BundleComponent): boolean {
  return c.risk === "dangerous" || DANGEROUS_KINDS.has(c.kind)
    || (c.kind === "factual_correction" && HIGH_STAKES_CLAIM.test(`${c.before ?? ""} ${c.after}`));
}

/** The manual proving phase serves only bounded edits to an existing page. One predicate guards every
 * presentation and action door, including old stored rows created before the phase narrowed. */
function isManualEditProofWork(p: ChangeProposal): boolean {
  if (p.kind === "new_page" || p.recommendedChange.kind === "new_page" || p.changeFamily === "full_rewrite") return false;
  if (p.recommendedChange.target?.mode === "whole_body") return false;
  return !(p.bundle?.components ?? []).some((c) => c.kind === "new_page" || c.kind === "full_rewrite" || c.target?.mode === "whole_body");
}

/** Bulk recording carries no per-piece selection or destructive confirmation. It is therefore valid only
 * for one nondestructive existing-page deliverable; every bundle is recorded from its own detail. */
function isBulkRecordable(p: ChangeProposal): boolean {
  if (!isManualEditProofWork(p) || p.kind !== "existing_edit" || p.recommendedChange.kind !== "existing_edit") return false;
  const components = p.bundle?.components ?? [];
  return components.length <= 1 && !components.some(isDangerousComponent);
}

/** Publication copy is allowlisted. Structural steps and any future/unknown kind fail closed as instructions. */
function isPasteableComponent(c: BundleComponent): boolean {
  if (!c.after.trim() || isDangerousComponent(c)) return false;
  switch (c.kind) {
    case "title": case "meta": case "h1": case "opening_answer": case "section":
    case "paragraph_correction": case "section_add": case "section_rewrite": case "full_rewrite":
    case "factual_correction": case "source_update": case "entity_expansion": case "table_or_list_add": case "schema":
      return true;
    case "internal_link_add": return !!c.units || (!!c.anchorAfter && !!c.redirectTo);
    case "source_pack": case "restructure": return !!c.units;
    default: return false;
  }
}
type LinkedComponent = { id: string; dependsOn?: readonly string[] };
/** A derived component and every component it names are one undirected group. Starting at either side reaches
 * the whole group, including a future chain of derivations, so the browser and the server cannot disagree. */
function linkedComponentIds(components: readonly LinkedComponent[], seed: string): Set<string> {
  const linked = new Set([seed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const component of components) {
      const group = [component.id, ...(component.dependsOn ?? [])];
      if (!group.some((id) => linked.has(id))) continue;
      for (const id of group) if (!linked.has(id)) { linked.add(id); grew = true; }
    }
  }
  return linked;
}
/** Browser and clipboard destinations share HTTP(S) resolution; relative targets need their owning page. */
function livePageHref(value: string | null | undefined, pageUrl?: string | null): string | null {
  const raw = (value ?? "").trim(); if (!raw) return null;
  const candidate = /^[^:/?#]+\.[^:/?#]+(?::\d+)?(?:[/?#]|$)/.test(raw) ? `https://${raw}` : raw, base = pageUrl ? livePageHref(pageUrl) : null;
  try { const parsed = new URL(candidate, base ?? undefined); return /^(?:http|https):$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; }
}
const operatorUiPolicy = { isManualEditProofWork, isBulkRecordable, isPasteableComponent, linkedComponentIds, measurementAcknowledgement, livePageHref };
export default operatorUiPolicy;

/** A PAGE ADDRESS, READ THE WAY A PERSON SAYS IT. Every change surface printed the raw slug as its headline
 *  ("/famous-iranian-comedians"), which is a file name, not a page. The last segment becomes the name, the
 *  address stays beside it as the small line. Pure, shared by Changes, the change detail and Results. */
export function pageLabel(path: string | null | undefined): string {
  // No address is NOT the home page: claiming a specific page for a missing one is the lie this exists to kill.
  if (!(path ?? "").trim()) return "This page";
  const trimmed = (path ?? "").replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  const last = trimmed.split("/").filter(Boolean).pop();
  if (!last) return "Home page";
  let words = last;
  try { words = decodeURIComponent(last); } catch { /* a half-encoded path is said as it is written */ }
  words = words.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  // A de-slug that emptied out falls back to the raw segment rather than inventing a page.
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : last;
}

/** WHAT A PERSON SHOULD KEEP IN MIND ABOUT THE WORDS ON OFFER, decided ONCE for the list and the detail
 *  (operator, 2026-09-06: "Remove stale caveats from previous drafts and contradictory boilerplate"). The list
 *  printed the row's RAW limitations and the detail printed the hold's filtered caveats, so one row said two
 *  different things on two screens. TWO MECHANICAL TESTS, no reading of prose: a caveat naming a BLANK (an
 *  all-caps token a writer leaves for the operator to fill, "publishing NAME and SOUND") stands only while the
 *  copy still carries that blank, because once the words moved on it is a caveat about a draft that is gone;
 *  and a caveat saying there is nothing to paste never rides copy there is something to paste. The readiness
 *  verdict's own `advisories` ride with them wherever the row carries them, and a row banked before that field
 *  existed reads as none, so nothing here depends on the field arriving. */
const BLANK = /\b[A-Z]{4,}\b/g; // four letters up, so a three letter acronym in an ordinary sentence is never read as a slot in the copy
const DENIES_COPY = /ready to paste|has not been written|is not written yet|is still owed/i;
export function cardCaveats(p: ChangeProposal & { advisories?: unknown }, filtered: readonly string[]): string[] {
  const c = p.recommendedChange;
  const copy = [c.kind === "new_page" ? `${c.proposedTitle} ${c.metaDescription} ${c.openingAnswer}` : `${c.after} ${c.where ?? ""}`,
    ...(p.bundle?.components ?? []).map((x) => `${x.after} ${x.where ?? ""}`)].join(" ");
  const said = (a: unknown): string => (typeof a === "string" ? a : a != null && typeof a === "object"
    ? String((a as Record<string, unknown>).note ?? (a as Record<string, unknown>).sentence ?? (a as Record<string, unknown>).text ?? "") : "");
  const rows = [...(Array.isArray(p.advisories) ? p.advisories : []).map(said), ...filtered];
  return [...new Set(rows.map((s) => s.trim()).filter(Boolean))]
    .filter((s) => !(copy.trim().length > 0 && DENIES_COPY.test(s)))
    .filter((s) => (s.match(BLANK) ?? []).every((t) => copy.includes(t)));
}
