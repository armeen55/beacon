import { beforeEach, describe, expect, it, vi } from "vitest";
const ROWS: Array<Record<string, unknown> & { tenant?: string }> = [];
const WRITES: Array<[string, string, { status: string }]> = [];
const search = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: search.rpc }) }));
beforeEach(() => { search.rpc.mockImplementation(async (_fn: string, a: { p_since: string }) => (a.p_since <= "2026-08-05" ? { data: [{ page: "https://own.com/nowruz", clicks: 30, impressions: 900, pos_weighted: 4500 }], error: null } : { data: [], error: null })); });
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChangesForTenant: async (t: string) => ROWS.filter((r) => !r.tenant || r.tenant === t), // a row may name the account it belongs to, so one fixture holds two synthetic accounts; a row that names none belongs to whoever asks, exactly as before
  recordVerification: async (t: string, id: string, v: { status: string }) => { WRITES.push([t, id, v]); return true; },}));
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
type Fetcher = () => Promise<{ ok: true; html: string; status: number; finalUrl?: string } | { ok: false; reason: "robots_blocked" | "fetch_failed"; detail?: string }>;
const serve = (html: string, over: { status?: number; finalUrl?: string } = {}): Fetcher =>
  async () => ({ ok: true, html, status: 200, ...over });
const refuse = (reason: "robots_blocked" | "fetch_failed", detail?: string): Fetcher =>
  async () => ({ ok: false, reason, detail });
