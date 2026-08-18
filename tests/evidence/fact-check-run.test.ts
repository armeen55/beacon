import { describe, expect, it, vi, beforeEach } from "vitest";

/** THE STORE IS THE CURSOR, so these tests stand it up rather than pretending it away: the inventory written
 *  by one call is what the next call resumes from, exactly as a second lease would read it back. */
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], owed: [] as Record<string, unknown>[],
  superseded: [] as string[], writeFails: false }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real,
    recordFactChecks: async (_t: string, _p: string, checks: Record<string, unknown>[]) =>
      db.writeFails ? 0 : (db.rows.push(...checks), checks.length),
    recordOwedClaims: async (_t: string, _p: string, claims: Record<string, unknown>[]) => (db.owed.push(...claims), claims.length),
    supersedeStaleFacts: async (_t: string, _p: string, _h: string, present: (c: string) => boolean) => {
      const gone = db.rows.filter((r) => !present(String(r.current)));
      db.superseded.push(...gone.map((g) => String(g.subject))); return gone.length; },
  };
});

import { runFactCheckUnit, pageHashOf, claimTypeOf, sourceQueryFor, claimIdentity } from "@/domains/evidence/pages/fact-check-run";
import type { FactCheck } from "@/domains/evidence/pages/fact-checks";

const NOW = new Date("2026-08-18T00:00:00.000Z");
const PAGE = { url: "https://x.example/names", path: "/names", body: "Afsaneh means Goddess. Darya means Beauty." };
const reader = (byStage: { claims?: unknown; judge?: unknown }) => async (input: { system: string }) =>
  (input.system.startsWith("You read one web page") ? byStage.claims : byStage.judge) as Record<string, unknown> | null;
const CLAIMS = { statements: [{ subject: "Afsaneh", current: "Goddess", locator: "Afsaneh" }] };
const CONFIRMS = { verdict: "page_wrong", proposed: "Legend, myth, fable", confidence: "confirmed",
  supportingQuote: "tale, story, fable", agreement: "multiple_agree", note: "" };
const SOURCE = { organic: [{ domain: "en.wiktionary.org", url: "https://en.wiktionary.org/x", title: "Afsaneh" }] };
const PASSAGE = "Persian افسانه: tale, story, fable, legend.";
const unit = (over: Record<string, unknown>) => runFactCheckUnit({ tenantId: "t", now: NOW, basis: "b1",
  deadlineAt: Date.now() + 600_000, page: PAGE, read: reader({ claims: CLAIMS, judge: CONFIRMS }),
  searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }), ...over } as never);
/** An inventory row as the store hands it back on a later lease. */
const row = (over: Partial<FactCheck>): FactCheck => ({ page: "/names", statementKey: "k", subject: "Afsaneh",
  current: "Goddess", proposed: null, literal: null, usage: null, sources: [], agreement: "none_found",
  confidence: "unsupported", verdict: "undecidable", alsoAt: [], note: "", pageContentHash: pageHashOf(PAGE.body),
  pageLocator: null, sourceReadAt: null, state: "owed", evidenceBasis: "b1", checkedAt: NOW.toISOString(), ...over });

