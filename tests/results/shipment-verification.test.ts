import { beforeEach, describe, expect, it, vi } from "vitest";
/** Live implementation verification (V1 Truth Convergence Phase 6). These pin CUSTOMER TRUTH, not the implementation: what Beacon says it saw on the operator's live page, and what it refuses to say. Fixtures only, zero network: the polite fetch is seamed exactly the way the owned-page read seams it. */
const ROWS: Array<Record<string, unknown>> = [];
const WRITES: Array<[string, string, { status: string }]> = [];
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: async (_fn: string, a: { p_since: string }) => (a.p_since <= "2026-08-05" ? { data: [{ page: "https://own.com/nowruz", clicks: 30, impressions: 900, pos_weighted: 4500 }], error: null } : { data: [], error: null }) }) }));
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChangesForTenant: async () => ROWS,
  recordVerification: async (t: string, id: string, v: { status: string }) => { WRITES.push([t, id, v]); return true; },}));
/** The evidence facade is stubbed so the ONE thing under test at the funnel call site is the argument. */
let passedBustedAt: string | null | undefined;
vi.mock("@/domains/evidence", () => {
  const done = () => async () => ({ status: "done", cursor: null, progress: {} });
  return {
    keywordDiscoveryUnit: done, promptObservationUnit: done, serpAnalysisUnit: done,
    winningPagesUnit: (_d: unknown, _q: unknown, _a: unknown, _u: unknown, busted: string | null) => {
      passedBustedAt = busted; return async () => ({ status: "done", cursor: null, progress: {} });},};});
import { isCurrent } from "@/domains/evidence/freshness";
import { shipmentBustedAt, shipmentsAwaitingVerification, verifyDueShipments, verifyShipment, verifyShipmentNow } from "@/domains/measurement/verify-shipment";
import { readTechnicalFindings, technicalComponents } from "@/domains/decision/technical-findings";
const T = "tenant-1", URL_ = "https://own.com/nowruz", NOW = Date.parse("2026-07-31T12:00:00Z"), DAY = 86_400_000;
const PAGE = `<html><head><title>How to set a nowruz table</title>
<meta name="description" content="Set a nowruz table in seven steps."/>
<link rel="canonical" href="https://own.com/nowruz"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>
</head><body><main>
<h1>How to set a nowruz table</h1>
<p>A nowruz table is set with seven symbolic items known together as the haft seen, one for each wish.</p>
<h2>What goes on the table</h2>
<p>Every item on the cloth stands for a wish for the year that is starting, and families choose their own.</p>
<p><a href="/haft-seen">the haft seen explained</a></p>
</main></body></html>`;
/** The polite fetch, seamed: every test answers for the customer's website itself. */
type Fetcher = () => Promise<{ ok: true; html: string; status: number; finalUrl?: string } | { ok: false; reason: "robots_blocked" | "fetch_failed"; detail?: string }>;
const serve = (html: string, over: { status?: number; finalUrl?: string } = {}): Fetcher =>
  async () => ({ ok: true, html, status: 200, ...over });
const refuse = (reason: "robots_blocked" | "fetch_failed", detail?: string): Fetcher =>
  async () => ({ ok: false, reason, detail });
