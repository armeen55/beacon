import { beforeEach, describe, expect, it, vi } from "vitest";
/** Live implementation verification (V1 Truth Convergence Phase 6). These pin CUSTOMER TRUTH, not the implementation: what Beacon says it saw on the operator's live page, and what it refuses to say. Fixtures only, zero network: the polite fetch is seamed exactly the way the owned-page read seams it. */
const ROWS: Array<Record<string, unknown> & { tenant?: string }> = [];
const WRITES: Array<[string, string, { status: string }]> = [];
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: async (_fn: string, a: { p_since: string }) => (a.p_since <= "2026-08-05" ? { data: [{ page: "https://own.com/nowruz", clicks: 30, impressions: 900, pos_weighted: 4500 }], error: null } : { data: [], error: null }) }) }));
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChangesForTenant: async (t: string) => ROWS.filter((r) => !r.tenant || r.tenant === t), // a row may name the account it belongs to, so one fixture holds two synthetic accounts; a row that names none belongs to whoever asks, exactly as before
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
import { evaluateChange, evaluateWindows } from "@/domains/measurement/proof-gsc/kernel";
import { buildResultsView } from "@/app/(shell)/results/results-presentation";
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
  it("reads the page's own fields exactly: the wording I gave, other wording, the wording that was already there, or no field at all", async () => {
    expect([await state("title", "How to set a nowruz table"), await state("title", "how to set a NOWRUZ table."), await state("meta", "Set a nowruz table in seven steps."), await state("h1", "How to set a nowruz table")], "the same words are the same field").toEqual(["verified", "verified", "verified", "verified"]);
    const other = await check([{ kind: "title", after: "Nowruz gift ideas" }]); expect([other.components[0]!.state, other.reason, other.components[0]!.note], "WHAT ACTUALLY SHIPPED IS PRESERVED: the operator's own version is what the change is measured on from here").toEqual(["changed_differently", "published_differently", 'Your page title is live, and it is not the prepared wording. Your page says "How to set a nowruz table", which is what this change is measured on.']);
    const old = await check([{ kind: "title", after: "Nowruz gift ideas", before: "How to set a nowruz table" }]); expect([old.components[0]!.state, old.reason], "and the wording that was there BEFORE, still live, is a publish that has not happened, never the operator's own version").toEqual(["not_verified", "not_published_yet"]);
    const bare = await check([{ kind: "meta", after: "anything" }], serve("<html><head><title>t</title></head><body><p>x</p></body></html>")); expect([bare.components[0]!.state, bare.reason], "a head that parsed can honestly report an absent field").toEqual(["not_verified", "not_published_yet"]);});
  it("checks the opening answer against the words the page actually opens with", async () => { expect([await state("opening_answer", "A nowruz table is set with seven symbolic items known together as the haft seen"), await state("opening_answer", "Nowruz is celebrated on the spring equinox by millions of people every year"), await state("opening_answer", "anything at all", serve("<html><head><title>t</title></head><body></body></html>"))]).toEqual(["verified", "changed_differently", "unverifiable"]);});
  it("looks for a section by its heading OR by its own words, and reads a removal the other way round", async () => { expect([await state("section_add", "What goes on the table\nEvery item stands for a wish."), await state("section", "Where to buy a haft seen set"), await state("section_remove", "Where to buy a haft seen set"), await state("section_remove", "What goes on the table"), await state("section", "Every item on the cloth stands for a wish for the year")], "and the last one is the six live sections this missed: what a Shipment stores is the BODY copy that was applied, whose first line is a sentence and never a heading").toEqual(["verified", "not_verified", "verified", "not_verified", "verified"]);});
  it("never lets a two-word heading stand in for the section that was actually asked for", async () => { const fragment = serve(PAGE.replace("<h2>What goes on the table</h2>", "<h2>The table</h2>")); expect([await state("section_add", "The table settings every family in Tehran uses at Nowruz", fragment), await state("section_add", "What goes on the table at Nowruz and why", serve(PAGE))]).toEqual(["not_verified", "verified"]);});
  it("compares an internal link as an address, and says unknown when it could not read the page's links", async () => { const noLinks = serve("<html><head><title>t</title></head><body><main><p>words enough to count as a paragraph here</p></main></body></html>");
    const stored = await verifyShipment(T, { id: "s1", url: "own.com/nowruz", components: [{ kind: "internal_link_add", after: "Link to /haft-seen" }], targetQueries: ["nowruz table"] }, { ...base, fetchPage: serve(PAGE), readSerp: async () => [{ url: "https://www.own.com/nowruz/", title: "How to set a nowruz table", snippet: null }] });
    expect([await state("internal_link_add", "Link to https://own.com/haft-seen from the opening"), await state("internal_link_add", "Link to /haft-seen"), await state("internal_link_add", "Link to /chaharshanbe-suri"), await state("internal_link_add", "Add a link to the guide"), await state("internal_link_add", "Link to /haft-seen", noLinks), stored.status], "relative and absolute are one address; no address named and no links read are both unknown; and a stored own.com/nowruz reads the same live page as a captured https://www.own.com/nowruz/").toEqual(["verified", "verified", "not_verified", "unverifiable", "unverifiable", "verified"]);});
  it("verifies a new link only when the live link to the named address also carries the words the change asked for", async () => { const to = { kind: "internal_link_add", after: "Link to /haft-seen" }; expect([(await check([{ ...to, anchorAfter: "the haft seen explained" }])).components[0]!.state, (await check([{ ...to, anchorAfter: "seven items of spring" }])).components[0]!.state, ((await check([{ ...to, anchorAfter: "seven items of spring" }])).components[0]!.note ?? "").includes("does not carry the words")]).toEqual(["verified", "not_verified", true]); });
  it("checks a renamed link on the words that are actually on it, both ways, and says unknown without them", async () => {
    const swap = async (anchorAfter: string | null) => (await check([{ kind: "anchor_text", after: 'I would change the words "read more" that already point at /haft-seen so they read "the haft seen explained".', anchorAfter }])).components[0]!.state;
    expect([await swap("the haft seen explained"), await swap("what each haft seen item means"), await swap(null)], "the live link carries the new words; the link is there and the wording is not; and a SENTENCE about the link is not the wording, so nothing is claimed either way").toEqual(["verified", "not_verified", "unverifiable"]);
    const label = (after: string, over: Record<string, unknown> = {}) => check([{ kind: "anchor_text", after, ...over }]);
    expect([(await label("the haft seen explained")).components[0]!.state, (await label("seven items of spring")).reason, (await label("the haft seen")).components[0]!.state, (await label("the haft seen explained", { redirectTo: "/chaharshanbe-suri" })).components[0]!.note], "the label IS the wording (27 applied renames read as unreadable while their words sat on the row); a label that is only PART of a live anchor is not that anchor; and where the change stored an address, only the links to that address are looked at").toEqual(["verified", "not_published_yet", "not_verified", "No link to that address is on your page at all."]);
  });
  it("reads structured data as the weak signal it is, and never as proof of absence when the page builds itself in the browser", async () => {
    const bare = serve(`<html><head><title>t</title></head><body><main><p>${"a real sentence about setting the table ".repeat(10)}</p></main></body></html>`);
    expect([await state("schema", "Add FAQPage structured data"), await state("schema", "Add HowTo structured data"), await state("schema", "Add FAQPage structured data", bare)], "something is there but not what was asked for, and a page with real words and no markup at all").toEqual(["verified", "unverifiable", "not_verified"]);
    const shell = serve("<html><head><title>t</title></head><body><div id=app></div></body></html>"), built = await check([{ kind: "schema", after: "Add FAQPage structured data" }, { kind: "section_add", after: "What goes on the table" }, { kind: "paragraph_correction", after: "Every item on the cloth stands for a wish" }], shell);
    expect([built.status, built.reason, ...built.components.map((c) => c.state)], "ONE FACT FOR THE WHOLE READING: a page that builds itself in the browser said so for its structured data while its sections called the operator's work undone").toEqual(["blocked", "rendered_content_gap", "unverifiable", "unverifiable", "unverifiable"]);});
  // A PREPARED BLOCK IS CHECKED ON THE NAMES INSIDE IT. Shipped as its field family a schema change was read as a section, and no heading on any page will ever match a JSON-LD block, so every one of them read as work the operator had not done.
  it("reads a prepared structured-data block on the names inside it, never on the page's own headings", async () => { const ASKED = "What goes on the table?", qa = (qs: string[]) => JSON.stringify(qs.map((q) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: "yes" } })));
    const block = (qs: string[]) => `{"@context":"https://schema.org","@type":"FAQPage","mainEntity":${qa(qs)}}`, live = (qs: string[]) => serve(PAGE.replace('"mainEntity":[]', `"mainEntity":${qa(qs)}`));
    expect([await state("schema_add", block([ASKED]), live([ASKED])), await state("schema_add", block([ASKED]), live(["Something else entirely?"])), await state("schema_add", block([ASKED]), serve(PAGE.replace(/<script[\s\S]*?<\/script>/, ""))), await state("schema_add", "not json at all", live([ASKED]))], "the block it asked for, a block of that type carrying other questions, a page with no structured data on it at all, and a block nobody can read").toEqual(["verified", "changed_differently", "not_verified", "unverifiable"]);
    expect((await check([{ kind: "schema_replace", after: block([ASKED]), before: block(["Old question?"]) }], live(["Old question?"]))).components[0], "a replacement the page still answers with the OLD block has not landed, which is not the same thing as a page carrying a different change").toEqual({ kind: "schema_replace", state: "not_verified", note: "Your page still carries the FAQPage block that was there before this change." });});
  it("checks the preferred address, the forward and the search setting from what the page itself reports", async () => { expect(await state("canonical", "Point the canonical at https://own.com/nowruz")).toBe("verified"); expect(await state("canonical", "Point the canonical at https://own.com/nowruz-guide")).toBe("changed_differently");
    const noCanonical = serve("<html><head><title>t</title></head><body><main><p>a paragraph with quite enough words in it</p></main></body></html>"), noindex = serve(PAGE.replace("<head>", '<head><meta name="robots" content="noindex, follow"/>'));
    const moved = await check([{ kind: "redirect", after: "Set up a forward" }], serve(PAGE, { finalUrl: "https://own.com/login" }));
    expect([await state("canonical", "Point the canonical at https://own.com/x", noCanonical), await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: "https://own.com/haft-seen" })), await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: URL_ })), await state("redirect", "Forward it to https://own.com/haft-seen"), moved.components[0]!.state, moved.components[0]!.note, await state("noindex", "Take it out of search", noindex), await state("noindex", "Take it out of search")], "no final address reported, a forward the change named no destination for, and a header nobody outside the page can see are all unknown").toEqual(["not_verified", "verified", "not_verified", "unverifiable", "unverifiable", "It forwards somewhere, and the change named no destination, so there is nothing to confirm it against.", "verified", "unverifiable"]);});
  it("verifies a forward against the destination the change named, never the address it moved", async () => { const chain = (url: string, to: string) => ({ url, discovered_via: "nav", crawl_state: "crawled", http_status: 200, redirects_to: to });
    const found = readTechnicalFindings({ inventory: [chain(URL_, "https://own.com/mid"), chain("https://own.com/mid", "https://own.com/haft-seen")] }).filter((f) => f.kind === "redirect_chain");
    const parts = technicalComponents(found, "nowruz table"); expect(parts.map((c) => [c.kind, c.redirectTo])).toEqual([["redirect", "https://own.com/haft-seen"]]);
    expect(parts[0]!.after).toContain("/nowruz"); // the address being moved is still the first one in the sentence
    const applied = parts.map((c) => ({ kind: c.kind, after: c.after, redirectTo: c.redirectTo ?? null }));
    const seen = await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: serve(PAGE, { finalUrl: "https://own.com/haft-seen" }) });
    expect([seen.status, seen.components[0]!.state]).toEqual(["verified", "verified"]);
    const wrong = await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: serve(PAGE, { finalUrl: "https://own.com/login" }) });
    expect(wrong.components[0]!.state).toBe("changed_differently");});
  it("reads a sitemap change in the sitemap itself, and refuses to grade one it could not read", async () => { const listing = (...locs: string[]) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
    const graded = async (xml: string | null) => (await check([{ kind: "navigation", after: "I would add /nowruz to the sitemap you already publish." }], (async (u: string) => (!u.endsWith("/sitemap.xml") ? { ok: true, html: PAGE, status: 200 } : xml == null ? { ok: false, reason: "fetch_failed" } : { ok: true, html: xml, status: 200 })) as unknown as Fetcher)).components[0]!;
    const absent = await graded(listing("https://own.com/haft-seen"));
    expect([(await graded(listing(URL_, "https://own.com/haft-seen"))).state, absent.state, absent.note, (await graded(null)).state, (await graded("<sitemapindex><sitemap><loc>https://own.com/s1.xml</loc></sitemap></sitemapindex>")).state, (await graded(listing())).state], "a sitemap that did not answer, one listing other sitemaps and one answering with no addresses all grade nothing").toEqual(["verified", "not_verified", "Your sitemap lists 1 address, and this page is not one of them.", "unverifiable", "unverifiable", "unverifiable"]);});
  it("checks a broken link fix on the dead address it named, in both directions", async () => {
    const found = readTechnicalFindings({ inventory: [{ url: "https://own.com/old-price", discovered_via: "nav", crawl_state: "crawled", http_status: 404 }], pages: [{ url: URL_, internal_links: ["https://own.com/old-price"] }], }).filter((f) => f.kind === "broken_internal_link");
    const parts = technicalComponents(found, "nowruz table"); expect(parts.map((c) => [c.kind, c.redirectTo])).toEqual([["internal_link_remove", "https://own.com/old-price"]]);
    const applied = parts.map((c) => ({ kind: c.kind, after: c.after, redirectTo: c.redirectTo ?? null })); const still = serve(PAGE.replace("</main>", '<p><a href="/old-price">old prices</a></p></main>'));
    expect([(await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: still })).components[0]!.state, (await verifyShipment(T, { id: "s1", url: URL_, components: applied }, { ...base, fetchPage: serve(PAGE) })).components[0]!.state]).toEqual(["not_verified", "verified"]);});
  it("reads body wording off the whole page, and refuses to judge a change whose wording it does not hold", async () => {
    const template = await check([{ kind: "answer_block", after: "Nowruz has a population of NUMBER as of YEAR (SOURCE)." }]);
    expect([await state("paragraph_correction", "Every item on the cloth stands for a wish"), await state("factual_correction", "Nowruz always falls on the twenty first of March"), await state("title", ""), template.components[0]!.state, template.reason], "no copy on file is no claim, and copy that is still a template was applied to nothing: grading a page against an unfilled slot calls work undone that nobody was ever handed").toEqual(["verified", "not_verified", "unverifiable", "unverifiable", "applied_wording_missing"]);});
  it("calls a new page live only when there is a real page at the address", async () => {
    const long = `<html><head><title>Haft seen</title></head><body><main><p>${"a real sentence about the haft seen table ".repeat(20)}</p></main></body></html>`; expect(await state("new_page", "", serve(long))).toBe("verified");
    expect(await state("new_page", "", serve("<html><head><title>t</title></head><body><main><p>almost nothing is here yet at all</p></main></body></html>"))).toBe("changed_differently");});});
