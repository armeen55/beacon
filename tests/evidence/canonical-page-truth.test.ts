/** CANONICAL PAGE TRUTH (operator, 2026-09-01). Every reader chooses the same capture for a page: the newest confirmed body, never a newer blank over it, and a stale body proves presence but never a current absence. Live counterexample: /iranian-actors-actresses held a newer zero-word capture marked uncertain beside an older 921-word confirmed body, and the diagnosis read zero while the writer read 921. */
import { describe, expect, it, vi } from "vitest";
import { selectPageVersion } from "@/domains/evidence/pages/page-version";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: async () => ({ data: db.rows, error: null }) }; return { from: () => q }; } }));
import { loadOwnedPageBodies, pageContains } from "@/domains/evidence/pages/owned-context";
const cap = (fetchedAt: string, words: number, certainty = "confirmed", bodyHeld = true) => ({ fetchedAt, words, bodyHeld, certainty });
describe("one rule decides which capture is the page", () => {
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
    expect([flag.version, flag.completeness, pageContains(flag, "Takbir"), pageContains(flag, "Pahlavi")]).toEqual(["current", "complete", "yes", "no"]); }); });
