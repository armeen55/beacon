/** EVIDENCE - the owned-page inventory (discovery through the site's OWN answer inside hard bounds, first_seen kept, a refusing page held back, a crawl finished
 *  only when the inventory is) and the whole-page read that can finally answer "no". ONE in-memory stand-in for the two tables, with filters, ordering and paging
 *  applied for real, so a query that forgot its tenant scope shows up here as another account's row coming back. No network. */
import { beforeEach, describe, expect, it, vi } from "vitest"; import { createHash } from "node:crypto";
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ owned: [] as Record<string, unknown>[], snaps: [] as Record<string, unknown>[], missing: "", fails: false }));
const FRESH = { crawl_state: "uncrawled", completeness: "missing", is_canonical_target: true, http_status: null, last_crawled_at: null, content_hash: null, blocked_until: null, redirects_to: null };
function fake(name: string) {
  const T = () => (name === "owned_pages" ? db.owned : db.snaps);
  const f: ((r: Row) => boolean)[] = []; let mode = "select", patch: Row = {}, rows: Row[] = [], skipDup = false, key = "", asc = true, lim = Infinity, from = 0;
  const run = () => {
    if (db.missing === name || db.fails) return { data: null, error: { code: db.fails ? "500" : "PGRST205", message: "Could not find the table" } };
    if (mode === "upsert") {
      for (const r of rows) { const at = T().findIndex((x) => x.tenant_id === r.tenant_id && x.url === r.url);
        if (at >= 0) { if (!skipDup) T()[at] = { ...T()[at], ...r }; continue; }
        T().push({ ...FRESH, first_seen: new Date().toISOString(), last_seen_in_discovery: new Date().toISOString(), ...r }); }
      return { data: rows, error: null }; }
    let out = T().filter((r) => f.every((p) => p(r)));
    if (mode === "update") { for (const r of out) Object.assign(r, patch); return { data: out, error: null }; }
    if (key) out = [...out].sort((a, z) => (String(a[key] ?? "") < String(z[key] ?? "") ? -1 : 1) * (asc ? 1 : -1));
    return { data: out.slice(from, from + lim), error: null }; };
  const b = { select: () => b, update: (p: Row) => { mode = "update"; patch = p; return b; }, limit: (n: number) => { lim = n; return b; },
    upsert: (r: Row[], o?: { ignoreDuplicates?: boolean }) => { mode = "upsert"; rows = r; skipDup = !!o?.ignoreDuplicates; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; }, in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return b; },
    lt: (c: string, v: string) => { f.push((r) => r[c] != null && String(r[c]) < v); return b; }, lte: (c: string, v: string) => { f.push((r) => r[c] != null && String(r[c]) <= v); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { key = c; asc = o?.ascending !== false; return b; }, then: (res: (v: unknown) => unknown) => res(run()),
    range: (a: number, z: number) => { from = a; lim = z - a + 1; return b; } };
  return b; }
vi.mock("@/lib/persistence/supabase", async (o) => ({ ...((await o()) as object), getSupabaseAdmin: () => ({ from: (t: string) => fake(t) }) }));
import { discoverUrls, runInProcessColdStartScan, MAX_DISCOVERED_URLS } from "@/domains/evidence/scanning/in-process-scan"; import { completenessOf, runCrawlBatch, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { markBlocked, markCrawled, nextCrawlCandidates, readInventory, upsertDiscovery } from "@/domains/evidence/scanning/owned-pages-store";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor"; import { loadOwnedPageBodies, pageContains } from "@/domains/evidence/pages/owned-context";

const T = "tenant-own", OTHER = "tenant-other", NOW = new Date("2026-08-03T00:00:00.000Z"), asked: string[] = [];
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const serve = (map: Record<string, string>) => (async (u: string) => (asked.push(String(u)), map[String(u)] == null
  ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, url: String(u), text: async () => map[String(u)] })) as unknown as typeof fetch;
const urlset = (u: string[]) => `<urlset>${u.map((x) => `<url><loc>${x}</loc></url>`).join("")}</urlset>`;
const index = (k: string[]) => `<sitemapindex>${k.map((x) => `<sitemap><loc>${x}</loc></sitemap>`).join("")}</sitemapindex>`;
const discover = (m: Record<string, string>) => discoverUrls("https://own.com", serve(m), 100, () => NOW.getTime(), NOW.getTime() + 60_000);
beforeEach(() => { db.owned = []; db.snaps = []; db.missing = ""; db.fails = false; asked.length = 0; });

