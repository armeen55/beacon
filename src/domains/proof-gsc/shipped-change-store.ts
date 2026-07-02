import "server-only";

/**
 * GSC Proof ledger — durable store for manually-shipped changes (Phase 5, Path B).
 *
 * Mirrors `publishing-mode-store` / `mappings-store` posture EXACTLY:
 *   • Service-role admin client, tenant-scoped on every query (.eq("tenant_id", tid)).
 *   • AMBIENT tenant (currentTenantId()) — same routing as the file fallback (no
 *     explicit-tenant override → no cross-tenant desync).
 *   • FILE FALLBACK so local dev (no Supabase env) AND the pre-migration hosted
 *     window keep working: getSupabaseAdmin() throws → file; PostgREST 42P01
 *     undefined_table → file.
 *   • Fail-soft: reads return [] on any error; never throws into a surface.
 *
 * SEPARATE from the citation proof path (change_outcomes_v2) — its own table, its
 * own enums. Operator substrate (no customer surface writes here).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type {
  GscWindowMetrics,
  GscProofVerdict,
  GscProofConfidence,
  ProofWindowResult,
} from "./measure";
import type { TrafficOutcome } from "./traffic-outcome";
import type { CitationOutcome } from "./citation-outcome";
import type { RankRecheckResult } from "./rank-recheck";
import type { ChangeDollarValue } from "./change-dollar-value";
import type { PermutationRead } from "./permutation-null";
import type { BayesianRead } from "./bayesian-read";
import type { TargetQueryRead } from "./target-query-read";
import type { RankedControl } from "./control-matching";

const TABLE = "shipped_change_proof";
const STORE = "proof-gsc-ledger";

export type ShippedChangeRecord = {
  /** Stable per (page, ship-date). */
  id: string;
  /** Canonical page URL. */
  page: string;
  /** Host-stripped path (display + control matching). */
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  /** ISO timestamp the operator confirmed it shipped live. */
  shippedAt: string;
  /** GSC metrics over the pre-ship window (display snapshot). */
  baseline: GscWindowMetrics & { windowDays: number };
  targetQueries: string[];
  /** Canonical control page URLs for diff-in-diff. */
  controlPages: string[];
  windows: ProofWindowResult[];
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  measuredAt: string | null;
  /** GA4 traffic + conversion outcome (Dollar-ROI, gap #1). COMPUTED at measure
   *  time and recomputed on every load — NOT persisted (no column; recordToRow
   *  omits it), so it stays in lockstep with live GA4 like the GSC verdict. */
  trafficOutcome?: TrafficOutcome | null;
  /** AI-citation outcome (master plan item 5): did AI answers start or stop
   *  citing this page after the ship, adjusted by the comparison pages? Same
   *  computed-only posture as trafficOutcome: NOT persisted (recordToRow
   *  omits it), recomputed on every measure. Populated ONLY for
   *  citation-relevant action types (answer block / FAQ / new page / schema). */
  citationOutcome?: CitationOutcome | null;
  /** Live-SERP rank re-check (BEACON_500 item 19): the literal Google position at
   *  ship vs the freshest cache-busted read, for whichever proof window most
   *  recently fired a re-check. Same computed-only posture as trafficOutcome and
   *  citationOutcome: NOT persisted (recordToRow omits it) - recomputed each
   *  measure pass from serp-history + a bounded, idempotent live re-check. Null
   *  when no target query is known, no window is due, or the live read failed. */
  rankOutcome?: RankRecheckResult | null;
  /** Dollar attribution for this specific shipped change (BEACON_500 item 22):
   *  the operator's own unit-economics rate (item 3) x the extra sessions or
   *  key events THIS change earned, from trafficOutcome. Same computed-only
   *  posture as trafficOutcome/citationOutcome/rankOutcome: NOT persisted
   *  (recordToRow omits it), recomputed on every measure. Null when there is
   *  no traffic outcome yet, or when no revenue model is configured (in which
   *  case the sentence still names the extra visits, in clicks only). */
  dollarValue?: ChangeDollarValue | null;
  /** Permutation-null read (master plan item 37): where the treated lift lands
   *  against every untreated page's same-window pseudo-lift (percentile 0-1,
   *  plus the raw nGreater/nTotal counts the plain-English sentence names).
   *  Same computed-only posture as trafficOutcome/citationOutcome/rankOutcome/
   *  dollarValue: NOT persisted (recordToRow omits it), recomputed on every
   *  measure. Null when fewer than MIN_NULL_PAGES untreated pages were
   *  available (honest skip, never a fabricated percentile off a thin pool). */
  permutationRead?: PermutationRead | null;
  /** Bayesian read (master plan item 67): P(this helped) plus a 90% credible
   *  interval on monthly clicks, computed from the SAME basis window's
   *  treated pre/post metrics. Same computed-only posture as
   *  trafficOutcome/citationOutcome/rankOutcome/dollarValue/permutationRead:
   *  NOT persisted (recordToRow omits it), recomputed on every measure. Never
   *  changes `verdict`/`confidence` - a pure additive quantification layer.
   *  Null for a position-judged change or before any window has closed. */
  bayesianRead?: BayesianRead | null;
  /** Per-target-query diff-in-diff (master plan item 68): CTR + position for
   *  the record's OWN targetQueries (not the page's whole query mix), treated
   *  vs comparison pages, over the same basis window. Same computed-only
   *  posture as the other attachments above: NOT persisted (recordToRow
   *  omits it), recomputed on every measure. Empty array when there are no
   *  target queries, no window has closed, or a query's data is too thin
   *  (< 50 impressions either window) - honest silence, never a fabricated
   *  read off a sliver of data. */
  targetQueryRead?: TargetQueryRead[];
  /** Operator free-text on the shipped change. */
  notes: string | null;
  /** Operator confirmed it's live on the site (manual ship). */
  verifiedLive: boolean;
  /** Optional URL the operator verified it live at. */
  liveSourceUrl: string | null;
  /** ISO timestamp the operator manually requested a Google recrawl/indexing. */
  recrawlRequestedAt: string | null;
  /** BEACON_500 items 33 + 36 (2026-07-02): plain-language receipt lines for any
   *  raw comparison-page candidate the matcher left out at selection time (scale
   *  mismatch, diverging pre-ship trend, or too much shared search demand with
   *  the treated page). Additive, optional (older rows never had a matcher run) -
   *  null means either no candidates were excluded or this row predates item 33.
   *  Set ONCE at selection time in auto-record-on-ship.ts; never rewritten by
   *  re-measurement. */
  controlMatchNotes?: string[] | null;
  /** BEACON_500 item 33 (2026-07-02): true when the matcher had to fall back
   *  to its best-available comparison pages because too few candidates passed
   *  the baseline-scale + pre-ship trend bands (control-matching.ts's
   *  usedFallback). Feeds measurement-maturity.ts's weakComparison input at
   *  read time so the parallel-trends veto can downgrade the presentation.
   *  Additive, optional (older rows never had a matcher run) - undefined/false
   *  reads identically to "not flagged". Set ONCE at selection time; never
   *  rewritten by re-measurement. */
  controlMatchWeak?: boolean;
  /** BEACON_500 N13 (2026-07-03): the FULL ranked comparison-page candidate
   *  list (control-matching.ts's RankedControl[] - kept AND excluded, in
   *  original candidate order, with the matching inputs that produced each
   *  verdict) frozen at THIS ship's selection time. This is the ONLY pool a
   *  later contamination-driven promotion may draw from (control-
   *  contamination.ts's promoteFromFrozenPool) - it is NEVER re-ranked with
   *  post-ship data, because choosing a replacement using information that
   *  arrived after the ship would bias the verdict toward whatever outcome
   *  the replacement happened to show. Null for older rows that predate N13
   *  (no frozen pool exists) or when the matcher itself failed at selection
   *  time (the top-3-by-demand fallback has nothing ranked to freeze). Set
   *  ONCE at selection time; never rewritten by re-measurement. */
  controlDonorPool?: RankedControl[] | null;
  /** Operator override that PINS the learning verdict to "inconclusive",
   *  excluding this change from the per-action_type outcome prior that steers
   *  recommendation ranking. Use when a measured "won"/"lost" is mis-attributed
   *  (control contamination / seasonal co-movement) and would otherwise skew
   *  the prior. Survives re-measurement (applied in measureRecord). null = the
   *  measured verdict stands. */
  operatorVerdictOverride: "inconclusive" | null;
  createdAt: string;
  updatedAt: string;
};