describe("what Beacon says overall, and what it refuses to say", () => {
  it("rolls the components up honestly: all of them, some of them, or none of them", async () => {
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "How to set a nowruz table" }])).status).toBe("verified");
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("partially_verified");
    expect((await check([{ kind: "title", after: "Nowruz gifts" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("differs");});
  /** EVERY UNCONFIRMED READING NAMES EXACTLY ONE CAUSE, so the backlog reconciles to its causes and never to its outcomes: 40 rows carried an outcome and not one carried a reason, so three different problems printed one sentence and none of them could be worked. */
  it("names one typed cause for every unconfirmed reading, and the backlog reconciles to those causes", async () => {
    const shell = serve("<html><head><title>t</title></head><body><div id=app></div></body></html>"), serp = async () => [{ url: URL_, title: "Nowruz gift ideas", snippet: null }];
    const of = (components: Array<{ kind: string; after: string; before?: string | null }>, page = serve(PAGE), { implementedAt = null, ...over }: Record<string, unknown> & { implementedAt?: string | null } = {}) => verifyShipment(T, { id: "s1", url: "own.com/nowruz", components, targetQueries: ["nowruz table"], implementedAt }, { ...base, fetchPage: page, ...over });
    const held = async () => new Map([["own.com/nowruz", { url: URL_, title: "t", h1: null, metaDescription: null, headings: [], passages: [], openingSample: null, vocabulary: "", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt: new Date(NOW - 9 * DAY).toISOString(), completeness: "complete" as const, contentHash: null }]]);
    const backlog = await Promise.all([of([{ kind: "section", after: "Where to buy a haft seen set" }]), of([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout")), of([{ kind: "section", after: "Where to buy a haft seen set" }], shell),
      of([{ kind: "title", after: "x" }], refuse("fetch_failed", "http_404")), of([{ kind: "title", after: "x" }], serve("<html><body><div id=app></div></body></html>"), { readHeld: held, implementedAt: new Date(NOW - DAY).toISOString() }),
      of([{ kind: "title", after: "" }]), of([{ kind: "title", after: "Nowruz gifts" }]), of([{ kind: "title", after: "How to set a nowruz table" }], serve(PAGE), { readSerp: serp }), of([{ kind: "title", after: "x" }], refuse("robots_blocked"))]);
    expect(backlog.map((v) => v.reason), "one cause each, all nine distinct, and a scheme-less stored address reads the very same live page every one of them was read from").toEqual(["not_published_yet", "page_unreachable", "rendered_content_gap", "address_mismatch", "stale_reading", "applied_wording_missing", "published_differently", "google_not_updated", "unmeasurable"]);
    expect([backlog.filter((v) => v.status !== "verified" && v.reason == null).length, new Set(backlog.map((v) => v.reason)).size], "nothing unconfirmed is left uncaused, and no two causes collapse into one").toEqual([0, 9]);});
  it("says blocked when it could not read the page, and not found when there is no page there", async () => {
    const robots = await check([{ kind: "title", after: "How to set a nowruz table" }], refuse("robots_blocked")), dead = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"));
    const gone = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "http_404")); expect([robots.status, robots.components[0]!.state, robots.reason, robots.recheckAfter ?? null, robots.components[0]!.note!.includes("robots rules"), dead.status, dead.reason, gone.status, gone.recheckAfter != null, gone.reason, (await check([{ kind: "new_page", after: "" }], refuse("fetch_failed", "http_404"))).status], "a standing refusal can never be read, a site that timed out can be, and neither is words nobody stored: three causes where one sentence used to print. NOT_FOUND INSIDE THE PUBLISH LAG IS THE SAME LAG (operator, 2026-08-29): marked done in the editor, published later, so read one schedules a bounded recheck instead of burying the change").toEqual(["blocked", "unverifiable", "unmeasurable", null, true, "blocked", "page_unreachable", "not_found", true, "address_mismatch", "not_found"]);
    const graded = await check([{ kind: "noindex", after: "" }]), bound = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "noindex", after: "" }], priorChecks: 2 }, { ...base, fetchPage: serve(PAGE) }); expect([graded.status, graded.checks, graded.recheckAfter, bound.recheckAfter], "R-059: a reading that could grade nothing is owed the same bounded rechecks a difference gets, and the third one stands").toEqual(["blocked", 1, "2026-08-02", null]);});
  it("verifies a page the raw fetch cannot read at all from the capture the store already holds, and never writes the shell over it", async () => {
    const shell = serve("<html><body><div id=app></div></body></html>"), body = (fetchedAt: string) => async () => new Map([["own.com/nowruz", { url: URL_, title: "How to set a nowruz table", h1: "How to set a nowruz table", metaDescription: "Set a nowruz table in seven steps.", headings: ["What goes on the table"], passages: ["Every item on the cloth stands for a wish."], openingSample: null, vocabulary: "every item on the cloth stands for a wish", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt, completeness: "complete" as const, contentHash: null }]]);
    const wrote: string[] = [], at = (d: number) => new Date(NOW + d * DAY).toISOString(), of = (readHeld: unknown) => verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "How to set a nowruz table" }], implementedAt: at(-2) }, { ...base, fetchPage: shell, writeOwnedPage: async (s2) => { wrote.push(s2.url); }, readHeld: readHeld as never });
    const rendered = await of(body(at(-1))), stale = await of(body(at(-5))), none = await of(async () => new Map());
    expect([rendered.status, rendered.reason, stale.status, stale.reason, none.status, none.reason, wrote.length], "the rendered capture answers when it is newer than the change; words captured BEFORE the change prove what the page said then, never now; and no blank shell is ever written over the page").toEqual(["verified", null, "blocked", "stale_reading", "blocked", "rendered_content_gap", 0]);
    expect([stale.recheckAfter ?? null, none.recheckAfter], "and a reading taken off a capture older than the change promises no day: the same shell comes back every time, so it closes here and the page itself reopens it when a newer capture lands").toEqual([null, "2026-08-02"]);});
  it("reads a difference inside the publish grace window as not published yet: no bounded check is spent and it is read again tomorrow", async () => { const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString(); const early = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], implementedAt: at(1) }, { ...base, fetchPage: serve(PAGE) }), late = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], implementedAt: at(8) }, { ...base, fetchPage: serve(PAGE) });
    expect([early.status, early.checks, early.recheckAfter, (early.components[0]!.note ?? "").includes("published later"), late.status, late.checks, late.recheckAfter]).toEqual(["differs", 0, "2026-08-01", true, "differs", 1, "2026-08-02"]); });
  it("resolves a scheme-less page key and an absolute address to the same Search history, and answers nothing at all for a page with none", async () => { const { readWindowForPages } = await import("@/domains/measurement/proof-gsc/gsc-window"); const m = await readWindowForPages({ tenantId: T, pages: ["own.com/nowruz", "https://www.own.com/nowruz/", "own.com/never"], start: "2026-08-05", end: "2026-09-02" }); expect([m.get("own.com/nowruz")?.impressions, m.get("https://www.own.com/nowruz/")?.impressions, m.has("own.com/never")]).toEqual([900, 900, false]); }); // NOTHING ON FILE IS NOT ZERO
  /** DELIVERED IS NOT SHOWING: the page carrying the new title and Google displaying it are two different facts, and only the first one is what "verified" means. */
  it("banks what Google shows beside the page reading, prints it on the card, and never lets it move the change's own status", async () => { const serp = (title: string) => async () => [{ url: URL_, title, snippet: "Set a nowruz table in seven steps." }];
    const ship = ({ before = null, ...over }: Record<string, unknown> & { before?: string | null }) => verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "How to set a nowruz table", before }], targetQueries: ["nowruz table"], implementedAt: new Date(NOW - 3 * DAY).toISOString() }, { ...base, fetchPage: serve(PAGE), ...over });
    const showing = await ship({ readSerp: serp("How to set a nowruz table | Iranopedia") }), behind = await ship({ readSerp: serp("Nowruz gift ideas") });
    expect([showing.status, showing.components.map((c) => c.kind), showing.components[1]!.note], "a brand suffix is still the words that were shipped").toEqual(["verified", ["title", "google_display"], "Google is showing your new title."]);
    expect([behind.status, behind.components[1]!.state, behind.components[1]!.note], "H6: the results page has not caught up, the change itself is still verified, and the old title is never claimed unless the old title was read").toEqual(["verified", "not_verified", "Google is not yet showing your new title, checked 3 days after the change."]);
    const wasOld = await ship({ readSerp: serp("Nowruz table guide"), before: "Nowruz table guide" }); expect([wasOld.components[1]!.note, wasOld.reason], "and where Google really is showing the old words, those words were literally read").toEqual(["Google still shows the old title, checked 3 days after the change.", "google_not_updated"]);
    const missing = await ship({ readSerp: async () => [{ url: "https://rival.com/nowruz", title: "Nowruz table", snippet: null }] }); expect([missing.status, missing.components[1]!.state, missing.components[1]!.note]).toEqual(["verified", "unverifiable", "That search did not bring your page back, so what Google shows for it could not be read."]);
    const read = evaluateChange({ id: "s1", page: URL_, path: "/nowruz", actionType: "title", shippedAt: "2026-07-28", baselineImpressions: 900, baselineClicks: 30, windows: [] }, evaluateWindows("2026-07-28", new Date(NOW), "2026-07-31"), []);
    const card = Object.values(buildResultsView([{ read, implementedAt: new Date(NOW - 3 * DAY).toISOString(), verification: behind, baseline: null }], new Date(NOW)).rows).flat()[0]!;
    expect(card.timeline.map((t) => t.label), "the operator reads it on the change's own timeline, with no position anywhere near it").toContain("Google is not yet showing your new title, checked 3 days after the change.");});
  it("asks Google nothing for a body change, and nothing at all when no provider is on file", async () => { let asked = 0; const count = async () => { asked += 1; return []; };
    const body = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "section_add", after: "What goes on the table" }], targetQueries: ["nowruz table"] }, { ...base, fetchPage: serve(PAGE), readSerp: count });
    expect([asked, body.components.map((c) => c.kind)], "a body change never buys a results page").toEqual([0, ["section_add"]]); vi.stubEnv("DATAFORSEO_LOGIN", ""); vi.stubEnv("DATAFORSEO_PASSWORD", ""); vi.stubEnv("DATAFORSEO_AUTH_B64", "");
    const blanked = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "How to set a nowruz table" }], targetQueries: ["nowruz table"] }, { ...base, fetchPage: serve(PAGE) });
    expect(blanked, "keys blanked: the page reading is exactly what it was before any of this, and a confirmed reading names no cause").toEqual({ status: "verified", checkedAt: new Date(NOW).toISOString(), checks: 1, reason: null, recheckAfter: null, components: [{ kind: "title", state: "verified", note: "Your page title matches the prepared wording exactly." }] }); vi.unstubAllEnvs();});
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
  it("reads at most twelve results pages in one pass, however many changes are owed one", async () => { for (const id of [..."abcdefghijklmno"]) ROWS.push(row({ id, targetQueries: ["nowruz table"] })); let asked = 0;
    const written = await verifyDueShipments(T, { ...base, fetchPage: serve(PAGE), readSerp: async () => { asked += 1; return []; } });
    expect([written, asked], "fifteen pages read for free, twelve results pages bought, and the rest are owed the next pass").toEqual([15, 12]);});
  it("records a page it was refused rather than retrying it forever: the answer lands, so the change stops being due", async () => {
    ROWS.push(row({ id: "a" }));
    let reads = 0; const pass = () => verifyDueShipments(T, { ...base, fetchPage: (async () => { reads += 1; return { ok: false as const, reason: "robots_blocked" as const }; }) });
    expect([await pass(), WRITES[0]![2].status, reads]).toEqual([1, "blocked", 1]);
    ROWS[0]!.verification = WRITES[0]![2];
    expect([await pass(), reads]).toEqual([0, 1]);
    ROWS.length = 0; ROWS.push(row({ id: "a" })); // and a shipment whose answer could not be saved stays due, so the check is not silently lost
    expect(await verifyDueShipments(T, { ...base, fetchPage: serve(PAGE), record: async () => false })).toBe(0);
    ROWS.length = 0; WRITES.length = 0; const was = { after: "Nowruz gifts", before: "How to set a nowruz table" }; ROWS.push(row({ id: "old", ...was }), row({ id: "listed", ...was, componentsApplied: [{ kind: "title", label: "the title" }] })); await verifyDueShipments(T, { ...base, fetchPage: serve(PAGE) }); // and the wording the ROW says was there before reaches the piece that carries none of its own, listed or not
    expect(WRITES.map((w) => [w[2].status, (w[2] as { reason?: string }).reason]), "the page still reading the way it did before this change is a publish that has not happened, never the operator's own version").toEqual([["differs", "not_published_yet"], ["differs", "not_published_yet"]]);});
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
    const tomorrow = await shipmentsAwaitingVerification(T, 3, { now: () => NOW + DAY }); expect(tomorrow.map((s) => [s.id, s.priorChecks])).toEqual([["waiting", 1]]);
    ROWS.length = 0; const shut = (checkedAt: string) => ({ status: "differs", checkedAt, components: [], recheckAfter: null }); ROWS.push(row({ id: "closed", verification: shut("2026-07-30T09:00:00Z") }));
    const asked = async (at: string) => (await shipmentsAwaitingVerification(T, 3, { now: () => NOW, readHeld: async () => new Map([["own.com/nowruz", { fetchedAt: at } as never]]) })).map((s) => s.id);
    const first = await asked("2026-08-15T00:00:00Z"); ROWS[0]!.verification = shut("2026-08-16T00:00:00Z"); expect([first, await asked("2026-08-15T00:00:00Z"), await asked("2026-09-01T00:00:00Z")], "THE PAGE ITSELF REOPENS A CLOSED READING, exactly once per capture: a capture newer than the reading that closed it makes the row due, the answer that re-read writes is stamped later than that capture so the same one never opens it twice, and a later capture opens it once more").toEqual([["closed"], [], ["closed"]]);});
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
/** PROOF 14 OF THE LOOP PLAN: a record that names nothing to look for can never be answered by reading the page, so it is
 *  reconciled from what it holds and consumes no live verification work at all. No wording is invented to check against. */
