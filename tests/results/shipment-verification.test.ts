import { beforeEach, describe, expect, it, vi } from "vitest";
/** Live implementation verification (V1 Truth Convergence Phase 6). These pin CUSTOMER TRUTH, not the implementation: what Beacon says it saw on the operator's live
 *  page, and what it refuses to say. Fixtures only, zero network: the polite fetch is seamed exactly the way the owned-page read seams it. */
const ROWS: Array<Record<string, unknown>> = [];
const WRITES: Array<[string, string, { status: string }]> = [];
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChangesForTenant: async () => ROWS,
  recordVerification: async (t: string, id: string, v: { status: string }) => { WRITES.push([t, id, v]); return true; },
}));
/** The evidence facade is stubbed so the ONE thing under test at the funnel call site is the argument. */
let passedBustedAt: string | null | undefined;
vi.mock("@/domains/evidence", () => {
  const done = () => async () => ({ status: "done", cursor: null, progress: {} });
  return {
    keywordDiscoveryUnit: done, promptObservationUnit: done, serpAnalysisUnit: done,
    winningPagesUnit: (_d: unknown, _q: unknown, _a: unknown, _u: unknown, busted: string | null) => {
      passedBustedAt = busted; return async () => ({ status: "done", cursor: null, progress: {} });
    },
  };
});
import { isCurrent } from "@/domains/evidence/freshness";
import { shipmentBustedAt, shipmentsAwaitingVerification, verifyDueShipments, verifyShipment } from "@/domains/measurement/verify-shipment";
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
const check = async (components: Array<{ kind: string; after: string; anchorAfter?: string | null }>, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  verifyShipment(T, { id: "s1", url: URL_, components }, { ...base, fetchPage: page, ...over });
/** What ONE component was judged to be. */
const state = async (kind: string, after: string, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  (await check([{ kind, after }], page, over)).components[0]!.state;
describe("what Beacon can see on the live page, component by component", () => {
  it("reads the page's own fields exactly: the wording I gave, other wording, or no field at all", async () => {
    expect(await state("title", "How to set a nowruz table")).toBe("verified");
    expect(await state("title", "how to set a NOWRUZ table.")).toBe("verified"); // the same words are the same title
    expect(await state("title", "Nowruz gift ideas")).toBe("changed_differently");
    expect(await state("meta", "Set a nowruz table in seven steps.")).toBe("verified");
    expect(await state("h1", "How to set a nowruz table")).toBe("verified");
    expect(await state("meta", "anything", serve("<html><head><title>t</title></head><body><p>x</p></body></html>"))).toBe("not_verified");
  });
  it("checks the opening answer against the words the page actually opens with", async () => {
    expect(await state("opening_answer", "A nowruz table is set with seven symbolic items known together as the haft seen")).toBe("verified");
    expect(await state("opening_answer", "Nowruz is celebrated on the spring equinox by millions of people every year")).toBe("changed_differently");
    expect(await state("opening_answer", "anything at all", serve("<html><head><title>t</title></head><body></body></html>"))).toBe("unverifiable");
  });
  it("looks for a section by its heading, and reads a removal the other way round", async () => {
    expect(await state("section_add", "What goes on the table\nEvery item stands for a wish.")).toBe("verified");
    expect(await state("section", "Where to buy a haft seen set")).toBe("not_verified");
    expect(await state("section_remove", "Where to buy a haft seen set")).toBe("verified");
    // A section I was asked to REMOVE that is still there is not a different change, it is no change.
    expect(await state("section_remove", "What goes on the table")).toBe("not_verified");
  });
  it("never lets a two-word heading stand in for the section that was actually asked for", async () => {
    const fragment = serve(PAGE.replace("<h2>What goes on the table</h2>", "<h2>The table</h2>"));
    // "The table" is a fragment of the proposed heading, not a cover of it: two of eight words is not the section.
    expect(await state("section_add", "The table settings every family in Tehran uses at Nowruz", fragment)).toBe("not_verified");
    // Half the words or more IS the section, however the operator reworded the rest of it.
    expect(await state("section_add", "What goes on the table at Nowruz and why", serve(PAGE))).toBe("verified");
  });
  it("compares an internal link as an address, and says unknown when it could not read the page's links", async () => {
    expect(await state("internal_link_add", "Link to https://own.com/haft-seen from the opening")).toBe("verified");
    expect(await state("internal_link_add", "Link to /haft-seen")).toBe("verified"); // relative and absolute are one address
    expect(await state("internal_link_add", "Link to /chaharshanbe-suri")).toBe("not_verified");
    expect(await state("internal_link_add", "Add a link to the guide")).toBe("unverifiable"); // no address named
    const noLinks = serve("<html><head><title>t</title></head><body><main><p>words enough to count as a paragraph here</p></main></body></html>");
    expect(await state("internal_link_add", "Link to /haft-seen", noLinks)).toBe("unverifiable");
  });
  // A RENAMED LINK IS NOT VERIFIED BY THE LINK EXISTING. The swap renames a link that is already there, so checking for the address answered yes the moment the change was written: it read verified before the operator touched the page. The words on the live link are the only thing that can settle it.
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
    // A page thin enough that its content may be built in the browser is never called missing.
    expect(await state("schema", "Add FAQPage structured data", serve("<html><head><title>t</title></head><body><div id=app></div></body></html>"))).toBe("unverifiable");
  });
  it("checks the preferred address, the forward and the search setting from what the page itself reports", async () => {
    expect(await state("canonical", "Point the canonical at https://own.com/nowruz")).toBe("verified");
    expect(await state("canonical", "Point the canonical at https://own.com/nowruz-guide")).toBe("changed_differently");
    const noCanonical = serve("<html><head><title>t</title></head><body><main><p>a paragraph with quite enough words in it</p></main></body></html>");
    expect(await state("canonical", "Point the canonical at https://own.com/x", noCanonical)).toBe("not_verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: "https://own.com/haft-seen" }))).toBe("verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: URL_ }))).toBe("not_verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen")).toBe("unverifiable"); // no final address reported
    // MOVED IS NOT ARRIVED. A forward with no destination named could be landing on a login wall.
    const moved = await check([{ kind: "redirect", after: "Set up a forward" }], serve(PAGE, { finalUrl: "https://own.com/login" }));
    expect(moved.components[0]!.state).toBe("unverifiable");
    expect(moved.components[0]!.note).toContain("named no destination");
    const noindex = serve(PAGE.replace("<head>", '<head><meta name="robots" content="noindex, follow"/>'));
    expect(await state("noindex", "Take it out of search", noindex)).toBe("verified");
    expect(await state("noindex", "Take it out of search")).toBe("unverifiable"); // a header I cannot see could carry it
  });
  // PIN (B, F2a): the whole road, finding to reading. A shortened forward names /haft-seen, and the check has to read THAT address: taking the first address out of the sentence took the one being MOVED, so an operator who did exactly what I asked was told their forward went somewhere other than where I asked.
  it("verifies a forward against the destination the change named, never the address it moved", async () => {
    const chain = (url: string, to: string) => ({ url, discovered_via: "nav", crawl_state: "crawled", http_status: 200, redirects_to: to });
    const found = readTechnicalFindings({ inventory: [chain(URL_, "https://own.com/mid"), chain("https://own.com/mid", "https://own.com/haft-seen")] })
      .filter((f) => f.kind === "redirect_chain");
    const parts = technicalComponents(found, "nowruz table");
    expect(parts.map((c) => [c.kind, c.redirectTo])).toEqual([["redirect", "https://own.com/haft-seen"]]);
    expect(parts[0]!.after).toContain("/nowruz"); // the address being moved is still the first one in the sentence
    // exactly what "Mark implemented" records on the shipment, and exactly what the check is handed back
    const applied = parts.map((c) => ({ kind: c.kind, after: c.after, redirectTo: c.redirectTo ?? null }));
    const seen = await verifyShipment(T, { id: "s1", url: URL_, components: applied },
      { ...base, fetchPage: serve(PAGE, { finalUrl: "https://own.com/haft-seen" }) });
    expect([seen.status, seen.components[0]!.state]).toEqual(["verified", "verified"]);
    // and a forward that landed somewhere else is still called out, on the same structured address
    const wrong = await verifyShipment(T, { id: "s1", url: URL_, components: applied },
      { ...base, fetchPage: serve(PAGE, { finalUrl: "https://own.com/login" }) });
    expect(wrong.components[0]!.state).toBe("changed_differently");
  });
  // PIN (B, F2c): an edit to sitemap.xml can never put a link on the page, so looking for one graded every sitemap change as work the operator had not done. It is read in the sitemap, or it is not graded.
  it("reads a sitemap change in the sitemap itself, and refuses to grade one it could not read", async () => {
    const listing = (...locs: string[]) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
    const graded = async (xml: string | null) => (await check([{ kind: "navigation", after: "I would add /nowruz to the sitemap you already publish." }],
      (async (u: string) => (!u.endsWith("/sitemap.xml") ? { ok: true, html: PAGE, status: 200 }
        : xml == null ? { ok: false, reason: "fetch_failed" } : { ok: true, html: xml, status: 200 })) as unknown as Fetcher)).components[0]!;
    expect((await graded(listing(URL_, "https://own.com/haft-seen"))).state).toBe("verified");
    const absent = await graded(listing("https://own.com/haft-seen"));
    expect([absent.state, absent.note]).toEqual(["not_verified", "Your sitemap lists 1 address, and this page is not one of them."]);
    expect((await graded(null)).state).toBe("unverifiable");
    expect((await graded("<sitemapindex><sitemap><loc>https://own.com/s1.xml</loc></sitemap></sitemapindex>")).state).toBe("unverifiable");
    expect((await graded(listing())).state).toBe("unverifiable"); // a sitemap answering with no addresses grades nothing
  });
  // PIN (F2d): a broken link is checked on the DEAD address, not the page carrying it. The regex took the first address in the sentence, the carrying page, and asked whether it links to itself: that answered verified whether or not the operator touched anything, and unearned work entered measurement.
  it("checks a broken link fix on the dead address it named, in both directions", async () => {
    const found = readTechnicalFindings({
      inventory: [{ url: "https://own.com/old-price", discovered_via: "nav", crawl_state: "crawled", http_status: 404 }],
      pages: [{ url: URL_, internal_links: ["https://own.com/old-price"] }],
    }).filter((f) => f.kind === "broken_internal_link");
    const parts = technicalComponents(found, "nowruz table");
    expect(parts.map((c) => [c.kind, c.redirectTo])).toEqual([["internal_link_remove", "https://own.com/old-price"]]);
    const applied = parts.map((c) => ({ kind: c.kind, after: c.after, redirectTo: c.redirectTo ?? null }));
    const still = serve(PAGE.replace("</main>", '<p><a href="/old-price">old prices</a></p></main>'));
    expect((await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: still })).components[0]!.state).toBe("not_verified");
    expect((await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: serve(PAGE) })).components[0]!.state).toBe("verified");
  });
  it("reads body wording off the whole page, and refuses to judge a change whose wording it does not hold", async () => {
    expect(await state("paragraph_correction", "Every item on the cloth stands for a wish")).toBe("verified");
    expect(await state("factual_correction", "Nowruz always falls on the twenty first of March")).toBe("not_verified");
    expect(await state("title", "")).toBe("unverifiable"); // no copy on file for this component, so no claim about it
  });
  it("calls a new page live only when there is a real page at the address", async () => {
    const long = `<html><head><title>Haft seen</title></head><body><main><p>${"a real sentence about the haft seen table ".repeat(20)}</p></main></body></html>`;
    expect(await state("new_page", "", serve(long))).toBe("verified");
    expect(await state("new_page", "", serve("<html><head><title>t</title></head><body><main><p>almost nothing is here yet at all</p></main></body></html>"))).toBe("changed_differently");
  });
});
describe("what Beacon says overall, and what it refuses to say", () => {
  it("rolls the components up honestly: all of them, some of them, or none of them", async () => {
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "How to set a nowruz table" }])).status).toBe("verified");
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("partially_verified");
    expect((await check([{ kind: "title", after: "Nowruz gifts" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("differs");
  });
  it("says blocked when it could not read the page, and not found when there is no page there", async () => {
    const robots = await check([{ kind: "title", after: "How to set a nowruz table" }], refuse("robots_blocked"));
    expect([robots.status, robots.components[0]!.state]).toEqual(["blocked", "unverifiable"]);
    expect(robots.components[0]!.note).toContain("robots rules");
    expect((await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"))).status).toBe("blocked");
    expect((await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "http_404"))).status).toBe("not_found");
    expect((await check([{ kind: "new_page", after: "" }], refuse("fetch_failed", "http_404"))).status).toBe("not_found");
    // A page I reached but nothing on it I can check is NOT a difference and never a pass: it is a check I could not complete.
    expect((await check([{ kind: "noindex", after: "" }])).status).toBe("blocked");
  });
  // PIN (B): THE CLAIM STARTS THE CHECK AND NEVER FINISHES IT. No argument to verifyShipment suppresses the read, and no state it returns says verified unless the page itself said so. CHANGED DIFFERENTLY is its own answer: the spot moved, and it moved to something other than what I wrote.
  it("goes and reads the page whatever the operator claimed, and cannot land verified without page evidence", async () => {
    let fetched = 0;
    const claimed = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }] },
      { ...base, fetchPage: async () => { fetched += 1; return { ok: true as const, html: PAGE, status: 200 }; } });
    expect([claimed.status, fetched, claimed.components[0]!.state]).toEqual(["differs", 1, "changed_differently"]);
  });
});
describe("the pass: what is due, how much of it runs, and what it writes", () => {
  const row = (o: Record<string, unknown>) => ({
    id: "s1", page: URL_, path: "/nowruz", actionType: "title", after: "How to set a nowruz table",
    implementedAt: "2026-07-30T09:00:00Z", verification: null, componentsApplied: null, ...o });
  beforeEach(() => { ROWS.length = 0; WRITES.length = 0; passedBustedAt = undefined; });
  it("owes a check on every change marked implemented that has never been checked, and on nothing else", async () => {
    ROWS.push(row({ id: "a" }), row({ id: "b", verification: { status: "verified", checkedAt: "x", components: [] } }), row({ id: "c", implementedAt: null }));
    expect((await shipmentsAwaitingVerification(T, 3)).map((s) => s.id)).toEqual(["a"]);
    expect(await shipmentsAwaitingVerification("", 3)).toEqual([]);
  });
  it("reads at most three live pages in one pass, writes each answer exactly once, and never reads a page twice", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) ROWS.push(row({ id, implementedAt: `2026-07-3${id === "a" ? 0 : 1}T09:00:00Z` }));
    const read: string[] = [];
    const written = await verifyDueShipments(T, { ...base, fetchPage: (async (u: string) => { read.push(u); return { ok: true as const, html: PAGE, status: 200 }; }) });
    expect([written, read.length, WRITES.length]).toEqual([3, 3, 3]);
    expect(WRITES.map((w) => w[2].status)).toEqual(["verified", "verified", "verified"]);
  });
  it("records a page it was refused rather than retrying it forever: the answer lands, so the change stops being due", async () => {
    ROWS.push(row({ id: "a" }));
    let reads = 0;
    const pass = () => verifyDueShipments(T, { ...base, fetchPage: (async () => { reads += 1; return { ok: false as const, reason: "robots_blocked" as const }; }) });
    expect([await pass(), WRITES[0]![2].status, reads]).toEqual([1, "blocked", 1]);
    // The store now holds an answer for that shipment, so the next pass finds nothing due and reads nothing.
    ROWS[0]!.verification = WRITES[0]![2];
    expect([await pass(), reads]).toEqual([0, 1]);
  });
  it("keeps a shipment due when the answer could not be saved, so the check is not silently lost", async () => {
    ROWS.push(row({ id: "a" }));
    expect(await verifyDueShipments(T, { ...base, fetchPage: serve(PAGE), record: async () => false })).toBe(0);
  });
  it("stops reading an address inside the same pass once an answer for it could not be saved", async () => {
    ROWS.push(row({ id: "a" }), row({ id: "b" }), row({ id: "c" })); // three changes, one page
    let reads = 0;
    const written = await verifyDueShipments(T, {
      ...base, record: async () => false,
      fetchPage: (async () => { reads += 1; return { ok: true as const, html: PAGE, status: 200 }; }),
    });
    expect([written, reads]).toEqual([0, 1]);
  });
  it("gives a site that did not answer ONE retry on a later day, and a robots denial none at all", async () => {
    const dead = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"));
    expect([dead.status, dead.recheckAfter]).toEqual(["blocked", "2026-08-01"]);
    const robots = await check([{ kind: "title", after: "x" }], refuse("robots_blocked"));
    expect([robots.status, robots.recheckAfter ?? null]).toEqual(["blocked", null]);
    // The retry's own answer is final, whatever it is: one retry is all there ever is.
    const again = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "x" }], recheck: true },
      { ...base, fetchPage: refuse("fetch_failed", "timeout") });
    expect(again.recheckAfter ?? null).toBeNull();
  });
  it("owes that retry only once the promised day arrives, and never owes one for a robots denial", async () => {
    const blocked = (recheckAfter: string | null) => ({ status: "blocked", checkedAt: "2026-07-30T09:00:00Z", components: [], recheckAfter });
    ROWS.push(row({ id: "waiting", verification: blocked("2026-08-01") }), row({ id: "refused", verification: blocked(null) }));
    expect(await shipmentsAwaitingVerification(T, 3, { now: () => NOW })).toEqual([]); // 2026-07-31: not yet
    const tomorrow = await shipmentsAwaitingVerification(T, 3, { now: () => NOW + DAY });
    expect(tomorrow.map((s) => [s.id, s.recheck])).toEqual([["waiting", true]]);
  });
  /** THE PROMISED DAY IS THE OPERATOR'S DAY, not the UTC one. Read off a UTC instant, a retry promised for the 5th came due at 5 PM Pacific on the 4th, so the one retry
   *  a silent site earns was spent a day early and its answer, which is final either way, stood. */
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
    const dead = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"), { now: () => evening });
    expect(dead.recheckAfter).toBe("2026-08-05");
  });
});
describe("a change the operator implemented busts that page's freshness", () => {
  beforeEach(() => { ROWS.length = 0; passedBustedAt = undefined; });
  it("hands back the LATEST moment that page was implemented, and nothing for a page nobody changed", async () => {
    ROWS.push({ id: "a", page: URL_, path: "/nowruz", implementedAt: "2026-07-20T09:00:00Z" },
      { id: "b", page: "https://own.com/nowruz", path: "/nowruz", implementedAt: "2026-07-29T09:00:00Z" },
      { id: "c", page: "https://own.com/other", path: "/other", implementedAt: "2026-07-30T09:00:00Z" });
    expect(await shipmentBustedAt(T, URL_)).toBe("2026-07-29T09:00:00Z");
    expect(await shipmentBustedAt(T, "https://own.com/nothing")).toBeNull();
    expect(await shipmentBustedAt(T, "")).toBeNull();
  });
  it("busts the page that was changed and no other: a home page change does not throw away the whole site", async () => {
    ROWS.push({ id: "home", page: "https://own.com/", path: "/", implementedAt: "2026-07-30T09:00:00Z" });
    expect(await shipmentBustedAt(T, "https://own.com/")).toBe("2026-07-30T09:00:00Z");
    expect(await shipmentBustedAt(T, URL_)).toBeNull();
    // Nor does a change to /guide bust /nowruz-guide, which merely ends with the same letters.
    ROWS.push({ id: "guide", page: "https://own.com/guide", path: "/guide", implementedAt: "2026-07-30T09:00:00Z" });
    expect(await shipmentBustedAt(T, "https://own.com/nowruz-guide")).toBeNull();
  });
  it("forces a re-read of a body that is still inside its freshness window but older than the change", async () => {
    const bodyReadAt = new Date(NOW - DAY).toISOString(), busted = new Date(NOW - DAY / 2).toISOString();
    expect(isCurrent("owned_page", bodyReadAt, NOW)).toBe(true); // a day old, well inside the weekly window
    expect(isCurrent("owned_page", bodyReadAt, NOW, busted)).toBe(false); // but it describes the page as it was before the change
    expect(isCurrent("owned_page", new Date(NOW - DAY / 4).toISOString(), NOW, busted)).toBe(true); // a read taken after it stands
  });
  it("passes that moment into the ONE owned page a research pass may read", async () => {
    ROWS.push({ id: "a", page: URL_, path: "/nowruz", implementedAt: "2026-07-29T09:00:00Z" });
    const { defaultSteps } = await import("@/domains/runtime/ops/research-steps");
    const focus = { basis: "b1", topics: [{ topicKey: "t1", query: "nowruz table", requirement: null, retryAfter: null, ownedUrl: URL_ }] };
    await defaultSteps.funnelUnit("winning_pages", T, { basis: "b1" }, 1000, focus as never);
    expect(passedBustedAt).toBe("2026-07-29T09:00:00Z");
    ROWS.length = 0; // no shipment for that page: nothing changed it, and the ordinary freshness window decides
    await defaultSteps.funnelUnit("winning_pages", T, { basis: "b1" }, 1000, focus as never);
    expect(passedBustedAt).toBeNull();
  });
});