const base = { loadProfile: async () => null, writeOwnedPage: async () => {}, now: () => NOW };
const check = async (components: Array<{ kind: string; after: string; anchorAfter?: string | null; before?: string | null }>, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  verifyShipment(T, { id: "s1", url: URL_, components }, { ...base, fetchPage: page, ...over });
const state = async (kind: string, after: string, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  (await check([{ kind, after }], page, over)).components[0]!.state;
describe("what Beacon can see on the live page, component by component", () => {
  it("reads the page's own fields exactly: the wording I gave, other wording, the wording that was already there, or no field at all", async () => {
    expect([await state("title", "How to set a nowruz table"), await state("title", "how to set a NOWRUZ table."), await state("meta", "Set a nowruz table in seven steps."), await state("h1", "How to set a nowruz table")], "the same words are the same field").toEqual(["verified", "verified", "verified", "verified"]);
    const other = await check([{ kind: "title", after: "Nowruz gift ideas" }]); expect([other.components[0]!.state, other.reason, other.components[0]!.note], "WHAT ACTUALLY SHIPPED IS PRESERVED: the operator's own version is what the change is measured on from here").toEqual(["changed_differently", "published_differently", 'Your page title is live, and it is not the prepared wording. Your page says "How to set a nowruz table", which is what this change is measured on.']);
    const old = await check([{ kind: "title", after: "Nowruz gift ideas", before: "How to set a nowruz table" }]); expect([old.components[0]!.state, old.reason], "and the wording that was there BEFORE, still live, is a publish that has not happened, never the operator's own version").toEqual(["not_verified", "not_published_yet"]);
    const bare = await check([{ kind: "meta", after: "anything" }], serve("<html><head><title>t</title></head><body><p>x</p></body></html>")); expect([bare.components[0]!.state, bare.reason], "a head that parsed can honestly report an absent field").toEqual(["not_verified", "not_published_yet"]);});
  it("checks the complete answer at the opening, not a prefix or the same answer later", async () => { const answer = "A nowruz table is set with seven symbolic items known together as the haft seen, one for each wish."; expect([await state("opening_answer", answer), await state("opening_answer", `${answer} Families add flowers too.`), await state("opening_answer", answer, serve(PAGE.replace(`<p>${answer}</p>`, `<p>Start with a clean cloth.</p><p>${answer}</p>`))), await state("opening_answer", "anything at all", serve("<html><head><title>t</title></head><body></body></html>"))]).toEqual(["verified", "changed_differently", "changed_differently", "unverifiable"]);});
  it("requires all section copy, including the suffix, and checks removals against readable content", async () => { const copy = "Every item on the cloth stands for a wish for the year that is starting, and families choose their own.";
    expect([await state("section_add", `What goes on the table\n${copy}`), await state("section", `${copy} Choose flowers from your garden.`), await state("section", "What goes on the table"), await state("section_remove", "Where to buy a haft seen set"), await state("section_remove", copy), await state("section_remove", "Where to buy a haft seen set", serve("<html><body><div id=app></div></body></html>")), await state("section", copy)]).toEqual(["verified", "not_verified", "unverifiable", "verified", "not_verified", "unverifiable", "verified"]);});
  it("never substitutes a fuzzy heading or navigation for copy, and accepts ordinary CMS formatting", async () => { const copy = "A rainwater bowl & flowers: نوروز costs 5%.", formatted = PAGE.replace("</main>", `<p>A <strong>rain</strong>water bowl &amp; flowers: نوروز costs 5%.</p></main>`);
    expect([await state("section_add", "What goes on the table at Nowruz and why"), await state("section_add", copy, serve(PAGE.replace("<main>", `<nav>${copy}</nav><main>`))), await state("paragraph_correction", copy, serve(formatted)), await state("paragraph_correction", copy.replace("5%", "5"), serve(formatted))]).toEqual(["not_verified", "not_verified", "verified", "not_verified"]);});
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
  it("confirms actual entity properties, never just a schema type, pooled names or truncated answer", async () => {
    const json = (node: Record<string, unknown>) => JSON.stringify({ "@context": "https://schema.org", ...node }), script = (block: string) => `<script TYPE="application/ld+json">${block}</script>`, live = (block: string) => serve(PAGE.replace(/<script[\s\S]*?<\/script>/, script(block)));
    const faq = (text: string) => ({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What goes on the table?", acceptedAnswer: { "@type": "Answer", text } }] }), answer = "Shared opening words. ".repeat(15) + "Seven items, not eight.";
    const image = { "@type": "ImageObject", name: "Nowruz table", caption: "Seven items", contentUrl: "https://own.com/Table.jpg", creditText: "A Photographer", dateCreated: "2026-07-01" }, article = { "@type": ["Article", "WebPage"], headline: "Nowruz table", author: { "@type": "Person", name: "A Writer" }, dateModified: "2026-07-31" }, service = { "@type": "Service", name: "Table setup", offers: { "@type": "Offer", price: 100, priceCurrency: "USD" } };
    for (const [tenant, node, changes] of [["publisher", faq(answer), [faq(answer.replace("Seven", "Eight")), faq("yes"), { ...faq(answer), mainEntity: [{ ...faq(answer).mainEntity[0], name: "Something else?" }] }]], ["shop", image, [ ...["name", "caption", "contentUrl", "creditText", "dateCreated"].map((k) => ({ ...image, [k]: "different" })), article, service ]], ["publisher", article, [{ ...article, author: { "@type": "Person", name: "Other writer" } }, { ...article, dateModified: "2025-01-01" }, { ...article, "@type": "Article" }]], ["shop", service, [{ ...service, offers: { ...service.offers, price: 101 } }, { ...service, offers: { ...service.offers, priceCurrency: "EUR" } }]]] as Array<[string, Record<string, unknown>, Record<string, unknown>[]]>) {
      const verify = (block: string, before?: string) => verifyShipment(tenant, { id: "schema", url: URL_, components: [{ kind: "schema_replace", after: json(node), before }] }, { ...base, fetchPage: live(block) });
      expect((await verify(json(node))).status).toBe("verified"); for (const changed of changes) expect((await verify(json(changed))).status, `${tenant}: ${JSON.stringify(changed)}`).not.toBe("verified");
      const old = changes[0]!; expect((await verify(json(old), json(old))).components[0]!.state).toBe("not_verified"); expect((await verify(`${json(node)}</script>${script(json(old))}`, json(old))).components[0]!.state).toBe("changed_differently");
    }
    const wanted = json(faq(answer)); expect([await state("schema_add", wanted, live(wanted)), await state("schema", wanted, live(wanted)), await state("schema_add", wanted, serve(PAGE.replace(/<script[\s\S]*?<\/script>/, "")))]).toEqual(["verified", "verified", "not_verified"]);
    let reads = 0; const absent = await check([{ kind: "schema", after: "Add FAQPage structured data" }], async () => { reads++; return { ok: true, html: PAGE, status: 200 }; }); expect([absent.status, absent.checks, absent.recheckAfter, reads]).toEqual(["blocked", 0, null, 0]);
    const built = await check([{ kind: "schema_add", after: wanted }, { kind: "section_add", after: "What goes on the table" }, { kind: "paragraph_correction", after: "Every item on the cloth stands for a wish" }], serve("<html><head><title>t</title></head><body><div id=app></div></body></html>")); expect([built.status, built.reason, ...built.components.map((c) => c.state)]).toEqual(["blocked", "rendered_content_gap", "unverifiable", "unverifiable", "unverifiable"]);
    for (const bad of ["{", json({ ...faq(answer), "@context": { "@vocab": "https://schema.org/" } }), json({ ...faq(answer), "@type": 9 })]) expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "schema_add", after: wanted }], live(bad))).status).toBe("partially_verified");
  });
  it("reads complete standard graphs and ID relationships, without conflating entities or certifying unsupported expansion", async () => {
    const node = { "@type": ["Article", "WebPage"], "@id": "https://own.com/nowruz#article", headline: "Table", author: { "@type": "Person", "@id": "https://own.com/#writer", name: "A Writer" } }, block = JSON.stringify({ "@context": "https://schema.org", ...node }), script = (n: unknown) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...n as object })}</script>`;
    const graph = { "@graph": [{ ...node, "@type": ["WebPage", "Article"], author: { "@id": "https://own.com/#writer" } }, node.author] }, live = (html: string) => serve(PAGE.replace(/<script[\s\S]*?<\/script>/, html));
    expect(await state("schema_add", block, live(script(graph)))).toBe("verified"); expect(await state("schema_add", block, live(script({ ...graph, "@graph": [graph["@graph"][0], { ...node.author, name: "Other" }, { "@type": "Person", name: "A Writer" }] })))).toBe("changed_differently");
    const split = [{ "@type": ["WebPage", "Article"], "@id": node["@id"], headline: "Table" }, { "@id": node["@id"], author: { "@id": node.author["@id"] } }, node.author]; expect(await state("schema_add", block, live(split.map(script).join("")))).toBe("verified"); expect(await state("schema_add", block, live([...split, { ...node.author, name: "Conflicting" }].map(script).join("")))).toBe("unverifiable");
    const list = { "@type": "ItemList", itemListElement: { "@list": ["first", "second"] } }; expect(await state("schema_add", JSON.stringify({ "@context": "https://schema.org", ...list }), live(script({ ...list, itemListElement: { "@list": ["second", "first"] } })))).toBe("changed_differently");
    const duplicated = { "@type": "FAQPage", mainEntity: [node.author, node.author] }, broad = { "@type": "FAQPage", mainEntity: [{ "@type": "Person" }, { "@type": "Person", name: "A Writer" }] }; expect([await state("schema_add", JSON.stringify({ "@context": "https://schema.org", ...duplicated }), live(script({ ...duplicated, mainEntity: [node.author] }))), await state("schema_add", JSON.stringify({ "@context": "https://schema.org", ...broad }), live(script({ ...broad, mainEntity: [{ "@type": "Person", name: "A Writer" }, { "@type": "Person", name: "Other" }] })))]).toEqual(["changed_differently", "verified"]);
  });
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
  it("verifies the recorded new-page copy, never just an answering address or a word count", async () => {
    const copy = "The new page's complete recorded copy.", long = `<html><head><title>Haft seen</title></head><body><main><p>${"a real sentence about the haft seen table ".repeat(20)}</p></main></body></html>`, unread = vi.fn(serve(long));
    expect([await state("new_page", "", unread), unread.mock.calls.length, await state("new_page", copy, serve(long)), await state("new_page", copy, serve(`<main><p>${copy}</p></main>`)), await state("new_page", `${copy} A final paragraph is owed.`, serve(`<main><p>${copy}</p></main>`))]).toEqual(["unverifiable", 0, "not_verified", "verified", "unverifiable"]);});});
describe("what Beacon says overall, and what it refuses to say", () => {
  it("rolls the components up honestly: all of them, some of them, or none of them", async () => {
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "How to set a nowruz table" }])).status).toBe("verified");
    expect((await check([{ kind: "title", after: "How to set a nowruz table" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("partially_verified");
    expect((await check([{ kind: "title", after: "Nowruz gifts" }, { kind: "h1", after: "Nowruz gifts" }])).status).toBe("differs");});
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
    const gone = await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "http_404")); expect([robots.status, robots.components[0]!.state, robots.reason, robots.recheckAfter ?? null, robots.components[0]!.note!.includes("robots rules"), dead.status, dead.reason, gone.status, gone.recheckAfter != null, gone.reason, (await check([{ kind: "new_page", after: "Complete proposed new-page copy." }], refuse("fetch_failed", "http_404"))).status], "a standing refusal can never be read, a site that timed out can be, and neither is words nobody stored: three causes where one sentence used to print. NOT_FOUND INSIDE THE PUBLISH LAG IS THE SAME LAG (operator, 2026-08-29): marked done in the editor, published later, so read one schedules a bounded recheck instead of burying the change").toEqual(["blocked", "unverifiable", "unmeasurable", null, true, "blocked", "page_unreachable", "not_found", true, "address_mismatch", "not_found"]);
    const graded = await check([{ kind: "noindex", after: "" }]), bound = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "noindex", after: "" }], priorChecks: 2 }, { ...base, fetchPage: serve(PAGE) }); expect([graded.status, graded.checks, graded.recheckAfter, bound.recheckAfter], "R-059: a reading that could grade nothing is owed the same bounded rechecks a difference gets, and the third one stands").toEqual(["blocked", 1, "2026-08-02", null]);});
  it("verifies a page the raw fetch cannot read at all from the capture the store already holds, and never writes the shell over it", async () => {
    const shell = serve("<html><body><div id=app></div></body></html>"), body = (fetchedAt: string) => async () => new Map([["own.com/nowruz", { url: URL_, title: "How to set a nowruz table", h1: "How to set a nowruz table", metaDescription: "Set a nowruz table in seven steps.", headings: ["What goes on the table"], passages: ["Every item on the cloth stands for a wish."], openingSample: null, vocabulary: "every item on the cloth stands for a wish", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt, completeness: "complete" as const, version: "current" as const, contentHash: null }]]);
    const wrote: string[] = [], at = (d: number) => new Date(NOW + d * DAY).toISOString(), of = (readHeld: unknown, schema = false) => verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "How to set a nowruz table" }, ...(schema ? [{ kind: "schema_add", after: '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}' }] : [])], implementedAt: at(-2) }, { ...base, fetchPage: shell, writeOwnedPage: async (s2) => { wrote.push(s2.url); }, readHeld: readHeld as never });
    const rendered = await of(body(at(-1))), stale = await of(body(at(-5))), none = await of(async () => new Map()), markup = await of(body(at(-1)), true);
    expect([rendered.status, rendered.reason, stale.status, stale.reason, none.status, none.reason, wrote.length, markup.status, markup.components[1]!.state], "a fresh saved text capture proves text, never JSON-LD missing from the live shell; stale words prove neither, and no shell overwrites a capture").toEqual(["verified", null, "blocked", "stale_reading", "blocked", "rendered_content_gap", 0, "partially_verified", "unverifiable"]);
    for (const version of [undefined, "stale_known_good"] as const) {
      expect((await of(async () => new Map([...await body(at(-1))()].map(([key, b]) => [key, { ...b, version }])))).status).toBe("blocked");
    }
    for (const kind of ["section_remove", "opening_answer"]) expect(await state(kind, "Where to buy a haft seen set", shell, { readHeld: async () => new Map([...await body(at(-1))()].map(([key, b]) => [key, { ...b, completeness: "partial" }])) })).toBe("unverifiable");
    expect([stale.recheckAfter ?? null, none.recheckAfter], "and a reading taken off a capture older than the change promises no day: the same shell comes back every time, so it closes here and the page itself reopens it when a newer capture lands").toEqual([null, "2026-08-02"]);});
  it("reads a difference inside the publish grace window as not published yet: no bounded check is spent and it is read again tomorrow", async () => { const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString(); const early = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], implementedAt: at(1) }, { ...base, fetchPage: serve(PAGE) }), late = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], implementedAt: at(8) }, { ...base, fetchPage: serve(PAGE) });
    expect([early.status, early.checks, early.recheckAfter, (early.components[0]!.note ?? "").includes("published later"), late.status, late.checks, late.recheckAfter]).toEqual(["differs", 0, "2026-08-01", true, "differs", 1, "2026-08-02"]); });
  it("keeps failed cumulative reads distinct from missing history and measured zero, and never subtracts an invalid side", async () => {
    const { readWindowForPages } = await import("@/domains/measurement/proof-gsc/gsc-window"), args = { tenantId: T, pages: ["own.com/nowruz", "https://www.own.com/nowruz/", "own.com/never"], start: "2026-08-05", end: "2026-09-02", siteTotal: { key: "site", exclude: URL_ } };
    const known = await readWindowForPages(args); expect(known.status).toBe("available"); if (known.status !== "available") throw new Error(known.reason);
    expect([known.data.get(args.pages[0]!)?.impressions, known.data.get(args.pages[1]!)?.impressions, known.data.has(args.pages[2]!)]).toEqual([900, 900, false]);
    const row = { page: URL_, clicks: 30, impressions: 900, pos_weighted: 4500 };
    for (const bad of [{ data: null, error: { message: "outage" } }, { data: {}, error: null }, { data: [{ ...row, clicks: "NaN" }], error: null }, { data: [{ ...row, impressions: null }], error: null }, { data: [{ ...row, pos_weighted: -1 }], error: null }, { data: [null], error: null }]) {
      for (const failedDay of [args.start, args.end]) { search.rpc.mockImplementation(async (_fn: string, a: { p_since: string }) => a.p_since === failedDay ? bad : { data: [row], error: null }); expect((await readWindowForPages(args)).status).toBe("unavailable"); }
    }
    search.rpc.mockRejectedValue(new Error("network")); expect((await readWindowForPages(args)).status).toBe("unavailable");
    search.rpc.mockImplementation(async (_fn: string, a: { p_since: string }) => ({ data: [{ ...row, clicks: a.p_since === args.end ? 31 : 30 }], error: null })); expect((await readWindowForPages(args)).status).toBe("unavailable");
    search.rpc.mockResolvedValue({ data: [row], error: null }); const zero = await readWindowForPages(args); expect(zero.status === "available" && zero.data.get(args.pages[0]!)?.clicks).toBe(0);
    search.rpc.mockResolvedValue({ data: [], error: null }); const absent = await readWindowForPages(args); expect(absent.status === "available" && absent.data.has(args.pages[0]!)).toBe(false);
  });
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
    expect(blanked, "keys blanked: page evidence is still read; without an implementation stamp it is not learning permission").toEqual({ checkerContract: 1, proof: null, status: "verified", checkedAt: new Date(NOW).toISOString(), checks: 1, reason: null, recheckAfter: null, components: [{ kind: "title", state: "verified", note: "Your page title matches the prepared wording exactly." }] }); vi.unstubAllEnvs();});
  it("goes and reads the page whatever the operator claimed, and cannot land verified without page evidence", async () => { let fetched = 0; const claimed = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }] }, { ...base, fetchPage: async () => { fetched += 1; return { ok: true as const, html: PAGE, status: 200 }; } });
    expect([claimed.status, fetched, claimed.components[0]!.state]).toEqual(["differs", 1, "changed_differently"]);});});
describe("the pass: what is due, how much of it runs, and what it writes", () => {
  const row = (o: Record<string, unknown>) => ({
    id: "s1", page: URL_, path: "/nowruz", actionType: "title", after: "How to set a nowruz table",
    implementedAt: "2026-07-30T09:00:00Z", verification: null, componentsApplied: null, ...o });
  beforeEach(() => { ROWS.length = 0; WRITES.length = 0; passedBustedAt = undefined; });
  it("checks never-read and obsolete delivery proofs within the original read bound", async () => {
    ROWS.push(row({ id: "a" }), row({ id: "b", verification: { status: "verified", checkedAt: "x", components: [] } }), row({ id: "c", implementedAt: null }));
    expect((await shipmentsAwaitingVerification(T, 3)).map((s) => s.id)).toEqual(["a", "b"]); expect(await shipmentsAwaitingVerification("", 3)).toEqual([]); ROWS.length = 0; // and then reads every due live page in one bounded pass, writing each answer exactly once
    for (const id of ["a", "b", "c", "d", "e"]) ROWS.push(row({ id, implementedAt: `2026-07-3${id === "a" ? 0 : 1}T09:00:00Z` }));
    const read: string[] = []; const written = await verifyDueShipments(T, { ...base, fetchPage: (async (u: string) => { read.push(u); return { ok: true as const, html: PAGE, status: 200 }; }) });
    expect([written, read.length, WRITES.length], "five shipments at ONE address are five answers off ONE read of that page: four shipments sitting on iranopedia.com/iran-animals fetched it four times and stored four captures of it inside five seconds, and 79 of that account's 1,086 stored page versions are that one address").toEqual([5, 1, 5]); expect(WRITES.map((w) => w[2].status)).toEqual(["verified", "verified", "verified", "verified", "verified"]);});
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
  it("stops the recheck at its bound, at the door that reopens one as well as inside the reading, and stamps a reading when it answers", async () => { // MEASURED ON THE LIVE LEDGER (2026-09-05): one shipment stood at 28 live reads against a bound of 3, because the reading stamped itself BEFORE writing the capture it had just read (07:32:52.706Z against a capture at 07:32:53.665Z), the closed-row door read that capture as the page having moved since, and the bound was written into the reading and never into that door
    for (const acct of ["acct-one", "acct-two"]) {
      ROWS.length = 0; const shut = (checks: number) => ({ status: "differs", checkedAt: "2026-08-15T00:00:00Z", components: [], recheckAfter: null, checks }), newer = async () => new Map([["own.com/nowruz", { fetchedAt: "2026-09-01T00:00:00Z" } as never]]);
      ROWS.push(row({ id: `${acct}-spent`, tenant: acct, verification: shut(3) }), row({ id: `${acct}-left`, tenant: acct, verification: shut(2) }));
      expect((await shipmentsAwaitingVerification(acct, 3, { now: () => NOW, readHeld: newer })).map((s2) => s2.id), "a reading closed on its last check is the last one there is, whatever the page does next").toEqual([`${acct}-left`]);
      let clock = NOW, wroteAt = 0; const answer = await verifyShipment(acct, { id: `${acct}-s`, url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], priorChecks: 2 }, { ...base, now: () => (clock += 1000), fetchPage: serve(PAGE), writeOwnedPage: async () => { wroteAt = clock; } });
      expect([Date.parse(answer.checkedAt) > wroteAt, answer.checks, answer.recheckAfter, (answer.components[0]!.note ?? "").includes("which is the limit, so this one stands and nothing more is read for it")], "the reading is stamped when it answers, so the capture it writes on the way through can never be newer than it and reopen it, and the reading that spends the last check says on the record that it is the last one with what to do instead").toEqual([true, 3, null, true]); } });
  it("promises and owes retries on the same operator-local day, never the preceding UTC evening", async () => {
    ROWS.push(row({ id: "waiting", verification: { status: "blocked", checkedAt: "2026-08-01T09:00:00Z", components: [], recheckAfter: "2026-08-05" } }));
    const dueAt = async (iso: string) => (await shipmentsAwaitingVerification(T, 3, { now: () => Date.parse(iso) })).map((s) => s.id);
    expect([await dueAt("2026-08-05T02:00:00Z"), await dueAt("2026-08-05T08:01:00Z"), (await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"), { now: () => Date.parse("2026-08-05T02:00:00Z") })).recheckAfter]).toEqual([[], ["waiting"], "2026-08-05"]);});});
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
    expect([by.blank!.components[0]!.note.includes("never recorded"), by.template!.components[0]!.note.includes("never filled in"), by.blank!.components[0]!.note.includes("Record the words")]).toEqual([true, true, true]);
    reads = 0; WRITES.length = 0;
    expect([await verifyDueShipments("acct-two", { ...base, fetchPage }), reads], "the second account behaves identically: two answers, and the website is never touched").toEqual([2, 0]);
    for (const r of ROWS) r.verification = WRITES.concat([]).find((w) => w[1] === r.id)?.[2] ?? r.verification;
    const newer = async () => new Map([["own.com/nowruz", { fetchedAt: "2026-09-01T00:00:00Z" } as never]]);
    expect((await shipmentsAwaitingVerification("acct-two", 15, { ...base, readHeld: newer })).map((r) => r.id), "and a newer capture of the page does not reopen them either: a fresh read cannot answer a record that names nothing to look for").toEqual([]);});
  it("re-derives a record it wrote off once the rule that closed it stops holding, takes ONE more read for it and never a third, and leaves a record that still names nothing closed, on two accounts", async () => {
    const link = (id: string, tenant: string, after: string, checks: number) => ({ id, tenant, page: URL_, path: "/nowruz", actionType: "anchor_text", after, implementedAt: "2026-07-30T09:00:00Z",
      verification: { status: "blocked", checkedAt: "2026-08-15T00:00:00Z", reason: "applied_wording_missing", recheckAfter: null, checks, components: [{ kind: "anchor_text", state: "unverifiable", note: "n" }] },
      componentsApplied: [{ kind: "anchor_text", label: "link label", after }] });
    for (const acct of ["acct-one", "acct-two"]) {
      ROWS.length = 0; WRITES.length = 0;
      ROWS.push(link(`${acct}-reads-now`, acct, "the haft seen explained", 3), link(`${acct}-still-a-note`, acct, "Rename this link so it says what the other page is about, in the reader's own words", 3), link(`${acct}-past-one-more`, acct, "the haft seen explained", 4));
      expect((await shipmentsAwaitingVerification(acct, 15, base)).map((r) => r.id), "the record whose wording the reader can read today comes back; the one that still holds a note about the change rather than the words that were applied does not; and neither does the one that has already had its one more read").toEqual([`${acct}-reads-now`]);
      expect([await verifyDueShipments(acct, { ...base, fetchPage: serve(PAGE) }), (WRITES[0]![2] as { checks?: number }).checks, (WRITES[0]![2] as { reason?: string }).reason, WRITES[0]![2].status, (WRITES[0]![2] as { recheckAfter?: string | null }).recheckAfter ?? null], "the re-derivation reads the page once, grades the wording it can now read, and closes on that read with no day promised").toEqual([1, 4, null, "verified", null]);
      for (const r of ROWS) r.verification = WRITES.concat([]).find((w) => w[1] === r.id)?.[2] ?? r.verification;
      expect((await shipmentsAwaitingVerification(acct, 15, base)).map((r) => r.id), "and it is over: the answer carries a different reason and the count is past the bound, so nothing reopens it again").toEqual([]); } });});
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