describe("the owned-page inventory: what the site says it has, and what my read of it found", () => {
  it("follows the Sitemap: directive robots.txt publishes, three levels of index nesting deep, and inventories what it found", async () => {
    const out = await discover({ // the sitemap is at NEITHER conventional path: only the directive finds it
      "https://own.com/robots.txt": "User-agent: *\nDisallow: /admin\nSitemap: https://own.com/sm/root.xml",
      "https://own.com/sm/root.xml": index(["https://own.com/sm/mid.xml"]), "https://own.com/sm/mid.xml": index(["https://own.com/sm/leaf.xml", "https://own.com/sm/deeper.xml", "https://evil.example/sm.xml"]),
      "https://own.com/sm/leaf.xml": urlset(["https://own.com/a/", "https://own.com/b?utm=x", "https://own.com/a"]),
      "https://own.com/sm/deeper.xml": index(["https://own.com/sm/too-deep.xml"]), "https://own.com/sm/too-deep.xml": urlset(["https://own.com/never"]) }); // a FOURTH level is past the bound
    expect([out.source, out.truncated, out.pages.every((p) => p.via === "robots_sitemap"), asked.some((u) => u.includes("evil.example"))]).toEqual(["sitemap", 0, true, false]); // a child index on another host is dropped UNFETCHED
    expect(out.pages.map((p) => p.url).sort()).toEqual(["https://own.com/a", "https://own.com/b"]); // canonical, deduped, query dropped, never the too-deep page
    expect(await upsertDiscovery(T, out.pages)).toBe(2);
    expect((await readInventory(T, { limit: 10 })).map((r) => [r.url, r.crawl_state, r.completeness])).toEqual([["https://own.com/a", "uncrawled", "missing"], ["https://own.com/b", "uncrawled", "missing"]]);
    expect(await readInventory(OTHER, { limit: 10 })).toEqual([]); }); // never another account's inventory
  it("keeps the conventional path as a fallback, COUNTS what one pass could not record, and says plainly when it has no inventory yet", async () => {
    const out = await discover({ "https://own.com/sitemap.xml": urlset(Array.from({ length: MAX_DISCOVERED_URLS + 3 }, (_, i) => `https://own.com/p${i}`)) });
    expect([out.pages.length, out.truncated, out.pages[0]!.via]).toEqual([MAX_DISCOVERED_URLS, 3, "sitemap"]);
    db.missing = "owned_pages"; // the pre-migration window is never reported as an empty website
    expect([await upsertDiscovery(T, [{ url: "/a", via: "sitemap" }]), await readInventory(T)]).toEqual([0, []]); });
  it("preserves first_seen across rediscovery and never undoes what the crawl learned", async () => {
    await upsertDiscovery(T, [{ url: "https://own.com/a", via: "sitemap" }]); const firstSeen = (await readInventory(T))[0]!.first_seen;
    await markCrawled(T, "https://own.com/a", { httpStatus: 200, contentHash: "h1", completeness: "complete" }, NOW);
    await new Promise((r) => setTimeout(r, 2)); expect(await upsertDiscovery(T, [{ url: "https://own.com/a", via: "nav" }])).toBe(1);
    const row = (await readInventory(T))[0]!;
    expect([row.first_seen, row.crawl_state, row.content_hash, row.last_seen_in_discovery > firstSeen]).toEqual([firstSeen, "crawled", "h1", true]); });
  it("gives a refusal a bounded retry date, holds the page back until it passes, and backs off further each time", async () => {
    await upsertDiscovery(T, [{ url: "https://own.com/locked", via: "sitemap" }, { url: "https://own.com/gone", via: "sitemap" }]);
    await markBlocked(T, "https://own.com/locked", 403, NOW); await markBlocked(T, "https://own.com/gone", 404, NOW);
    const locked = () => readInventory(T).then((rs) => rs.find((r) => r.url.endsWith("/locked"))!); expect([(await locked()).crawl_state, (await locked()).completeness, (await locked()).blocked_until]).toEqual(["blocked", "blocked", at(1).toISOString()]);
    expect(await nextCrawlCandidates(T, 10, at(0.5))).toEqual([]); // inside the wait: not a candidate
    expect(await nextCrawlCandidates(T, 10, at(2))).toEqual(["https://own.com/locked"]); // due again, and a 404 never is
    await markBlocked(T, "https://own.com/locked", 403, at(2)); expect((await locked()).blocked_until).toBe(at(9).toISOString()); // SAME refusal, second attempt: a day was not enough, so a week
    await markBlocked(T, "https://own.com/locked", 403, at(9)); expect((await locked()).blocked_until).toBe(at(39).toISOString()); // then a month, the ceiling: the ladder is attempt-driven, not status-driven
    await upsertDiscovery(T, [{ url: "https://own.com/flaky", via: "sitemap" }]); await markBlocked(T, "https://own.com/flaky", 500, NOW); // a server error is a failure, never a read
    const flaky = (await readInventory(T)).find((r) => r.url.endsWith("/flaky"))!; expect([flaky.crawl_state, flaky.last_crawled_at, flaky.blocked_until, await nextCrawlCandidates(T, 10, at(0.5))]).toEqual(["uncrawled", null, at(1).toISOString(), []]); }); // unread, unstamped, waiting
});

