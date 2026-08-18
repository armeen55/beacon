import { describe, expect, it, vi, beforeEach } from "vitest";

/** THE STORE IS THE CURSOR, so these tests stand it up rather than pretending it away: the inventory and
 *  coverage written by one call are what the next call resumes from, exactly as a second lease would. */
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], owed: [] as Record<string, unknown>[], superseded: [] as string[],
  reopened: [] as string[], cov: null as Record<string, unknown> | null, writeFails: false }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real,
    recordFactChecks: async (_t: string, _p: string, checks: Record<string, unknown>[]) => {
      if (db.writeFails) return 0;
      for (const c of checks) if (c.state === "superseded") db.superseded.push(String(c.subject));
      db.rows.push(...checks); return checks.length; },
    recordOwedClaims: async (_t: string, _p: string, claims: Record<string, unknown>[]) => (db.owed.push(...claims), claims.length),
    reopenObsoleteChecks: async (_t: string, _p: string, stale: { statementKey: string }[]) => (db.reopened.push(...stale.map((x) => x.statementKey)), stale.length),
    supersedeStaleFacts: async (_t: string, _p: string, _h: string, present: (c: string) => boolean) => {
      const gone = db.rows.filter((r) => !present(String(r.current)));
      db.superseded.push(...gone.map((g) => String(g.subject))); return gone.length; },
  };
});

import { runFactCheckUnit, runFactCheckPass, pageHashOf, claimTypeOf, sourceQueryFor, claimIdentity, tokenFingerprintOf, ATTEMPTS_PER_PASS, EXTRACT_CHUNK } from "@/domains/evidence/pages/fact-check-run";
import { VERIFICATION_RULES_VERSION, type FactCheck, type InventoryCoverage } from "@/domains/evidence/pages/fact-checks";

const NOW = new Date("2026-08-18T00:00:00.000Z");
const PAGE = { url: "https://x.example/names", path: "/names", body: "Afsaneh means Goddess. Darya means Beauty." };
const reader = (byStage: { claims?: unknown; judge?: unknown }) => async (input: { system: string }) => {
  const a = input.system.startsWith("You read one web page") ? byStage.claims : byStage.judge;
  return (a == null ? { hold: "unavailable" } : { value: a }) as { value: Record<string, unknown> } | { hold: "unavailable" }; };
const CLAIMS = { statements: [{ subject: "Afsaneh", current: "Goddess", locator: "Afsaneh" }] };
const CONFIRMS = { verdict: "page_wrong", proposed: "Legend, myth, fable", confidence: "confirmed", supportingQuote: "tale, story, fable", agreement: "multiple_agree", note: "" };
const SOURCE = { organic: [{ domain: "en.wiktionary.org", url: "https://en.wiktionary.org/x", title: "Afsaneh" }] };
const PASSAGE = "Persian افسانه: tale, story, fable, legend.";
const coverage = () => ({ readCoverage: async () => db.cov as InventoryCoverage | null,
  writeCoverage: async (c: InventoryCoverage) => { db.cov = c as unknown as Record<string, unknown>; return true; } });
const unit = (over: Record<string, unknown>) => runFactCheckUnit({ tenantId: "t", now: NOW, basis: "b1", deadlineAt: Date.now() + 600_000,
  page: PAGE, read: reader({ claims: CLAIMS, judge: CONFIRMS }), searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }), ...coverage(), ...over } as never);
/** An inventory row as the store hands it back on a later lease. */
const row = (over: Partial<FactCheck>): FactCheck => ({ page: "/names", statementKey: "k", subject: "Afsaneh",
  current: "Goddess", proposed: null, literal: null, usage: null, sources: [], agreement: "none_found",
  confidence: "unsupported", verdict: "undecidable", alsoAt: [], note: "", pageContentHash: pageHashOf(PAGE.body),
  pageLocator: null, sourceReadAt: null, state: "owed", rulesVersion: VERIFICATION_RULES_VERSION, evidenceBasis: "b1", checkedAt: NOW.toISOString(), ...over });
const reset = () => { db.rows = []; db.owed = []; db.superseded = []; db.reopened = []; db.cov = null; db.writeFails = false; };

