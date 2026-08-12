/** THE PAGE JOB: one sentence saying what a page is FOR, and the two fit checks that read it. Each pin states what a job may
 *  change about a decision and what a MISSING job may never change: nothing. Fixtures only, zero network. */
import { describe, it, expect, vi } from "vitest";
const budget = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({
  checkBudget: async () => (budget.allowed ? { allowed: true, remaining: 10 } : { allowed: false, reason: "cap reached" }),
  recordSpend: async () => {},
}));
import { linkFit, loadPageJobs, pageJobFor, sectionFit, type OwnedPageJob } from "@/domains/decision/producers/page-job";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";

const extract = (path: string) => ({ url: `https://mysite.example${path}`, title: "Tabriz, Iran: what to know before you go",
  h1: "Tabriz, Iran", headings: ["Tabriz population", "Tabriz climate", "Things to see in Tabriz"], wordCount: 737 });
const READING = { job: "This page tells a traveller what the city of Tabriz is like before they visit.", pageType: "city" as const,
  audience: "travellers planning a trip to Iran", topics: ["Tabriz", "iran travel", "city guide"], commercial: false };
/** A completion seam that answers with one fixed reading and counts how many times it actually ran. */
const seam = (value: unknown): { complete: CompleteFn; calls: () => number } => {
  let calls = 0;
  return { calls: () => calls, complete: async () => { calls += 1; return { value }; } };
};
const job = (over: Partial<OwnedPageJob> = {}): OwnedPageJob => ({ ...READING, topics: ["tabriz", "iran travel", "city guide"], url: "https://mysite.example/tabriz", ...over });

describe("what one page is for", () => {
  it("reads the job off the page's own extract and hands the subject words back lowercased", async () => {
    budget.allowed = true;
    const s = seam(READING);
    const out = await pageJobFor("t_fixture", extract("/tabriz"), { complete: s.complete });
    expect([out?.job, out?.pageType, out?.commercial, out?.topics, out?.url, s.calls()])
      .toEqual([READING.job, "city", false, ["tabriz", "iran travel", "city guide"], "https://mysite.example/tabriz", 1]);
  });
  it("has no job for a shape that does not validate, for a blocked budget, or for a page with no words captured", async () => {
    budget.allowed = true;
    // Two subject words is below the schema's floor of three, so the whole reading is refused rather than half kept.
    expect(await pageJobFor("t_fixture", extract("/tabriz"), { complete: seam({ ...READING, topics: ["tabriz", "iran"] }).complete })).toBeNull();
    const blind = seam(READING);
    expect(await pageJobFor("t_fixture", { url: "https://mysite.example/unread" }, { complete: blind.complete })).toBeNull();
    expect(blind.calls()).toBe(0); // a page with nothing captured is never paid to be read
    budget.allowed = false;
    expect(await pageJobFor("t_fixture", extract("/tabriz"), { complete: seam(READING).complete })).toBeNull();
    budget.allowed = true;
  });
  it("buys what one pass is allowed and no more, so a cold start spreads over passes", async () => {
    budget.allowed = true;
    const s = seam(READING);
    const many = Array.from({ length: 12 }, (_, i) => extract(`/page-${i}`));
    const out = await loadPageJobs("t_fixture", many, { complete: s.complete, maxNewReads: 2 });
    // The pass stops ISSUING work once its allowance is gone; it never abandons a reading already in flight, so
    // the four running at that moment still land. The twelve pages are never read in one pass.
    expect(s.calls()).toBeLessThanOrEqual(2 + 4);
    expect([out.size < many.length, out.size > 0, out.size === s.calls()]).toEqual([true, true, true]);
  });
});

describe("what a job changes, and what a missing one may never change", () => {
  it("keeps a section off a page that is not for it and off a rail an essay never goes on", () => {
    expect(sectionFit(job(), ["tabriz", "climate"])).toBe("fits");
    expect(sectionFit(job(), ["saffron", "recipe"])).toBe("off_topic");
    expect(sectionFit(job({ pageType: "product" }), ["tabriz", "climate"])).toBe("wrong_type");
    expect(sectionFit(job({ pageType: "category" }), ["tabriz"])).toBe("wrong_type");
    // FAIL OPEN: no job on file is never a verdict about the page, so the producer runs its own word overlap.
    expect(sectionFit(null, ["tabriz"])).toBe("unknown");
    expect(sectionFit(undefined, ["tabriz"])).toBe("unknown");
  });
  it("keeps a body link off a page the words do not belong to, and off a dictionary page from a stranger", () => {
    const target = job({ url: "https://mysite.example/persian-words", pageType: "translation", topics: ["farsi words", "persian phrases"] });
    const related = job({ url: "https://mysite.example/farsi", topics: ["farsi words", "learning persian"] });
    const stranger = job({ url: "https://mysite.example/tabriz" });
    expect(linkFit(target, related, ["farsi", "words"])).toBe("fits");
    expect(linkFit(target, stranger, ["farsi", "words"])).toBe("wrong_type");
    expect(linkFit(job(), stranger, ["saffron"])).toBe("off_topic");
    expect(linkFit(null, stranger, ["farsi"])).toBe("unknown");
    expect(linkFit(target, null, ["farsi"])).toBe("unknown");
  });
});