describe("one claim, researched properly, per unit", () => {
  beforeEach(() => { db.rows = []; db.owed = []; db.superseded = []; db.writeFails = false; });

  it("asks a question shaped by the claim, never etymology for a date or a figure", () => {
    expect(claimTypeOf("Afsaneh", "means Goddess")).toBe("word_meaning");
    expect(claimTypeOf("Tehran", "was founded in 1796")).toBe("date_or_event");
    expect(sourceQueryFor("quantity", "Iran population")).not.toContain("etymology");
    expect(sourceQueryFor("word_meaning", "Afsaneh")).toContain("etymology");
    expect(claimIdentity("Cyrus", "founded it", "History")).not.toBe(claimIdentity("Cyrus", "died 530 BCE", "Death"));
  });

  it("a source found but never read cannot produce a verdict or a replacement", async () => {
    expect((await unit({ fetchSource: async () => null })).status).toBe("advanced");
    const r = db.rows[0] as FactCheck;
    expect([r.confidence, r.proposed, r.sourceReadAt]).toEqual(["unsupported", null, null]);
    expect(r.note).toContain("none could be read");
  });

  it("will not confirm on a quote it cannot point at in a fetched passage", async () => {
    await unit({ read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, supportingQuote: "nowhere in the passage" } }) });
    expect((db.rows[0] as FactCheck).confidence).toBe("likely"); // downgraded, never confirmed
  });

  it("confirms only with a real quote from a fetched authority", async () => {
    await unit({});
    const r = db.rows[0] as FactCheck;
    expect([r.confidence, r.state]).toEqual(["confirmed", "checked"]);
    expect(r.sourceReadAt).not.toBeNull();
    expect(r.sources[0]!.says).toContain("fable");
  });

  it("stops before a call it cannot finish, and banks nothing rather than half a result", async () => {
    const out = await unit({ deadlineAt: Date.now() + 1_000 });
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("lease");
    expect(db.rows).toHaveLength(0);
  });
});

