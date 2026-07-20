import { permanentRedirect } from "next/navigation";

/**
 * /briefs -> /changes (retiring the standalone briefs UI surface, matching
 * the /worklist redirect precedent). The ranked Changes list is the single
 * surface for execution work; briefs as a separate list added a second view
 * of the same underlying work without adding a decision the operator
 * couldn't already make from Changes. This is a permanent (308) redirect
 * that preserves query strings so old bookmarks and deep links keep working.
 */
export default async function BriefsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value != null) qs.append(key, value);
  }
  const suffix = qs.toString();
  permanentRedirect(suffix ? `/changes?${suffix}` : "/changes");
}
