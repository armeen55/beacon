import { describe, it, expect } from "vitest";

import {
  findSnippetPromiseGap,
  snippetPromiseCandidates,
  hasSnippetPromise,
  MAX_SNIPPET_PROMISE_CANDIDATES,
  MIN_IMPRESSIONS_FOR_PROMISE_AUDIT,
  type SnippetPromiseInput,
} from "./snippet-promise";

function page(over: Partial<SnippetPromiseInput> = {}): SnippetPromiseInput {
  return {
    url: "https://iranopedia.com/persian-cat-cost",
    title: "How Much Does a Persian Cat Cost",
    metaDescription: "What owning a Persian cat costs.",
    earlyText:
      "Persian cats are a beloved long haired breed with a calm temperament. " +
      "They are known for their round faces and quiet personalities and make gentle companions for families.",
    impressions: 500,
    httpStatus: 200,
    fetchedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

describe("findSnippetPromiseGap - promise-gap fixtures", () => {
  it("flags a cost promise with no early number", () => {
    const gap = findSnippetPromiseGap(page());
    expect(gap).not.toBeNull();
    expect(gap!.promise).toBe("cost");
    expect(gap!.sentence).toBe("The title promises the cost but the first 200 words never give a number.");
  });

  it("passes a cost promise that delivers a number (or 'free') early", () => {
    expect(findSnippetPromiseGap(page({ earlyText: "A Persian cat costs 800 to 1500 upfront from a rescue." }))).toBeNull();
    expect(findSnippetPromiseGap(page({ earlyText: "Adopting an adult Persian cat is often free from shelters." }))).toBeNull();
  });

  it("flags a count/list promise ('Top 10') with no early count", () => {
    const gap = findSnippetPromiseGap(
      page({
        title: "Top 10 Persian Cat Names",
        metaDescription: "The best names.",
        earlyText: "Persian cats deserve names as elegant as their coats. Naming a cat is a personal choice every owner approaches differently.",
      }),
    );
    expect(gap).not.toBeNull();
    expect(gap!.promise).toBe("count_list");
    expect(gap!.sentence).toContain("never show a count");
  });

  it("flags a how-to promise with no early steps, passes one that starts the steps", () => {
    const base = { title: "How to Cook Tahdig", metaDescription: "Crispy rice." };
    const gap = findSnippetPromiseGap(
      page({ ...base, earlyText: "Tahdig is the crispy golden crust at the bottom of the Persian rice pot, prized at every family table." }),
    );
    expect(gap).not.toBeNull();
    expect(gap!.promise).toBe("how_to");
    const kept = findSnippetPromiseGap(page({ ...base, earlyText: "To cook tahdig, first rinse the rice well, then parboil it." }));
    expect(kept).toBeNull();
  });

  it("flags a date promise with no early date, passes month/year answers", () => {
    const base = { title: "When Is Nowruz", metaDescription: "The Persian New Year." };
    const gap = findSnippetPromiseGap(
      page({ ...base, earlyText: "Nowruz is the Persian New Year and the most important holiday in Iranian culture, celebrated with family gatherings." }),
    );
    expect(gap).not.toBeNull();
    expect(gap!.promise).toBe("date");
    expect(findSnippetPromiseGap(page({ ...base, earlyText: "Nowruz falls on March 20 or March 21 each year." }))).toBeNull();
    expect(findSnippetPromiseGap(page({ ...base, earlyText: "Nowruz 2026 begins on the spring equinox." }))).toBeNull();
  });

  it("never flags when there is no stored early text (missing data is not evidence)", () => {
    expect(findSnippetPromiseGap(page({ earlyText: null }))).toBeNull();
    expect(findSnippetPromiseGap(page({ earlyText: "   " }))).toBeNull();
  });

  it("skips low-impression pages, dead pages, and pages promising nothing specific", () => {
    expect(findSnippetPromiseGap(page({ impressions: MIN_IMPRESSIONS_FOR_PROMISE_AUDIT - 1 }))).toBeNull();
    expect(findSnippetPromiseGap(page({ httpStatus: 404 }))).toBeNull();
    expect(
      findSnippetPromiseGap(page({ title: "Persian Cats", metaDescription: "About Persian cats.", earlyText: "Persian cats are calm." })),
    ).toBeNull();
  });

  it("only checks words inside the 200-word window", () => {
    const filler = Array.from({ length: 210 }, () => "word").join(" ");
    // The number sits past the window -> still a gap.
    const gap = findSnippetPromiseGap(page({ earlyText: `${filler} 1200` }));
    expect(gap).not.toBeNull();
  });
});

describe("hasSnippetPromise", () => {
  it("detects a promise in the title or meta, and nothing on plain pages", () => {
    expect(hasSnippetPromise("How Much Does a Persian Cat Cost", null)).toBe(true);
    expect(hasSnippetPromise("Persian Cats", "Prices and care explained")).toBe(true);
    expect(hasSnippetPromise("Persian Cats", "A gentle long haired breed")).toBe(false);
    expect(hasSnippetPromise(null, null)).toBe(false);
  });
});

describe("snippetPromiseCandidates", () => {
  it("caps at 5, ordered by impressions (fix the promise the most searchers see)", () => {
    const pages = Array.from({ length: 8 }, (_, i) =>
      page({ url: `https://iranopedia.com/p${i}`, impressions: 100 + i * 50 }),
    );
    const rows = snippetPromiseCandidates({ tenantId: "t1", pages, signalAt: "2026-07-03T00:00:00Z" });
    expect(rows).toHaveLength(MAX_SNIPPET_PROMISE_CANDIDATES);
    expect(rows[0]!.target_url).toBe("https://iranopedia.com/p7"); // highest impressions first
    const imprs = rows.map((r) => Number(/impressions_90d=(\d+)/.exec(r.evidence[0]!.detail ?? "")?.[1]));
    expect([...imprs].sort((a, b) => b - a)).toEqual(imprs);
  });

  it("shapes a valid candidate row (keys, action, copy, no dashes, no fabricated fields)", () => {
    const rows = snippetPromiseCandidates({ tenantId: "t1", pages: [page()], signalAt: "2026-07-03T00:00:00Z" });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.trigger_signal).toBe("snippet_promise_gap");
    expect(row.action_type).toBe("update_intro");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.confidence).toBe("medium");
    expect(row.evidence).toHaveLength(1);
    expect(row.dedupe_key).toMatch(/^[0-9a-f]{40}$/);
    expect(row.cooldown_key).toMatch(/^[0-9a-f]{40}$/);
    expect(row.customer_copy).toContain("keeps the promise its listing makes");
    expect(row.customer_copy).not.toMatch(/[–—]/);
    expect(row.created_from_signal_at).toBe("2026-07-01T00:00:00Z"); // the snapshot's own timestamp
    expect(row.safety_flags).toEqual([]);
  });

  it("emits nothing when every page keeps its promise or lacks data", () => {
    const rows = snippetPromiseCandidates({
      tenantId: "t1",
      pages: [
        page({ earlyText: "It costs 800 upfront." }),
        page({ url: "https://iranopedia.com/x", earlyText: null }),
      ],
      signalAt: "2026-07-03T00:00:00Z",
    });
    expect(rows).toEqual([]);
  });
});
