/**
 * ask/history-store (BEACON_500 item 59). Round-trip on an in-memory json-store + the
 * MAX_HISTORY cap + the registration pins that make the store real: TENANT_SCOPED
 * classification (per-tenant file, request-context writer) and the Supabase mirror
 * entry (Vercel durability). Mirrors strategy-mix-store.test.ts's exact shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => stored),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    stored = data;
  }),
}));

import { appendAskHistory, loadAskHistory, MAX_HISTORY } from "./history-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import type { AskHistoryEntry } from "./types";

beforeEach(() => {
  stored = [];
});

function entry(over: Partial<AskHistoryEntry> = {}): AskHistoryEntry {
  return {
    id: `ask_${Math.random().toString(36).slice(2)}`,
    tenant_id: "t",
    question: "why did clicks drop on cheetah",
    answer: {
      speaker: "gsc",
      answer: "Clicks on the cheetah page dropped about 22 percent starting June 2.",
      citedFacts: [{ fact: "Cheetah had a sustained clicks drop of about 22% starting 2026-06-02.", href: "/page/cheetah" }],
      source: "fallback",
    },
    questionClass: "page_specific",
    askedAt: "2026-07-01T12:00:00.000Z",
    ...over,
  };
}

describe("registration pins", () => {
  it("ask-history is a TENANT_SCOPED store (per-tenant file, request-context writer)", () => {
    expect(classifyStore("ask-history")).toBe("per-tenant");
  });

  it("ask-history is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"ask-history"');
  });
});

describe("round-trip", () => {
  it("appends and reads back an entry", async () => {
    const ok = await appendAskHistory(entry());
    expect(ok).toBe(true);
    const history = await loadAskHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.question).toBe("why did clicks drop on cheetah");
  });

  it("returns newest first", async () => {
    await appendAskHistory(entry({ askedAt: "2026-07-01T09:00:00.000Z", question: "first" }));
    await appendAskHistory(entry({ askedAt: "2026-07-01T10:00:00.000Z", question: "second" }));
    await appendAskHistory(entry({ askedAt: "2026-07-01T11:00:00.000Z", question: "third" }));
    const history = await loadAskHistory();
    expect(history.map((h) => h.question)).toEqual(["third", "second", "first"]);
  });

  it("caps history at MAX_HISTORY entries, dropping the oldest first", async () => {
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      await appendAskHistory(entry({ askedAt: `2026-07-01T${String(i % 24).padStart(2, "0")}:00:00.000Z-${i}`, question: `q${i}` }));
    }
    const history = await loadAskHistory();
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);
  });

});

describe("fail-soft", () => {
  it("appendAskHistory returns false (never throws) when the store write rejects", async () => {
    const { readStore, writeStore } = await import("@/lib/persistence/json-store");
    vi.mocked(writeStore).mockRejectedValueOnce(new Error("boom"));
    await expect(appendAskHistory(entry())).resolves.toBe(false);
    vi.mocked(readStore); // keep the import used
  });

  it("loadAskHistory returns [] (never throws) when the store read rejects", async () => {
    const { readStore } = await import("@/lib/persistence/json-store");
    vi.mocked(readStore).mockRejectedValueOnce(new Error("boom"));
    await expect(loadAskHistory()).resolves.toEqual([]);
  });
});