type LedgerRow = {
  tenant_id: string;
  id: string;
  page: string;
  path: string;
  action_type: string;
  before_text: string | null;
  after_text: string | null;
  shipped_at: string;
  baseline: ShippedChangeRecord["baseline"];
  target_queries: string[];
  control_pages: string[];
  windows: ProofWindowResult[];
  verdict: string;
  confidence: string;
  measured_at: string | null;
  notes: string | null;
  verified_live: boolean;
  live_source_url: string | null;
  recrawl_requested_at: string | null;
  /** Additive column (migration 2026-06-23). Optional in the row type so the
   *  store keeps working before the migration is applied. recordToRow emits it
   *  UNCONDITIONALLY (audit-9) — incl. null — so the operator-clearable override
   *  round-trips ("Include again" → null actually clears it post-migration); a
   *  missing column on read/write is tolerated by isUndefinedTableError
   *  (PGRST204) → file fallback. */
  operator_verdict_override?: "inconclusive" | null;
  /** BEACON_500 items 33 + 36 additive column. Optional in the row type (same
   *  posture as operator_verdict_override) so a pre-migration environment keeps
   *  working — a missing column trips PGRST204 -> isUndefinedTableError ->
   *  file fallback, which round-trips this field with no schema at all. */
  control_match_notes?: string[] | null;
  /** Additive column, same posture as control_match_notes. */
  control_match_weak?: boolean | null;
  /** N13 additive column, same posture as control_match_notes/control_match_weak
   *  - a missing column trips PGRST204 -> isUndefinedTableError -> file
   *  fallback, which round-trips this field with no schema at all. */
  control_donor_pool?: RankedControl[] | null;
  created_at: string;
  updated_at: string;
};

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  // Raw Postgres reports 42P01 (undefined table); PostgREST (the supabase-js path)
  // reports PGRST205 ("Could not find the table … in the schema cache") and PGRST204
  // ("Could not find the 'x' column … in the schema cache") when an additive-column
  // migration hasn't been applied yet. Catch all so the file fallback engages and
  // additive-column migrations stay deploy-order-independent like the table itself.
  if (
    typeof e.code === "string" &&
    (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")
  ) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /schema cache|could not find the (table|.*column)/i.test(e.message)
  );
}

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "measuring",
  "won",
  "lost",
  "inconclusive",
  "insufficient_data",
]);
const VALID_CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);
/** Fallback so a legacy/partial row without a baseline can't crash a render. */
const ZERO_BASELINE: ShippedChangeRecord["baseline"] = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
  windowDays: 28,
};

