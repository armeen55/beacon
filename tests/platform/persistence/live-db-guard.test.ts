/**
 * Quota/waste guard (2026-06-17) — proves a test run cannot connect to a hosted
 * Supabase without an explicit opt-in. This is the boundary that stops a
 * pre-prod app from burning prod egress via local/test runs.
 */

import { describe, it, expect, afterEach } from "vitest";

import {
  isLiveDbTestAllowed,
  isTestRuntime,
  looksLikeHostedSupabase,
  assertHermeticSupabase,
} from "@/lib/persistence/live-db-guard";

const SAVED = {
  live: process.env.BEACON_LIVE_DB_TESTS,
  allow: process.env.BEACON_ALLOW_LIVE_DB_TESTS,
};

afterEach(() => {
  if (SAVED.live == null) delete process.env.BEACON_LIVE_DB_TESTS;
  else process.env.BEACON_LIVE_DB_TESTS = SAVED.live;
  if (SAVED.allow == null) delete process.env.BEACON_ALLOW_LIVE_DB_TESTS;
  else process.env.BEACON_ALLOW_LIVE_DB_TESTS = SAVED.allow;
});

describe("looksLikeHostedSupabase", () => {
  it("flags hosted *.supabase.co projects", () => {
    expect(looksLikeHostedSupabase("https://jdegznovgysxyweknewh.supabase.co")).toBe(true);
  });
  it("allows local Supabase (127.0.0.1 / localhost)", () => {
    expect(looksLikeHostedSupabase("http://127.0.0.1:54321")).toBe(false);
    expect(looksLikeHostedSupabase("http://localhost:54321")).toBe(false);
  });
});

describe("assertHermeticSupabase — the loud guard", () => {
  it("is running under a test runtime here (vitest)", () => {
    expect(isTestRuntime()).toBe(true);
  });

  it("THROWS when a test tries to connect to a hosted Supabase without opt-in", () => {
    delete process.env.BEACON_LIVE_DB_TESTS;
    delete process.env.BEACON_ALLOW_LIVE_DB_TESTS;
    expect(isLiveDbTestAllowed()).toBe(false);
    expect(() =>
      assertHermeticSupabase("https://jdegznovgysxyweknewh.supabase.co"),
    ).toThrow(/Refusing to connect to a hosted Supabase/);
  });

  it("does NOT throw for local Supabase even without opt-in", () => {
    delete process.env.BEACON_LIVE_DB_TESTS;
    expect(() => assertHermeticSupabase("http://127.0.0.1:54321")).not.toThrow();
  });

  it("does NOT throw when explicitly opted in (BEACON_LIVE_DB_TESTS=1)", () => {
    process.env.BEACON_LIVE_DB_TESTS = "1";
    expect(isLiveDbTestAllowed()).toBe(true);
    expect(() =>
      assertHermeticSupabase("https://jdegznovgysxyweknewh.supabase.co"),
    ).not.toThrow();
  });

  it("also honors the BEACON_ALLOW_LIVE_DB_TESTS alias", () => {
    delete process.env.BEACON_LIVE_DB_TESTS;
    process.env.BEACON_ALLOW_LIVE_DB_TESTS = "1";
    expect(() =>
      assertHermeticSupabase("https://x.supabase.co"),
    ).not.toThrow();
  });
});
