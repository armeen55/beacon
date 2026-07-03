import { permanentRedirect } from "next/navigation";

/**
 * /proof -> /results (FP4 route-name unification, 2026-07-03).
 *
 * The nav has said "Results" since the 2026-07-01 consolidation while the URL
 * still said /proof (a lab word the Beacon voice bans from primary surfaces).
 * The results page now LIVES at /results; this permanent (308) redirect
 * preserves query strings (?page=...) so old bookmarks and deep links keep
 * working.
 */
export default async function ProofRedirect({
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
  permanentRedirect(suffix ? `/results?${suffix}` : "/results");
}
