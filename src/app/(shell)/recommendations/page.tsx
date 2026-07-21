import { redirect } from "next/navigation";

/**
 * Legacy "Drafts" list → the canonical Changes Ready view (2026-07-01, Move 5 / Move 1
 * consolidation). The prepared-draft list is a duplicate of the same moves the canonical
 * Changes list already shows (same MoveCard actions on expand), so the index now redirects
 * to /changes?status=ready. A `?page=` deep link forwards as a search so the operator
 * still lands on the right item. The per-rec brief route (/recommendations/[id]) and the
 * standalone card components were removed in the surface-collapse campaign (2026-07-21);
 * the recommendation ENGINE (edits persistence, action-types, response store, push,
 * attribution) is untouched and now surfaces through the Changes queue. This tiny stub
 * stays so lingering links and bookmarks still land on live work.
 */
export default async function RecommendationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = typeof sp.page === "string" ? sp.page : null;
  redirect(page ? `/changes?status=ready&search=${encodeURIComponent(page)}` : "/changes?status=ready");
}
