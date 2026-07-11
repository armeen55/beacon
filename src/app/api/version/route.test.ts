import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

const KEYS = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "VERCEL_DEPLOYMENT_ID"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("GET /api/version", () => {
  it("returns nulls (never throws) when the deploy env vars are unset", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sha: null, ref: null, deployedId: null });
  });

  it("reflects the injected Vercel build identity when present", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_xyz";
    const res = GET();
    const body = await res.json();
    expect(body).toEqual({ sha: "abc123", ref: "main", deployedId: "dpl_xyz" });
  });
});
