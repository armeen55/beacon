import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";
import { autoMeasureDuePass } from "./auto-measure-pass";
import { harvestWinners } from "@/domains/llm/winner-memory";
import { buildTeamScoreboardSummary } from "@/domains/team-scoreboard/compute-scoreboard";

/**
 * auto-measure-on-use (2026-06-29) — PASSIVE settle of due proof rows when the operator
 * opens the Results page. The proof→ranking loop is fully wired, but `autoMeasureDuePass`
 * previously ran ONLY from the explicit "Measure now" operator action, so due rows sat
 * un-measured (and learning never activated) unless the operator remembered to click.
 *
 * This schedules the SAME engine via next/after — it runs AFTER the response, so it adds
 * ZERO render latency and never blocks the page. On-demand (operator opens /results), NOT a
 * cron. Fail-soft. Bounded (autoMeasureDuePass caps records + does GSC reads from already-
 * synced data — no paid calls). The caller gates this to operator mode + only fires when
 * due rows exist, so a customer/anon view never mutates proof data.
 *
 * Idempotence: a per-warm-lambda throttle collapses rapid /results renders into one pass;
 * autoMeasureDuePass itself is deterministic (re-measuring the same GSC window yields the
 * same verdict), so an occasional duplicate across lambdas is harmless. Mirrors the proven
 * scheduleBriefBackfill pattern.
 *
 * BEACON_500 item 30 (2026-07-02): the tail of this same pass re-harvests winner-memory
 * (mature-won before/after text + structural features per actionFamily) so a settlement
 * that just turned "won" is available to the drafter's few-shot injection on the very
 * next draft. harvestWinners is itself fail-soft/idempotent/$0 (re-reads the ledger,
 * no LLM call) - an isolated try/catch here means a harvest failure can never affect the
 * measurement pass it rides along with.
 *
 * BEACON_500 item 38 (2026-07-02): a second, equally isolated tail step full-recomputes the
 * specialist scoreboard (buildTeamScoreboardSummary) whenever this pass settled anything - the
 * same "re-read the whole ledger, $0, idempotent" posture as harvestWinners, so a fresh won/lost
 * verdict is reflected in each specialist's Brier score on the very next Today render.
 */
const lastRunAt = new Map<string, number>();
const MIN_GAP_MS = 10 * 60_000;
const PER_RUN_CAP = 15;

/** Fire-and-forget a due-row measurement pass after the response. No-op if throttled or
 *  called outside a request scope. NEVER throws (fail-soft for the render path). */
export function scheduleAutoMeasure(tenantId: string): void {
  if (!tenantId) return;
  const nowMs = Date.now();
  const last = lastRunAt.get(tenantId) ?? 0;
  if (nowMs - last < MIN_GAP_MS) return; // collapse rapid renders (one pass per window)
  lastRunAt.set(tenantId, nowMs);
  try {
    after(async () => {
      try {
        const res = await autoMeasureDuePass(tenantId, { maxRecords: PER_RUN_CAP });
        if (res.measured > 0) {
          log.info("[auto-measure-on-use] passive pass ran", {
            tenantId,
            due: res.due,
            measured: res.measured,
            settled: res.settled,
            changed: res.changed,
          });
        }
        // R4 (2026-07-03): the pass's upserts invalidated the /results SWR snapshot
        // (shipped-change-store choke point). Rebuild it here, still in the same
        // after() window, so "Refresh in a moment to see the verdict" lands on a
        // page that is both instant AND current instead of a slow cold re-measure.
        if (res.measured > 0) {
          try {
            const { rebuildResultsSurface } = await import(
              "@/app/(shell)/results/results-ledger-data"
            );
            await rebuildResultsSurface(tenantId);
          } catch (e) {
            log.warn("[auto-measure-on-use] results-surface rebuild failed (non-blocking)", {
              tenantId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (res.settled > 0) {
          try {
            await harvestWinners(tenantId);
          } catch (e) {
            log.warn("[auto-measure-on-use] winner harvest failed (non-blocking)", {
              tenantId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          try {
            await buildTeamScoreboardSummary(tenantId);
          } catch (e) {
            log.warn("[auto-measure-on-use] team scoreboard recompute failed (non-blocking)", {
              tenantId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } catch (e) {
        log.warn("[auto-measure-on-use] passive pass failed (non-blocking)", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  } catch {
    // after() is only valid inside a request scope — ignore outside one.
  }
}