describe("evidence - my own page's actual words, read narrowly", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${"ordinary prose about this page. ".repeat(8)}`).join(" ") + " The Zephyr Archive opens at dawn.";
  const html = `<html><head><title>Deep</title></head><body><nav>Menu Home About</nav><main>${long.split(". ").map((s) => `<p>${s}.</p>`).join("")}</main><footer>Footer</footer></body></html>`;
  const snapRow = (over: Record<string, unknown> = {}) => ({ tenant_id: T, url: "https://own.com/actors", title: "T", meta_description: "M", fetched_at: "2026-06-11T00:00:00.000Z",
    body_paragraph_sample: ["Iran has a deep film history."], card_texts: ["Card"], schema_entity_names: ["Person"], internal_links: [{ href: "/a", anchor_text: "A" }], ...over });
  const read = async (url = "https://own.com/actors") => (await loadOwnedPageBodies(T, [url])).get(url.replace("https://", ""))!;
  it("reads only the asked tenant and the asked URLs, refuses a wider ask, fails closed to no bodies, and never passes headings off as body text", async () => {
    db.snaps = [snapRow(), snapRow({ url: "https://own.com/other" }), snapRow({ tenant_id: OTHER, title: "Not mine" })];
    expect([...(await loadOwnedPageBodies(T, ["https://own.com/actors"])).keys()]).toEqual(["own.com/actors"]); // a page I did not ask about, and an account not mine, are never keyed in
    expect((await loadOwnedPageBodies(T, ["a", "b", "c", "d"])).size).toBe(0); // four is past the bound: refused, never fanned out
    db.fails = true; expect((await loadOwnedPageBodies(T, ["https://own.com/actors"])).size).toBe(0); db.fails = false; // a broken read is never an empty page
    db.snaps = [snapRow({ body_paragraph_sample: undefined, h2_list: ["Famous Actors"], card_texts: ["Golshifteh Farahani"] })];
    expect([(await read()).openingSample, (await read()).cardTexts]).toEqual([null, ["Golshifteh Farahani"]]); }); // no body text on file is said plainly, never filled in from labels
  it("holds the whole de-chromed page, hashes exactly the text it holds, and only then answers a whole-page question with no", async () => {
    const snap = extractPageSnapshot(html, "https://own.com/deep", "page-1", T, 200, null);
    expect([snap.body_text!.includes("Zephyr Archive"), snap.body_text!.includes("Menu Home About"), completenessOf(snap)]).toEqual([true, false, "complete"]);
    expect(extractPageSnapshot("<html><body><nav>Menu</nav></body></html>", "https://own.com/empty", "page-2", T, 200, null).body_text).toBe(""); // a page with nothing to say holds the empty string, never nothing at all
    expect(snap.content_hash).toBe(createHash("sha256").update(snap.body_text!).digest("hex").slice(0, 16));
    await upsertDiscovery(T, [{ url: "https://own.com/deep", via: "sitemap" }]);
    await markCrawled(T, "https://own.com/deep", { httpStatus: 200, contentHash: snap.content_hash, completeness: completenessOf(snap) }, NOW);
    const row = (await readInventory(T))[0]!; expect([row.crawl_state, row.completeness, row.content_hash]).toEqual(["crawled", "complete", snap.content_hash]);
    db.snaps = [snapRow({ url: "https://own.com/deep", word_count: snap.word_count, body_text: snap.body_text })]; const body = await read("https://own.com/deep");
    expect([body.completeness, pageContains(body, "Zephyr Archive"), pageContains(body, "a fact this page never states")]).toEqual(["complete", "yes", "no"]);
    expect(body.heldNote).not.toMatch(/[—–]/); });
  it("still reads a sample-era row as a sample, so absence stays unknown on it, and records what a ceiling cut", async () => {
    db.snaps = [snapRow({ body_paragraph_sample: ["x".repeat(300), "The kite festival opens at dawn."], word_count: 4_000 })]; // a paragraph at the crawler's 300-char limit was cut mid sentence
    expect([(await read()).completeness, pageContains(await read(), "kite festival"), pageContains(await read(), "opening hours")]).toEqual(["sample_only", "yes", "unknown"]);
    expect((await read()).heldNote).toContain("unknown, not missing");
    db.snaps = [snapRow({ body_paragraph_sample: ["The kite festival opens at dawn."], word_count: undefined })]; // no word count is the same unprovable claim
    expect((await read()).completeness).toBe("sample_only");
    db.snaps = [snapRow({ body_paragraph_sample: undefined, body_text: "" })]; expect([(await read()).completeness, pageContains(await read(), "anything at all")]).toEqual(["complete", "no"]); // held whole and genuinely empty, so absence is provable
    db.snaps = [snapRow({ body_paragraph_sample: Array.from({ length: 20 }, (_, i) => `Passage ${i + 1}.`), word_count: 2, card_texts: [], internal_links: [] })];
    expect((await read()).completeness).toBe("sample_only"); // the crawler's PARAGRAPH cap is a stop, not an ending
    db.snaps = [snapRow({ body_text: "held prose. ".repeat(6_000), word_count: 5, card_texts: [], internal_links: [] })]; const held = await read();
    expect([held.completeness, held.heldNote.includes("past my 48000 character ceiling")]).toEqual(["partial", true]); });
});
describe("a crawl is finished only when the inventory is", () => {
  const html = (w: string) => `<html><head><title>T</title></head><body><main><p>${w}</p></main></body></html>`;
  const noWrite = { syncPagesImpl: async () => {}, syncPageSnapshotsImpl: async () => {} };
  it("keeps every URL discovery found and refills a drained working set from it instead of calling the site read", async () => {
    await runInProcessColdStartScan({ tenantId: T, domain: "own.com", deps: { maxPages: 1, ...noWrite, fetchImpl: serve({ "https://own.com/sitemap.xml": urlset(["https://own.com/a", "https://own.com/b"]), "https://own.com/a": html("Page a says this.") }) } });
    expect((await readInventory(T)).map((r) => r.url)).toEqual(["https://own.com/a", "https://own.com/b"]); // one launch scan reads a handful of pages; the inventory keeps every one it found
    let saved: CrawlFrontierState = { tenant_id: T, domain: "own.com", status: "in_progress", frontier: ["https://own.com/a"], visited: [], pages_crawled: 0, pages_failed: 0, page_cap: 600, source: "sitemap", started_at: NOW.toISOString(), updated_at: NOW.toISOString(), last_batch_at: null, batches_run: 0, page_facts: [] };
    const out = await runCrawlBatch({ tenantId: T, deps: { maxPagesPerBatch: 1, sleep: async () => {}, now: () => NOW.getTime(), ...noWrite, loadState: async () => saved, saveState: async (s) => { saved = s; }, fetchImpl: serve({ "https://own.com/a": html("Page a says this.") }) } });
    expect([out.complete, saved.status, saved.frontier]).toEqual([false, "in_progress", ["https://own.com/b"]]); }); // /b was never in the blob: only the inventory knew it existed
});
