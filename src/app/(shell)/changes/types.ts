/**
 * Shared /changes row types. Surface collapse (2026-06-15); the raw-change-log timeline and its proof pill
 * were deleted with the legacy proof-timeline subsystem (terminal closure, 2026-08-26): the modern Results
 * surface owns that value, and git history is the archive.
 */
/** HOW MUCH OF THE RANKED QUEUE ONE SCREEN CARRIES. The queue itself is unlimited; a list of a
 *  hundred and twelve changes is not a decision surface, so the page opens with this many and says
 *  exactly how many are behind it. Shared by the server slice and the client's "Show more". */
export const CHANGES_PAGE_SIZE = 25;

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