describe("the search is the proposition", () => {
  it("the real Ahvaz claim searches the claim, and the type shapes but never erases the assertion", () => {
    const subject = "Ahvaz, Iran", current = "Ahvaz, Iran holds the record for hottest day ever in Asia at 54 °C (129 °F)";
    expect(claimTypeOf(subject, current)).toBe("quantity"); // a record temperature is not a definition
    const q = sourceQueryFor(claimTypeOf(subject, current), subject, current);
    for (const must of ["Ahvaz", "54", "°C", "Asia", "hottest", "record"]) expect(q).toContain(must);
    expect(q).not.toContain("definition reference"); // the query the live run actually sent
    expect(claimTypeOf("Tehran", "was founded in 1796")).toBe("date_or_event");
    const meaning = sourceQueryFor("word_meaning", "Afsaneh", "means Goddess");
    expect([meaning.includes("etymology"), meaning.includes("Goddess")]).toEqual([true, true]); // the proposition survives the hint
    expect(sourceQueryFor("quantity", "Iran", "has a population of 89 million")).toContain("89");
    expect(claimIdentity("Cyrus", "founded it", "History")).not.toBe(claimIdentity("Cyrus", "died 530 BCE", "Death"));
  });
});

describe("every failure is typed and leaves the claim owed", () => {
  beforeEach(reset);
  it("a failed source read leaves the row OWED, never checked", async () => {
    const out = await unit({ held: [row({ statementKey: "k1" })], fetchSource: async () => ({ hold: "capped" }) }); // sources found, reading them refused
    expect([out.status, out.failure, out.cursor?.checked]).toEqual(["failed", "fetch_capped", 0]); // the fetch keeps ITS own hold
    expect(db.rows).toHaveLength(0); // NOTHING banked: unread evidence never clears the claim
  });
  it("every provider hold keeps its own name, against the stage that took it", async () => {
    const held = [row({ statementKey: "k1" })];
    for (const hold of ["capped", "waiting", "unavailable"] as const)
      expect((await unit({ held, searchSources: async () => ({ hold }) })).failure).toBe(`search_${hold}`);
    expect((await unit({ held, read: reader({ claims: CLAIMS, judge: null }) })).failure).toBe("judge_unavailable");
    expect((await unit({ held, read: async () => ({ hold: "refused" as const }) })).failure).toBe("judge_refused"); // refused is not unavailable
    expect((await unit({ read: async () => ({ hold: "capped" as const }) })).failure).toBe("extraction_capped"); // nothing inventoried yet
    expect(db.rows).toHaveLength(0); // none of them banked anything
  });
  it("a readable search with zero qualifying sources settles the claim, and a lost write does not", async () => {
    const out = await unit({ held: [row({ statementKey: "k1" })],
      searchSources: async () => ({ organic: [{ domain: "babynames.example", url: "https://babynames.example/x", title: "x" }] }) });
    expect(out.status).toBe("advanced"); // a readable, empty world IS an answer
    const r = db.rows[0] as FactCheck;
    expect([r.confidence, r.agreement, r.proposed]).toEqual(["unsupported", "none_found", null]);
    db.writeFails = true;
    expect((await unit({ held: [row({ statementKey: "k1" })] })).failure).toBe("store_write_failed");
  });
});

describe("coverage, duplicates and diversity", () => { beforeEach(reset);
  it("a page longer than one section is NOT complete after its first chunk", async () => {
    const long = { url: "https://x.example/long", path: "/long", body: "A fact. ".repeat(2 + EXTRACT_CHUNK / 8) };
    const first = await unit({ page: long, read: reader({ claims: CLAIMS, judge: CONFIRMS }) });
    // coverage persisted BEFORE any claim research, and one section is never the whole page
    expect([(db.cov as { coveredChars: number }).coveredChars, first.cursor?.pageComplete]).toEqual([EXTRACT_CHUNK, false]);
    // Even with its extracted claim checked, the page stays incomplete until the whole body was inventoried.
    const held = [row({ page: "/long", statementKey: claimIdentity("Afsaneh", "Goddess", "Afsaneh"),
      pageContentHash: pageHashOf(long.body), state: "checked" })];
    const second = await unit({ page: long, held, read: reader({ claims: { statements: [] }, judge: CONFIRMS }) });
    // Completion arrives only once the LAST section has been inventoried too, and coverage says so durably.
    expect((db.cov as { coveredChars: number }).coveredChars).toBe(long.body.length);
    expect(second.status).toBe("done");
  });
  it("one proposition reworded with the same content words is not acquired twice", async () => {
    const heat = tokenFingerprintOf("Ahvaz", "holds the record for hottest day at 54 °C");
    expect(tokenFingerprintOf("Ahvaz", "The hottest day record, 54 °C, is held by Ahvaz")).toBe(heat);
    // NOT semantic, and the name says so: different content words are a different claim, researched on its own.
    expect(tokenFingerprintOf("Ahvaz", "reached 54 °C in 2017")).not.toBe(heat);
    // A duplicate of an already-checked proposition is superseded for free, never researched again.
    db.cov = { pageContentHash: pageHashOf(PAGE.body), coveredChars: PAGE.body.length, totalChars: PAGE.body.length };
    let searches = 0;
    const held = [
      row({ statementKey: "a", subject: "Ahvaz", current: "hottest day record 54 °C", state: "checked" }),
      row({ statementKey: "b", subject: "Ahvaz", current: "The hottest day record, 54 °C, is held by Ahvaz", state: "owed" })];
    const out = await unit({ held, searchSources: async () => { searches += 1; return SOURCE; } });
    expect(searches).toBe(0); // no paid call for the reformulation
    expect(db.superseded).toContain("Ahvaz");
    expect(out.status).toBe("done");
  });
  it("agreement means independent publishers, so the second fetch prefers a different source class", async () => {
    const fetched: string[] = [];
    await unit({ held: [row({ statementKey: "k1" })],
      searchSources: async () => ({ organic: [
        { domain: "en.wikipedia.org", url: "https://en.wikipedia.org/a", title: "A" },
        { domain: "www.britannica.com", url: "https://britannica.com/a", title: "A" },
        { domain: "behindthename.com", url: "https://behindthename.com/a", title: "A" }] }),
      fetchSource: async (url: string) => { fetched.push(url); return { text: PASSAGE }; } });
    // not the second encyclopedia that merely ranked next
    expect([fetched.length, fetched[0]!.includes("wikipedia"), fetched[1]!.includes("behindthename")]).toEqual([2, true, true]);
  });
});