const base = { loadProfile: async () => null, writeOwnedPage: async () => {}, now: () => NOW };
/** ONE verification of one page, with the components under test. */
const check = async (components: Array<{ kind: string; after: string; anchorAfter?: string | null; before?: string | null }>, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  verifyShipment(T, { id: "s1", url: URL_, components }, { ...base, fetchPage: page, ...over });
/** What ONE component was judged to be. */
const state = async (kind: string, after: string, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  (await check([{ kind, after }], page, over)).components[0]!.state;
describe("what Beacon can see on the live page, component by component", () => {
  it("reads the page's own fields exactly: the wording I gave, other wording, or no field at all", async () => {
    expect(await state("title", "How to set a nowruz table")).toBe("verified");
    expect(await state("title", "how to set a NOWRUZ table.")).toBe("verified"); // the same words are the same title
    expect(await state("title", "Nowruz gift ideas")).toBe("changed_differently"); expect(await state("meta", "Set a nowruz table in seven steps.")).toBe("verified");
    expect(await state("h1", "How to set a nowruz table")).toBe("verified"); expect(await state("meta", "anything", serve("<html><head><title>t</title></head><body><p>x</p></body></html>"))).toBe("not_verified");});
  it("checks the opening answer against the words the page actually opens with", async () => {
    expect(await state("opening_answer", "A nowruz table is set with seven symbolic items known together as the haft seen")).toBe("verified");
    expect(await state("opening_answer", "Nowruz is celebrated on the spring equinox by millions of people every year")).toBe("changed_differently");
    expect(await state("opening_answer", "anything at all", serve("<html><head><title>t</title></head><body></body></html>"))).toBe("unverifiable");});
  it("looks for a section by its heading, and reads a removal the other way round", async () => {
    expect(await state("section_add", "What goes on the table\nEvery item stands for a wish.")).toBe("verified"); expect(await state("section", "Where to buy a haft seen set")).toBe("not_verified");
    expect(await state("section_remove", "Where to buy a haft seen set")).toBe("verified");
    expect(await state("section_remove", "What goes on the table")).toBe("not_verified");});
  it("never lets a two-word heading stand in for the section that was actually asked for", async () => {
    const fragment = serve(PAGE.replace("<h2>What goes on the table</h2>", "<h2>The table</h2>"));
    expect(await state("section_add", "The table settings every family in Tehran uses at Nowruz", fragment)).toBe("not_verified");
    expect(await state("section_add", "What goes on the table at Nowruz and why", serve(PAGE))).toBe("verified");});
  it("compares an internal link as an address, and says unknown when it could not read the page's links", async () => {
    expect(await state("internal_link_add", "Link to https://own.com/haft-seen from the opening")).toBe("verified");
    expect(await state("internal_link_add", "Link to /haft-seen")).toBe("verified"); // relative and absolute are one address
    expect(await state("internal_link_add", "Link to /chaharshanbe-suri")).toBe("not_verified");
    expect(await state("internal_link_add", "Add a link to the guide")).toBe("unverifiable"); // no address named
    const noLinks = serve("<html><head><title>t</title></head><body><main><p>words enough to count as a paragraph here</p></main></body></html>"); expect(await state("internal_link_add", "Link to /haft-seen", noLinks)).toBe("unverifiable");});
  it("verifies a new link only when the live link to the named address also carries the words the change asked for", async () => { const to = { kind: "internal_link_add", after: "Link to /haft-seen" }; expect([(await check([{ ...to, anchorAfter: "the haft seen explained" }])).components[0]!.state, (await check([{ ...to, anchorAfter: "seven items of spring" }])).components[0]!.state, ((await check([{ ...to, anchorAfter: "seven items of spring" }])).components[0]!.note ?? "").includes("does not carry the words")]).toEqual(["verified", "not_verified", true]); });
  it("checks a renamed link on the words that are actually on it, both ways, and says unknown without them", async () => {
    const swap = async (anchorAfter: string | null) => (await check([{ kind: "anchor_text",
      after: 'I would change the words "read more" that already point at /haft-seen so they read "the haft seen explained".',
      anchorAfter }])).components[0]!.state;
    expect(await swap("the haft seen explained")).toBe("verified"); // the live link carries the new words
    expect(await swap("what each haft seen item means")).toBe("not_verified"); // the link is there, the wording is not
    expect(await swap(null)).toBe("unverifiable"); // no new wording on file, so no claim either way
  });
  it("reads structured data as the weak signal it is, and never as proof of absence when the page builds itself in the browser", async () => {
    expect(await state("schema", "Add FAQPage structured data")).toBe("verified");
    expect(await state("schema", "Add HowTo structured data")).toBe("unverifiable"); // something is there, but not what was asked for
    const bare = serve(`<html><head><title>t</title></head><body><main><p>${"a real sentence about setting the table ".repeat(10)}</p></main></body></html>`);
    expect(await state("schema", "Add FAQPage structured data", bare)).toBe("not_verified");
    expect(await state("schema", "Add FAQPage structured data", serve("<html><head><title>t</title></head><body><div id=app></div></body></html>"))).toBe("unverifiable");});
  // A PREPARED BLOCK IS CHECKED ON THE NAMES INSIDE IT. Shipped as its field family a schema change was read as a section, and no heading on any page will ever match a JSON-LD block, so every one of them read as work the operator had not done.
  it("reads a prepared structured-data block on the names inside it, never on the page's own headings", async () => {
    const ASKED = "What goes on the table?", qa = (qs: string[]) => JSON.stringify(qs.map((q) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: "yes" } })));
    const block = (qs: string[]) => `{"@context":"https://schema.org","@type":"FAQPage","mainEntity":${qa(qs)}}`, live = (qs: string[]) => serve(PAGE.replace('"mainEntity":[]', `"mainEntity":${qa(qs)}`));
    expect([await state("schema_add", block([ASKED]), live([ASKED])), await state("schema_add", block([ASKED]), live(["Something else entirely?"])), await state("schema_add", block([ASKED]), serve(PAGE.replace(/<script[\s\S]*?<\/script>/, ""))), await state("schema_add", "not json at all", live([ASKED]))], "the block it asked for, a block of that type carrying other questions, a page with no structured data on it at all, and a block nobody can read").toEqual(["verified", "changed_differently", "not_verified", "unverifiable"]);
    expect((await check([{ kind: "schema_replace", after: block([ASKED]), before: block(["Old question?"]) }], live(["Old question?"]))).components[0], "a replacement the page still answers with the OLD block has not landed, which is not the same thing as a page carrying a different change").toEqual({ kind: "schema_replace", state: "not_verified", note: "Your page still carries the FAQPage block that was there before this change." });});
  it("checks the preferred address, the forward and the search setting from what the page itself reports", async () => {
    expect(await state("canonical", "Point the canonical at https://own.com/nowruz")).toBe("verified"); expect(await state("canonical", "Point the canonical at https://own.com/nowruz-guide")).toBe("changed_differently");
    const noCanonical = serve("<html><head><title>t</title></head><body><main><p>a paragraph with quite enough words in it</p></main></body></html>");
    expect(await state("canonical", "Point the canonical at https://own.com/x", noCanonical)).toBe("not_verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: "https://own.com/haft-seen" }))).toBe("verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: URL_ }))).toBe("not_verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen")).toBe("unverifiable"); // no final address reported
    const moved = await check([{ kind: "redirect", after: "Set up a forward" }], serve(PAGE, { finalUrl: "https://own.com/login" })); expect(moved.components[0]!.state).toBe("unverifiable");
    expect(moved.components[0]!.note).toContain("named no destination"); const noindex = serve(PAGE.replace("<head>", '<head><meta name="robots" content="noindex, follow"/>'));
    expect(await state("noindex", "Take it out of search", noindex)).toBe("verified");
    expect(await state("noindex", "Take it out of search")).toBe("unverifiable"); // a header I cannot see could carry it
  });
  it("verifies a forward against the destination the change named, never the address it moved", async () => {
    const chain = (url: string, to: string) => ({ url, discovered_via: "nav", crawl_state: "crawled", http_status: 200, redirects_to: to });
    const found = readTechnicalFindings({ inventory: [chain(URL_, "https://own.com/mid"), chain("https://own.com/mid", "https://own.com/haft-seen")] })
      .filter((f) => f.kind === "redirect_chain");
    const parts = technicalComponents(found, "nowruz table"); expect(parts.map((c) => [c.kind, c.redirectTo])).toEqual([["redirect", "https://own.com/haft-seen"]]);
    expect(parts[0]!.after).toContain("/nowruz"); // the address being moved is still the first one in the sentence
    const applied = parts.map((c) => ({ kind: c.kind, after: c.after, redirectTo: c.redirectTo ?? null }));
    const seen = await verifyShipment(T, { id: "s1", url: URL_, components: applied },
      { ...base, fetchPage: serve(PAGE, { finalUrl: "https://own.com/haft-seen" }) });
    expect([seen.status, seen.components[0]!.state]).toEqual(["verified", "verified"]);
    const wrong = await verifyShipment(T, { id: "s1", url: URL_, components: applied },
      { ...base, fetchPage: serve(PAGE, { finalUrl: "https://own.com/login" }) });
    expect(wrong.components[0]!.state).toBe("changed_differently");});
  it("reads a sitemap change in the sitemap itself, and refuses to grade one it could not read", async () => {
    const listing = (...locs: string[]) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
    const graded = async (xml: string | null) => (await check([{ kind: "navigation", after: "I would add /nowruz to the sitemap you already publish." }],
      (async (u: string) => (!u.endsWith("/sitemap.xml") ? { ok: true, html: PAGE, status: 200 }
        : xml == null ? { ok: false, reason: "fetch_failed" } : { ok: true, html: xml, status: 200 })) as unknown as Fetcher)).components[0]!;
    expect((await graded(listing(URL_, "https://own.com/haft-seen"))).state).toBe("verified"); const absent = await graded(listing("https://own.com/haft-seen"));
    expect([absent.state, absent.note]).toEqual(["not_verified", "Your sitemap lists 1 address, and this page is not one of them."]); expect((await graded(null)).state).toBe("unverifiable");
    expect((await graded("<sitemapindex><sitemap><loc>https://own.com/s1.xml</loc></sitemap></sitemapindex>")).state).toBe("unverifiable");
    expect((await graded(listing())).state).toBe("unverifiable"); // a sitemap answering with no addresses grades nothing
  });
  it("checks a broken link fix on the dead address it named, in both directions", async () => {
    const found = readTechnicalFindings({
      inventory: [{ url: "https://own.com/old-price", discovered_via: "nav", crawl_state: "crawled", http_status: 404 }],
      pages: [{ url: URL_, internal_links: ["https://own.com/old-price"] }],
    }).filter((f) => f.kind === "broken_internal_link");
    const parts = technicalComponents(found, "nowruz table"); expect(parts.map((c) => [c.kind, c.redirectTo])).toEqual([["internal_link_remove", "https://own.com/old-price"]]);
    const applied = parts.map((c) => ({ kind: c.kind, after: c.after, redirectTo: c.redirectTo ?? null })); const still = serve(PAGE.replace("</main>", '<p><a href="/old-price">old prices</a></p></main>'));
    expect((await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: still })).components[0]!.state).toBe("not_verified");
    expect((await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: serve(PAGE) })).components[0]!.state).toBe("verified");});
  it("reads body wording off the whole page, and refuses to judge a change whose wording it does not hold", async () => {
    expect(await state("paragraph_correction", "Every item on the cloth stands for a wish")).toBe("verified"); expect(await state("factual_correction", "Nowruz always falls on the twenty first of March")).toBe("not_verified");
    expect(await state("title", "")).toBe("unverifiable"); // no copy on file for this component, so no claim about it
  });
  it("calls a new page live only when there is a real page at the address", async () => {
    const long = `<html><head><title>Haft seen</title></head><body><main><p>${"a real sentence about the haft seen table ".repeat(20)}</p></main></body></html>`; expect(await state("new_page", "", serve(long))).toBe("verified");
    expect(await state("new_page", "", serve("<html><head><title>t</title></head><body><main><p>almost nothing is here yet at all</p></main></body></html>"))).toBe("changed_differently");});});
