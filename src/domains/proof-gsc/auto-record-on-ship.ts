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
} from "./measure-pass";
import {
  loadShippedChanges,
  upsertShippedChange,
} from "./shipped-change-store";
import type { ShippedChangeRecord } from "./shipped-change-store";

/**
 * auto-record-on-ship (CORE 100K) - the Ship to Proof BRIDGE. When a Move with a
 * target URL is accepted from any surface, create the same shipped-change ledger
 * record the manual /results form creates (GSC baseline + comparison pages) so
 * measurement starts automatically.
 *
 * Contract: FAIL-SOFT (never throws) and IDEMPOTENT (deduped on page-path +
 * Pacific ship-date). Comparison pages are the top same-site pages by real GSC
 * demand, excluding the treated page and any page already mid-measurement (a
 * page that is itself changing is not a clean comparison).
 */

const MIN_CONTROLS = 2;
const dateOnly = (iso: string): string => (iso || "").slice(0, 10);

/** Top same-site pages by real GSC demand - the raw comparison-page pool. */
export async function loadControlCandidatesForTenant(tenantId: string, n: number): Promise<string[]> {
  const ctx = await loadPageSurgeonContext(tenantId);
  return topPagesByDemand(ctx, n);
}

export type AutoRecordDeps = {
  captureChangeMeta: typeof captureChangeMeta;
  recordShippedChange: typeof recordShippedChange;
  loadShippedChanges: typeof loadShippedChanges;
  upsertShippedChange: typeof upsertShippedChange;
  loadControlCandidates: (tenantId: string, n: number) => Promise<string[]>;
  shipDate: () => string;
};

const defaultDeps: AutoRecordDeps = {
  captureChangeMeta,
  recordShippedChange,
  loadShippedChanges,
  upsertShippedChange,
  loadControlCandidates: loadControlCandidatesForTenant,
  shipDate: () => dateOnly(defaultPacificShipDate()),
};

export type AutoRecordResult = {
  recorded: boolean;
  /** recorded | no-url | unresolved-url | already-recorded | insufficient-controls | error */
  reason: string;
};

/**
 * Create the proof record for a just-accepted Move. Returns the outcome; NEVER
 * throws. `actionType` is the rec's action_type; `targetQuery` is the demand
 * cluster / top query when known.
 */
export async function autoRecordShippedChangeForRec(
  args: {
    tenantId: string;
    pageUrl: string | null | undefined;
    actionType?: string | null;
    targetQuery?: string | null;
    /** @deprecated ignored; Beacon does not honor a self-reported "it's live". */
    verifiedLive?: boolean;
    notes?: string;
  },
  depsOverride: Partial<AutoRecordDeps> = {},
): Promise<AutoRecordResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const pageUrl = (args.pageUrl ?? "").trim();
  if (!pageUrl) return { recorded: false, reason: "no-url" };

  try {
    const meta = await deps.captureChangeMeta(args.tenantId, pageUrl);
    if (!/^https?:\/\//i.test(meta.canonPage)) return { recorded: false, reason: "unresolved-url" };

    const shipDate = deps.shipDate();
    const existing = await deps.loadShippedChanges();

    // Idempotent: the ledger PK is (page-path, ship-date).
    const existingRow = existing.find((r) => r.path === meta.path && dateOnly(r.shippedAt) === shipDate);
    if (existingRow) return { recorded: false, reason: "already-recorded" };

    // Comparison pages = top same-site pages by demand, excluding the treated page
    // and any page already mid-measurement (a changing page is not a clean control).
    const origin = new URL(meta.canonPage).origin;
    void origin;
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
      notes: args.notes ?? "Auto-recorded from cockpit Ship",
      verifiedLive: false,
    });
    // Flag the page for a fresh crawl so the same Move stops being re-recommended.
    await deps.upsertShippedChange({ ...record, recrawlRequestedAt: new Date().toISOString() });
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