describe("a historical record no page can answer is reconciled from the record, never re-crawled", () => {
  const held = (id: string, tenant: string, after: string) => ({ id, tenant, page: URL_, path: "/nowruz", actionType: "answer_block", after,
    implementedAt: "2026-07-30T09:00:00Z", verification: null as unknown, componentsApplied: [{ kind: "answer_block", label: "Answer at the top of the page", after }] });
  beforeEach(() => { ROWS.length = 0; WRITES.length = 0; });
  it("spends no live read on a record whose applied wording was never stored or is still an unfilled template, and reads only the record that names something to look for, on two accounts", async () => {
    ROWS.push(held("blank", "acct-one", ""), held("template", "acct-one", "Isfahan has a population of NUMBER as of YEAR (SOURCE)."), held("real", "acct-one", "What goes on the table"));
    ROWS.push(held("blank-two", "acct-two", ""), held("template-two", "acct-two", "It has a population of NUMBER as of YEAR (SOURCE)."));
    let reads = 0; const fetchPage = (async () => { reads += 1; return { ok: true as const, html: PAGE, status: 200 }; }) as unknown as Fetcher;
    expect([await verifyDueShipments("acct-one", { ...base, fetchPage }), reads], "three answers written and exactly ONE website read, and it belongs to the record that names something to find").toEqual([3, 1]);
    const by = Object.fromEntries(WRITES.map((w) => [w[1], w[2] as unknown as { status: string; reason?: string; recheckAfter?: string | null; checks?: number; components: Array<{ note: string }> }]));
    expect([by.blank!.status, by.blank!.reason, by.blank!.recheckAfter ?? null, by.blank!.checks, by.template!.reason, by.real!.status], "each unanswerable one is settled for good: no day promised and no bounded check spent, while the answerable one is graded exactly as before").toEqual(["blocked", "applied_wording_missing", null, 0, "applied_wording_missing", "verified"]);
    expect([by.blank!.components[0]!.note, by.template!.components[0]!.note], "and each says what it holds and what the operator can actually do about it").toEqual([
      "The exact wording that was applied here was never recorded, so no reading of the page can confirm it. Nothing more is read for it. Record the words that are on the page and the next check reads them.",
      "What was recorded here is still the template wording, with its NUMBER, YEAR or SOURCE never filled in, so no live page could be carrying it. Nothing more is read for it. Record the words that are on the page and the next check reads them."]);
    reads = 0; WRITES.length = 0;
    expect([await verifyDueShipments("acct-two", { ...base, fetchPage }), reads], "the second account behaves identically: two answers, and the website is never touched").toEqual([2, 0]);
    for (const r of ROWS) r.verification = WRITES.concat([]).find((w) => w[1] === r.id)?.[2] ?? r.verification;
    const newer = async () => new Map([["own.com/nowruz", { fetchedAt: "2026-09-01T00:00:00Z" } as never]]);
    expect((await shipmentsAwaitingVerification("acct-two", 15, { ...base, readHeld: newer })).map((r) => r.id), "and a newer capture of the page does not reopen them either: a fresh read cannot answer a record that names nothing to look for").toEqual([]);});});