describe("the production seams, not the fakes", () => {
  beforeEach(() => { db.rows = []; db.owed = []; db.superseded = []; db.writeFails = false; });

  it("the real schema registry can express a claim list and a claim judgement", async () => {
    const { SCHEMA_BY_KIND } = await import("@/domains/decision/llm/schemas");
    expect(SCHEMA_BY_KIND.fact_claim_extraction.safeParse({ statements: [{ subject: "A", current: "means B", locator: "A" }] }).success).toBe(true);
    expect(SCHEMA_BY_KIND.fact_claim_judgement.safeParse({ verdict: "page_wrong", confidence: "confirmed",
      proposed: "Legend", literal: "legend", usage: "", supportingQuote: "tale, story, fable",
      quotedFrom: "https://en.wiktionary.org/x", note: "" }).success).toBe(true);
    // The editor judge cannot express either shape, which is why asking it for one read nothing forever.
    expect(SCHEMA_BY_KIND.editor_judgement.safeParse({ statements: [] }).success).toBe(false);
  });

  it("reads a source through the REAL provider parser, not a shape invented to match", async () => {
    const { parseCapability } = await import("@/domains/evidence/dataforseo/capabilities");
    const envelope = { tasks: [{ result: [{ items: [{ page_content: { main_topic: [{ main_title: "Afsaneh",
      h_title: "Etymology", primary_content: [{ text: PASSAGE }] }] } }] }] }] };
    const p = parseCapability("onpage_content_parsing", envelope as never) as { bodyText: string | null; openingSample: string | null; headings: string[] };
    // THE ADAPTER THE RUNTIME USES, copied from research-steps: bodyText + openingSample + headings.
    const text = [p.bodyText, p.openingSample, ...p.headings].filter(Boolean).join("\n");
    expect(text).toContain("fable"); // the read that came back empty for ever because it looked for `text`
    await unit({ fetchSource: async () => ({ text }) });
    expect((db.rows[0] as FactCheck).confidence).toBe("confirmed");
  });

  it("stores the page's whole claim inventory BEFORE researching one of them, and resumes from it", async () => {
    let extractions = 0;
    const read = async (i: { kind: string }) => {
      if (i.kind === "fact_claim_extraction") { extractions += 1; return CLAIMS as unknown as Record<string, unknown>; }
      return CONFIRMS as unknown as Record<string, unknown>; };
    expect((await unit({ read })).status).toBe("advanced");
    expect(db.owed).toHaveLength(1); // the whole inventory landed BEFORE any claim was researched
    expect(db.owed[0]!.subject).toBe("Afsaneh");
    // A SECOND LEASE, holding only what the store gives it back: no page re-read is bought.
    const second = await unit({ read, fetchSource: async () => null,
      held: [row({ statementKey: claimIdentity("Afsaneh", "Goddess", "Afsaneh"), state: "checked" })] });
    expect(extractions).toBe(1); // NOT re-extracted: the inventory is the cursor
    expect(second.status).toBe("done");
    expect(second.cursor?.pageComplete).toBe(true);
  });

  it("takes the next owed claim on the same page, so a second statement actually lands", async () => {
    const out = await unit({ held: [row({ statementKey: "one", state: "checked" }),
      row({ statementKey: "two", subject: "Darya", current: "Beauty" })] });
    expect(out.status).toBe("advanced");
    expect((db.rows[0] as FactCheck).subject).toBe("Darya"); // the OWED one, not the researched one again
    expect([out.cursor?.checked, out.cursor?.pageComplete]).toEqual([2, true]);
  });

  it("retires what an older page version claimed instead of leaving it live beside its replacement", async () => {
    db.rows.push({ subject: "Afsaneh", current: "a wording this page no longer carries" });
    await unit({});
    expect(db.superseded).toContain("Afsaneh"); // history kept, authority withdrawn
  });

  it("a write that did not land leaves the claim owed and advances nothing", async () => {
    db.writeFails = true;
    const out = await unit({});
    expect(out.status).toBe("failed");
    expect([out.cursor?.checked, out.cursor?.pageComplete]).toEqual([0, false]);
    expect(out.reason).toContain("still owed");
  });

  it("a quote cannot borrow a stronger source's authority", async () => {
    const weak = "Afsaneh is a lovely name for a girl.";
    await unit({ read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, supportingQuote: weak } }),
      searchSources: async () => ({ organic: [...SOURCE.organic,
        { domain: "behindthename.com", url: "https://behindthename.com/x", title: "Afsaneh" }] }),
      // The AUTHORITY does not carry the quote; a weaker reference source does.
      fetchSource: async (url: string) => ({ text: url.includes("wiktionary") ? PASSAGE : weak }) });
    const r = db.rows[0] as FactCheck;
    expect(r.confidence).not.toBe("confirmed"); // the weak page cannot confirm through the strong one's name
    expect(r.sources.find((s) => s.url.includes("wiktionary"))!.says).toBe(""); // and is not credited with it
    expect(r.agreement).toBe("single_source"); // counted, not taken from the model's label
  });

  it("a provider that did not answer leaves the claim owed instead of banking none_found", async () => {
    // Capped, waiting or failed is not a world without sources.
    const out = await unit({ searchSources: async () => null, fetchSource: async () => null });
    expect(db.rows).toHaveLength(0);
    expect(out.status).toBe("failed");
    expect(out.reason).toContain("still owed");
  });

  it("a source nobody read may never authorize replacing published words", async () => {
    const { authorizedCorrections } = await import("@/domains/evidence/pages/fact-checks");
    const c = row({ proposed: "new", verdict: "page_wrong", confidence: "confirmed", state: "checked",
      pageContentHash: "h1", sources: [{ url: "https://en.wiktionary.org/x", kind: "dictionary", says: "new" }] });
    expect(authorizedCorrections([{ ...c, sourceReadAt: null }])).toHaveLength(0);
    const read = { ...c, sourceReadAt: NOW.toISOString() };
    expect(authorizedCorrections([read])).toHaveLength(1);
    // A claim the page version moved past, or one still owed, is history and never a live instruction.
    expect(authorizedCorrections([read], { pageContentHash: "h2" })).toHaveLength(0);
    expect(authorizedCorrections([{ ...read, state: "superseded" }])).toHaveLength(0);
    expect(authorizedCorrections([{ ...read, state: "owed" }])).toHaveLength(0);
    expect(authorizedCorrections([read], { pageContentHash: "h1", evidenceBasis: "b1" })).toHaveLength(1);
  });
});