describe("one pass, one global claim allowance", () => {
  beforeEach(reset);
  it("three eligible pages cannot exceed the global attempt allowance", async () => {
    let units = 0;
    const pages = ["/a", "/b", "/c"].map((p) => ({ url: `https://x.example${p}`, path: p, loadBody: async () => `${p} page body.` }));
    const out = await runFactCheckPass({
      tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, pages, held: [],
      refreshHeld: async () => null,
      readCoverage: async () => null, writeCoverage: async () => true,
      read: async (i: { kind: string }) => { if (i.kind === "fact_claim_extraction") units += 1;
        return { value: (i.kind === "fact_claim_extraction"
          ? { statements: Array.from({ length: 5 }, (_, n) => ({ subject: `S${units}${n}`, current: `claim ${units} ${n}`, locator: `L${n}` })) }
          : CONFIRMS) as Record<string, unknown> }; },
      searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }),
    });
    expect(out.attempts).toBe(ATTEMPTS_PER_PASS); // 4 TOTAL, not 4 per page
    expect(out.attempts).toBeLessThanOrEqual(4);
  });
  it("an account whose pages have no stored words owes nothing here, and never pauses a fresh account", async () => {
    const out = await runFactCheckPass({ tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, held: [],
      pages: [{ url: "https://x.example/new", path: "/new", loadBody: async () => "" }],
      refreshHeld: async () => null, readCoverage: async () => null, writeCoverage: async () => true,
      read: reader({ claims: CLAIMS, judge: CONFIRMS }), searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }) });
    expect([out.status, out.attempts, out.failure]).toEqual(["done", 0, undefined]);
  });
  it("a failed unit ends the pass with its typed identity instead of burning the allowance", async () => {
    const pages = [{ url: "https://x.example/a", path: "/a", loadBody: async () => "A body." }];
    const out = await runFactCheckPass({
      tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, pages,
      held: [row({ page: "/a", pageContentHash: pageHashOf("A body.") })],
      refreshHeld: async () => null, readCoverage: async () => null, writeCoverage: async () => true,
      read: reader({ claims: CLAIMS, judge: CONFIRMS }),
      searchSources: async () => ({ hold: "capped" }), fetchSource: async () => ({ text: PASSAGE }),
    });
    expect(out.status).toBe("failed");
    expect(out.failure).toBe("search_capped");
    expect(out.attempts).toBe(1);
  });
});

