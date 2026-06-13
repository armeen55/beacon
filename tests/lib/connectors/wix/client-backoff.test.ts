/**
 * 2026-06-13 — Wix client rate-limit safety (ban-avoidance).
 *
 * Pins: a 429 (or 502/503) from Wix triggers exponential backoff + retry
 * (honoring Retry-After), success after a transient limit, and a bounded
 * give-up so a hard-down API still fails fast — so a burst of pushes or a
 * large collection sync can never hammer Wix past its limits.
 */

import { describe, it, expect, vi } from "vitest";

import { wixQueryDataItems } from "@/lib/connectors/wix/client";

type FakeRes = {
  ok: boolean;
  status: number;
  retryAfter?: string;
  body?: unknown;
};

function res(r: FakeRes): Response {
  return {
    ok: r.ok,
    status: r.status,
    headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? r.retryAfter ?? null : null) },
    text: async () => "rate limited",
    json: async () => r.body ?? { dataItems: [] },
  } as unknown as Response;
}

function fetchSeq(sequence: FakeRes[]) {
  let i = 0;
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const next = sequence[Math.min(i, sequence.length - 1)]!;
    i++;
    return res(next);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

const token = { api_key: "k", site_id: "s" };

describe("wixFetch rate-limit backoff", () => {
  it("retries through 429s and succeeds when the limit clears", async () => {
    const slept: number[] = [];
    const { fetchImpl, calls } = fetchSeq([
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: true, status: 200, body: { dataItems: [{ id: "i1", data: { x: 1 } }] } },
    ]);
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(1);
    expect(calls()).toHaveLength(3); // two 429s + the success
    expect(slept).toEqual([1000, 2000]); // exponential 1s, 2s
  });

  it("honors a Retry-After header for the backoff delay", async () => {
    const slept: number[] = [];
    const { fetchImpl } = fetchSeq([
      { ok: false, status: 429, retryAfter: "5" },
      { ok: true, status: 200, body: { dataItems: [] } },
    ]);
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(true);
    expect(slept).toEqual([5000]); // Retry-After: 5s
  });

  it("gives up after the bounded retry budget (never hammers forever)", async () => {
    const slept: number[] = [];
    const { fetchImpl, calls } = fetchSeq([{ ok: false, status: 429 }]); // always 429
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("http_429");
    expect(calls()).toHaveLength(4); // initial + 3 retries
    expect(slept).toHaveLength(3); // backed off before each retry
  });

  it("does NOT retry a non-retryable error (e.g. 400)", async () => {
    const slept: number[] = [];
    const { fetchImpl, calls } = fetchSeq([{ ok: false, status: 400 }]);
    const r = await wixQueryDataItems(
      { dataCollectionId: "Col" },
      { token, fetchImpl, sleepImpl: async (ms) => { slept.push(ms); } },
    );
    expect(r.ok).toBe(false);
    expect(calls()).toHaveLength(1); // no retry on a client error
    expect(slept).toHaveLength(0);
  });
});