describe("what Beacon says overall, and what it refuses to say", () => {
  it("rolls the components up honestly: all of them, some of them, or none of them", async () => {
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "How to set a nowruz table" }])).status).toBe("verified");
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("partially_verified");
    expect((await check([{ kind: "title", after: "Nowruz gifts" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("differs");});
  it("says blocked when it could not read the page, and not found when there is no page there", async () => {
    const robots = await check([{ kind: "title", after: "How to set a nowruz table" }], refuse("robots_blocked")); expect([robots.status, robots.components[0]!.state]).toEqual(["blocked", "unverifiable"]);
    expect(robots.components[0]!.note).toContain("robots rules"); expect((await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"))).status).toBe("blocked");
    const gone = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "http_404")); // NOT_FOUND INSIDE THE PUBLISH LAG IS THE SAME LAG (operator, 2026-08-29): work is marked done in the editor and the site publishes later, so read one schedules a bounded recheck instead of burying the change
    expect([gone.status, gone.recheckAfter != null]).toEqual(["not_found", true]); expect((await check([{ kind: "new_page", after: "" }], refuse("fetch_failed", "http_404"))).status).toBe("not_found");
    const graded = await check([{ kind: "noindex", after: "" }]), bound = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "noindex", after: "" }], priorChecks: 2 }, { ...base, fetchPage: serve(PAGE) }); expect([graded.status, graded.checks, graded.recheckAfter, bound.recheckAfter], "R-059: a reading that could grade nothing is owed the same bounded rechecks a difference gets, and the third one stands").toEqual(["blocked", 1, "2026-08-02", null]);});
  it("reads a difference inside the publish grace window as not published yet: no bounded check is spent and it is read again tomorrow", async () => { const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString(); const early = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], implementedAt: at(1) }, { ...base, fetchPage: serve(PAGE) }), late = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], implementedAt: at(8) }, { ...base, fetchPage: serve(PAGE) });
    expect([early.status, early.checks, early.recheckAfter, (early.components[0]!.note ?? "").includes("published later"), late.status, late.checks, late.recheckAfter]).toEqual(["differs", 0, "2026-08-01", true, "differs", 1, "2026-08-02"]); });
  it("resolves a scheme-less page key and an absolute address to the same Search history, and answers nothing at all for a page with none", async () => { const { readWindowForPages } = await import("@/domains/measurement/proof-gsc/gsc-window"); const m = await readWindowForPages({ tenantId: T, pages: ["own.com/nowruz", "https://www.own.com/nowruz/", "own.com/never"], start: "2026-08-05", end: "2026-09-02" }); expect([m.get("own.com/nowruz")?.impressions, m.get("https://www.own.com/nowruz/")?.impressions, m.has("own.com/never")]).toEqual([900, 900, false]); }); // NOTHING ON FILE IS NOT ZERO
  it("goes and reads the page whatever the operator claimed, and cannot land verified without page evidence", async () => { let fetched = 0; const claimed = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }] }, { ...base, fetchPage: async () => { fetched += 1; return { ok: true as const, html: PAGE, status: 200 }; } });
    expect([claimed.status, fetched, claimed.components[0]!.state]).toEqual(["differs", 1, "changed_differently"]);});});
