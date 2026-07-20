import { permanentRedirect } from "next/navigation";

/**
 * /briefs/[id] -> /changes (retiring the standalone briefs UI surface, matching
 * the /worklist redirect precedent). Brief ids don't map to a single change
 * record, so old bookmarks land on the ranked Changes list rather than a
 * dead end. This is a permanent (308) redirect that preserves query strings.
 */
export default async function BriefDetailRedirect({
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