/** WHAT THE OPERATOR APPLIED IS WHAT THE PAGE IS READ FOR, with the prepared wording kept beside it (proof 12's live half). */
describe("a change the operator applied in their own words is read against their words", () => {
  beforeEach(() => { ROWS.length = 0; WRITES.length = 0; });
  it("reads the page for the version the operator recorded, and for the prepared one where they recorded none, on two accounts", async () => {
    const titled = (id: string, tenant: string, over: Record<string, unknown>) => ({ id, tenant, page: URL_, path: "/nowruz", actionType: "title", after: "Nowruz gift ideas",
      implementedAt: "2026-07-30T09:00:00Z", verification: null as unknown, componentsApplied: [{ kind: "title", label: "Page title on Nowruz guide", after: "Nowruz gift ideas", ...over }] });
    for (const tenant of ["acct-one", "acct-two"]) {
      ROWS.length = 0; WRITES.length = 0;
      ROWS.push(titled("theirs", tenant, { appliedAfter: "How to set a nowruz table" }), titled("prepared", tenant, {}));
      await verifyDueShipments(tenant, { ...base, fetchPage: serve(PAGE) });
      const by = Object.fromEntries(WRITES.map((w) => [w[1], w[2] as unknown as { status: string; reason?: string }]));
      expect([by.theirs!.status, by.prepared!.status, by.prepared!.reason], "their version is on the page and is confirmed; the record that carries none is read for the prepared wording and the page carries something else").toEqual(["verified", "differs", "published_differently"]);
      expect((ROWS[0]!.componentsApplied as Array<{ after: string }>)[0]!.after, "and the prepared wording is still on the record, untouched by the reading").toBe("Nowruz gift ideas");
    }});});
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
