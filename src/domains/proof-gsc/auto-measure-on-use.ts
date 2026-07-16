import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";
import { autoMeasureDuePass } from "./auto-measure-pass";
import {
  loadShippedChangesForTenant,
  canonicalOutcome,
  retryEligibility,
  verifyLastAttemptAt,
  type ShippedChangeRecord,
} from "./shipped-change-store";
import { verifyShippedChange } from "./verify-shipped-change";
import { harvestWinners } from "@/domains/llm/winner-memory";
import { buildTeamScoreboardSummary } from "@/domains/team-scoreboard/compute-scoreboard";

/**
 * auto-measure-on-use (2026-06-29) — PASSIVE settle of due proof rows when the user
 * opens the Results page. The proof→ranking loop is fully wired, but `autoMeasureDuePass`
 * previously ran ONLY from the explicit "Measure now" operator action, so due rows sat
 * un-measured (and learning never activated) unless the operator remembered to click.
 *
 * This schedules the SAME engine via next/after — it runs AFTER the response, so it adds
 * ZERO render latency and never blocks the page. On-demand (operator opens /results), NOT a
 * cron. Fail-soft. Bounded (autoMeasureDuePass caps records + does GSC reads from already-
 * synced data — no paid calls). The authenticated Results route fires only when due or
 * re-verifiable rows exist. Manual proof mutations remain operator-gated separately.
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
/** P1-2b: at most this many un-confirmed rows get a fresh crawl-verify per
 *  passive pass (bounds the crawl work; the rest wait for the next open). */
const MAX_REVERIFY_PER_PASS = 5;

/**
 * W5 stop-ship F6 (2026-07-09): PURE selection of the rows a passive pass
 * should re-verify. A row qualifies when it has a real page + proposal AND is
 * NOT a latched canonical success (verified_live / verified_live_modified) AND
 * is not exhausted AND is past its retry backoff (never scheduled, or
 * nextRetryAt <= now). This is the retry-fairness fix: a never-verified row, a
 * prior crawl_failed / not_found (a transient blip / a page that had not
 * propagated), AND an unresolved needs_review all get a fair, backed-off,
 * bounded re-crawl - never an unbounded hammer, never a downgrade of a proven
 * live verification. The queue is sorted OLDEST attempt first (a never-attempted
 * row, lastAttempt "", sorts first) so no row starves. Capped at `max`.
 */
export function selectRowsToReverify(
  rows: ReadonlyArray<ShippedChangeRecord>,
  max: number = MAX_REVERIFY_PER_PASS,
  nowIso: string = new Date().toISOString(),
): ShippedChangeRecord[] {
  return rows
    .filter((r) => {
      if (!r.page || (r.after ?? "").trim() === "") return false;
      const canon = canonicalOutcome(r.verifyState);
      if (canon === "verified_live" || canon === "verified_live_modified") return false;
      return retryEligibility(r.verifyState, nowIso);
    })
    .slice() // copy before sort (input is readonly)
    .sort((a, b) => {
      const aa = verifyLastAttemptAt(a.verifyState);
      const bb = verifyLastAttemptAt(b.verifyState);
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    })
    .slice(0, max);
}

/** Fire-and-forget a due-row measurement pass after the response. No-op if throttled or
 *  called outside a request scope. NEVER throws (fail-soft for the render path). */
export function scheduleAutoMeasure(tenantId: string): void {
  if (!tenantId) return;
  const nowMs = Date.now();
  const last = lastRunAt.get(tenantId) ?? 0;
  if (nowMs - last < MIN_GAP_MS) return; // collapse rapid renders (one pass per window)
  try {
    after(async () => {
      try {
        // P0-B W1: this pass rides a page GET's after(); it must spend nothing.
        // Bounded (PER_RUN_CAP) GSC-only re-measure, zero paid live-SERP calls.
        const res = await autoMeasureDuePass(tenantId, { maxRecords: PER_RUN_CAP, allowPaidRankRecheck: false });
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
        // after() window, so the next normal render is both instant and current.
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
        // P1-2b (2026-07-09): re-verify up to MAX_REVERIFY_PER_PASS rows still
        // un-confirmed live (never verified, or a prior crawl_failed /
        // not_found - a transient network blip or a page that had not
        // propagated at ship time) so they get a fresh crawl-verify on this
        // /results open. Isolated + fail-soft; never downgrades a confirmed
        // verified_live (markVerifyResultById is a monotonic latch). Rides the
        // same throttle as the measure pass above.
        try {
          // F3: tenant-EXPLICIT read - this after() callback runs outside the
          // render's tenant scope, so an ambient read could resolve the wrong
          // (or an empty) tenant and re-verify another tenant's rows.
          const rows = await loadShippedChangesForTenant(tenantId);
          const toReverify = selectRowsToReverify(rows, MAX_REVERIFY_PER_PASS);
          for (const record of toReverify) {
            try {
              await verifyShippedChange({ tenantId, record });
            } catch (e) {
              log.warn("[auto-measure-on-use] re-verify failed (non-blocking)", {
                tenantId,
                id: record.id,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        } catch (e) {
          log.warn("[auto-measure-on-use] re-verify pass failed (non-blocking)", {
            tenantId,
            error: e instanceof Error ? e.message : String(e),
          });
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
    // A failed after() registration did no work and must not suppress the next
    // legitimate request for ten minutes.
    lastRunAt.set(tenantId, nowMs);
  } catch {
    // after() is only valid inside a request scope — ignore outside one.
  }
}
