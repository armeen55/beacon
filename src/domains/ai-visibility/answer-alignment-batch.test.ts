/**
 * getOwnedAnswerAlignmentsBatch (W2-B, 2026-07-10) - the /results GET-mutation +
 * N+1 fix.
 *
 * Pins:
 *   - QUERY-COUNT REGRESSION: N cited cards -> ONE move-draft read + ONE Profound
 *     excerpts read + ONE page-body read per DISTINCT url (not 3 reads per card).
 *   - RENDER PATH NEVER MUTATES: with the default { persist:false } NO saveMoveDraft
 *     fires even when a fresh alignment is computed; the after() warm-up
 *     ({ persist:true }) is the only writer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestMoveDraftsMock = vi.fn(async (_t: string) => new Map<string, { content: string }>());
const saveMoveDraftMock = vi.fn(async () => true);

const fromCalls: string[] = [];

// A page/answer pair that alignAnswerToPage (real, pure) will match on a shared
// literal sentence.
const ANSWER = "Our widgets ship in three business days with free returns on every order.";
const PAGE_BODY =
  "Welcome to our store. Our widgets ship in three business days with free returns on every order. Contact us anytime.";
const PROMPT = "our widgets ship in three business days";

function fakeQuery(table: string) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.not = () => q;
  q.order = () => q;
  // profound read terminal
  q.range = async () => ({
    data: table === "profound_answer_rows" ? [{ prompt: PROMPT, model: "gpt-4", response_excerpt: ANSWER }] : [],
    error: null,
  });
  // page-body read terminal
  q.limit = async () => ({
    data:
      table === "page_snapshots"
        ? [{ body_paragraph_sample: [PAGE_BODY], card_texts: [], faqs: [] }]
        : [],
    error: null,
  });
  return q;
}

vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      fromCalls.push(t);
      return fakeQuery(t);
    },
  }),
}));
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/domains/demand-graph/move-draft-store", () => ({
  getLatestMoveDrafts: (t: string) => getLatestMoveDraftsMock(t),
  saveMoveDraft: (...a: unknown[]) => saveMoveDraftMock(...(a as [])),
}));
vi.mock("@/domains/demand-graph/competitor-page-audit", () => ({
  getCompetitorAuditsForTenantId: async () => new Map(),
}));

import { getOwnedAnswerAlignmentsBatch } from "./answer-alignment-store";

beforeEach(() => {
  getLatestMoveDraftsMock.mockClear();
  getLatestMoveDraftsMock.mockResolvedValue(new Map());
  saveMoveDraftMock.mockClear();
  fromCalls.length = 0;
});

describe("getOwnedAnswerAlignmentsBatch", () => {
  it("N cards sharing a URL -> ONE draft read, ONE excerpts read, ONE page-body read (query-count regression)", async () => {
    const requests = [
      { recId: "r1", ownedUrl: "https://s.com/p", citingPrompts: [PROMPT] },
      { recId: "r2", ownedUrl: "https://s.com/p", citingPrompts: [PROMPT] },
      { recId: "r3", ownedUrl: "https://s.com/p", citingPrompts: [PROMPT] },
    ];
    const out = await getOwnedAnswerAlignmentsBatch("tenant-a", requests);

    // ONE move-draft read for all three cards.
    expect(getLatestMoveDraftsMock).toHaveBeenCalledTimes(1);
    // ONE profound excerpts read, ONE page-body read (same url deduped).
    expect(fromCalls.filter((t) => t === "profound_answer_rows")).toHaveLength(1);
    expect(fromCalls.filter((t) => t === "page_snapshots")).toHaveLength(1);
    // Every asked rec is present; the matched ones carry the aligned passage.
    expect(out.get("r1")?.passages[0]?.pageSentence).toContain("ship in three business days");
    expect(out.get("r2")).not.toBeNull();
  });

  it("render path is READ-ONLY: default persist:false NEVER calls saveMoveDraft even when a fresh alignment is computed", async () => {
    const out = await getOwnedAnswerAlignmentsBatch("tenant-a", [
      { recId: "r1", ownedUrl: "https://s.com/p", citingPrompts: [PROMPT] },
    ]);
    expect(out.get("r1")).not.toBeNull(); // a fresh alignment WAS computed
    expect(saveMoveDraftMock).not.toHaveBeenCalled(); // ...but nothing was written on the GET
  });

  it("the after() warm-up (persist:true) IS the writer", async () => {
    await getOwnedAnswerAlignmentsBatch(
      "tenant-a",
      [{ recId: "r1", ownedUrl: "https://s.com/p", citingPrompts: [PROMPT] }],
      { persist: true },
    );
    expect(saveMoveDraftMock).toHaveBeenCalledTimes(1);
  });

  it("distinct URLs read the page body once EACH (still one draft/excerpt read overall)", async () => {
    await getOwnedAnswerAlignmentsBatch("tenant-a", [
      { recId: "r1", ownedUrl: "https://s.com/a", citingPrompts: [PROMPT] },
      { recId: "r2", ownedUrl: "https://s.com/b", citingPrompts: [PROMPT] },
    ]);
    expect(fromCalls.filter((t) => t === "page_snapshots")).toHaveLength(2);
    expect(fromCalls.filter((t) => t === "profound_answer_rows")).toHaveLength(1);
    expect(getLatestMoveDraftsMock).toHaveBeenCalledTimes(1);
  });

  it("returns an all-null map (and no reads) for no requests", async () => {
    const out = await getOwnedAnswerAlignmentsBatch("tenant-a", []);
    expect(out.size).toBe(0);
    expect(getLatestMoveDraftsMock).not.toHaveBeenCalled();
  });
});
