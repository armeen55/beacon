import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  checkCronRegistration,
  checkRequiredEnv,
  runCronPreflight,
  REQUIRED_ENV,
  type DeclaredCron,
} from "./cron-preflight";
import { CRON_SCHEDULE_MAP } from "./cron-schedule-map";

const FULL_ENV: Record<string, string | undefined> = Object.fromEntries(
  REQUIRED_ENV.map(({ name }) => [name, "set"]),
);

function realVercelCrons(): DeclaredCron[] {
  const raw = readFileSync(resolve(__dirname, "../../../vercel.json"), "utf-8");
  return (JSON.parse(raw) as { crons?: DeclaredCron[] }).crons ?? [];
}

describe("checkCronRegistration", () => {
  it("is clean for the real vercel.json + the real schedule map", () => {
    expect(checkCronRegistration(realVercelCrons())).toEqual([]);
  });

  it("flags a cron declared on Vercel but missing from the map", () => {
    const declared = [...realVercelCrons(), { path: "/api/cron/new-thing", schedule: "0 8 * * *" }];
    const findings = checkCronRegistration(declared);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("cron_declared_not_mapped");
    expect(findings[0]!.sentence).toContain("/api/cron/new-thing");
  });

  it("flags a mapped job that vercel.json no longer declares", () => {
    const declared = realVercelCrons().filter((c) => c.path !== "/api/cron/measure-due");
    const findings = checkCronRegistration(declared);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("cron_mapped_not_declared");
    expect(findings[0]!.sentence).toContain("/api/cron/measure-due");
    expect(findings[0]!.sentence).toContain("Vercel will never fire it");
  });

  it("flags a schedule string drift", () => {
    const declared = realVercelCrons().map((c) =>
      c.path === "/api/cron/sync-connectors" ? { ...c, schedule: "0 4 * * *" } : c,
    );
    const findings = checkCronRegistration(declared);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("cron_schedule_mismatch");
    expect(findings[0]!.sentence).toContain('"0 4 * * *"');
    expect(findings[0]!.sentence).toContain('"0 9 * * *"');
  });
});

describe("checkRequiredEnv", () => {
  it("is clean when every required name is present", () => {
    expect(checkRequiredEnv(FULL_ENV)).toEqual([]);
  });

  it("names a missing env var WITHOUT ever echoing a value", () => {
    const env = { ...FULL_ENV, CRON_SECRET: undefined, GOOGLE_CLIENT_ID: "sk-super-secret-value" };
    const findings = checkRequiredEnv(env);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("env_missing");
    expect(findings[0]!.sentence).toBe(
      "CRON_SECRET is not set on this deployment. Without it, no scheduled job will start.",
    );
    // Presence only: no present var's VALUE may ever leak into a sentence.
    for (const f of findings) expect(f.sentence).not.toContain("sk-super-secret-value");
  });

  it("treats a blank value as missing", () => {
    const env = { ...FULL_ENV, SUPABASE_SERVICE_ROLE_KEY: "  " };
    const findings = checkRequiredEnv(env);
    expect(findings.map((f) => f.sentence).join(" ")).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("runCronPreflight", () => {
  it("green path: ok with honest counts", () => {
    const result = runCronPreflight(realVercelCrons(), FULL_ENV);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.cronsDeclared).toBe(CRON_SCHEDULE_MAP.length);
    expect(result.cronsMapped).toBe(CRON_SCHEDULE_MAP.length);
    expect(result.envChecked).toBe(REQUIRED_ENV.length);
  });

  it("aggregates drift + env findings and flips ok", () => {
    const declared = realVercelCrons().slice(1);
    const env = { ...FULL_ENV, GOOGLE_CLIENT_ID: undefined };
    const result = runCronPreflight(declared, env);
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(2);
  });

  it("no finding sentence carries an em or en dash", () => {
    const result = runCronPreflight([], {});
    for (const f of result.findings) expect(f.sentence).not.toMatch(/[‒–—―]/);
  });
});