export function recordToRow(tid: string, r: ShippedChangeRecord): LedgerRow {
  return {
    tenant_id: tid,
    id: r.id,
    page: r.page,
    path: r.path,
    action_type: r.actionType,
    before_text: r.before,
    after_text: r.after,
    shipped_at: r.shippedAt,
    baseline: r.baseline,
    target_queries: r.targetQueries,
    control_pages: r.controlPages,
    windows: r.windows,
    verdict: r.verdict,
    confidence: r.confidence,
    measured_at: r.measuredAt,
    notes: r.notes,
    verified_live: r.verifiedLive,
    live_source_url: r.liveSourceUrl,
    recrawl_requested_at: r.recrawlRequestedAt,
    // audit-9: emit UNCONDITIONALLY (like every other nullable column) so a null
    // round-trips. The override is operator-CLEARABLE ("Include again" sets it
    // null) — a conditional emit omitted the column on re-include, and a Supabase
    // upsert leaves omitted columns at their existing value, so the exclusion
    // stuck forever post-migration. Pre-migration the null emit still trips
    // PGRST204 → isUndefinedTableError routes to the full-record file fallback
    // (which clears it correctly), so this is safe before AND after the migration.
    operator_verdict_override: r.operatorVerdictOverride,
    // Additive, write-once at selection time (never operator-cleared like the
    // override above) — emit unconditionally so a null still overwrites a stale
    // value on re-record, same round-trip safety as every other nullable column.
    control_match_notes: r.controlMatchNotes ?? null,
    control_match_weak: r.controlMatchWeak ?? false,
    // N13, write-once at selection time (never rewritten by re-measurement or
    // by the read-time contamination check) - emit unconditionally so a null
    // still overwrites a stale value, same round-trip safety as every other
    // nullable column here.
    control_donor_pool: r.controlDonorPool ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function rowToRecord(row: LedgerRow): ShippedChangeRecord {
  return {
    id: row.id,
    page: row.page,
    path: row.path,
    actionType: row.action_type,
    before: row.before_text ?? null,
    after: row.after_text ?? null,
    shippedAt: row.shipped_at,
    baseline: row.baseline ?? ZERO_BASELINE,
    targetQueries: row.target_queries ?? [],
    controlPages: row.control_pages ?? [],
    windows: row.windows ?? [],
    verdict: (VALID_VERDICTS.has(row.verdict) ? row.verdict : "inconclusive") as GscProofVerdict,
    confidence: (VALID_CONFIDENCES.has(row.confidence)
      ? row.confidence
      : "low") as GscProofConfidence,
    measuredAt: row.measured_at ?? null,
    notes: row.notes ?? null,
    verifiedLive: row.verified_live ?? false,
    liveSourceUrl: row.live_source_url ?? null,
    recrawlRequestedAt: row.recrawl_requested_at ?? null,
    operatorVerdictOverride:
      row.operator_verdict_override === "inconclusive" ? "inconclusive" : null,
    controlMatchNotes: Array.isArray(row.control_match_notes) && row.control_match_notes.length > 0
      ? row.control_match_notes
      : null,
    controlMatchWeak: row.control_match_weak === true,
    controlDonorPool: Array.isArray(row.control_donor_pool) && row.control_donor_pool.length > 0
      ? row.control_donor_pool
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readFile(): Promise<ShippedChangeRecord[]> {
  try {
    return (await readStore<ShippedChangeRecord>(STORE)) ?? [];
  } catch {
    return [];
  }
}

async function writeFile(records: ShippedChangeRecord[]): Promise<void> {
  await writeStore<ShippedChangeRecord>(STORE, records);
}

/** All shipped-change records for the ambient tenant, newest ship first. Fail-soft → []. */
export async function loadShippedChanges(): Promise<ShippedChangeRecord[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return sortNewest(await readFile()); // no env → file
  }
  let tid: string;
  try {
    tid = await currentTenantId();
  } catch {
    return [];
  }
  const { data, error } = await admin.from(TABLE).select("*").eq("tenant_id", tid);
  if (error != null) {
    if (isUndefinedTableError(error)) return sortNewest(await readFile());
    console.error(
      `[shipped-change-store] read failed for ${tid}: ${error.message ?? String(error)}`,
    );
    return [];
  }
  return sortNewest((data as LedgerRow[]).map(rowToRecord));
}

/** Upsert one record (by id) for the ambient tenant. Durable + file mirror. */
export async function upsertShippedChange(record: ShippedChangeRecord): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await upsertFile(record); // no env → file only
    return;
  }
  const tid = await currentTenantId();
  const up = await admin
    .from(TABLE)
    .upsert(recordToRow(tid, record), { onConflict: "tenant_id,id" });
  if (up.error != null) {
    if (isUndefinedTableError(up.error)) {
      // Deploy-order safety net: a missing table/column routes the write to the file
      // mirror so it works pre-migration. BUT on Vercel the file is ephemeral, so if a
      // migration is never applied this silently loses durable writes (it stranded ALL
      // proof-verdict settlement when 2026-06-23_…_operator_verdict_override.sql wasn't
      // applied to beacon-main). WARN loudly so a pending migration is observable, not
      // a silent multi-week data-loss.
      console.warn(
        `[shipped-change-store] DURABLE upsert fell back to file (apply the pending migration): ${
          (up.error as { code?: string }).code ?? "?"
        } ${(up.error as { message?: string }).message ?? String(up.error)}`,
      );
      await upsertFile(record);
      return;
    }
    throw new Error(
      `shipped-change-store: upsert failed for ${tid}: ${up.error.message ?? String(up.error)}`,
    );
  }
  await mirrorFile(record);
}

async function upsertFile(record: ShippedChangeRecord): Promise<void> {
  const rows = await readFile();
  const next = rows.filter((r) => r.id !== record.id);
  next.push(record);
  await writeFile(next);
}

/**
 * Stamp recrawl_requested_at on ONE proof row via a targeted, tenant-EXPLICIT update (no
 * load-all/upsert-all, no ambient-tenant double-source). Operator-attested GSC submission marker —
 * does NOT call Google. Fail-soft on a missing table (pre-migration); throws on a real DB error.
 */
export async function markRecrawlRequestedById(tenantId: string, id: string, atIso: string): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    const rows = await readFile();
    const rec = rows.find((r) => r.id === id);
    if (rec) await upsertFile({ ...rec, recrawlRequestedAt: atIso, updatedAt: new Date().toISOString() });
    return;
  }
  const { error } = await admin
    .from(TABLE)
    .update({ recrawl_requested_at: atIso, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error != null && !isUndefinedTableError(error)) {
    throw new Error(`shipped-change-store: markRecrawlRequestedById failed for ${id}: ${error.message ?? String(error)}`);
  }
}

/**
 * Item 11 (2026-07-02): append ONE additive note line to a proof row. NEVER
 * touches windows, verdict, confidence, or any measurement field - the record
 * is re-persisted as-is with only `notes` extended and `updatedAt` stamped.
 * Used by the revert executor to mark "I put the old version back" on the
 * original row without mutating its measurement history. Fail-soft on a
 * missing row (no-op); ambient-tenant routing like the other helpers here.
 */
export async function appendShippedChangeNote(id: string, note: string): Promise<void> {
  const line = (note ?? "").trim();
  if (line === "") return;
  const records = await loadShippedChanges();
  const rec = records.find((r) => r.id === id);
  if (rec == null) return;
  const notes =
    rec.notes != null && rec.notes.trim() !== "" ? `${rec.notes}\n${line}` : line;
  await upsertShippedChange({ ...rec, notes, updatedAt: new Date().toISOString() });
}

async function mirrorFile(record: ShippedChangeRecord): Promise<void> {
  try {
    await upsertFile(record);
  } catch {
    /* best-effort local parity */
  }
}

function sortNewest(records: ShippedChangeRecord[]): ShippedChangeRecord[] {
  return [...records].sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
}
