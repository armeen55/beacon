import "server-only";

import { log } from "@/lib/logger";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  loadPageSurgeonContext,
  topPagesByDemand,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import {
  recordShippedChange,
  captureChangeMeta,
  defaultPacificShipDate,
} from "./run-measurement";
import { loadShippedChanges, upsertShippedChange } from "./shipped-change-store";
import type { ShippedChangeRecord } from "./shipped-change-store";

/**
 * auto-record-on-ship (2026-06-25) — the Ship→Proof BRIDGE.
 *
 * The connectedness audit found the #1 broken link: the cockpit "Ship it" only
 * wrote a recommendation_responses row + revalidated — it created NO measurable
 * proof record, so nothing was ever measured, held, or learned from. This closes
 * that: when a Move with a target URL is accepted from ANY surface, we also create
 * the same shipped_changes ledger record the manual /proof form creates (GSC
 * baseline + diff-in-diff controls), so measurement starts automatically.
 *
 * Contract: FAIL-SOFT (never throws — a ship must succeed even if measurement
 * can't start) and IDEMPOTENT (deduped on page-path + Pacific ship-date, so a
 * re-accept or the manual form recording the same change won't double-write).
 * Deps are injectable for tests (no prod write, no GSC read).
 */

const MIN_CONTROLS = 2;
const dateOnly = (iso: string): string => (iso || "").slice(0, 10);

export type AutoRecordDeps = {
  captureChangeMeta: typeof captureChangeMeta;
  recordShippedChange: typeof recordShippedChange;
  loadShippedChanges: typeof loadShippedChanges;
  upsertShippedChange: typeof upsertShippedChange;
  /** Returns up to `n` candidate control URLs (top same-site pages by demand). */
  loadControlCandidates: (tenantId: string, n: number) => Promise<string[]>;
  shipDate: () => string; // Pacific ship date (date-only)
};

const defaultDeps: AutoRecordDeps = {
  captureChangeMeta,
  recordShippedChange,
  loadShippedChanges,
  upsertShippedChange,
  loadControlCandidates: async (tenantId, n) => {
    const ctx = await loadPageSurgeonContext(tenantId);
    return topPagesByDemand(ctx, n);
  },
  shipDate: () => dateOnly(defaultPacificShipDate()),
};

export type AutoRecordResult = {
  recorded: boolean;
  /** machine-readable outcome: recorded | no-url | unresolved-url | already-recorded | insufficient-controls | error */
  reason: string;
};

/**
 * Create the proof record for a just-accepted Move. Returns the outcome; NEVER
 * throws. `actionType` is the rec's action_type (e.g. add_answer_block,
 * edit_title); `targetQuery` is the demand cluster / top query when known.
 */
export async function autoRecordShippedChangeForRec(
  args: { tenantId: string; pageUrl: string | null | undefined; actionType?: string | null; targetQuery?: string | null },
  depsOverride: Partial<AutoRecordDeps> = {},
): Promise<AutoRecordResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const pageUrl = (args.pageUrl ?? "").trim();
  if (!pageUrl) return { recorded: false, reason: "no-url" };

  try {
    const meta = await deps.captureChangeMeta(args.tenantId, pageUrl);
    // GSC windows are keyed by canonical absolute URLs — a bare/unresolved path
    // reads zero clicks and produces a misleading verdict. Skip rather than lie.
    if (!/^https?:\/\//i.test(meta.canonPage)) return { recorded: false, reason: "unresolved-url" };

    const shipDate = deps.shipDate();
    const existing = await deps.loadShippedChanges();

    // Idempotent: the ledger PK is (page-path, ship-date). If this page already has
    // a record for today, do nothing (the manual form or a prior accept got here).
    if (existing.some((r) => r.path === meta.path && dateOnly(r.shippedAt) === shipDate)) {
      return { recorded: false, reason: "already-recorded" };
    }

    // Controls = top same-site pages by demand, excluding the treated page and any
    // page already mid-experiment (a treated control contaminates the diff-in-diff).
    const origin = new URL(meta.canonPage).origin;
    const normPath = (p: string): string => p.replace(/\/+$/, "") || "/";
    const treated = new Set(existing.map((r) => normPath(r.path)));
    const isUntreated = (u: string): boolean => {
      try {
        return !treated.has(normPath(new URL(u).pathname));
      } catch {
        return true;
      }
    };
    const controlPages = (await deps.loadControlCandidates(args.tenantId, 12))
      .map((u) => canonicalizeCitationUrl(u) ?? u)
      .filter((u) => u && u !== meta.canonPage && isUntreated(u))
      .slice(0, 3);

    // No honest diff-in-diff without ≥2 comparable untreated pages — skip (the
    // operator can still record manually once GSC has more pages). Never block ship.
    if (controlPages.length < MIN_CONTROLS) return { recorded: false, reason: "insufficient-controls" };

    const actionType = (args.actionType ?? "").trim() || meta.headlineAction || "change";
    const record: ShippedChangeRecord = await deps.recordShippedChange({
      tenantId: args.tenantId,
      page: meta.canonPage,
      path: meta.path,
      actionType,
      before: (meta.before || "").trim() || null,
      after: (meta.after || "").trim() || null,
      targetQueries: args.targetQuery?.trim() ? [args.targetQuery.trim()] : meta.targetQueries,
      controlPages,
      notes: "Auto-recorded from cockpit Ship",
      verifiedLive: false,
    });
    // Flag the page for a fresh crawl: the snapshot/EvidencePacket must re-read the
    // changed content so the SAME Move stops being re-recommended. The persisted
    // re-crawl rides the scan path (orchestrate-scan → Supabase); this stamps the
    // intent on the record so the scan/measurement layer knows the page changed.
    const stamped: ShippedChangeRecord = { ...record, recrawlRequestedAt: new Date().toISOString() };
    await deps.upsertShippedChange(stamped);
    log.info("[ship->proof] auto-recorded shipped change", {
      tenantId: args.tenantId,
      path: meta.path,
      actionType,
      controls: controlPages.length,
    });
    return { recorded: true, reason: "recorded" };
  } catch (e) {
    log.warn("[ship->proof] auto-record failed (non-blocking)", {
      tenantId: args.tenantId,
      pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
    return { recorded: false, reason: "error" };
  }
}
