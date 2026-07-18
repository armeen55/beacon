/**
 * cron-preflight (BEACON_500 T0c, 2026-07-03) - PURE checks that the nightly
 * machinery is even wired up, rendered on the operator-gated /diagnostics
 * page (never a customer surface):
 *
 *   1. Cron registration drift: vercel.json's declared crons vs the runtime
 *      CRON_SCHEDULE_MAP. A cron declared but not mapped (the health panel
 *      and deadman would be blind to it), mapped but not declared (Vercel
 *      will never fire it), or mapped with a different schedule string is a
 *      config-drift finding. The cron-schedule-map pin test catches this at
 *      test time; this check catches it on the RUNNING deployment.
 *
 *   2. Required env presence: NAMES ONLY, never values. Without these the
 *      nightly jobs refuse to run or cannot write, and the first sign would
 *      otherwise be a silent morning.
 *
 * NO I/O here - callers pass vercel.json (static import, bundled at build
 * time) and process.env.
 */

import { CRON_SCHEDULE_MAP, type CronScheduleEntry } from "./cron-schedule-map";

export type DeclaredCron = { path: string; schedule: string };

export type PreflightFinding = {
  kind:
    | "cron_declared_not_mapped"
    | "cron_mapped_not_declared"
    | "cron_schedule_mismatch"
    | "env_missing";
  /** Plain sentence for the diagnostics surface. */
  sentence: string;
};

/** Env vars the nightly machinery cannot run without, with a plain reason.
 *  Names only - the check (and the surface) never reads past presence. */
export const REQUIRED_ENV: ReadonlyArray<{ name: string; why: string }> = [
  { name: "CRON_SECRET", why: "no scheduled job will start" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", why: "I cannot reach the database where all synced data lives" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", why: "the nightly jobs cannot write anything they find" },
  { name: "GOOGLE_CLIENT_ID", why: "the Search Console and Analytics connections cannot stay signed in" },
  { name: "GOOGLE_CLIENT_SECRET", why: "the Search Console and Analytics connections cannot stay signed in" },
];

/** Compare the declared crons against the runtime schedule map. Pure. */
export function checkCronRegistration(
  declared: ReadonlyArray<DeclaredCron>,
  map: ReadonlyArray<CronScheduleEntry> = CRON_SCHEDULE_MAP,
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const mapByPath = new Map(map.map((e) => [e.path, e]));
  const declaredByPath = new Map(declared.map((c) => [c.path, c]));

  for (const cron of declared) {
    const mapped = mapByPath.get(cron.path);
    if (!mapped) {
      findings.push({
        kind: "cron_declared_not_mapped",
        sentence: `${cron.path} is scheduled on Vercel but missing from the schedule map, so my health panel and stall alarm cannot watch it. Add it to cron-schedule-map.ts.`,
      });
    } else if (mapped.schedule !== cron.schedule) {
      findings.push({
        kind: "cron_schedule_mismatch",
        sentence: `${cron.path} runs on "${cron.schedule}" but the schedule map says "${mapped.schedule}", so my late/stalled math for it is wrong. Update cron-schedule-map.ts to match vercel.json.`,
      });
    }
  }

  for (const entry of map) {
    if (!declaredByPath.has(entry.path)) {
      findings.push({
        kind: "cron_mapped_not_declared",
        sentence: `${entry.path} (${entry.label}) is in the schedule map but not declared in vercel.json, so Vercel will never fire it. Declare it or remove the map entry.`,
      });
    }
  }

  return findings;
}

/** Presence-only env check. Pure; pass process.env in. Never echoes values. */
export function checkRequiredEnv(
  env: Record<string, string | undefined>,
  required: ReadonlyArray<{ name: string; why: string }> = REQUIRED_ENV,
): PreflightFinding[] {
  return required
    .filter(({ name }) => {
      const v = env[name];
      return v == null || v.trim() === "";
    })
    .map(({ name, why }) => ({
      kind: "env_missing" as const,
      sentence: `${name} is not set on this deployment. Without it, ${why}.`,
    }));
}

export type CronPreflightResult = {
  ok: boolean;
  findings: PreflightFinding[];
  cronsDeclared: number;
  cronsMapped: number;
  envChecked: number;
};

/** The whole preflight in one call. Pure. */
export function runCronPreflight(
  declared: ReadonlyArray<DeclaredCron>,
  env: Record<string, string | undefined>,
  map: ReadonlyArray<CronScheduleEntry> = CRON_SCHEDULE_MAP,
): CronPreflightResult {
  // No declared/mapped schedules is an intentional on-use deployment, not a
  // broken nightly system. In that mode CRON_SECRET and cron-only provider
  // prerequisites cannot be release gates.
  const scheduled = declared.length > 0 || map.length > 0;
  const findings = [
    ...checkCronRegistration(declared, map),
    ...(scheduled ? checkRequiredEnv(env) : []),
  ];
  return {
    ok: findings.length === 0,
    findings,
    cronsDeclared: declared.length,
    cronsMapped: map.length,
    envChecked: scheduled ? REQUIRED_ENV.length : 0,
  };
}
