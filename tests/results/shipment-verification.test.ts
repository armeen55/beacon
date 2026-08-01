import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Live implementation verification (V1 Truth Convergence Phase 6). These pin CUSTOMER TRUTH, not the
 * implementation: what Beacon says it saw on the operator's live page, and what it refuses to say. Fixtures
 * only, zero network: the polite fetch is seamed exactly the way the owned-page read seams it.
 */

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
const check = async (components: Array<{ kind: string; after: string }>, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  verifyShipment(T, { id: "s1", url: URL_, components }, { ...base, fetchPage: page, ...over });
/** What ONE component was judged to be. */
const state = async (kind: string, after: string, page: Fetcher = serve(PAGE), over: Record<string, unknown> = {}) =>
  (await check([{ kind, after }], page, over)).components[0]!.state;

describe("what Beacon can see on the live page, component by component", () => {
  it("reads the page's own fields exactly: the wording I gave, other wording, or no field at all", async () => {
    expect(await state("title", "How to set a nowruz table")).toBe("verified");
    expect(await state("title", "how to set a NOWRUZ table.")).toBe("verified"); // the same words are the same title
    expect(await state("title", "Nowruz gift ideas")).toBe("differs");
    expect(await state("meta", "Set a nowruz table in seven steps.")).toBe("verified");
    expect(await state("h1", "How to set a nowruz table")).toBe("verified");
    expect(await state("meta", "anything", serve("<html><head><title>t</title></head><body><p>x</p></body></html>"))).toBe("missing");
  });

  it("checks the opening answer against the words the page actually opens with", async () => {
    expect(await state("opening_answer", "A nowruz table is set with seven symbolic items known together as the haft seen")).toBe("verified");
    expect(await state("opening_answer", "Nowruz is celebrated on the spring equinox by millions of people every year")).toBe("differs");
    expect(await state("opening_answer", "anything at all", serve("<html><head><title>t</title></head><body></body></html>"))).toBe("unknown");
  });

  it("looks for a section by its heading, and reads a removal the other way round", async () => {
    expect(await state("section_add", "What goes on the table\nEvery item stands for a wish.")).toBe("verified");
    expect(await state("section", "Where to buy a haft seen set")).toBe("missing");
    expect(await state("section_remove", "Where to buy a haft seen set")).toBe("verified");
    expect(await state("section_remove", "What goes on the table")).toBe("differs");
  });

  it("compares an internal link as an address, and says unknown when it could not read the page's links", async () => {
    expect(await state("internal_link_add", "Link to https://own.com/haft-seen from the opening")).toBe("verified");
    expect(await state("internal_link_add", "Link to /haft-seen")).toBe("verified"); // relative and absolute are one address
    expect(await state("internal_link_add", "Link to /chaharshanbe-suri")).toBe("missing");
    expect(await state("internal_link_add", "Add a link to the guide")).toBe("unknown"); // no address named
    const noLinks = serve("<html><head><title>t</title></head><body><main><p>words enough to count as a paragraph here</p></main></body></html>");
    expect(await state("internal_link_add", "Link to /haft-seen", noLinks)).toBe("unknown");
  });

  it("reads structured data as the weak signal it is, and never as proof of absence when the page builds itself in the browser", async () => {
    expect(await state("schema", "Add FAQPage structured data")).toBe("verified");
    expect(await state("schema", "Add HowTo structured data")).toBe("unknown"); // something is there, but not what was asked for
    const bare = serve(`<html><head><title>t</title></head><body><main><p>${"a real sentence about setting the table ".repeat(10)}</p></main></body></html>`);
    expect(await state("schema", "Add FAQPage structured data", bare)).toBe("missing");
    // A page thin enough that its content may be built in the browser is never called missing.
    expect(await state("schema", "Add FAQPage structured data", serve("<html><head><title>t</title></head><body><div id=app></div></body></html>"))).toBe("unknown");
  });

  it("checks the preferred address, the forward and the search setting from what the page itself reports", async () => {
    expect(await state("canonical", "Point the canonical at https://own.com/nowruz")).toBe("verified");
    expect(await state("canonical", "Point the canonical at https://own.com/nowruz-guide")).toBe("differs");
    const noCanonical = serve("<html><head><title>t</title></head><body><main><p>a paragraph with quite enough words in it</p></main></body></html>");
    expect(await state("canonical", "Point the canonical at https://own.com/x", noCanonical)).toBe("missing");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: "https://own.com/haft-seen" }))).toBe("verified");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen", serve(PAGE, { finalUrl: URL_ }))).toBe("missing");
    expect(await state("redirect", "Forward it to https://own.com/haft-seen")).toBe("unknown"); // no final address reported
    const noindex = serve(PAGE.replace("<head>", '<head><meta name="robots" content="noindex, follow"/>'));
    expect(await state("noindex", "Take it out of search", noindex)).toBe("verified");
    expect(await state("noindex", "Take it out of search")).toBe("unknown"); // a header I cannot see could carry it
  });

  it("reads body wording off the whole page, and refuses to judge a change whose wording it does not hold", async () => {
    expect(await state("paragraph_correction", "Every item on the cloth stands for a wish")).toBe("verified");
    expect(await state("factual_correction", "Nowruz always falls on the twenty first of March")).toBe("missing");
    expect(await state("title", "")).toBe("unknown"); // no copy on file for this component, so no claim about it
  });

  it("calls a new page live only when there is a real page at the address", async () => {
    const long = `<html><head><title>Haft seen</title></head><body><main><p>${"a real sentence about the haft seen table ".repeat(20)}</p></main></body></html>`;
    expect(await state("new_page", "", serve(long))).toBe("verified");
    expect(await state("new_page", "", serve("<html><head><title>t</title></head><body><main><p>almost nothing is here yet at all</p></main></body></html>"))).toBe("differs");
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
    expect([robots.status, robots.components[0]!.state]).toEqual(["blocked", "unknown"]);
    expect(robots.components[0]!.note).toContain("robots rules");
    expect((await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "timeout"))).status).toBe("blocked");
    expect((await check([{ kind: "title", after: "x" }], refuse("fetch_failed", "http_404"))).status).toBe("not_found");
    expect((await check([{ kind: "new_page", after: "" }], refuse("fetch_failed", "http_404"))).status).toBe("not_found");
    // A page I reached but nothing on it I can check is NOT a difference and never a pass: it is a check I could not complete.
    expect((await check([{ kind: "noindex", after: "" }])).status).toBe("blocked");
  });

  it("never calls a change verified because the operator clicked: operator_confirmed is the override and nothing else", async () => {
    let fetched = 0;
    const confirmed = await verifyShipment(T, { id: "s1", url: URL_, components: [{ kind: "title", after: "Nowruz gifts" }], operatorConfirmed: true },
      { ...base, fetchPage: (async () => { fetched += 1; return { ok: true as const, html: PAGE, status: 200 }; }) });
    expect([confirmed.status, fetched, confirmed.components[0]!.state]).toEqual(["operator_confirmed", 0, "unknown"]);
    // The same shipment WITHOUT the override is checked, and the page disagrees.
    expect((await check([{ kind: "title", after: "Nowruz gifts" }])).status).toBe("differs");
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
