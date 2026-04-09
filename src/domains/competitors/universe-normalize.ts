/** Normalize hostname for universe matching (no scheme, no path, lowercase). */
export function normalizeCompetitorDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  const slash = d.indexOf("/");
  if (slash >= 0) d = d.slice(0, slash);
  const q = d.indexOf("?");
  if (q >= 0) d = d.slice(0, q);
  d = d.replace(/^www\./, "");
  return d;
}
