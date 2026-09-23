import { beforeEach, describe, expect, it, vi } from "vitest"; import { createHash } from "node:crypto";
const db = vi.hoisted(() => ({ owned: [] as Record<string, unknown>[], snaps: [] as Record<string, unknown>[], blobs: [] as Record<string, unknown>[], missing: "", fails: false, client: {} as Record<string, unknown> }));
const FRESH = { crawl_state: "uncrawled", completeness: "missing", is_canonical_target: true, http_status: null, last_crawled_at: null, status_reconfirmed_at: null, content_hash: null, blocked_until: null, redirects_to: null };
vi.mock("@/lib/persistence/supabase", async (o) => ({ ...((await o()) as object), getSupabaseAdmin: () => db.client }));
import { discoverUrls, runInProcessColdStartScan, MAX_DISCOVERED_URLS } from "@/domains/evidence/scanning/in-process-scan"; import { completenessOf, loadCrawlFrontier, runCrawlBatch, startColdStartCrawl, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { markBlocked, markCrawled, nextCrawlCandidates, readInventory, upsertDiscovery } from "@/domains/evidence/scanning/owned-pages-store";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor"; import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context"; import { pageContains } from "@/domains/evidence/pages/page-version";
import { supabaseFake } from "../helpers/supabase-fake";
Object.assign(db.client, supabaseFake({ rows: (t) => (t === "owned_pages" ? db.owned : t === "json_store_blobs" ? db.blobs : db.snaps),
  error: (t) => (db.missing === t || db.fails ? { code: db.fails ? "500" : "PGRST205", message: "Could not find the table" } : null),
  same: (stored, sent) => sent.scope_key ? stored.scope_key === sent.scope_key : stored.tenant_id === sent.tenant_id && stored.url === sent.url,
  insertDefaults: () => ({ ...FRESH, first_seen: new Date().toISOString(), last_seen_in_discovery: new Date().toISOString() }) }));
const T = "tenant-own", OTHER = "tenant-other", NOW = new Date("2026-08-03T00:00:00.000Z"), asked: string[] = [];
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const serve = (map: Record<string, string>) => (async (u: string) => { const url = String(u), body = map[url]; asked.push(url);
  return new Response(body ?? "", { status: body == null ? 404 : 200, headers: { "content-type": url.endsWith("robots.txt") ? "text/plain" : url.endsWith(".xml") ? "application/xml" : "text/html" } }); }) as unknown as typeof fetch;
const urlset = (u: string[]) => `<urlset>${u.map((x) => `<url><loc>${x}</loc></url>`).join("")}</urlset>`;
const index = (k: string[]) => `<sitemapindex>${k.map((x) => `<sitemap><loc>${x}</loc></sitemap>`).join("")}</sitemapindex>`;
const discover = (m: Record<string, string>) => discoverUrls("https://own.com", serve(m), 100, () => NOW.getTime(), NOW.getTime() + 60_000);
beforeEach(() => { db.owned = []; db.snaps = []; db.blobs = []; db.missing = ""; db.fails = false; asked.length = 0; });
describe("the owned-page inventory: what the site says it has, and what my read of it found", () => {
  it("follows every child map through deeper indexes and cycles without leaving this site", async () => {
    const children = Array.from({ length: 61 }, (_, i) => `https://own.com/sm/child-${i}.xml`), root = "https://own.com/sm/root.xml";
    const out = await discover({ // the sitemap is at NEITHER conventional path: only the directive finds it
      "https://own.com/robots.txt": "User-agent: *\nDisallow: /admin\nSitemap: https://own.com/sm/root.xml",
      [root]: index(["https://own.com/sm/mid.xml", ...children]), "https://own.com/sm/mid.xml": index(["https://own.com/sm/leaf.xml", "https://own.com/sm/deeper.xml", "https://evil.example/sm.xml"]),
      "https://own.com/sm/leaf.xml": urlset(["https://own.com/a/", "https://own.com/b?utm=x", "https://own.com/a"]),
      "https://own.com/sm/deeper.xml": index(["https://own.com/sm/too-deep.xml", root]), "https://own.com/sm/too-deep.xml": urlset(["https://own.com/never"]), ...Object.fromEntries(children.map((u, i) => [u, urlset([`https://own.com/child-${i}`])])) });
    expect([out.source, out.checkpoint, out.pages.length, out.pages.at(-1)?.url, asked.filter((u) => u === root).length, asked.some((u) => u.includes("evil.example"))]).toEqual(["sitemap", null, 64, "https://own.com/child-60", 1, false]);
    expect([await upsertDiscovery(T, out.pages), (await readInventory(T, { limit: 100 })).length, await readInventory(OTHER, { limit: 10 })]).toEqual([64, 64, []]); }); // never another account's inventory
  it("keeps the conventional path as a fallback, COUNTS what one pass could not record, and says plainly when it has no inventory yet", async () => {
    const out = await discover({ "https://own.com/sitemap.xml": urlset(Array.from({ length: MAX_DISCOVERED_URLS + 3 }, (_, i) => `https://own.com/p${i}`)) }); expect([out.pages.length, out.truncated, out.pages[0]!.via]).toEqual([MAX_DISCOVERED_URLS, 3, "sitemap"]);
    db.missing = "owned_pages"; // the pre-migration window is never reported as an empty website
    expect([await upsertDiscovery(T, [{ url: "/a", via: "sitemap" }]), await readInventory(T)]).toEqual([0, []]); });
  it("preserves first_seen across rediscovery and never undoes what the crawl learned", async () => {
    await upsertDiscovery(T, [{ url: "https://own.com/a", via: "sitemap" }]); const firstSeen = (await readInventory(T))[0]!.first_seen;
    await markCrawled(T, "https://own.com/a", { httpStatus: 200, contentHash: "h1", completeness: "complete" }, NOW);
    await new Promise((r) => setTimeout(r, 2)); expect(await upsertDiscovery(T, [{ url: "https://own.com/a", via: "nav" }])).toBe(1); const row = (await readInventory(T))[0]!;
    expect([row.first_seen, row.crawl_state, row.content_hash, row.last_seen_in_discovery > firstSeen]).toEqual([firstSeen, "crawled", "h1", true]); });
  it("gives a refusal a bounded retry date, holds the page back until it passes, and backs off further each time", async () => {
    await upsertDiscovery(T, [{ url: "https://own.com/locked", via: "sitemap" }, { url: "https://own.com/gone", via: "sitemap" }]); await markBlocked(T, "https://own.com/locked", 403, NOW); await markBlocked(T, "https://own.com/gone", 404, NOW);
    const locked = () => readInventory(T).then((rs) => rs.find((r) => r.url.endsWith("/locked"))!); expect([(await locked()).crawl_state, (await locked()).completeness, (await locked()).blocked_until]).toEqual(["blocked", "blocked", at(1).toISOString()]);
    expect(await nextCrawlCandidates(T, 10, at(0.5))).toEqual([]); // inside the wait: not a candidate
    expect(await nextCrawlCandidates(T, 10, at(2))).toEqual(["https://own.com/locked"]); // due again, and a 404 never is
    await markBlocked(T, "https://own.com/locked", 403, at(2)); expect((await locked()).blocked_until).toBe(at(9).toISOString()); // SAME refusal, second attempt: a day was not enough, so a week
    await markBlocked(T, "https://own.com/locked", 403, at(9)); expect((await locked()).blocked_until).toBe(at(39).toISOString()); // then a month, the ceiling: the ladder is attempt-driven, not status-driven
    await upsertDiscovery(T, [{ url: "https://own.com/flaky", via: "sitemap" }, { url: "https://own.com/due", via: "nav" }]); await markBlocked(T, "https://own.com/flaky", 500, NOW); // a server error is a failure, never a read
    const flaky = (await readInventory(T)).find((r) => r.url.endsWith("/flaky"))!; expect([flaky.crawl_state, flaky.last_crawled_at, flaky.blocked_until, await nextCrawlCandidates(T, 1, at(0.5))]).toEqual(["uncrawled", null, at(1).toISOString(), ["https://own.com/due"]]); }); // Waiting rows cannot consume the bounded slot owed to an eligible page.
  it("calls a server error a fault only after the same answer comes back on a SECOND Pacific day, and drops it the moment the page answers", async () => {
    const flaky = async () => (await readInventory(T)).find((r) => r.url.endsWith("/flaky"))!; await upsertDiscovery(T, [{ url: "https://own.com/flaky", via: "sitemap" }]); await markBlocked(T, "https://own.com/flaky", 500, NOW);
    expect((await flaky()).status_reconfirmed_at).toBe(null); // one 500 is a bad minute and says nothing at all
    await markBlocked(T, "https://own.com/flaky", 503, new Date(NOW.getTime() + 7_200_000)); // same class, and 2 AM UTC is still the SAME Pacific evening
    expect((await flaky()).status_reconfirmed_at).toBe(null); // a UTC day would have called this two days and confirmed it
    await markBlocked(T, "https://own.com/flaky", 500, at(1)); expect((await flaky()).status_reconfirmed_at).toBe(at(1).toISOString()); // two days, same answer: a fault
    await markCrawled(T, "https://own.com/flaky", { httpStatus: 200, contentHash: "h", completeness: "complete" }, at(2));
    expect((await flaky()).status_reconfirmed_at).toBe(null); // it answered, so the fault is over and is never carried forward
    await markBlocked(T, "https://own.com/flaky", 500, at(3)); await markBlocked(T, "https://own.com/flaky", 403, at(4));
    expect((await flaky()).status_reconfirmed_at).toBe(null); }); // a DIFFERENT answer on the second day confirms nothing
});
describe("evidence - my own page's actual words, read narrowly", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${"ordinary prose about this page. ".repeat(8)}`).join(" ") + " The Zephyr Archive opens at dawn.";
  const html = `<html><head><title>Deep</title></head><body><nav>Menu Home About</nav><main>${long.split(". ").map((s) => `<p>${s}.</p>`).join("")}</main><footer>Footer</footer></body></html>`;
  const snapRow = (over: Record<string, unknown> = {}) => ({ id: `${over.tenant_id ?? T}::${over.url ?? "https://own.com/actors"}`, page_id: over.url ?? "https://own.com/actors", tenant_id: T, url: "https://own.com/actors", title: "T", meta_description: "M", fetched_at: "2026-06-11T00:00:00.000Z",
    body_paragraph_sample: ["Iran has a deep film history."], card_texts: ["Card"], schema_entity_names: ["Person"], internal_links: [{ href: "/a", anchor_text: "A" }], ...over });
  const read = async (url = "https://own.com/actors") => (await loadOwnedPageBodies(T, [url])).get(url.replace("https://", ""))!;
  it("reads only the asked tenant and the asked URLs, answers a wide ask page by page with a typed miss, fails closed to no bodies, and never passes headings off as body text", async () => {
    db.snaps = [snapRow(), snapRow({ url: "https://own.com/other" }), snapRow({ tenant_id: OTHER, title: "Not mine" })];
    expect([...(await loadOwnedPageBodies(T, ["https://own.com/actors"])).keys()]).toEqual(["own.com/actors"]); // a page I did not ask about, and an account not mine, are never keyed in
    const wide = new Map<string, "no_capture" | "read_failed">(); expect([(await loadOwnedPageBodies(T, ["a", "b", "c", "d", "e", "f", "g", "h"], wide)).size, wide.size, [...new Set(wide.values())], [...(await loadOwnedPageBodies(T, ["https://own.com/actors", "own.com/actors", "https://own.com/actors/"])).keys()]]).toEqual([0, 8, ["no_capture"], ["own.com/actors"]]); // eight pages asked past the old bound: eight typed answers, no cap
    const broken = new Map<string, "no_capture" | "read_failed">(); db.fails = true; expect([(await loadOwnedPageBodies(T, ["https://own.com/actors"], broken)).size, [...broken.values()]]).toEqual([0, ["read_failed"]]); db.fails = false; // a broken read is never an empty page, and it says so
    db.snaps = [snapRow({ body_paragraph_sample: undefined, h2_list: ["Famous Actors"], card_texts: ["Golshifteh Farahani"] })];
    expect([(await read()).openingSample, (await read()).cardTexts]).toEqual([null, ["Golshifteh Farahani"]]); }); // no body text on file is said plainly, never filled in from labels
  it("holds the whole de-chromed page, hashes exactly the text it holds, and only then answers a whole-page question with no", async () => {
    const snap = extractPageSnapshot(html.replace("<main>", `<main><h3>Earlier detail</h3><p>${long}</p><h2>Later section</h2>`).replace("</main>", "</main><main><h4>Follow-up</h4><p>The archive remains open throughout the following week.</p></main>"), "https://own.com/deep", "page-1", T, 200, null);
    expect([snap.body_text!.includes("Zephyr Archive"), snap.body_text!.includes("Menu Home About"), completenessOf(snap)]).toEqual([true, false, "complete"]); expect(snap.content_capture).toMatchObject({ version: 1, complete: true, mainHtml: expect.stringContaining("<p>"), jsonLd: [] }); expect(snap.content_capture!.mainHtml).not.toMatch(/Menu Home About|Footer/);
    expect(extractPageSnapshot("<html><body><nav>Menu</nav></body></html>", "https://own.com/empty", "page-2", T, 200, null).body_text).toBe(""); // a page with nothing to say holds the empty string, never nothing at all
    expect(snap.content_hash).toBe(createHash("sha256").update(snap.body_text!).digest("hex").slice(0, 16)); await upsertDiscovery(T, [{ url: "https://own.com/deep", via: "sitemap" }]);
    await markCrawled(T, "https://own.com/deep", { httpStatus: 200, contentHash: snap.content_hash, completeness: completenessOf(snap) }, NOW);
    const row = (await readInventory(T))[0]!; expect([row.crawl_state, row.completeness, row.content_hash]).toEqual(["crawled", "complete", snap.content_hash]);
    db.snaps = [snapRow({ url: "https://own.com/deep", word_count: snap.word_count, body_text: snap.body_text, content_capture: JSON.parse(JSON.stringify(snap.content_capture)) })]; const body = await read("https://own.com/deep");
    expect([body.completeness, pageContains(body, "Zephyr Archive"), pageContains(body, "a fact this page never states"), body.sourceCapture, body.headings, body.passages.every((x) => x.length <= 1_000) && body.passages.join(" ").includes(long.replace(/\s+/g, " ").trim())]).toEqual(["complete", "yes", "no", snap.content_capture, ["Earlier detail", "Later section", "Follow-up"], true]);
    expect([[...new Set(body.passageMeta!.map((m) => m.id.split("#")[0]))], body.passageMeta!.filter((m) => m.id.startsWith("earlier-detail#")).length > 1, body.passageMeta!.map((m) => m.id)], "a passage is one heading's text under a stable heading-path id, split into numbered parts at the bound, never a positional chunk").toEqual([["earlier-detail", "later-section", "later-section/follow-up"], true, (await read("https://own.com/deep")).passageMeta!.map((m) => m.id)]); expect(body.heldNote).not.toMatch(/[—–]/); db.snaps = [snapRow({ url: "https://own.com/deep", word_count: snap.word_count, body_text: snap.body_text, content_capture: { ...JSON.parse(JSON.stringify(snap.content_capture)), complete: false } })]; const partial = await read("https://own.com/deep"); expect([partial.completeness, pageContains(partial, "Zephyr Archive"), pageContains(partial, "a fact this page never states"), partial.heldNote]).toEqual(["partial", "yes", "unknown", expect.stringContaining("saved main-content capture is incomplete")]); });
  it("preserves every short section when the complete capture fits the reader's text budget", async () => {
    const snap = extractPageSnapshot(`<main>${Array.from({ length: 240 }, (_, i) => `<h2>Entry ${i}</h2><p>Unique fact ${i}.</p>`).join("")}</main>`, "https://own.com/many", "page-many", T, 200, null);
    db.snaps = [snapRow({ url: snap.url, body_text: snap.body_text, word_count: snap.word_count, content_capture: snap.content_capture })];
    const body = await read(snap.url);
    expect([body.completeness, body.passages.join(" "), body.passageMeta?.length]).toEqual(["complete", snap.body_text, 480]);
  });
  it("still reads a sample-era row as a sample, so absence stays unknown on it, and records what a ceiling cut", async () => {
    db.snaps = [snapRow({ body_paragraph_sample: ["x".repeat(300), "The kite festival opens at dawn."], word_count: 4_000 })]; // a paragraph at the crawler's 300-char limit was cut mid sentence
    expect([(await read()).completeness, pageContains(await read(), "kite festival"), pageContains(await read(), "opening hours")]).toEqual(["sample_only", "yes", "unknown"]); expect((await read()).heldNote).toContain("unknown, not missing");
    db.snaps = [snapRow({ body_paragraph_sample: undefined, body_text: "" })]; expect([(await read()).completeness, pageContains(await read(), "anything at all")]).toEqual(["sample_only", "unknown"]); // blank content cannot distinguish an empty page from failed extraction
    db.snaps = [snapRow({ body_text: "Known text without captured structure.", word_count: 5, extraction_certainty: "confirmed" })];
    const legacy = await read(); expect([legacy.completeness, pageContains(legacy, "Known text"), pageContains(legacy, "unseen section"), legacy.heldNote]).toEqual(["partial", "yes", "unknown", expect.stringContaining("no complete source-structure capture")]);
    for (const mainHtml of ["", "Known text without markup"]) {
      db.snaps = [snapRow({ body_text: "Known text without captured structure.", word_count: 5, extraction_certainty: "confirmed",
        content_capture: { version: 1, complete: true, mainHtml, jsonLd: [] } })];
      const invalid = await read(); expect([invalid.completeness, pageContains(invalid, "unseen section")]).toEqual(["partial", "unknown"]);
    }
    db.snaps = [snapRow({ body_paragraph_sample: Array.from({ length: 20 }, (_, i) => `Passage ${i + 1}.`), word_count: 2, card_texts: [], internal_links: [] })];
    expect((await read()).completeness).toBe("sample_only"); // the crawler's PARAGRAPH cap is a stop, not an ending
    db.snaps = [snapRow({ body_text: "held prose. ".repeat(6_000), word_count: 5, card_texts: [], internal_links: [] })]; const held = await read();
    expect([held.completeness, held.heldNote.includes("past the 48000 character ceiling")]).toEqual(["partial", true]);
    db.snaps = [snapRow({ body_text: "Intro words. History The shah ruled. Culture Rice is eaten.", h2_list: ["History", "Culture"], word_count: 11 })]; const flat = await read(); // a row crawled before the structured capture: the level-grouped labels cut the flat text
    expect([flat.passages, flat.passageMeta]).toEqual([["Intro words.", "History", "The shah ruled.", "Culture", "Rice is eaten."], [{ id: "opening#1", heading: null }, { id: "history#0", heading: "History" }, { id: "history#1", heading: "History" }, { id: "culture#0", heading: "Culture" }, { id: "culture#1", heading: "Culture" }]]); // the heading is part 0 of its own section, so the join reproduces the page
    db.snaps = [snapRow({ body_text: "Iranian Actors Iranian Actors are famous.", h2_list: ["Iranian Actors"], word_count: 6 })]; expect([flat.passages.join(" "), (await read()).passages]).toEqual(["Intro words. History The shah ruled. Culture Rice is eaten.", ["Iranian Actors", "Iranian Actors are famous."]]); });}); // a sentence opening with the heading's words is the section's text, never a second empty heading
describe("a crawl is finished only when the inventory is", () => {
  const html = (w: string) => `<html><head><title>T</title></head><body><main><p>${w}</p></main></body></html>`;
  const noWrite = { syncPagesImpl: async () => {}, syncPageSnapshotsImpl: async () => {} };
  const state = (o: Partial<CrawlFrontierState> = {}): CrawlFrontierState => ({ tenant_id: T, domain: "own.com", status: "in_progress", frontier: [], visited: [], pages_crawled: 0, pages_failed: 0,
    page_cap: 600, source: "sitemap", started_at: NOW.toISOString(), updated_at: NOW.toISOString(), last_batch_at: null, batches_run: 0, page_facts: [], ...o });
  const batch = async (hold: { s: CrawlFrontierState }, map: Record<string, string>, when = NOW) => { const from = asked.length;
    const out = await runCrawlBatch({ tenantId: T, deps: { sleep: async () => {}, now: () => when.getTime(), ...noWrite, loadState: async () => hold.s, saveState: async (s) => { hold.s = s; }, fetchImpl: serve(map) } });
    return { out, read: asked.slice(from).filter((u) => !u.endsWith("robots.txt") && !u.endsWith(".xml")) }; };
  it("keeps every URL discovery found and refills a drained working set from it instead of calling the site read", async () => {
    await runInProcessColdStartScan({ tenantId: T, domain: "own.com", deps: { maxPages: 1, ...noWrite, fetchImpl: serve({ "https://own.com/sitemap.xml": urlset(["https://own.com/a", "https://own.com/b"]), "https://own.com/a": html("Page a says this.") }) } });
    expect((await readInventory(T)).map((r) => r.url)).toEqual(["https://own.com/a", "https://own.com/b"]); // one launch scan reads a handful of pages; the inventory keeps every one it found
    const hold = { s: state({ frontier: ["https://own.com/a"] }) }, { out } = await batch(hold, { "https://own.com/a": html("Page a says this.") });
    expect([out.complete, hold.s.status, hold.s.frontier]).toEqual([false, "in_progress", ["https://own.com/b"]]); }); // /b was never in the blob: only the inventory knew it existed
  it("reads a page it has not read on every pass until there are none left, and never the same page twice", async () => {
    const urls = ["a", "b", "c", "d", "e"].map((p) => `https://own.com/${p}`), pages = { "https://own.com/robots.txt": "User-agent: *\nDisallow: /\nUser-agent: BeaconBot\nUser-agent: OtherBot\nDisallow: /\nAllow: /a\nAllow: /b\nAllow: /c\nAllow: /d\nAllow: /e", ...Object.fromEntries(urls.map((u) => [u, html("Ordinary prose.")])) }; await upsertDiscovery(T, urls.map((url) => ({ url, via: "sitemap" as const })));
    const hold = { s: state({ page_cap: 2 }) }; // two pages a pass, so three passes is the whole five-page site
    const p1 = await batch(hold, pages), p2 = await batch(hold, pages), p3 = await batch(hold, pages); expect([p1.read.length, p2.read.length, p3.read.length, new Set([...p1.read, ...p2.read, ...p3.read]).size]).toEqual([2, 2, 1, 5]);
    expect([p1.out.complete, p2.out.complete, p3.out.complete, hold.s.status, hold.s.pages_crawled, await readInventory(T, { states: ["uncrawled"] })]).toEqual([false, false, true, "complete", 5, []]);
    const uncertain = { s: state() }, guard = { loadState: async () => uncertain.s, saveState: async (s: CrawlFrontierState) => { uncertain.s = s; }, pickCandidates: async () => [], ...noWrite }; db.fails = true; const stopped = await runCrawlBatch({ tenantId: T, deps: guard }), before = uncertain.s.status; db.fails = false; const retried = await runCrawlBatch({ tenantId: T, deps: guard }); expect([stopped.complete, before, retried.complete, uncertain.s.status]).toEqual([false, "in_progress", true, "complete"]); const initial = { s: state() }, io = { ...noWrite, now: () => NOW.getTime(), loadState: async () => initial.s, saveState: async (s: CrawlFrontierState) => { initial.s = s; } }; db.fails = true; const lost = await runCrawlBatch({ tenantId: T, deps: io }), heldStatus = initial.s.status; db.fails = false; const recovered = await runCrawlBatch({ tenantId: T, deps: io }); expect([lost.status, heldStatus, recovered.complete]).toEqual(["no_crawl", "in_progress", true]); });
  it("resumes an oversized sitemap where the last pass stopped, instead of walking the same first pages forever", async () => {
    const many = Array.from({ length: MAX_DISCOVERED_URLS + 1_200 }, (_, i) => `https://own.com/p${i}`), sm = { "https://own.com/sitemap.xml": urlset(many) }, first = await discover(sm); expect([first.pages.length, first.truncated, first.checkpoint?.stack.at(-1)?.offset]).toEqual([MAX_DISCOVERED_URLS, 1_200, MAX_DISCOVERED_URLS]); const second = await discoverUrls("https://own.com", serve(sm), 100, () => NOW.getTime(), NOW.getTime() + 60_000, first.checkpoint);
    expect([second.pages.length, second.truncated, second.checkpoint, new Set([...first.pages, ...second.pages].map((p) => p.url)).size]).toEqual([1_200, 0, null, many.length]); const changed = await discoverUrls("https://own.com", serve({ "https://own.com/sitemap.xml": urlset(["https://own.com/new", ...many]) }), 100, () => NOW.getTime(), NOW.getTime() + 60_000, first.checkpoint); expect(changed.pages[0]?.url).toBe("https://own.com/new");
    const hold = { s: state({ discovery: first.checkpoint }) }, deps = { loadState: async () => hold.s, saveState: async (s: CrawlFrontierState) => { hold.s = s; }, pickCandidates: async () => [], ...noWrite, fetchImpl: serve(sm) };
    await runCrawlBatch({ tenantId: T, deps: { ...deps, recordDiscovery: async () => 1 } }); expect([hold.s.discovery?.stack.at(-1)?.offset, hold.s.status]).toEqual([MAX_DISCOVERED_URLS, "in_progress"]); await runCrawlBatch({ tenantId: T, deps }); expect([hold.s.discovery, db.owned.length]).toEqual([null, 1_200]);
    db.owned = []; const legacy = { s: state({ discovery_cursor: 2 }) }; await batch(legacy, { "https://own.com/sitemap.xml": urlset(["https://own.com/x", "https://own.com/y", "https://own.com/z"]) }); expect([db.owned.some((r) => r.url === "https://own.com/z"), legacy.s.discovery_cursor]).toEqual([true, 0]); });
  it("keeps a cut document and failed write pending in tenant-scoped durable state", async () => { const one = "https://own.com/one.xml", two = "https://own.com/two.xml", map = { "https://own.com/sitemap.xml": index([one, two]), [one]: urlset(["https://own.com/a"]), [two]: urlset(["https://own.com/b"]) }; let tick = NOW.getTime(); const timed = (async (u: string, init?: RequestInit) => { const r = await serve(map)(u, init); if (u === one) tick += 1_000; return r; }) as typeof fetch;
    const cut = await discoverUrls("https://own.com", timed, 100, () => tick, tick + 500), resumed = await discoverUrls("https://own.com", serve(map), 100, () => tick, tick + 60_000, cut.checkpoint); expect([cut.pages.map((p) => p.url), cut.checkpoint?.stack.at(-1)?.url, resumed.pages.map((p) => p.url), resumed.checkpoint]).toEqual([["https://own.com/a"], one, ["https://own.com/b"], null]);
    const limited = (async (u: string, init?: RequestInit) => u === one ? new Response("", { status: 429 }) : serve(map)(u, init)) as typeof fetch, throttled = await discoverUrls("https://own.com", limited, 100, () => tick, tick + 60_000); expect([throttled.held, throttled.checkpoint?.stack.at(-1)?.url, throttled.pages.length]).toEqual(["sitemap_unreadable", one, 0]); const chain = Array.from({ length: 34 }, (_, i) => `https://own.com/d${i}.xml`), deep = { "https://own.com/sitemap.xml": index([chain[0]!]), ...Object.fromEntries(chain.map((u, i) => [u, i < chain.length - 1 ? index([chain[i + 1]!]) : urlset(["https://own.com/deep"])])) }, depth = await discover(deep), depthState: { s: CrawlFrontierState | null } = { s: null }; await startColdStartCrawl({ tenantId: T, domain: "own.com", deps: { fetchImpl: serve(deep), loadState: async () => null, saveState: async (s) => { depthState.s = s; }, pickCandidates: async () => [] } }); expect([depth.held, depth.checkpoint?.stack.length, depthState.s?.status, depthState.s?.detail]).toEqual(["depth_limit", 32, "in_progress", "depth_limit"]);
    const saved: { s: CrawlFrontierState | null } = { s: null }; const failed = await startColdStartCrawl({ tenantId: T, domain: "own.com", deps: { fetchImpl: serve(map), recordDiscovery: async () => 0, loadState: async () => null, saveState: async (s) => { saved.s = s; }, pickCandidates: async () => [] } }); expect([failed.status, saved.s?.discovery?.root, saved.s?.status, db.owned.length]).toEqual(["in_progress", 0, "in_progress", 0]);
    const old = state(); db.blobs.push({ scope_key: "crawl-frontier::global", content: [old] }); expect(await loadCrawlFrontier(T)).toEqual(old); const start = (tenantId: string) => startColdStartCrawl({ tenantId, domain: "own.com", deps: { fetchImpl: serve(map), loadState: async () => null, recordDiscovery: async () => 0 } }); await start(T); await start(OTHER);
    expect([db.blobs.map((b) => b.scope_key).sort(), (await loadCrawlFrontier(T))?.tenant_id, (await loadCrawlFrontier(OTHER))?.tenant_id]).toEqual([["crawl-frontier::global", `crawl-frontier::tenant:${OTHER}`, `crawl-frontier::tenant:${T}`].sort(), T, OTHER]);
    const before = db.blobs.find((b) => b.scope_key === `crawl-frontier::tenant:${T}`)!.content; db.missing = "json_store_blobs"; expect((await start(T)).status).toBe("unreachable"); db.missing = ""; expect(db.blobs.find((b) => b.scope_key === `crawl-frontier::tenant:${T}`)!.content).toEqual(before); });
  it("stays open while a refused page waits out its retry date, never asks before it, and closes once the page answers", async () => {
    await upsertDiscovery(T, [{ url: "https://own.com/page.htm", via: "sitemap" }]);
    await batch({ s: state() }, { "https://own.com/robots.txt": "User-agent: *\nAllow: /page\nDisallow: /*.htm", "https://own.com/page.htm": html("It opens now.") }); // Actual robots precedence refuses it: due again a day from now.
    const hold = { s: state() }, page = { "https://own.com/page.htm": html("It opens now.") }, early = await batch(hold, page, at(0.5));
    expect([early.read, early.out.complete, hold.s.status]).toEqual([[], false, "in_progress"]); // never asked inside the wait, and never called finished either
    const due = await batch(hold, page, at(2));
    expect([due.read.length, due.out.crawled, hold.s.status]).toEqual([1, 1, "complete"]); }); // the promise is kept on a later pass, and only then is the site done
  it("reopens a finished crawl for a page shipped afterwards and for a read gone stale, and stays finished when the inventory owes nothing", async () => {
    const pages = { "https://own.com/a": html("Ordinary prose."), "https://own.com/new": html("Shipped later.") }; await upsertDiscovery(T, [{ url: "https://own.com/a", via: "sitemap" }]);
    const hold = { s: state({ frontier: ["https://own.com/a"] }) }, first = await batch(hold, pages); expect([first.out.complete, hold.s.status]).toEqual([true, "complete"]);
    const idle = await batch(hold, pages); // nothing owed: finished stands, and the site is not asked for anything
    expect([idle.read, idle.out.status, idle.out.detail, hold.s.status]).toEqual([[], "complete", "already_complete", "complete"]);
    await upsertDiscovery(T, [{ url: "https://own.com/new", via: "implementation" }]); // the operator ships a page AFTER I called it finished
    const shipped = await batch(hold, pages);
    expect([shipped.read, shipped.out.crawled, hold.s.pages_crawled]).toEqual([["https://own.com/new"], 1, 2]); // finished was a reading, never a latch
    const stale = await batch(hold, pages, at(45)); // and a read past thirty days is owed again on its own
    expect([stale.read.length, stale.out.crawled, hold.s.status]).toEqual([2, 2, "complete"]); });});
