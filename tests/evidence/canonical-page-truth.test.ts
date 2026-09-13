import { describe, expect, it, vi } from "vitest";
import { pageExtractFrom } from "@/domains/evidence/funnel/research-evidence";
import { assemblePacketForUrl } from "@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet";
import { jobEvidenceHash } from "@/domains/evidence/snapshot";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { supabaseFake } from "../helpers/supabase-fake";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: 0, failAfter: Infinity, reads: [] as { max: number; cols: string; inBytes: number }[] }));
vi.mock("@/lib/persistence/repositories", async () => { const { supabaseBackend } = await import("@/lib/persistence/repositories/supabase-backend"); return { getRepository: () => supabaseBackend }; });
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => supabaseFake({
  rows: (table) => table === "page_snapshots" ? db.rows.map((r, i) => ({ ...r, id: r.id ?? `r${String(i).padStart(6, "0")}`, page_id: r.page_id ?? r.url, tenant_id: r.tenant_id ?? "t" })) : [],
  error: () => ++db.calls > db.failAfter ? { message: "chunk down" } : null,
  onSelect: (_table, read) => db.reads.push(read),
}) }));
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context"; import { pageContains } from "@/domains/evidence/pages/page-version";
describe("one rule decides which capture is the page", () => {
  it("carries same-sized material revisions from extraction through the stored projection into job identity, without clock churn", async () => {
    const { extractPageSnapshot } = await import("@/domains/evidence/pages/extractor");
    const url = "https://fixture-revision.example/page", at = new Date("2026-09-10T12:00:00Z");
    const html = `<html><head><title>Harbour seals</title><script type="application/ld+json">{"@type":"ImageObject","caption":"Harbour colony","contentUrl":"https://fixture-revision.example/seals.jpg"}</script></head><body><main><h1>Harbour seals</h1><h2>Where they rest</h2><p>${"Seals rest near the harbour. ".repeat(15)}</p><details><summary>When do seals rest?</summary>${"They rest at low tide. ".repeat(15)}June.</details></main></body></html>`;
    const capture = (text: string) => ({ ...extractPageSnapshot(text, url, "p1", "t"), fetched_at: at.toISOString() });
    const read = () => loadEvidenceSnapshot("t", { site: "fixture-revision.example", now: at, resolveBasis: async () => null, loadObservations: async () => [] });
    const before = capture(html); db.rows = [JSON.parse(JSON.stringify(before))];
    const owned = (await loadOwnedPageBodies("t", [url])).get("fixture-revision.example/page")!, pair = owned.faqs[0]!;
    expect([owned.version, pair.question, pair.answer, pair.answerComplete, before.body_text?.includes("Harbour seals Where they rest Seals rest")]).toEqual(["current", "When do seals rest?", `${"They rest at low tide. ".repeat(15)}June.`, true, true]);
    const pollution = `<details><summary>Unheld question?</summary>Unheld assertion.</details>`, dirty = capture(html.replace("<main>", `${pollution}<nav>${pollution}</nav><main><div hidden>${pollution}</div><div aria-hidden="true">${pollution}</div><div style="display: none !important">${pollution}</div><template>${pollution}</template>`));
    expect([dirty.faqs, dirty.body_text, dirty.content_hash, dirty.faq_hash]).toEqual([before.faqs, before.body_text, before.content_hash, before.faq_hash]);
    const more = "A second content region has useful facts too.";
    for (const tag of ["main", "article"]) expect(capture(html.replaceAll("main>", `${tag}>`).replace(`</${tag}>`, `</${tag}><${tag}><p>${more}</p></${tag}>`)).body_text).toContain(more);
    for (const repeats of [1500, 6000]) {
      db.rows = [capture(html.replace("They rest at low tide. ".repeat(15), "They rest at low tide. ".repeat(repeats)))]; const wide = (await loadOwnedPageBodies("t", [url])).get("fixture-revision.example/page")!;
      expect([wide.faqs[0]!.answerComplete, wide.faqs[0]!.answer, wide.completeness]).toEqual([repeats === 1500, repeats === 1500 ? `${"They rest at low tide. ".repeat(repeats)}June.` : before.faqs[0]!.answer_excerpt, "partial"]); expect([wide.title ?? "", wide.metaDescription ?? "", ...wide.headings, ...wide.cardTexts, ...wide.entityNames].join(" ").length + wide.faqs.reduce((n, f) => n + f.question.length + f.answer.length, 0) + wide.passages.reduce((n, p) => n + p.length, 0)).toBeLessThanOrEqual(48000); }
    const busy = Array.from({ length: 1200 }, (_, i) => ({ ...before, id: `busy-${String(i).padStart(4, "0")}`, page_id: "a", url: "https://fixture-revision.example/busy", word_count: 0, extraction_certainty: "uncertain", internal_links: [] }));
    const quiet = Array.from({ length: 540 }, (_, i) => ({ ...before, id: `quiet-${i}-${"capture".repeat(30)}`, page_id: `q${String(i).padStart(4, "0")}`, url: `https://fixture-revision.example/quiet-${i}`, internal_links: [] }));
    db.rows = [...busy, { ...before, id: "good", page_id: "a", url: busy[0]!.url, fetched_at: "2026-09-09T12:00:00Z", internal_links: [] }, ...quiet, { ...before, id: "other", page_id: "other", tenant_id: "other", url: "https://other.example/page" }]; db.reads = [];
    const complete = await read(); expect(complete.ownedPages).toHaveLength(541); expect(complete.ownedPages.some((p) => p.url.endsWith("/quiet-539"))).toBe(true); db.reads = [];
    const { supabaseBackend } = await import("@/lib/persistence/repositories/supabase-backend"); const selected = await supabaseBackend.forTenant("t").getPageSnapshots(), recovered = selected.filter((r) => r.page_id === "a");
    expect([selected.length, recovered.map((r) => r.id), selected.every((r) => r.tenant_id === "t"), db.reads.every((r) => r.max <= 500 && r.inBytes <= 8000 && !r.cols.includes("body_text"))]).toEqual([542, ["busy-1199", "good"], true, true]);
    expect((await supabaseBackend.forTenant("t").getPageSnapshotLinkGraphs()).length).toBe(542); db.calls = 0; db.failAfter = 1; await expect(supabaseBackend.forTenant("t").getPageSnapshots()).rejects.toThrow(/history read failed/); db.failAfter = Infinity;
    await expect(supabaseBackend.getPageSnapshots()).rejects.toThrow(/forTenant/); await expect(supabaseBackend.forTenant("").getPageSnapshots()).rejects.toThrow(/explicit tenant/);
    db.rows = [before]; const base = await read(), key = jobEvidenceHash(base, [url], "harbour seals");
    expect(base.ownedPages[0]!.content?.revision).toEqual({ content_hash: before.content_hash, headings_hash: before.headings_hash, faq_hash: before.faq_hash, schema_hash: before.schema_hash });
    for (const changed of [html.replace("June.", "July."), html.replace("Harbour colony", "Harbour animals"), html.replace("seals.jpg", "shore.jpg"), html.replaceAll("near the harbour", "near the islands")]) {
      const after = capture(changed); db.rows = [after];
      expect([after.title, after.word_count, after.h2_list.length, after.schema_types]).toEqual([before.title, before.word_count, before.h2_list.length, before.schema_types]);
      expect(jobEvidenceHash(await read(), [url], "harbour seals")).not.toBe(key);
      expect(jobEvidenceHash(await read(), ["https://unrelated.example/page"], "other")).toBe(jobEvidenceHash(base, ["https://unrelated.example/page"], "other"));
    }
    const answer = capture(html.replace("June.", "July.")); expect(answer.faqs.map((f) => f.answer_excerpt)).toEqual(before.faqs.map((f) => f.answer_excerpt)); expect(answer.faqs[0]!.answer_text).not.toBe(before.faqs[0]!.answer_text); expect(answer.faq_hash).not.toBe(before.faq_hash);
    db.rows = [{ ...before, fetched_at: "2026-09-10T13:00:00Z" }]; expect(jobEvidenceHash(await read(), [url], "harbour seals")).toBe(key);
    const reordered = html.replace('{"@type":"ImageObject","caption":"Harbour colony","contentUrl":"https://fixture-revision.example/seals.jpg"}', '{"contentUrl":"https://fixture-revision.example/seals.jpg","caption":"Harbour colony","@type":"ImageObject"}');
    expect(capture(reordered).schema_hash).toBe(before.schema_hash);
    const serp = (target: string) => ({ query: "harbour seals", organic: [{ rank: 1, url: target }], aiOverview: [], aiMode: [] });
    const withSerps = (rows: unknown[]) => jobEvidenceHash({ ...base, research: { ...base.research, serpEvidence: rows } } as never, [url], "harbour seals");
    expect(withSerps([serp("https://r1.example/a"), serp("https://r2.example/a")])).toBe(withSerps([serp("https://r2.example/a"), serp("https://r1.example/a")])); expect(withSerps([serp("https://r1.example/a")])).not.toBe(withSerps([serp("https://r2.example/a")]));
  });
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
    expect(visible.faqs).toEqual([{ question: "Visible question?", answer: "Visible excerpt", source: "html_details", answerComplete: false }]);
    expect(assemblePacketForUrl({ tenantId: "t", publishChannel: "none", boilerplateTerms: [], snapshotByCanon: new Map([[flag.url, db.rows[0]]]), gscByUrl: new Map(), clarityByUrl: new Map(), ga4ByUrl: new Map() } as never, flag.url).crawl?.faqs, "the next reader receives the actual visible answer, not a dropped answer field or markup assertions").toEqual(["Visible question?: Visible excerpt"]);
    expect(pageContains(visible, "Markup-only assertion")).toBe("no");
    expect([pageExtractFrom(db.rows[0] as never).faqCount, pageContains(visible, "Markup-only entity"), pageContains({ ...visible, version: undefined }, "An unshown answer"), (db.rows[0]!.faqs as unknown[]).length]).toEqual([1, "no", "unknown", 23]);
    db.rows = [{ ...db.rows[0], body_text: null, faqs: hidden, word_count: 3, h1: null, title: null }];
    const sample = (await loadOwnedPageBodies("t", [flag.url])).get("iranopedia.com/iran-flags/iran-islamic-republic-flag-history")!;
    expect([sample.completeness, pageContains(sample, "An unshown answer")]).toEqual(["sample_only", "unknown"]);
    db.rows = [row(flag.url, "2026-09-10", "", 0, "uncertain")]; expect((await loadOwnedPageBodies("t", [flag.url])).get("iranopedia.com/iran-flags/iran-islamic-republic-flag-history")?.version).toBe("blank");
    db.rows = Array.from({ length: 9 }, (_v, i) => row(`https://iranopedia.com/p${i}`, "2026-08-30T22:00:00Z", `Page ${i} says something true about its own subject.`, 9, "confirmed"));
    const urls = db.rows.map((r) => String(r.url)); db.calls = 0;
    const misses = new Map<string, string>(); expect([(await loadOwnedPageBodies("t", [...urls, "https://iranopedia.com/never-crawled"], misses as Map<string, "no_capture" | "read_failed">)).size, [...misses]]).toEqual([9, [["iranopedia.com/never-crawled", "no_capture"]]]);
    const nine = db.rows; db.rows = [...Array.from({ length: 30 }, (_v, i) => row("https://iranopedia.com/busy-one", `2026-08-30T2${String(i % 4)}:${String(10 + i).padStart(2, "0")}:00Z`, `Busy one, version ${i}.`, 9, "confirmed")), ...Array.from({ length: 30 }, (_v, i) => row("https://iranopedia.com/busy-two", `2026-08-30T2${String(i % 4)}:${String(10 + i).padStart(2, "0")}:00Z`, `Busy two, version ${i}.`, 9, "confirmed")), ...Array.from({ length: 3 }, (_v, i) => row("https://iranopedia.com/quiet", `2026-08-29T0${String(i)}:00:00Z`, `Quiet page, older capture ${i}.`, 9, "confirmed"))];
    db.calls = 0; const capped = new Map<string, "no_capture" | "read_failed">(); const three = await loadOwnedPageBodies("t", ["https://iranopedia.com/busy-one", "https://iranopedia.com/busy-two", "https://iranopedia.com/quiet"], capped);
    expect([three.size, three.has("iranopedia.com/quiet"), [...capped], db.calls], "the page the cut read left out is asked for again on its own, comes back with its own newest capture, and is never reported as never captured").toEqual([3, true, [], 2]); db.rows = nine;
    db.calls = 0; db.failAfter = 1; const broke = new Map<string, "no_capture" | "read_failed">();
    const partial = await loadOwnedPageBodies("t", urls, broke); db.failAfter = Infinity;
    expect([partial.size, [...broke.values()]]).toEqual([7, ["read_failed", "read_failed"]]); }); });
