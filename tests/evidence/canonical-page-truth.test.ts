import { describe, expect, it, vi } from "vitest";
import { selectPageVersion } from "@/domains/evidence/pages/page-version";
import { pageExtractFrom } from "@/domains/evidence/funnel/research-evidence";
import { assemblePacketForUrl } from "@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet";
import { jobEvidenceHash } from "@/domains/evidence/snapshot";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: 0, failAfter: Infinity }));
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: (t: string) => ({ getPageSnapshots: async () => db.rows.filter((r) => r.tenant_id === t) }) }) }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { let asked: string[] = [];
  const q = { select: () => q, eq: () => q, in: (_c: string, list: string[]) => (asked = list, q), order: () => q,
    limit: async (n: number) => (db.calls += 1) > db.failAfter ? { data: null, error: { message: "chunk down" } } : { data: db.rows.filter((r) => asked.includes(String(r.url))).sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at))).slice(0, n), error: null } }; // newest first and cut at the budget, as the store answers
  return { from: () => q }; } }));
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context"; import { pageContains } from "@/domains/evidence/pages/page-version";
const cap = (fetchedAt: string, words: number, certainty = "confirmed", bodyHeld = true) => ({ fetchedAt, words, bodyHeld, certainty });
describe("one rule decides which capture is the page", () => {
  it("carries same-sized material revisions from extraction through the stored projection into job identity, without clock churn", async () => {
    const { extractPageSnapshot } = await import("@/domains/evidence/pages/extractor");
    const url = "https://fixture-revision.example/page", at = new Date("2026-09-10T12:00:00Z");
    const html = `<html><head><title>Harbour seals</title><script type="application/ld+json">{"@type":"ImageObject","caption":"Harbour colony","contentUrl":"https://fixture-revision.example/seals.jpg"}</script></head><body><main><h1>Harbour seals</h1><h2>Where they rest</h2><p>${"Seals rest near the harbour. ".repeat(15)}</p><details><summary>When do seals rest?</summary>${"They rest at low tide. ".repeat(15)}June.</details></main></body></html>`;
    const capture = (text: string) => ({ ...extractPageSnapshot(text, url, "p1", "t"), fetched_at: at.toISOString() });
    const read = () => loadEvidenceSnapshot("t", { site: "fixture-revision.example", now: at, resolveBasis: async () => null, loadObservations: async () => [] });
    const before = capture(html); db.rows = [JSON.parse(JSON.stringify(before))];
    const base = await read(), key = jobEvidenceHash(base, [url], "harbour seals");
    expect(base.ownedPages[0]!.content?.revision).toEqual({ content_hash: before.content_hash, headings_hash: before.headings_hash, faq_hash: before.faq_hash, schema_hash: before.schema_hash });
    for (const changed of [html.replace("June.", "July."), html.replace("Harbour colony", "Harbour animals"), html.replace("seals.jpg", "shore.jpg"), html.replaceAll("near the harbour", "near the islands")]) {
      const after = capture(changed); db.rows = [after];
      expect([after.title, after.word_count, after.h2_list.length, after.schema_types]).toEqual([before.title, before.word_count, before.h2_list.length, before.schema_types]);
      expect(jobEvidenceHash(await read(), [url], "harbour seals")).not.toBe(key);
      expect(jobEvidenceHash(await read(), ["https://unrelated.example/page"], "other")).toBe(jobEvidenceHash(base, ["https://unrelated.example/page"], "other"));
    }
    const answer = capture(html.replace("June.", "July.")); expect(answer.faqs).toEqual(before.faqs); expect(answer.faq_hash).not.toBe(before.faq_hash);
    db.rows = [{ ...before, fetched_at: "2026-09-10T13:00:00Z" }]; expect(jobEvidenceHash(await read(), [url], "harbour seals")).toBe(key);
    const reordered = html.replace('{"@type":"ImageObject","caption":"Harbour colony","contentUrl":"https://fixture-revision.example/seals.jpg"}', '{"contentUrl":"https://fixture-revision.example/seals.jpg","caption":"Harbour colony","@type":"ImageObject"}');
    expect(capture(reordered).schema_hash).toBe(before.schema_hash);
    const serp = (target: string) => ({ query: "harbour seals", organic: [{ rank: 1, url: target }], aiOverview: [], aiMode: [] });
    const withSerps = (rows: unknown[]) => jobEvidenceHash({ ...base, research: { ...base.research, serpEvidence: rows } } as never, [url], "harbour seals");
    expect(withSerps([serp("https://r1.example/a"), serp("https://r2.example/a")])).toBe(withSerps([serp("https://r2.example/a"), serp("https://r1.example/a")])); expect(withSerps([serp("https://r1.example/a")])).not.toBe(withSerps([serp("https://r2.example/a")]));
  });
  it("an old confirmed body beats a new uncertain blank and is named stale; a new confirmed body is current; a short confirmed page is current; a sample is a sample; a blank is blank; nothing is unread", () => {
    const old = cap("2026-08-04", 921), blank = cap("2026-08-30", 0, "uncertain"), fresh = cap("2026-08-30", 900), short = cap("2026-08-29", 129), sample = cap("2026-06-11", 186, "confirmed", false);
    expect([selectPageVersion([blank, old], (x) => x).state, selectPageVersion([blank, old], (x) => x).content, selectPageVersion([blank, old], (x) => x).conflict]).toEqual(["stale_known_good", old, true]);
    expect([selectPageVersion([old, fresh], (x) => x).content, selectPageVersion([short], (x) => x).state, selectPageVersion([short], (x) => x).words, selectPageVersion([sample], (x) => x).state, selectPageVersion([blank], (x) => x).state, selectPageVersion([], (x) => x).state])
      .toEqual([fresh, "current", 129, "sample_only", "blank", "unread"]); });
  it("the targeted reader hands the writer the stale body with its dates, and a stale body can never prove a current absence", async () => {
    const row = (url: string, fetched_at: string, body_text: string, word_count: number, extraction_certainty: string) => ({ url, title: "Iranian actors", h1: "Iranian actors", meta_description: null, fetched_at, word_count, h2_list: [], h3_list: [], faqs: [], body_text, body_paragraph_sample: [], card_texts: [], schema_entity_names: [], internal_links: [], content_hash: "h", extraction_certainty });
    db.rows = [row("https://iranopedia.com/iranian-actors-actresses", "2026-08-30T22:30:00Z", "", 0, "uncertain"), row("https://www.iranopedia.com/iranian-actors-actresses", "2026-08-04T22:43:00Z", "Shohreh Aghdashloo was nominated for an Academy Award. Golshifteh Farahani works in France.", 921, "confirmed")];
    const page = (await loadOwnedPageBodies("t", ["https://www.iranopedia.com/iranian-actors-actresses"])).get("iranopedia.com/iranian-actors-actresses")!;
    expect([page.version, page.newestAt?.slice(0, 10), page.fetchedAt?.slice(0, 10), page.passages.length > 0, page.heldNote.includes("captured no words")]).toEqual(["stale_known_good", "2026-08-30", "2026-08-04", true, true]);
    expect([pageContains(page, "Golshifteh Farahani"), pageContains(page, "Navid Negahban")]).toEqual(["yes", "unknown"]);
    db.rows = [row("https://iranopedia.com/iran-flags/iran-islamic-republic-flag-history", "2026-08-29T20:51:00Z", "The flag adopted in 1980 carries the Takbir twenty-two times along the edges of the green and red bands.", 129, "confirmed")];
    const flag = (await loadOwnedPageBodies("t", ["https://iranopedia.com/iran-flags/iran-islamic-republic-flag-history"])).get("iranopedia.com/iran-flags/iran-islamic-republic-flag-history")!;
    expect([flag.version, flag.completeness, pageContains(flag, "Takbir"), pageContains(flag, "Pahlavi")]).toEqual(["current", "complete", "yes", "no"]);
    const hidden = Array.from({ length: 20 }, () => ({ question: "Markup-only question?", answer_excerpt: "Markup-only assertion", source: "jsonld" }));
    db.rows = [{ ...db.rows[0], schema_entity_names: ["Markup-only entity"], faqs: [...hidden, { question: "Unanswered heading?", answer_excerpt: "", source: "html_section" }, { question: "Unknown origin?", answer_excerpt: "Legacy assertion" }, { question: "Visible question?", answer_excerpt: "Visible excerpt", source: "html_details" }] }];
    const visible = (await loadOwnedPageBodies("t", [flag.url])).get("iranopedia.com/iran-flags/iran-islamic-republic-flag-history")!;
    expect(visible.faqs).toEqual([{ question: "Visible question?", answer: "Visible excerpt", source: "html_details" }]);
    expect(assemblePacketForUrl({ tenantId: "t", publishChannel: "none", boilerplateTerms: [], snapshotByCanon: new Map([[flag.url, db.rows[0]]]), gscByUrl: new Map(), clarityByUrl: new Map(), ga4ByUrl: new Map() } as never, flag.url).crawl?.faqs, "the next reader receives the actual visible answer, not a dropped answer field or markup assertions").toEqual(["Visible question?: Visible excerpt"]);
    expect(pageContains(visible, "Markup-only assertion")).toBe("no");
    expect([pageExtractFrom(db.rows[0] as never).faqCount, pageContains(visible, "Markup-only entity"), pageContains({ ...visible, version: undefined }, "An unshown answer"), (db.rows[0]!.faqs as unknown[]).length]).toEqual([1, "no", "unknown", 23]);
    db.rows = [{ ...db.rows[0], body_text: null, faqs: hidden, word_count: 3, h1: null, title: null }];
    const sample = (await loadOwnedPageBodies("t", [flag.url])).get("iranopedia.com/iran-flags/iran-islamic-republic-flag-history")!;
    expect([sample.completeness, pageContains(sample, "An unshown answer")]).toEqual(["sample_only", "unknown"]);
    db.rows = Array.from({ length: 9 }, (_v, i) => row(`https://iranopedia.com/p${i}`, "2026-08-30T22:00:00Z", `Page ${i} says something true about its own subject.`, 9, "confirmed"));
    const urls = db.rows.map((r) => String(r.url)); db.calls = 0;
    const misses = new Map<string, string>(); expect([(await loadOwnedPageBodies("t", [...urls, "https://iranopedia.com/never-crawled"], misses as Map<string, "no_capture" | "read_failed">)).size, [...misses]]).toEqual([9, [["iranopedia.com/never-crawled", "no_capture"]]]);
    /* A CAPPED READ IS RE-ASKED FOR WHAT IT LEFT UNANSWERED (reviewer, 2026-09-05): two pages with thirty stored versions each fill the chunk's whole row budget newest first, so a third page with three older captures came back with no row, was reported as never captured, and the sibling rule fell silent on it. */
    const nine = db.rows; db.rows = [...Array.from({ length: 30 }, (_v, i) => row("https://iranopedia.com/busy-one", `2026-08-30T2${String(i % 4)}:${String(10 + i).padStart(2, "0")}:00Z`, `Busy one, version ${i}.`, 9, "confirmed")), ...Array.from({ length: 30 }, (_v, i) => row("https://iranopedia.com/busy-two", `2026-08-30T2${String(i % 4)}:${String(10 + i).padStart(2, "0")}:00Z`, `Busy two, version ${i}.`, 9, "confirmed")), ...Array.from({ length: 3 }, (_v, i) => row("https://iranopedia.com/quiet", `2026-08-29T0${String(i)}:00:00Z`, `Quiet page, older capture ${i}.`, 9, "confirmed"))];
    db.calls = 0; const capped = new Map<string, "no_capture" | "read_failed">(); const three = await loadOwnedPageBodies("t", ["https://iranopedia.com/busy-one", "https://iranopedia.com/busy-two", "https://iranopedia.com/quiet"], capped);
    expect([three.size, three.has("iranopedia.com/quiet"), [...capped], db.calls], "the page the cut read left out is asked for again on its own, comes back with its own newest capture, and is never reported as never captured").toEqual([3, true, [], 2]); db.rows = nine;
    db.calls = 0; db.failAfter = 1; const broke = new Map<string, "no_capture" | "read_failed">();
    const partial = await loadOwnedPageBodies("t", urls, broke); db.failAfter = Infinity;
    expect([partial.size, [...broke.values()]]).toEqual([7, ["read_failed", "read_failed"]]); }); });
