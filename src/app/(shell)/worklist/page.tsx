import { permanentRedirect } from "next/navigation";

/**
 * /worklist -> /changes (FP4 route-name unification, 2026-07-03).
 *
 * The diagnosis found one page carrying four names (Changes, worklist,
 * Tonight's changes, the worklist) while the URL "/changes" bounced somewhere
 * else entirely. The ranked Changes list now LIVES at /changes so the URL,
 * the nav label, and the page h1 finally agree. This is a permanent (308)
 * redirect that preserves query strings (?status=ready, ?search=...) so every
 * old bookmark and deep link keeps working.
 */
export default async function WorklistRedirect({
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
