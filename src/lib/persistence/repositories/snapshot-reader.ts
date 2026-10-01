import { getSupabaseAdmin } from "../supabase";
import type { PageSnapshot } from "@/domains/evidence/pages/types";
import { selectPageVersion } from "@/domains/evidence/pages/page-version";
import { canonicalUrlKey } from "@/domains/evidence/relevance-gate";

type Capture = Pick<PageSnapshot, "id" | "page_id" | "url" | "fetched_at" | "word_count" | "extraction_certainty" | "content_hash"> & { bodyHeld?: boolean };
const facts = (s: Capture) => ({ fetchedAt: s.fetched_at, words: s.word_count ?? 0, bodyHeld: s.bodyHeld === true, certainty: s.extraction_certainty ?? null, contentIdentity: s.content_hash }), goodCapture = (s: Capture): boolean => s.extraction_certainty !== "uncertain" && ((s.word_count ?? 0) > 0 || s.bodyHeld === true);
const identityColumns = "id, page_id, url, fetched_at, word_count, extraction_certainty, content_hash";
const pageSize = 500, requestBytes = 8000;

/** Shared identity-first read: history never crowds out pages or their trusted bodies. */
export async function selectedSnapshots<T extends Pick<PageSnapshot, "id" | "fetched_at">>(tenantId: string, columns: string, urls?: readonly string[], options?: { retainPreviousTrusted?: boolean; retainCaptureIds?: readonly string[] }): Promise<T[]> {
  if (!tenantId.trim()) throw new Error("page snapshots require an explicit tenant");
  if (urls?.length === 0) return [];
  const sb = getSupabaseAdmin(), selected = new Map<string, Capture[]>(), heldBodies = new Map<string, string>();
  const baseBytes = Buffer.byteLength(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") + 24;
  const withinRequest = (params: Record<string, string>) => {
    if (baseBytes + new URLSearchParams(params).toString().length > requestBytes) throw new RangeError("Supabase snapshot query exceeds the encoded request budget");
  };
  const identities = () => {
    const q = sb.from("page_snapshots").select(identityColumns).eq("tenant_id", tenantId);
    return urls ? q.in("url", [...urls]) : q;
  };
  const scoped = { select: identityColumns, tenant_id: `eq.${tenantId}`, limit: String(pageSize), order: "page_id.asc,fetched_at.desc,id.desc", ...(urls ? { url: `in.(${urls.map((u) => JSON.stringify(u)).join(",")})` } : {}) };
  const payloads = async <R extends { id: string }>(ids: string[], projection: string): Promise<R[]> => {
    const out: R[] = [], query = { select: projection.replace(/\s/g, ""), tenant_id: `eq.${tenantId}`, limit: String(pageSize) };
    for (let start = 0; start < ids.length;) {
      const chunk: string[] = [];
      let bytes = baseBytes + new URLSearchParams(query).toString().length + "&id=in.%28%29".length;
      while (start < ids.length && chunk.length < pageSize) {
        const cost = new URLSearchParams({ id: JSON.stringify(ids[start]!) }).toString().length + 3;
        if (bytes + cost > requestBytes) break;
        chunk.push(ids[start++]!); bytes += cost;
      }
      if (!chunk.length) throw new RangeError("Supabase snapshot identity exceeds the encoded request budget");
      const { data, error } = await sb.from("page_snapshots").select(projection).eq("tenant_id", tenantId).in("id", chunk).limit(pageSize);
      if (error) throw new Error(`Supabase selected snapshot read failed: ${error.message}`);
      const rows = (data ?? []) as unknown as R[], actual = new Set(rows.map((r) => r.id));
      if (actual.size !== chunk.length || chunk.some((id) => !actual.has(id))) throw new Error("Supabase selected snapshot read was incomplete");
      out.push(...rows);
    }
    return out;
  };
  const keep = async (rows: Capture[]) => {
    const unknownEmpty = rows.filter((r) => r.extraction_certainty !== "uncertain" && !(r.word_count > 0) && !heldBodies.has(r.id));
    const observed = await payloads<{ id: string; body_text?: string | null }>(unknownEmpty.map((r) => r.id), "id, body_text");
    for (const r of observed) if (typeof r.body_text === "string") heldBodies.set(r.id, r.body_text);
    for (const row of rows) {
      row.bodyHeld = heldBodies.has(row.id);
      const merged = [...(selected.get(row.page_id) ?? []), row].filter((candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index), v = selectPageVersion(merged, facts), keep = v.current === v.content ? [v.current!] : [v.current!, v.content!], trusted = merged.filter(goodCapture).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at) || b.id.localeCompare(a.id)), current = v.current!, baseline = trusted.find((candidate) => (candidate.word_count ?? 0) >= 100 && (current.word_count ?? 0) * 5 < (candidate.word_count ?? 0) * 3), agreeing = current.content_hash ? trusted.find((candidate) => candidate.id !== current.id && candidate.fetched_at !== current.fetched_at && candidate.content_hash === current.content_hash && (!baseline || candidate.fetched_at > baseline.fetched_at)) : undefined; if (agreeing) keep.push(agreeing);
      if (options?.retainPreviousTrusted || options?.retainCaptureIds?.length) keep.push(...(options.retainPreviousTrusted ? trusted.slice(0, 2) : []), ...(options.retainPreviousTrusted && baseline ? [baseline] : []), ...merged.filter(candidate => options.retainCaptureIds?.includes(candidate.id)));
      selected.set(row.page_id, keep.filter((candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index));
    }
  };
  let afterPage: string | null = null;
  for (;;) {
    withinRequest({ ...scoped, ...(afterPage ? { page_id: `gt.${afterPage}` } : {}) });
    let q = identities().order("page_id", { ascending: true }).order("fetched_at", { ascending: false }).order("id", { ascending: false });
    if (afterPage !== null) q = q.gt("page_id", afterPage);
    const { data, error } = await q.limit(pageSize);
    if (error) throw new Error(`Supabase snapshot identity read failed: ${error.message}`);
    const rows = (data ?? []) as Capture[];
    await keep(rows);
    if (rows.length < pageSize) break;
    let boundary = rows[rows.length - 1]!;
    while (selectPageVersion(selected.get(boundary.page_id)!, facts).state === "blank" || options?.retainPreviousTrusted === true) {
      const at = JSON.stringify(boundary.fetched_at), id = JSON.stringify(boundary.id), olderThan = `fetched_at.lt.${at},and(fetched_at.eq.${at},id.lt.${id})`;
      withinRequest({ ...scoped, page_id: `eq.${boundary.page_id}`, or: `(${olderThan})` });
      const older = await identities().eq("page_id", boundary.page_id).or(olderThan)
        .order("fetched_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize);
      if (older.error) throw new Error(`Supabase snapshot history read failed: ${older.error.message}`);
      const history = (older.data ?? []) as Capture[];
      await keep(history);
      if (history.length < pageSize) break;
      boundary = history[history.length - 1]!;
    }
    afterPage = boundary.page_id;
  }
  const canonicalOwners = new Map<string, Set<string>>(); for (const [pageId, rows] of selected) { const key = canonicalUrlKey(rows[0]?.url); if (key) canonicalOwners.set(key, (canonicalOwners.get(key) ?? new Set<string>()).add(pageId)); }
  const ids = [...selected.values()].flatMap((rows) => { if (options?.retainPreviousTrusted || options?.retainCaptureIds?.length) return rows.map((r) => r.id); const v = selectPageVersion(rows, facts), chosen = v.current === v.content ? [v.current!] : [v.current!, v.content!], key = canonicalUrlKey(v.current?.url), witness = (canonicalOwners.get(key)?.size ?? 0) > 1 && v.current?.content_hash ? rows.find((r) => r.id !== v.current!.id && r.fetched_at !== v.current!.fetched_at && r.content_hash === v.current!.content_hash) : undefined; return [...new Set([...chosen, ...(witness ? [witness] : [])].map((r) => r.id))]; });
  const out = await payloads<T>(ids, columns);
  for (const row of out) if (heldBodies.has(row.id)) Object.assign(row, { body_text: heldBodies.get(row.id) });
  return out.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at) || b.id.localeCompare(a.id));
}