describe("what may authorize replacing published words", () => {
  beforeEach(reset);
  it("confirms only with a real quote from a fetched authority, and credits only its carrier", async () => {
    const weak = "Afsaneh is a lovely name for a girl.";
    await unit({ held: [row({ statementKey: "k1" })], read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, supportingQuote: weak } }),
      searchSources: async () => ({ organic: [...SOURCE.organic, { domain: "behindthename.com", url: "https://behindthename.com/x", title: "Afsaneh" }] }),
      fetchSource: async (url: string) => ({ text: url.includes("wiktionary") ? PASSAGE : weak }) });
    const r = db.rows[0] as FactCheck;
    expect(r.confidence).not.toBe("confirmed"); // the weak page cannot confirm through the strong one's name
    expect(r.sources.find((s) => s.url.includes("wiktionary"))!.says).toBe("");
    expect(r.agreement).toBe("single_source"); // counted, not taken from the model's label

    db.rows = [];
    await unit({ held: [row({ statementKey: "k1" })] });
    const ok = db.rows[0] as FactCheck;
    expect([ok.confidence, ok.state]).toEqual(["confirmed", "checked"]);
    expect(ok.sourceReadAt).not.toBeNull();
  });
  it("a source nobody read, a stale page version and replaced rules each authorize nothing", async () => {
    const { authorizedCorrections } = await import("@/domains/evidence/pages/fact-checks");
    const c = row({ proposed: "new", verdict: "page_wrong", confidence: "confirmed", state: "checked",
      pageContentHash: "h1", sources: [{ url: "https://en.wiktionary.org/x", kind: "dictionary", says: "new" }] });
    expect(authorizedCorrections([{ ...c, sourceReadAt: null }])).toHaveLength(0);
    const read = { ...c, sourceReadAt: NOW.toISOString() };
    expect(authorizedCorrections([read], { pageContentHash: "h2" })).toHaveLength(0); // stale page version
    expect(authorizedCorrections([{ ...read, state: "owed" }])).toHaveLength(0);
    expect(authorizedCorrections([{ ...read, rulesVersion: 1 }])).toHaveLength(0); // verdict from replaced rules
    // A valid fetched-source contradiction still reaches Decision while its page hash is current.
    expect(authorizedCorrections([read], { pageContentHash: "h1", evidenceBasis: "b1" })).toHaveLength(1);
  });
  it("the real schema registry can express a claim list and a claim judgement", async () => {
    const { SCHEMA_BY_KIND } = await import("@/domains/decision/llm/schemas");
    expect(SCHEMA_BY_KIND.fact_claim_extraction.safeParse({ statements: [{ subject: "A", current: "means B", locator: "A" }] }).success).toBe(true);
    expect(SCHEMA_BY_KIND.fact_claim_judgement.safeParse({ verdict: "page_wrong", confidence: "confirmed",
      proposed: "Legend", literal: "legend", usage: "", supportingQuote: "tale, story, fable",
      quotedFrom: "https://en.wiktionary.org/x", note: "" }).success).toBe(true);
    expect(SCHEMA_BY_KIND.editor_judgement.safeParse({ statements: [] }).success).toBe(false);
  });
  it("reads a source through the REAL provider parser, not a shape invented to match", async () => {
    const { parseCapability } = await import("@/domains/evidence/dataforseo/capabilities");
    const envelope = { tasks: [{ result: [{ items: [{ page_content: { main_topic: [{ main_title: "Afsaneh", h_title: "Etymology", primary_content: [{ text: PASSAGE }] }] } }] }] }] };
    const p = parseCapability("onpage_content_parsing", envelope as never) as { bodyText: string | null; openingSample: string | null; headings: string[] };
    const text = [p.bodyText, p.openingSample, ...p.headings].filter(Boolean).join("\n");
    expect(text).toContain("fable");
    await unit({ held: [row({ statementKey: "k1" })], fetchSource: async () => ({ text }) });
    expect((db.rows[0] as FactCheck).confidence).toBe("confirmed");
  });
});

describe("a verdict from obsolete rules is not current evidence", () => {
  beforeEach(reset);
  it("re-opens the live Ahvaz check produced under the old subject-only query, and leaves a current one settled", async () => {
    const AHVAZ = "Ahvaz, Iran holds the record for hottest day ever in Asia at 54 °C (129 °F)";
    const page = { url: "https://x.example/ahvaz", path: "/ahvaz", body: `${AHVAZ} And more.` };
    const done = { pageContentHash: pageHashOf(page.body), coveredChars: page.body.length, totalChars: page.body.length }; db.cov = done;
    // The real live row: checked/undecidable, produced by "Ahvaz, Iran definition reference" under rules 1.
    const old = row({ page: "/ahvaz", statementKey: "ahvaz, iran#fdbdbbc407", subject: "Ahvaz, Iran", current: AHVAZ,
      pageContentHash: pageHashOf(page.body), state: "checked", rulesVersion: 1, sourceReadAt: NOW.toISOString() });
    let asked = "";
    const out = await unit({ page, held: [old], searchSources: async (q: string) => { asked = q; return SOURCE; } });
    expect([db.reopened, out.status]).toEqual([["ahvaz, iran#fdbdbbc407"], "advanced"]); // archived, owed, researched
    for (const must of ["Ahvaz", "54", "°C", "Asia", "hottest"]) expect(asked).toContain(must);
    expect(asked).not.toContain("definition reference");
    expect((db.rows[0] as FactCheck).rulesVersion).toBe(VERIFICATION_RULES_VERSION);
    // A check produced under the CURRENT rules stays settled and is never re-researched.
    reset(); db.cov = done; let searches = 0;
    const settled = await unit({ page, held: [{ ...old, rulesVersion: VERIFICATION_RULES_VERSION }],
      searchSources: async () => { searches += 1; return SOURCE; } });
    expect([db.reopened, searches, settled.status]).toEqual([[], 0, "done"]);
  });
});