describe("the pass: what is due, how much of it runs, and what it writes", () => {
  const row = (o: Record<string, unknown>) => ({
    id: "s1", page: URL_, path: "/nowruz", actionType: "title", after: "How to set a nowruz table",
    implementedAt: "2026-07-30T09:00:00Z", verification: null, componentsApplied: null, ...o });
  beforeEach(() => { ROWS.length = 0; WRITES.length = 0; passedBustedAt = undefined; });
  it("owes a check on every change marked implemented that has never been checked, and on nothing else", async () => {
    ROWS.push(row({ id: "a" }), row({ id: "b", verification: { status: "verified", checkedAt: "x", components: [] } }), row({ id: "c", implementedAt: null }));
    expect((await shipmentsAwaitingVerification(T, 3)).map((s) => s.id)).toEqual(["a"]); expect(await shipmentsAwaitingVerification("", 3)).toEqual([]); ROWS.length = 0; // and then reads every due live page in one bounded pass, writing each answer exactly once
    for (const id of ["a", "b", "c", "d", "e"]) ROWS.push(row({ id, implementedAt: `2026-07-3${id === "a" ? 0 : 1}T09:00:00Z` }));
    const read: string[] = []; const written = await verifyDueShipments(T, { ...base, fetchPage: (async (u: string) => { read.push(u); return { ok: true as const, html: PAGE, status: 200 }; }) });
    expect([written, read.length, WRITES.length]).toEqual([5, 5, 5]); expect(WRITES.map((w) => w[2].status)).toEqual(["verified", "verified", "verified", "verified", "verified"]);});
  it("finds its target past the sweep cap, and rules nothing else in its place", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) ROWS.push(row({ id, implementedAt: `2026-07-${id === "e" ? "31" : "30"}T09:00:00Z` }));
    const read: string[] = [];
    const written = await verifyShipmentNow(T, "e", { ...base, fetchPage: (async (u: string) => { read.push(u); return { ok: true as const, html: PAGE, status: 200 }; }) });
    expect([written, read.length, WRITES.map((w) => w[1])], "the fifth-in-line target, one read, one record").toEqual([1, 1, ["e"]]);
    ROWS.length = 0; WRITES.length = 0; for (const id of ["a", "b", "c"]) ROWS.push(row({ id, implementedAt: "2026-07-30T09:00:00Z" })); // and the one shipment just marked done goes through the same path and nothing else
    const read2: string[] = [];
    const written2 = await verifyShipmentNow(T, "b", { ...base, fetchPage: (async (u: string) => { read2.push(u); return { ok: true as const, html: PAGE, status: 200 }; }) });
    expect([written, read.length, WRITES.map((w) => w[1])], "one shipment, one read, one record").toEqual([1, 1, ["b"]]);
    expect(await verifyShipmentNow(T, "nope", { ...base, fetchPage: serve(PAGE) }), "a shipment that is not due reads nothing").toBe(0); });
  it("records a page it was refused rather than retrying it forever: the answer lands, so the change stops being due", async () => {
    ROWS.push(row({ id: "a" }));
    let reads = 0; const pass = () => verifyDueShipments(T, { ...base, fetchPage: (async () => { reads += 1; return { ok: false as const, reason: "robots_blocked" as const }; }) });
    expect([await pass(), WRITES[0]![2].status, reads]).toEqual([1, "blocked", 1]);
    ROWS[0]!.verification = WRITES[0]![2];
    expect([await pass(), reads]).toEqual([0, 1]);
    ROWS.length = 0; ROWS.push(row({ id: "a" })); // and a shipment whose answer could not be saved stays due, so the check is not silently lost
    expect(await verifyDueShipments(T, { ...base, fetchPage: serve(PAGE), record: async () => false })).toBe(0);});
  it("stops reading an address inside the same pass once an answer for it could not be saved", async () => {
    ROWS.push(row({ id: "a" }), row({ id: "b" }), row({ id: "c" })); // three changes, one page
    let reads = 0;
    const written = await verifyDueShipments(T, { ...base, record: async () => false,
      fetchPage: (async () => { reads += 1; return { ok: true as const, html: PAGE, status: 200 }; }),});
    expect([written, reads]).toEqual([0, 1]);});
  it("gives a site that did not answer ONE retry on a later day, and a robots denial none at all", async () => {
    const dead = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout")); expect([dead.status, dead.checks, dead.recheckAfter]).toEqual(["blocked", 1, "2026-08-01"]);
    const robots = await check([{ kind: "title", after: "x" }], refuse("robots_blocked")); expect([robots.status, robots.recheckAfter ?? null]).toEqual(["blocked", null]);
    const silent = async (priorChecks: number) => (await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "x" }], priorChecks }, { ...base, fetchPage: refuse("fetch_failed", "timeout") })).recheckAfter ?? null;
    expect([await silent(1), await silent(2)], "R-059: a silent site is read again on the promised day until the bound, and the third answer stands whatever it is").toEqual(["2026-08-01", null]);});
  it("owes that retry only once the promised day arrives, and never owes one for a robots denial", async () => {
    const blocked = (recheckAfter: string | null) => ({ status: "blocked", checkedAt: "2026-07-30T09:00:00Z", components: [], recheckAfter });
    ROWS.push(row({ id: "waiting", verification: blocked("2026-08-01") }), row({ id: "refused", verification: blocked(null) }));
    expect(await shipmentsAwaitingVerification(T, 3, { now: () => NOW })).toEqual([]); // 2026-07-31: not yet
    const tomorrow = await shipmentsAwaitingVerification(T, 3, { now: () => NOW + DAY }); expect(tomorrow.map((s) => [s.id, s.priorChecks])).toEqual([["waiting", 1]]);});
  /** THE PROMISED DAY IS THE OPERATOR'S DAY, not the UTC one. Read off a UTC instant, a retry promised for the 5th came due at 5 PM Pacific on the 4th, so the one retry a silent site earns was spent a day early and its answer, which is final either way, stood. */
  it("owes the retry on the promised day where the operator lives, not from 5 PM the evening before", async () => {
    const blocked = { status: "blocked", checkedAt: "2026-08-01T09:00:00Z", components: [], recheckAfter: "2026-08-05" };
    ROWS.push(row({ id: "waiting", verification: blocked }));
    const dueAt = async (iso: string) => (await shipmentsAwaitingVerification(T, 3, { now: () => Date.parse(iso) })).map((s) => s.id);
    expect(await dueAt("2026-08-05T02:00:00Z")).toEqual([]);            // 7 PM on the 4th where they are
    expect(await dueAt("2026-08-05T08:01:00Z")).toEqual(["waiting"]);   // 1 AM on the 5th where they are
  });
  /** And the promise itself is made in the same zone it is read in. */
  it("promises that retry on the operator's next day, not on UTC's", async () => {
    const evening = Date.parse("2026-08-05T02:00:00Z"); // 7 PM on the 4th where the operator is
    const dead = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"), { now: () => evening }); expect(dead.recheckAfter).toBe("2026-08-05");});});
describe("a change the operator implemented busts that page's freshness", () => {
  beforeEach(() => { ROWS.length = 0; passedBustedAt = undefined; });
  it("hands back the LATEST moment that page was implemented, and nothing for a page nobody changed", async () => {
    ROWS.push({ id: "a", page: URL_, path: "/nowruz", implementedAt: "2026-07-20T09:00:00Z" },
      { id: "b", page: "https://own.com/nowruz", path: "/nowruz", implementedAt: "2026-07-29T09:00:00Z" },
      { id: "c", page: "https://own.com/other", path: "/other", implementedAt: "2026-07-30T09:00:00Z" });
    expect(await shipmentBustedAt(T, URL_)).toBe("2026-07-29T09:00:00Z"); expect(await shipmentBustedAt(T, "https://own.com/nothing")).toBeNull();
    expect(await shipmentBustedAt(T, "")).toBeNull();
    ROWS.length = 0; ROWS.push({ id: "home", page: "https://own.com/", path: "/", implementedAt: "2026-07-30T09:00:00Z" }); // and only the page that was changed is busted: a home page change does not throw away the whole site
    expect(await shipmentBustedAt(T, "https://own.com/")).toBe("2026-07-30T09:00:00Z"); expect(await shipmentBustedAt(T, URL_)).toBeNull();
    ROWS.push({ id: "guide", page: "https://own.com/guide", path: "/guide", implementedAt: "2026-07-30T09:00:00Z" });
    expect(await shipmentBustedAt(T, "https://own.com/nowruz-guide")).toBeNull(); });
  it("forces a re-read of a body that is still inside its freshness window but older than the change", async () => {
    const bodyReadAt = new Date(NOW - DAY).toISOString(), busted = new Date(NOW - DAY / 2).toISOString();
    expect(isCurrent("owned_page", bodyReadAt, NOW)).toBe(true); // a day old, well inside the weekly window
    expect(isCurrent("owned_page", bodyReadAt, NOW, busted)).toBe(false); // but it describes the page as it was before the change
    expect(isCurrent("owned_page", new Date(NOW - DAY / 4).toISOString(), NOW, busted)).toBe(true); // a read taken after it stands
  });
  it("passes that moment into the ONE owned page a research pass may read", async () => {
    ROWS.push({ id: "a", page: URL_, path: "/nowruz", implementedAt: "2026-07-29T09:00:00Z" });
    const { defaultSteps } = await import("@/domains/runtime/ops/research-steps"); const focus = { basis: "b1", topics: [{ topicKey: "t1", query: "nowruz table", requirement: null, retryAfter: null, ownedUrl: URL_ }] };
    await defaultSteps.funnelUnit("winning_pages", T, { basis: "b1" }, 1000, focus as never); expect(passedBustedAt).toBe("2026-07-29T09:00:00Z");
    ROWS.length = 0; // no shipment for that page: nothing changed it, and the ordinary freshness window decides
    await defaultSteps.funnelUnit("winning_pages", T, { basis: "b1" }, 1000, focus as never); expect(passedBustedAt).toBeNull();});});
