import { redirect } from "next/navigation";

/**
 * Legacy "Drafts" list → the canonical Changes Ready view (2026-07-01, Move 5 / Move 1
 * consolidation). The prepared-draft list is a duplicate of the same moves the canonical
 * Changes list already shows (same MoveCard actions on expand), so the index now redirects
 * to /changes?status=ready. A `?page=` deep link forwards as a search so the operator
 * still lands on the right item. The per-rec brief + armed-publish review at
 * /recommendations/[id] is a distinct route and is UNCHANGED.
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
