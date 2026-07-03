import "server-only";

/**
 * MAX_SEO_AEO audit P0 #6 — Phase 6 (final): the daily GOLDEN PATH composer
 * (gaps #003 / #024 / #403 / #446 / #450).
 *
 * The five pieces of the daily loop — Refresh, Review, Approve, Verify,
 * Learn — each already exist as a built control somewhere on the product.
 * This module COMPOSES them, READ-ONLY, into one coherent cockpit state so
 * the operator can "just open /today and auto-flow": each step carries an
 * honest status + a plain-English `detail`, and `currentStepKey` names the
 * single next thing to do.
 *
 * Hard rules (mirrors readiness.ts / push-receipt.ts posture):
 *   • READ-ONLY: no sync, no push, no verify, no migration, no writes. Every
 *     field is derived from data that already persisted.
 *   • Tenant-scoped: every read is filtered by `tenantId`.
 *   • Soft-fail PER PIECE: a failing read degrades that step to a coherent
 *     status (never the whole state); the function NEVER throws to the page.
 *   • Determinism: `now` is injectable so step freshness is testable.
 *   • White-label + honest: no vendor jargon, no invented numbers; `detail`
 *     says exactly what's true.
 *
 * Which existing piece feeds each step:
 *   refresh — connector connected-state (`hasAnyConnectedDataSource`) +
 *             GSC synced-row freshness (`loadGscReadiness.freshnessDays`),
 *             with a connector `last_synced_at` fallback across real sources.
 *   review  — recommended_edits in `recommended` / `needs_review` (pending a
 *             human look) via the tenant repository.
 *   approve — recommended_edits `accepted` but not yet pushed.
 *   verify  — recommended_edits `pushed` (write landed, not yet confirmed
 *             live), cross-checked against the push ledger.
 *   learn   — causally-proven wins (`loadProvenWins`) — the strongest,
 *             failure-soft proof signal; done when ≥1 proven outcome exists.
 */

