import { describe, it, expect, vi } from "vitest";

import { autoRecordShippedChangeForRec, type AutoRecordDeps } from "@/domains/proof-gsc/auto-record-on-ship";

// A teardown of the real I/O via injected deps — no GSC read, no prod write.
function deps(over: Partial<AutoRecordDeps> = {}): {
  d: Partial<AutoRecordDeps>;
  upserts: unknown[];
} {
  const upserts: unknown[] = [];
  const d: Partial<AutoRecordDeps> = {
    captureChangeMeta: (async () => ({
      canonPage: "https://iranopedia.com/iran-flag",
      path: "/iran-flag",
      before: null,
      after: null,
      targetQueries: ["iran flag"],
      headlineAction: "add_answer_block",
    })) as AutoRecordDeps["captureChangeMeta"],
    loadShippedChanges: (async () => []) as AutoRecordDeps["loadShippedChanges"],
    loadControlCandidates: (async () => [
      "https://iranopedia.com/persian-boy-names",
      "https://iranopedia.com/persian-girl-names",
      "https://iranopedia.com/biggest-cities-in-iran",
    ]) as AutoRecordDeps["loadControlCandidates"],
    shipDate: () => "2026-06-25",
    recordShippedChange: (async (args: { path: string }) =>
      ({ id: `${args.path}::2026-06-25`, ...args }) as unknown) as AutoRecordDeps["recordShippedChange"],
    upsertShippedChange: (async (r: unknown) => {
      upserts.push(r);
    }) as AutoRecordDeps["upsertShippedChange"],
    ...over,
  };
  return { d, upserts };
}

describe("autoRecordShippedChangeForRec (Ship -> Proof bridge)", () => {
  it("records a proof change when the Move has a target URL + enough controls", async () => {
    const { d, upserts } = deps();
    const res = await autoRecordShippedChangeForRec(
      { tenantId: "tenant-iranopedia", pageUrl: "https://iranopedia.com/iran-flag", actionType: "add_answer_block", targetQuery: "iran flag" },
      d,
    );
    expect(res).toEqual({ recorded: true, reason: "recorded" });
    expect(upserts).toHaveLength(1);
  });

  it("does NOT record when the Move has no target URL", async () => {
    const { d, upserts } = deps();
    const res = await autoRecordShippedChangeForRec({ tenantId: "t", pageUrl: null }, d);
    expect(res.recorded).toBe(false);
    expect(res.reason).toBe("no-url");
    expect(upserts).toHaveLength(0);
  });

  it("is idempotent — a duplicate accept for the same page+date does not double-write", async () => {
    const { d, upserts } = deps({
      loadShippedChanges: (async () => [
        { path: "/iran-flag", shippedAt: "2026-06-25T12:00:00Z" },
      ]) as AutoRecordDeps["loadShippedChanges"],
    });
    const res = await autoRecordShippedChangeForRec(
      { tenantId: "tenant-iranopedia", pageUrl: "https://iranopedia.com/iran-flag", actionType: "add_answer_block" },
      d,
    );
    expect(res.recorded).toBe(false);
    expect(res.reason).toBe("already-recorded");
    expect(upserts).toHaveLength(0);
  });

  it("skips (does not block ship) when there are too few clean controls", async () => {
    const { d, upserts } = deps({
      loadControlCandidates: (async () => ["https://iranopedia.com/only-one"]) as AutoRecordDeps["loadControlCandidates"],
    });
    const res = await autoRecordShippedChangeForRec(
      { tenantId: "tenant-iranopedia", pageUrl: "https://iranopedia.com/iran-flag", actionType: "add_answer_block" },
      d,
    );
    expect(res.recorded).toBe(false);
    expect(res.reason).toBe("insufficient-controls");
    expect(upserts).toHaveLength(0);
  });

  it("never throws — a thrown dependency degrades to recorded:false", async () => {
    const { d } = deps({
      captureChangeMeta: (async () => {
        throw new Error("GSC down");
      }) as AutoRecordDeps["captureChangeMeta"],
    });
    const res = await autoRecordShippedChangeForRec(
      { tenantId: "t", pageUrl: "https://iranopedia.com/iran-flag" },
      d,
    );
    expect(res.recorded).toBe(false);
    expect(res.reason).toBe("error");
  });
});
