/**
 * Optional Bing Webmaster API quota check (BEACON_500 item 75 part 3,
 * 2026-07-02).
 *
 * Pins: self-hides to null with no bingWebmasterApiKey configured (never
 * scrapes, never invents a number), returns the parsed quota on a good
 * response, and fails soft to null (not a thrown error) on a bad response
 * or malformed body.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  config: null as { key: string; bingWebmasterApiKey?: string } | null,
}));

vi.mock("@/lib/connectors/indexnow/config-store", () => ({
  getIndexNowConfig: vi.fn(async () => mocks.config),
}));

import { getBingSubmissionQuota } from "@/lib/connectors/indexnow/bing-webmaster";

beforeEach(() => {
  mocks.config = null;
});

describe("getBingSubmissionQuota", () => {
  it("self-hides to null when no Bing Webmaster key is configured", async () => {
    mocks.config = { key: "abc12345" };
    const fetchImpl = vi.fn();
    const result = await getBingSubmissionQuota("https://example.com", fetchImpl);
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed quota on a good response", async () => {
    mocks.config = { key: "abc12345", bingWebmasterApiKey: "bing-key" };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ d: { DailyQuota: 100, MonthlyQuota: 3000 } }),
    })) as unknown as typeof fetch;
    const result = await getBingSubmissionQuota("https://example.com", fetchImpl);
    expect(result).toEqual({ dailyQuota: 100, monthlyQuota: 3000 });
  });

  it("fails soft to null on a non-ok response", async () => {
    mocks.config = { key: "abc12345", bingWebmasterApiKey: "bing-key" };
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const result = await getBingSubmissionQuota("https://example.com", fetchImpl);
    expect(result).toBeNull();
  });

  it("fails soft to null on a malformed body rather than inventing a number", async () => {
    mocks.config = { key: "abc12345", bingWebmasterApiKey: "bing-key" };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ d: {} }),
    })) as unknown as typeof fetch;
    const result = await getBingSubmissionQuota("https://example.com", fetchImpl);
    expect(result).toBeNull();
  });

  it("fails soft to null on a network error", async () => {
    mocks.config = { key: "abc12345", bingWebmasterApiKey: "bing-key" };
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await getBingSubmissionQuota("https://example.com", fetchImpl);
    expect(result).toBeNull();
  });
});
