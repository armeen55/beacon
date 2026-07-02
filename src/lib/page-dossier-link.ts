import { normalizeUrl } from "@/lib/url/normalize";

/**
 * page-dossier-link (BEACON_500 item 54) - the one shared helper that turns a page
 * URL or path into a link to its /page/[...path] dossier. Pure, no "server-only" so
 * both server sections and client cards (e.g. the MoveCard) can import it. Returns
 * null for the create-page sentinel and any input that normalizes to nothing real,
 * so callers never render a dead link.
 */
const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";

export function dossierHref(pageUrlOrPath: string | null | undefined): string | null {
  if (!pageUrlOrPath || pageUrlOrPath === NEEDS_NEW_PAGE_SENTINEL) return null;
  const path = normalizeUrl(pageUrlOrPath);
  // The dossier is a catch-all route ([...path]) that requires at least one segment,
  // so the site root has no dossier page to link to.
  if (!path || path === "/") return null;
  return `/page${path}`;
}
