/** Runtime acquisition executes EVERY kind the requirement union declares, through the machinery that already  exists: serp through the serp unit, competitor_page through the winning-pages unit's priority-query read,  page_source through that unit's owned-read seat, and factual_source through the fact-check pass. Two of the  four kinds used to be typed dead ends: minted by producers, refused at the one consumer with "nothing here  can buy a competitor_page", so the requirement system promised readings the runtime could never make. */
import { describe, expect, it, vi } from "vitest";
const CALLS = vi.hoisted(() => ({ serp: [] as string[][], win: [] as { qs: string[]; owned: string | null }[] }));
vi.mock("@/domains/evidence", async (actual) => ({ ...(await actual<Record<string, unknown>>()),
  serpAnalysisUnit: (_d: unknown, qs: string[]) => async () => (CALLS.serp.push(qs), { status: "done", cursor: null, progress: {} }),
  winningPagesUnit: (_d: unknown, qs: string[] = [], _i: unknown = null, owned: string | null = null) => async () => (CALLS.win.push({ qs, owned }), { status: "advanced", cursor: null, progress: {} }) }));
import { defaultSteps } from "@/domains/runtime/ops/research-steps";
describe("acquireEvidence is exhaustive over the requirement union", () => {
  it("routes serp, competitor_page and page_source to the existing units, and factual_source to the fact-check pass", async () => {
    expect((await defaultSteps.acquireEvidence("t1", { kind: "serp", query: "iran flag" }, "b", 5_000)).acquired).toBe(true);
    expect((await defaultSteps.acquireEvidence("t1", { kind: "competitor_page", query: "iran flag", url: "https://rival.example/flags" }, "b", 5_000)).acquired).toBe(true);
    expect((await defaultSteps.acquireEvidence("t1", { kind: "page_source", query: "iran flag", url: "https://me.example/flags" }, "b", 5_000)).acquired).toBe(true);
    expect(CALLS.serp).toEqual([["iran flag"]]); // the exact search, through the exact unit the funnel already uses
    expect(CALLS.win).toEqual([{ qs: ["iran flag"], owned: null }, { qs: [], owned: "https://me.example/flags" }]); // the winner read by priority query; the own page by the owned seat
    const facts = await defaultSteps.acquireEvidence("t1", { kind: "factual_source", query: "iran flag", url: "https://me.example/flags" }, "b", 1_000);
    expect(facts.detail).toContain("fact check"); // the pass RAN; hermetically it banks nothing, which is an honest not-acquired, never "nothing here can buy a factual_source"
    expect((await defaultSteps.acquireEvidence("t1", { kind: "serp", query: "x" }, null, 5_000)).acquired).toBe(false); // no confirmed basis, no read: unchanged fail-closed rule
    expect((await defaultSteps.acquireEvidence("t1", { kind: "page_source", query: "x" }, "b", 5_000)).detail).toContain("names no page"); }); // a malformed requirement refuses loudly instead of guessing a url
});
