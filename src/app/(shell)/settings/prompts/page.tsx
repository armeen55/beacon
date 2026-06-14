import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { SettingsPromptsClient } from "./settings-prompts-client";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

/**
 * Deploy hardening (2026-05-12) — pin this route to server-rendered.
 *
 * Pre-fix, the page lacked any `dynamic` declaration AND had no
 * `searchParams` / dynamic-segment in its function signature, so
 * Next.js attempted to PRERENDER it at build time. Build-time
 * prerender resolves `currentTenantId()` via the env fallback
 * (no headers, no cookies during static generation) and then issues
 * Supabase reads from a fresh-lambda context. The May 12 build
 * `beacon-39yl32o35` failed exactly this way — `Supabase query
 * failed on prompt_answer_observations: canceling statement due to
 * statement timeout` during `Generating static pages`. The redeploy
 * succeeded because Supabase was healthy, but the fragility is
 * structural, not transient.
 *
 * `force-dynamic` makes the route opt out of prerendering. Every
 * request runs server-side at request time, where the tenant is
 * header-injected by middleware and the Supabase query happens
 * under the runtime budget instead of the build budget. Matches
 * the pattern already used on `/changes`, `/changes/[id]`,
 * `/recommendations`, `/recommendations/[id]`, and the other
 * `/settings/*` routes that read live tenant data
 * (`/settings/connectors`, `/settings/config`, `/settings/health`,
 * `/settings/exit-gates`).
 */
export const dynamic = "force-dynamic";

/**
 * /settings/prompts — minimum-viable prompt-set management hub
 * (Phase v5 Commit 4, 2026-04-24).
 *
 * Operator-facing: "which prompts run tomorrow's cron, toggle any off,
 * add a new one." No inline editing; no bulk ops; no tenant picker
 * (single-tenant today). Intentionally thin.
 *
 * Deploy hardening (2026-05-12) — pre-fix the page called
 * `loadFreshCanonicalData({ observationsSince, snapshotsSince })` which
 * fans out 4 parallel Supabase reads:
 *   1. `tracked_prompts` (small — ~100 rows)
 *   2. `prompt_answer_observations` (heavy — windowed ~hundreds, but
 *      still the single slowest query in the canonical store)
 *   3. `tracked_entities` (small)
 *   4. `daily_metric_snapshots` (windowed but variable)
 * The page only consumes `trackedPrompts`; the other three reads were
 * pure waste AND they were the trigger for the build-time timeout.
 * Switched to a direct repo read on `tracked_prompts` only — single
 * SQL query, single small table, no canonical-store seed.
 */
export default async function SettingsPromptsPage() {
  const trace = createPerfTrace("loader:/settings/prompts", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/settings/prompts",
  });
  try {
  const tenantId = await currentTenantId();
  const trackedPrompts = await trace.time("getTrackedPrompts", () =>
    getRepository().forTenant(tenantId).getTrackedPrompts(),
  );
  trace.data("trackedPrompts_count", trackedPrompts.length);

  const rows = [...trackedPrompts]
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.text.localeCompare(b.text);
    })
    .map((p) => ({
      id: p.id,
      text: p.text,
      topic_id: p.topic_id,
      location_scope: p.location_scope,
      platforms: p.platforms,
      is_active: p.is_active,
    }));

  const activeCount = rows.filter((r) => r.is_active).length;
  const inactiveCount = rows.length - activeCount;

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Prompts</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          {activeCount > 0
            ? `${activeCount} prompt${activeCount === 1 ? "" : "s"} run in tomorrow's daily AI check.${
                inactiveCount > 0 ? ` ${inactiveCount} inactive.` : ""
              }`
            : "No prompts set up yet. Add the questions you want tracked so Beacon can start checking how AI assistants answer them."}
        </p>
      </header>
      <SettingsPromptsClient rows={rows} />
    </div>
  );
  } finally {
    trace.flush();
  }
}
