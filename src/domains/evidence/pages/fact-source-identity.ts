import { createHash } from "node:crypto";
import { readPublicPageExtract } from "../dataforseo/page-extract-cache";
import { pageExtractFromRecord } from "../funnel/research-evidence";
import type { FactCheck } from "./fact-checks";

type SourceText = { sections?: readonly { heading: string | null; text: string }[]; mainText?: string | null; bodyText?: string | null; openingSample?: string | null; headings?: readonly string[] };
const sourceTextOf = (p: SourceText): string => p.sections?.length
  ? p.sections.map((s) => [s.heading, s.text].filter(Boolean).join("\n")).join("\n")
  : [p.mainText ?? p.bodyText, p.openingSample, ...(p.headings ?? [])].filter(Boolean).join("\n");
const sourceHashOf = (text: string): string => createHash("sha256").update(text).digest("hex");
type CachedSource = { text: string; fetchedAt: string; structured?: boolean };
const usable = (p: SourceText & { truncated?: boolean | null }, at: string, structured = false): boolean => p.truncated === false && !!p.mainText?.trim() && Number.isFinite(Date.parse(at)) && Date.parse(at) <= Date.now() && (!structured || (p.sections?.length ?? 0) >= 2);
async function readCachedFactSource(url: string): Promise<CachedSource | null> {
  const cached = await readPublicPageExtract(url).catch(() => null);
  if (!cached) return null;
  const parsed = pageExtractFromRecord(cached.extract), text = sourceTextOf(parsed);
  return usable(parsed, cached.fetchedAt) && text.trim() ? { text, fetchedAt: cached.fetchedAt, structured: (parsed.sections?.length ?? 0) >= 2 } : null;
}
/** Only a newer banked read of a source this exact finding read can invalidate it. */
async function changedSourceFacts(rows: readonly FactCheck[], read: (url: string) => Promise<CachedSource | null> = readCachedFactSource): Promise<FactCheck[]> {
  const seen = new Map<string, Promise<CachedSource | null>>(), changed: FactCheck[] = [];
  for (const row of rows) {
    if (row.state !== "checked") continue;
    for (const source of row.sources) {
      if (!source.readHash || !source.readAt) continue;
      if (!seen.has(source.url)) seen.set(source.url, read(source.url).catch(() => null));
      const current = await seen.get(source.url)!;
      if (current && (!source.sectionsRead || current.structured) && Date.parse(current.fetchedAt) > Date.parse(source.readAt) && sourceHashOf(current.text) !== source.readHash) { changed.push(row); break; }
    }
  }
  return changed;
}
export const FACT_SOURCE = { text: sourceTextOf, hash: sourceHashOf, changed: changedSourceFacts, usable };
