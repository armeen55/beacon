import { describe, expect, it } from "vitest";
import { settledByRows } from "@/domains/decision/load-proposals";
import type { ChangeProposal } from "@/domains/decision/contracts";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const SAVED = new Date(NOW.getTime() + 4 * 60_000).toISOString();
const SITES = [
  { t: "acct-tide", a: "/tide-pools", b: "/rock-shelves" },
  { t: "acct-bordado", a: "/bordado", b: "/puntadas" },
];
const KEY = "work::body::one";
const row = (s: (typeof SITES)[number], over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${s.t}::body::x`, tenantId: s.t, kind: "existing_edit", pagePath: s.a, pageUrl: `https://${s.t}.example${s.a}`,
  pageLabel: "Page", primaryQuery: s.a.replace(/[/-]/g, " ").trim(), opportunityType: "Capture clicks", changeFamily: "section", status: "ready",
  researchOnly: false, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Finished copy." },
  whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query: s.a, hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, publish: "manual",
  createdAt: "2026-08-20T00:00:00.000Z", workKey: KEY, ...over,
} as ChangeProposal);
const DAY = NOW.toISOString().slice(0, 10); // the moment the walk hands the rule: the start of the day this memory belongs to

describe("the day's memory is settled by the rows, and by which rows", () => {
  it.each(SITES)("$t: a row the boxed job landed after the box settles the key it was funded under", (s) => {
    const before = { [KEY]: { calls: 2, last: "retryable_blocked", settled: false } };
    expect(settledByRows(before, { ready: [row(s, { createdAt: SAVED })], toDo: [] }, DAY)[KEY]).toEqual({ calls: 2, last: "produced", settled: true });
    const today = { createdAt: new Date().toISOString() } as Partial<ChangeProposal>; // and with no moment named at all the day this is read on is the floor, which is the day that wrote the memory
    expect(settledByRows(before, { ready: [row(s, today)], toDo: [] })[KEY]).toEqual({ calls: 2, last: "produced", settled: true });
  });

  it.each(SITES)("$t: a row standing since an earlier day settles nothing, so a drive that produced nothing never reads as produced", (s) => {
    const before = { [KEY]: { calls: 2, last: "retryable_blocked", settled: false } };
    const stale = row(s, { updatedAt: "2026-08-20T00:00:00.000Z" } as Partial<ChangeProposal>);
    // THE PIN: a key whose only row predates this drive is still owed, because nothing this drive did produced it.
    expect(settledByRows(before, { ready: [stale], toDo: [] }, DAY)[KEY]).toEqual({ calls: 2, last: "retryable_blocked", settled: false });
    expect(settledByRows(before, { ready: [stale], toDo: [] })[KEY], "and it is owed with no moment named either, because the floor is then the day this is read on").toEqual({ calls: 2, last: "retryable_blocked", settled: false });
    expect(settledByRows(before, { ready: [row(s, { createdAt: SAVED, updatedAt: "2026-08-20T00:00:00.000Z" } as Partial<ChangeProposal>)], toDo: [] }, DAY)[KEY], "and where the store carries an update moment that moment is what answers, never the day the row was first written").toEqual({ calls: 2, last: "retryable_blocked", settled: false });
  });
});
