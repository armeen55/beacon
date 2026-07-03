/**
 * CronPreflightSection (BEACON_500 T0c, 2026-07-03) - the nightly-machinery
 * preflight on the operator-gated /diagnostics page: is every cron declared
 * AND mapped (config drift), and is every required env var present (names
 * only, never values). Pure checks in cron-preflight.ts; this component just
 * feeds them vercel.json (static import, bundled at build time - a runtime
 * readFileSync would break in the serverless bundle) and process.env.
 *
 * Collapses to one green line when everything is wired. Operator surface:
 * env var names and route paths are fine here, never on customer pages.
 */
import vercelJson from "../../../../vercel.json";
import { runCronPreflight, type DeclaredCron } from "@/domains/ops/cron-preflight";

export function CronPreflightSection() {
  const declared = ((vercelJson as { crons?: DeclaredCron[] }).crons ?? []).map((c) => ({
    path: c.path,
    schedule: c.schedule,
  }));
  const result = runCronPreflight(declared, process.env as Record<string, string | undefined>);

  if (result.ok) {
    return (
      <p className="-mt-4 text-xs text-muted-foreground" data-diagnostic="cron-preflight">
        Nightly machinery preflight: all {result.cronsDeclared} scheduled jobs are declared and
        mapped, and all {result.envChecked} required environment variables are present.
      </p>
    );
  }

  return (
    <div
      className="rounded-md border border-status-danger/40 bg-status-danger/[0.06] px-4 py-3 -mt-2"
      data-diagnostic="cron-preflight"
    >
      <p className="text-[13px] font-semibold text-status-danger">
        Nightly machinery preflight found {result.findings.length}{" "}
        {result.findings.length === 1 ? "problem" : "problems"}.
      </p>
      <ul className="mt-1 space-y-1">
        {result.findings.map((f) => (
          <li
            key={f.sentence}
            className="text-[12px] leading-relaxed text-muted-foreground"
            data-preflight-kind={f.kind}
          >
            {f.sentence}
          </li>
        ))}
      </ul>
    </div>
  );
}
