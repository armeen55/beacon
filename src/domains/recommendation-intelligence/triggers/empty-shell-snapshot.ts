/**
 * 2026-06-13 — page-basics false-positive guard.
 *
 * Beacon's scanner fetches raw HTML (no JS execution). Client-rendered
 * sites (Wix, etc.) serve a pre-hydration SHELL whose <head>/<body> carry
 * no real title / h1 / meta until JavaScript runs. Intermittently the
 * scan captures that shell at HTTP 200, producing a snapshot with
 * `title`, `h1`, AND `meta_description` all null/empty.
 *
 * The `missing_title` / `missing_h1` / `missing_meta` predicates would
 * then emit high-confidence "add a title / H1 / meta" cards for pages
 * that actually HAVE all three — a false positive. Proven on Iranopedia
 * (2026-06-13): the same URLs captured full title+h1+meta on most days,
 * but a few JS-shell scrapes were all-empty and spawned no-op cards;
 * `/persian-rugs/mashhad-rug` live serves `<title>Mashhad Rug: Motifs,
 * History, and Patterns</title>` + a meta description.
 *
 * This guard: a 200-OK snapshot with title AND h1 AND meta_description
 * ALL empty is treated as a failed render, not a real page — the
 * page-basics triggers skip it. A real 200 HTML page virtually always
 * has at least a <title>; when only ONE basic is missing (the others
 * present) it's a genuine gap and the trigger still fires.
 *
 * PURE. No I/O. Keeps the predicates pure (purity ratchet).
 *
 * @no-classifier-required — this is a shared guard helper, not a trigger
 * predicate; page-type classification does not apply to it.
 */

import type { PageSnapshot } from "@/domains/pages/types";

function isBlank(v: string | null | undefined): boolean {
  return v == null || v.trim().length === 0;
}

export function isLikelyEmptyShellSnapshot(s: PageSnapshot): boolean {
  return (
    s.http_status === 200 &&
    isBlank(s.title) &&
    isBlank(s.h1) &&
    isBlank(s.meta_description)
  );
}