import { hasAnyConnectedDataSource, getConnectorInfo } from "@/lib/connector-store";
import { loadGscReadiness } from "@/lib/connectors/gsc/readiness";
import { getRepository } from "@/lib/persistence/repositories";
import {
  editLifecycleStatus,
  type RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import { readPushLedgerForTenant } from "@/domains/push/caps";
import { loadProvenWins } from "@/domains/attribution/load-proven-wins";

export type GoldenPathStepKey =
  | "refresh"
  | "review"
  | "approve"
  | "verify"
  | "learn";

export type GoldenPathStepStatus = "done" | "current" | "upcoming" | "blocked";

export type GoldenPathStep = {
  key: GoldenPathStepKey;
  /** Plain-English step label (the verb of the loop). */
  label: string;
  status: GoldenPathStepStatus;
  /** Honest, plain-English line describing exactly what's true right now. */
  detail: string;
  /** Optional count surfaced on the step (recs to review / approve / verify). */
  count?: number;
};

export type GoldenPathState = {
  steps: GoldenPathStep[];
  /** The first step that is `current` or `blocked` — the daily loop's focus. */
  currentStepKey: GoldenPathStepKey;
  /** True when at least one real data source is connected. */
  connectedAnySource: boolean;
};

/** A data reading is "fresh enough" within this many whole days. */
const FRESH_WITHIN_DAYS = 2;

/** The real read sources whose `last_synced_at` counts as a freshness signal
 *  when GSC has no synced rows to date from. Wix is publish-only. */
const FRESHNESS_FALLBACK_PROVIDERS = [
  "google_ga4",
  "semrush",
  "profound",
  "clarity",
] as const;

const STEP_LABELS: Record<GoldenPathStepKey, string> = {
  refresh: "Refresh",
  review: "Review",
  approve: "Approve",
  verify: "Verify",
  learn: "Learn",
};

/** Whole days (floored, never negative) between an ISO instant and `now`. */
function daysSinceIso(iso: string | null | undefined, now: Date): number | null {
  if (iso == null || iso === "") return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const diff = now.getTime() - then;
  if (diff <= 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

/**
 * Best-available freshness for the tenant, in whole days, or null when we
 * can't prove any data was ever pulled. Prefers GSC synced-row freshness (the
 * most honest "we have data through date X" signal), then falls back to the
 * newest `last_synced_at` across the other real read sources. Soft-fail → null.
 */
async function readFreshnessDays(
  tenantId: string,
  now: Date,
): Promise<number | null> {
  let best: number | null = null;
  try {
    const gsc = await loadGscReadiness(tenantId, now);
    if (gsc.freshnessDays != null) best = gsc.freshnessDays;
  } catch {
    /* soft-fail: fall through to the connector last_synced_at signal */
  }
  for (const provider of FRESHNESS_FALLBACK_PROVIDERS) {
    try {
      const info = await getConnectorInfo(provider, tenantId);
      if (info.status !== "connected") continue;
      const days = daysSinceIso(info.last_synced_at, now);
      if (days != null && (best == null || days < best)) best = days;
    } catch {
      /* soft-fail per provider */
    }
  }
  return best;
}

/** Tenant-scoped recommended edits; soft-fail → []. */
async function readEdits(tenantId: string): Promise<RecommendedEditRow[]> {
  try {
    return await getRepository().forTenant(tenantId).getRecommendedEdits();
  } catch {
    return [];
  }
}

/** Count of pushed edit ids for this tenant in the ledger; soft-fail → empty. */
async function readPushedEditIds(tenantId: string): Promise<Set<string>> {
  try {
    const ledger = await readPushLedgerForTenant(tenantId);
    return new Set(
      ledger
        .filter((e) => e.tenant_id === tenantId && e.result === "pushed")
        .map((e) => e.edit_id),
    );
  } catch {
    return new Set();
  }
}

/** True when ≥1 causally-proven win exists for the tenant; soft-fail → false. */
async function readHasProof(): Promise<boolean> {
  try {
    const wins = await loadProvenWins({ limit: 1 });
    return wins.length > 0;
  } catch {
    return false;
  }
}

/**
 * Compose the READ-ONLY Golden Path state for a tenant. Never throws — every
 * piece soft-fails to a coherent step status, and `currentStepKey` always
 * resolves (defaults to the first step's key when nothing is current/blocked,
 * which only happens when the whole loop is `done`).
 */
export async function loadGoldenPathState(
  tenantId: string,
  now: Date = new Date(),
): Promise<GoldenPathState> {
  // ── Gather (all soft-fail; reads run in parallel for a single round-trip).
  const [connectedAnySource, freshnessDays, edits, pushedEditIds, hasProof] =
    await Promise.all([
      hasAnyConnectedDataSource(tenantId).catch(() => false),
      readFreshnessDays(tenantId, now),
      readEdits(tenantId),
      readPushedEditIds(tenantId),
      readHasProof(),
    ]);

  // ── Derive per-step counts from the lifecycle statuses (read boundary
  // treats undefined as "recommended").
  let reviewCount = 0;
  let approveCount = 0;
  let verifyCount = 0;
  for (const row of edits) {
    const status = editLifecycleStatus(row);
    if (status === "recommended" || status === "needs_review") {
      reviewCount += 1;
    } else if (status === "accepted") {
      approveCount += 1;
    } else if (status === "pushed") {
      // A pushed-but-not-verified_live edit is awaiting live confirmation.
      // Cross-check the ledger so we only count edits the push layer agrees
      // actually landed (defensive: a stray "pushed" status without a ledger
      // entry shouldn't manufacture a verify step).
      if (pushedEditIds.has(row.id)) verifyCount += 1;
    }
  }

  // ── REFRESH.
  const refresh: GoldenPathStep = (() => {
    if (!connectedAnySource) {
      return {
        key: "refresh",
        label: STEP_LABELS.refresh,
        status: "blocked",
        detail: "Connect a data source to begin.",
      };
    }
    if (freshnessDays != null && freshnessDays <= FRESH_WITHIN_DAYS) {
      return {
        key: "refresh",
        label: STEP_LABELS.refresh,
        status: "done",
        detail:
          freshnessDays <= 0
            ? "Your data is up to date."
            : `Your data is current (refreshed ${freshnessDays} day${
                freshnessDays === 1 ? "" : "s"
              } ago).`,
      };
    }
    // Connected but stale or never pulled → the action of the day starts here.
    return {
      key: "refresh",
      label: STEP_LABELS.refresh,
      status: "current",
      detail:
        freshnessDays == null
          ? "Pull your latest data."
          : `Pull your latest data (last refreshed ${freshnessDays} days ago).`,
    };
  })();

  // ── REVIEW.
  const review: GoldenPathStep = {
    key: "review",
    label: STEP_LABELS.review,
    status: reviewCount > 0 ? "current" : "upcoming",
    detail:
      reviewCount > 0
        ? `${reviewCount} recommendation${
            reviewCount === 1 ? "" : "s"
          } to review.`
        : "New recommendations appear here after a refresh.",
    count: reviewCount,
  };

  // ── APPROVE.
  const approve: GoldenPathStep = {
    key: "approve",
    label: STEP_LABELS.approve,
    status: approveCount > 0 ? "current" : "upcoming",
    detail:
      approveCount > 0
        ? `${approveCount} approved, ready to publish.`
        : "Approved changes you publish show up here.",
    count: approveCount,
  };

  // ── VERIFY.
  const verify: GoldenPathStep = {
    key: "verify",
    label: STEP_LABELS.verify,
    status: verifyCount > 0 ? "current" : "upcoming",
    detail:
      verifyCount > 0
        ? `${verifyCount} published, confirming ${
            verifyCount === 1 ? "it's" : "they're"
          } live.`
        : "Published changes confirm live here.",
    count: verifyCount,
  };

  // ── LEARN.
  const learn: GoldenPathStep = {
    key: "learn",
    label: STEP_LABELS.learn,
    status: hasProof ? "done" : "upcoming",
    detail: hasProof
      ? "See what your changes drove."
      : "Results appear after your changes go live.",
  };

  const steps: GoldenPathStep[] = [refresh, review, approve, verify, learn];

  // The daily focus: the first step that is `current` or `blocked`. When the
  // whole loop is settled (nothing current/blocked), default to the first step
  // so the cockpit always has a coherent anchor.
  const focus = steps.find(
    (s) => s.status === "current" || s.status === "blocked",
  );
  const currentStepKey: GoldenPathStepKey = focus?.key ?? steps[0].key;

  return { steps, currentStepKey, connectedAnySource };
}
