import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import {
  WATCHDOG_EXPECTED_PLATFORMS,
  shouldDispatchPoll,
  type WatchdogObservationRun,
} from "@/domains/observations/poll-watchdog";

/**
 * GET/POST /api/cron/poll-watchdog — Automation Reliability Bundle
 * (2026-05-11).
 *
 * Backstop for the GitHub Actions scheduler. The `daily-native-poll`
 * workflow runs three redundant scheduled fires per UTC day
 * (07:00 / 08:30 / 10:00 UTC) plus three canary fires. On 2026-05-11
 * GH's shared scheduler skipped ALL of them and Beacon required a
 * manual `workflow_dispatch` to recover. This route, invoked daily
 * by a Vercel cron at 11:00 UTC (after every GH-side attempt should
 * have completed), checks today's `observation_runs` and dispatches
 * the GH workflow ONLY when at least one expected platform has no
 * `completed`/`running` row.
 *
 * Critically, this route NEVER runs the paid poll itself. It only
 * dispatches the existing workflow. The workflow's own
 * `defaultHasRecentRun` budget guard short-circuits to
 * `skipped_already_ran_today` if both Vercel cron and a delayed GH
 * scheduler fire on the same UTC day — double-spend is impossible.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (same as the other
 *       `/api/cron/*` routes). Vercel cron sends this automatically
 *       when `CRON_SECRET` is set on the project; the same secret
 *       lets an operator invoke the route manually for ops.
 *
 * Required env vars (added on top of the existing `CRON_SECRET`):
 *   - `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 *     (already present — read by getSupabaseAdmin)
 *   - `BEACON_GH_WORKFLOW_DISPATCH_PAT` — GitHub PAT with
 *     `workflow` scope (or fine-grained `actions:write` on this
 *     repo). Operator must add this in Vercel env before the
 *     watchdog can actually dispatch. Missing → returns 503 with
 *     a clear "PAT not configured" message so the operator sees it
 *     in logs without paging anyone.
 *   - `BEACON_GH_REPO_OWNER` / `BEACON_GH_REPO_NAME` — optional;
 *     default to "armeen55" / "beacon".
 *   - `BEACON_GH_WORKFLOW_FILE` — optional; defaults to
 *     "daily-native-poll.yml".
 *   - `BEACON_GH_WORKFLOW_REF` — optional; defaults to "main".
 *
 * Out of scope (intentional):
 *   - Watchdog does NOT call any paid AI provider directly. It is
 *     a control-plane endpoint only.
 *   - Watchdog does NOT modify any data. It is read-only on
 *     Supabase, write-only on the GitHub API.
 *   - Watchdog does NOT try to handle GH API failures by retrying
 *     in-process. If the dispatch fails it returns 502; the
 *     operator can dispatch manually via the Actions UI.
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DEFAULT_OWNER = "armeen55";
const DEFAULT_REPO = "beacon";
const DEFAULT_WORKFLOW = "daily-native-poll.yml";
const DEFAULT_REF = "main";

type DispatchOutcome =
  | { status: "dispatched"; httpStatus: number }
  | { status: "dispatch_failed"; httpStatus: number; error: string }
  | { status: "skipped_already_ran_today" }
  | { status: "skipped_pat_not_configured" };

async function handle(request: NextRequest): Promise<NextResponse> {
  // ── auth ──────────────────────────────────────────────────────────
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── read today's observation_runs ─────────────────────────────────
  const todayUtcStart = new Date(
    `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  ).toISOString();

  let todayRuns: WatchdogObservationRun[];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("observation_runs")
      .select("run_type, scope_label, status")
      .gte("started_at", todayUtcStart)
      .order("started_at", { ascending: true });
    if (error) {
      console.error("[poll-watchdog] supabase select failed:", error.message);
      return NextResponse.json(
        { error: "supabase select failed", detail: error.message },
        { status: 502 },
      );
    }
    todayRuns = (data ?? []) as WatchdogObservationRun[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[poll-watchdog] supabase fetch threw:", msg);
    return NextResponse.json(
      { error: "supabase fetch threw", detail: msg },
      { status: 502 },
    );
  }

  // ── decide ────────────────────────────────────────────────────────
  const decision = shouldDispatchPoll({ todayObservationRuns: todayRuns });

  if (!decision.shouldDispatch) {
    return NextResponse.json(
      {
        status: "skipped_already_ran_today" as const,
        coveredPlatforms: decision.coveredPlatforms,
        todayUtcStart,
        todayObservationRunCount: todayRuns.length,
        expectedPlatforms: [...WATCHDOG_EXPECTED_PLATFORMS],
      },
      { status: 200 },
    );
  }

  // ── dispatch ──────────────────────────────────────────────────────
  const pat = process.env.BEACON_GH_WORKFLOW_DISPATCH_PAT;
  if (!pat) {
    const outcome: DispatchOutcome = { status: "skipped_pat_not_configured" };
    console.warn(
      "[poll-watchdog] missing platforms but BEACON_GH_WORKFLOW_DISPATCH_PAT not set — cannot dispatch",
      { missingPlatforms: decision.missingPlatforms },
    );
    return NextResponse.json(
      {
        ...outcome,
        missingPlatforms: decision.missingPlatforms,
        coveredPlatforms: decision.coveredPlatforms,
        hint: "Set BEACON_GH_WORKFLOW_DISPATCH_PAT in Vercel env to enable recovery dispatch.",
      },
      { status: 503 },
    );
  }

  const owner = process.env.BEACON_GH_REPO_OWNER ?? DEFAULT_OWNER;
  const repo = process.env.BEACON_GH_REPO_NAME ?? DEFAULT_REPO;
  const workflow = process.env.BEACON_GH_WORKFLOW_FILE ?? DEFAULT_WORKFLOW;
  const ref = process.env.BEACON_GH_WORKFLOW_REF ?? DEFAULT_REF;

  let outcome: DispatchOutcome;
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref }),
      },
    );
    if (ghRes.status === 204) {
      outcome = { status: "dispatched", httpStatus: 204 };
    } else {
      const body = await ghRes.text().catch(() => "");
      outcome = {
        status: "dispatch_failed",
        httpStatus: ghRes.status,
        error: body.slice(0, 500),
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outcome = { status: "dispatch_failed", httpStatus: 0, error: msg };
  }

  const httpStatus =
    outcome.status === "dispatched"
      ? 200
      : outcome.status === "dispatch_failed"
        ? 502
        : 503;

  return NextResponse.json(
    {
      ...outcome,
      missingPlatforms: decision.missingPlatforms,
      coveredPlatforms: decision.coveredPlatforms,
      todayObservationRunCount: todayRuns.length,
      dispatch: { owner, repo, workflow, ref },
    },
    { status: httpStatus },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
