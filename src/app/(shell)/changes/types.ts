/**
 * Shared /changes row types. Surface collapse (2026-06-15); the raw-change-log timeline and its proof pill
 * were deleted with the legacy proof-timeline subsystem (terminal closure, 2026-08-26): the modern Results
 * surface owns that value, and git history is the archive.
 */
import type { ChangeProposal } from "@/domains/decision";
/** HOW MUCH OF THE RANKED QUEUE ONE SCREEN CARRIES. The queue itself is unlimited; a list of a
 *  hundred and twelve changes is not a decision surface, so the page opens with this many and says
 *  exactly how many are behind it. Shared by the server slice and the client's "Show more". Raised 25 to 100
 *  (operator, 2026-08-30): with production unlimited, 25 hid internal lanes past the first page behind a
 *  headline that counted only rendered rows; 100 keeps every near-term queue whole on first render. */
export const CHANGES_PAGE_SIZE = 100;

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
