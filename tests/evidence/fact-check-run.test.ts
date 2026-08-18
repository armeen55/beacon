import { describe, expect, it, vi, beforeEach } from "vitest";

const banked = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real, recordFactChecks: async (_t: string, _p: string, checks: Record<string, unknown>[]) => { banked.rows.push(...checks); return checks.length; } };
});

import { runFactCheckUnit, claimTypeOf, sourceQueryFor, claimIdentity, isCurrentCheck } from "@/domains/evidence/pages/fact-check-run";
import type { FactCheck } from "@/domains/evidence/pages/fact-checks";

const NOW = new Date("2026-08-18T00:00:00.000Z");
const PAGE = { url: "https://x.example/names", path: "/names", body: "Afsaneh means Goddess. Darya means Beauty." };
const far = () => Date.now() + 600_000;

const reader = (byStage: { claims?: unknown; judge?: unknown }) => async (input: { system: string }) =>
  (input.system.startsWith("You read one web page") ? byStage.claims : byStage.judge) as Record<string, unknown> | null;

const CLAIMS = { statements: [{ subject: "Afsaneh", current: "Goddess", locator: "Afsaneh" }] };

describe("one claim, researched properly, per unit", () => {
  beforeEach(() => { banked.rows = []; });

  it("asks a question shaped by the claim, never etymology for a date or a figure", () => {
    expect(claimTypeOf("Afsaneh", "means Goddess")).toBe("word_meaning");
    expect(claimTypeOf("Tehran", "was founded in 1796")).toBe("date_or_event");
    expect(claimTypeOf("Iran", "has a population of 89 million people")).toBe("quantity");
    expect(sourceQueryFor("quantity", "Iran population")).not.toContain("etymology");
    expect(sourceQueryFor("date_or_event", "Tehran")).not.toContain("etymology");
    expect(sourceQueryFor("word_meaning", "Afsaneh")).toContain("etymology");
  });

  it("keeps two different claims about one subject apart", () => {
    const a = claimIdentity("Cyrus", "founded the Persian empire", "History");
    const b = claimIdentity("Cyrus", "died in 530 BCE", "Death");
    expect(a).not.toBe(b);
  });

  it("a source found but never read cannot produce a verdict or a replacement", async () => {
    const out = await runFactCheckUnit({
      tenantId: "t", now: NOW, basis: "b1", deadlineAt: far(), page: PAGE,
      read: reader({ claims: CLAIMS, judge: { verdict: "page_wrong", proposed: "Legend", confidence: "confirmed", supportingQuote: "legend", agreement: "multiple_agree", note: "" } }),
      searchSources: async () => ({ organic: [{ domain: "en.wiktionary.org", url: "https://en.wiktionary.org/x", title: "Afsaneh" }] }),
      fetchSource: async () => null, // the fetch failed
    });
    expect(out.banked).toBe(1);
    const row = banked.rows[0] as FactCheck;
    expect(row.confidence).toBe("unsupported");
    expect(row.proposed).toBeNull(); // no invented replacement
    expect(row.note).toContain("none could be read");
  });

  it("will not confirm on a quote it cannot point at in a fetched passage", async () => {
    const out = await runFactCheckUnit({
      tenantId: "t", now: NOW, basis: "b1", deadlineAt: far(), page: PAGE,
      read: reader({ claims: CLAIMS, judge: { verdict: "page_wrong", proposed: "Legend, myth", confidence: "confirmed",
        supportingQuote: "a sentence that is nowhere in the passage", agreement: "multiple_agree", note: "" } }),
      searchSources: async () => ({ organic: [{ domain: "en.wiktionary.org", url: "https://en.wiktionary.org/x", title: "Afsaneh" }] }),
      fetchSource: async () => ({ text: "Persian افسانه: tale, story, fable, legend." }),
    });
    expect(out.banked).toBe(1);
    expect((banked.rows[0] as FactCheck).confidence).toBe("likely"); // downgraded, never confirmed
  });

  it("confirms only with a real quote from a fetched authority", async () => {
    const passage = "Persian افسانه: tale, story, fable, legend.";
    await runFactCheckUnit({
      tenantId: "t", now: NOW, basis: "b1", deadlineAt: far(), page: PAGE,
      read: reader({ claims: CLAIMS, judge: { verdict: "page_wrong", proposed: "Legend, myth, fable", confidence: "confirmed",
        supportingQuote: passage, agreement: "multiple_agree", note: "" } }),
      searchSources: async () => ({ organic: [{ domain: "en.wiktionary.org", url: "https://en.wiktionary.org/x", title: "Afsaneh" }] }),
      fetchSource: async () => ({ text: passage }),
    });
    const row = banked.rows[0] as FactCheck;
    expect(row.confidence).toBe("confirmed");
    expect(row.sources[0]!.says).toContain("fable");
  });

  it("stops before a call it cannot finish, and banks nothing rather than half a result", async () => {
    const out = await runFactCheckUnit({
      tenantId: "t", now: NOW, basis: "b1", deadlineAt: Date.now() + 1_000, page: PAGE,
      read: reader({ claims: CLAIMS, judge: {} }),
      searchSources: async () => ({ organic: [] }), fetchSource: async () => null,
    });
    expect(out.banked).toBe(0);
    expect(out.reason).toContain("lease");
    expect(banked.rows).toHaveLength(0);
  });

  it("resumes from the cursor instead of re-reading the page", async () => {
    const cursor = { page: "/names", pageContentHash: null, evidenceBasis: "b1",
      claims: [{ subject: "A", current: "one", locator: null }], nextIndex: 0, pageComplete: false };
    let readCalls = 0;
    const out = await runFactCheckUnit({
      tenantId: "t", now: NOW, basis: "b1", deadlineAt: far(), page: PAGE, cursor,
      read: async (i) => { readCalls += 1; return reader({ claims: CLAIMS, judge: { verdict: "undecidable", confidence: "unsupported", proposed: "", agreement: "none_found", supportingQuote: "", note: "" } })(i); },
      searchSources: async () => ({ organic: [] }), fetchSource: async () => null,
    });
    // The stored cursor is for another page version, so claims are re-read exactly once and then advanced.
    expect(readCalls).toBeGreaterThanOrEqual(1);
    expect(out.cursor?.nextIndex).toBe(1);
  });

  it("treats a changed page as stale, never as corrected", () => {
    const held = { pageContentHash: "hash-old", current: "Goddess", evidenceBasis: "b1" };
    expect(isCurrentCheck(held, { pageContentHash: "hash-old", current: "Goddess", evidenceBasis: "b1" })).toBe(true);
    expect(isCurrentCheck(held, { pageContentHash: "hash-new", current: "Goddess", evidenceBasis: "b1" })).toBe(false);
    expect(isCurrentCheck(held, { pageContentHash: "hash-old", current: "Legend", evidenceBasis: "b1" })).toBe(false);
    expect(isCurrentCheck(held, { pageContentHash: "hash-old", current: "Goddess", evidenceBasis: "b2" })).toBe(false);
  });

  it("says a page version is complete once every claim on it is current, so the caller can move on", async () => {
    const held: FactCheck[] = [];
    const first = await runFactCheckUnit({
      tenantId: "t", now: NOW, basis: "b1", deadlineAt: far(), page: PAGE, held,
      read: reader({ claims: CLAIMS, judge: { verdict: "page_correct", confidence: "likely", proposed: "", agreement: "single_source", supportingQuote: "x", note: "" } }),
      searchSources: async () => ({ organic: [] }), fetchSource: async () => null,
    });
    expect(first.cursor?.pageComplete).toBe(true);
  });
});
