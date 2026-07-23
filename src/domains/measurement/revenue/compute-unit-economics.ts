/**
 * Unit-economics revenue producer (2026-07-01, BEACON_500 item 3).
 *
 * Turns REAL measured GA4 traffic into honest per-page per-day dollar rows
 * for the `revenue_facts` table. The math is the operator's own rate applied
 * to measured traffic, nothing else:
 *
 *   kind 'rpm'      -> revenue = sessions / 1000 * rpmUsd        (content sites)
 *   kind 'per_lead' -> revenue = key events * dollarsPerLead     (service sites)
 *
 * Every row this module writes carries source='unit_economics' and
 * basis='your rate x real traffic'. That basis string is the honesty
 * contract: no surface may present these dollars as a measured payout.
 * Measured payouts only ever come from the ad-network slot
 * (src/lib/connectors/adnetwork), which ships dark until connected.
 *
 * `computeUnitEconomicsFacts` is PURE (no I/O) and pinned by
 * tests/domains/measurement/revenue/compute-unit-economics.test.ts.
 * `runRevenueFactsPass` is the nightly service: read GA4 rows for the last
 * 60 days, compute, upsert idempotently (PK tenant/page/day/source), fail
 * soft. Dormant until the operator sets a revenue model in settings.
 */

import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { fetchAdNetworkRevenueForTenant } from "@/lib/connectors/adnetwork/registry";
import { AD_NETWORK_MEASURED_BASIS } from "@/lib/connectors/adnetwork/types";

/** Operator-set unit economics. Revenue attribution is an MVP non-goal; the
 * settings surface that configured this was removed, so no account can set a
 * model and this path stays dormant (kept only for the ad-network read). */
export type RevenueModel = {
  kind: "rpm" | "per_lead";
  rpmUsd?: number;
  dollarsPerLead?: number;
};

export type RevenueSource =
  | "ad_network"
  | "unit_economics"
  | "affiliate"
  | "operator_manual";

/** The honesty label every unit-economics dollar carries. */
export const UNIT_ECONOMICS_BASIS = "your rate x real traffic";

/** The GA4 columns the producer needs, one row per (url, date). */
export type Ga4DailyTrafficRow = {
  /** Full URL or path as stored in ga4_url_traffic. */
  url: string;
  /** YYYY-MM-DD. */
  date: string;
  sessions: number;
  /** GA4 key events (the "conversions" column). */
  conversions: number;
};

/** Shape of one `revenue_facts` row (column-named for the upsert). */
export type RevenueFactRow = {
  tenant_id: string;
  page_path: string;
  day: string;
  source: RevenueSource;
  revenue_usd: number;
  basis: string;
  metadata: Record<string, unknown>;
};

const TABLE = "revenue_facts";
const WINDOW_DAYS = 60;
const READ_PAGE = 1000;
const MAX_READ_ROWS = 80_000;
const UPSERT_CHUNK = 500;

/**
 * Normalize a stored GA4 url (full URL or bare path) to a path with a
 * leading slash, query/hash stripped. Deterministic; never throws.
 */
export function pagePathFromUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (raw === "") return "/";
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname || "/";
  } catch {
    // fall through to the path handling below
  }
  const noQuery = raw.split(/[?#]/, 1)[0] ?? raw;
  if (noQuery === "") return "/";
  return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
}

/** True when the model has a usable positive rate for its kind. */
export function isUsableRevenueModel(model: RevenueModel | undefined): model is RevenueModel {
  if (model == null) return false;
  if (model.kind === "rpm") {
    return typeof model.rpmUsd === "number" && Number.isFinite(model.rpmUsd) && model.rpmUsd > 0;
  }
  if (model.kind === "per_lead") {
    return (
      typeof model.dollarsPerLead === "number" &&
      Number.isFinite(model.dollarsPerLead) &&
      model.dollarsPerLead > 0
    );
  }
  return false;
}

const roundCents = (v: number): number => Math.round(v * 100) / 100;

/**
 * PURE producer: GA4 daily traffic rows x the operator's rate ->
 * revenue_facts rows (source='unit_economics'). Aggregates rows whose urls
 * normalize to the same (page_path, day), rounds to cents, and drops rows
 * that compute to $0 (an absent row means "no estimated dollars", never a
 * fake zero). Output is deterministically sorted by (day, page_path) and
 * each (page_path, day) appears exactly once, so re-running the pass
 * upserts the identical set.
 */
export function computeUnitEconomicsFacts(args: {
  tenantId: string;
  rows: ReadonlyArray<Ga4DailyTrafficRow>;
  model: RevenueModel;
}): RevenueFactRow[] {
  const { tenantId, rows, model } = args;
  if (!isUsableRevenueModel(model)) return [];

  // Aggregate measured traffic per (page_path, day) first, so several stored
  // urls that normalize to one path (query variants etc.) become one fact.
  type Acc = { sessions: number; keyEvents: number };
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    if (!r?.date) continue;
    const day = r.date.slice(0, 10);
    const pagePath = pagePathFromUrl(r.url);
    const key = `${day}\u0000${pagePath}`;
    const acc = byKey.get(key) ?? { sessions: 0, keyEvents: 0 };
    acc.sessions += Number.isFinite(r.sessions) ? r.sessions : 0;
    acc.keyEvents += Number.isFinite(r.conversions) ? r.conversions : 0;
    byKey.set(key, acc);
  }

  const out: RevenueFactRow[] = [];
  for (const [key, acc] of byKey) {
    const [day, pagePath] = key.split("\u0000") as [string, string];
    let revenueUsd: number;
    let metadata: Record<string, unknown>;
    if (model.kind === "rpm") {
      revenueUsd = roundCents((acc.sessions / 1000) * model.rpmUsd!);
      metadata = { sessions: acc.sessions, rpm_usd: model.rpmUsd };
    } else {
      revenueUsd = roundCents(acc.keyEvents * model.dollarsPerLead!);
      metadata = { key_events: acc.keyEvents, dollars_per_lead: model.dollarsPerLead };
    }
    if (revenueUsd <= 0) continue;
    out.push({
      tenant_id: tenantId,
      page_path: pagePath,
      day,
      source: "unit_economics",
      revenue_usd: revenueUsd,
      basis: UNIT_ECONOMICS_BASIS,
      metadata,
    });
  }
  out.sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : a.page_path < b.page_path ? -1 : 1,
  );
  return out;
}

export type RevenueFactsPassResult =
  | { ran: false; reason: "no_revenue_model" | "no_traffic" | "read_failed" | "admin_unavailable" | "persist_failed" }
  | { ran: true; rowsUpserted: number; adNetworkRows: number };

/**
 * Nightly revenue-facts pass for ONE tenant. Idempotent (PK upsert over the
 * last 60 days), dormant until the operator sets a revenue model, fail-soft
 * by contract (returns a discriminated result, never throws on documented
 * paths). Also consults the ad-network slot first; while no network is
 * connected that branch writes nothing.
 */
export async function runRevenueFactsPass(
  tenantId: string,
  now: Date = new Date(),
): Promise<RevenueFactsPassResult> {
  const endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    log.warn("[revenue-facts] Supabase admin unavailable", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ran: false, reason: "admin_unavailable" };
  }

  // Measured slot first: a connected ad network's report is the real thing.
  // Fail-closed today (registry has stubs only), so this writes nothing.
  let adNetworkRows = 0;
  const adReport = await fetchAdNetworkRevenueForTenant({ tenantId, startDate, endDate });
  if (adReport.connected && adReport.rows.length > 0) {
    const measured: RevenueFactRow[] = adReport.rows
      .filter((r) => Number.isFinite(r.revenueUsd) && r.revenueUsd > 0)
      .map((r) => ({
        tenant_id: tenantId,
        page_path: pagePathFromUrl(r.pagePath),
        day: r.day.slice(0, 10),
        source: "ad_network" as const,
        revenue_usd: roundCents(r.revenueUsd),
        basis: AD_NETWORK_MEASURED_BASIS,
        metadata: { provider: adReport.provider, currency: r.currency },
      }));
    const wrote = await upsertFacts(admin, tenantId, measured);
    if (!wrote.ok) return { ran: false, reason: "persist_failed" };
    adNetworkRows = measured.length;
  }

  // Unit economics is dormant: revenue attribution is an MVP non-goal and the
  // canonical BusinessProfile carries no revenue model.
  const model: RevenueModel | undefined = undefined;
  if (!isUsableRevenueModel(model)) {
    if (adNetworkRows > 0) return { ran: true, rowsUpserted: adNetworkRows, adNetworkRows };
    return { ran: false, reason: "no_revenue_model" };
  }

  const rows: Ga4DailyTrafficRow[] = [];
  for (let from = 0; from < MAX_READ_ROWS; from += READ_PAGE) {
    const { data, error } = await admin
      .from("ga4_url_traffic")
      .select("url, date, sessions, conversions")
      .eq("tenant_id", tenantId)
      .gte("date", startDate)
      .order("date")
      .order("url")
      .range(from, from + READ_PAGE - 1);
    if (error) {
      log.warn("[revenue-facts] ga4_url_traffic read failed", {
        tenantId,
        error: error.message,
      });
      return { ran: false, reason: "read_failed" };
    }
    const batch = (data ?? []) as unknown as Ga4DailyTrafficRow[];
    rows.push(...batch);
    if (batch.length < READ_PAGE) break;
  }
  if (rows.length === 0) {
    if (adNetworkRows > 0) return { ran: true, rowsUpserted: adNetworkRows, adNetworkRows };
    return { ran: false, reason: "no_traffic" };
  }

  const facts = computeUnitEconomicsFacts({ tenantId, rows, model });
  const wrote = await upsertFacts(admin, tenantId, facts);
  if (!wrote.ok) return { ran: false, reason: "persist_failed" };
  return { ran: true, rowsUpserted: facts.length + adNetworkRows, adNetworkRows };
}

async function upsertFacts(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
  facts: RevenueFactRow[],
): Promise<{ ok: boolean }> {
  for (let i = 0; i < facts.length; i += UPSERT_CHUNK) {
    const chunk = facts.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from(TABLE)
      .upsert(chunk, { onConflict: "tenant_id,page_path,day,source" });
    if (error) {
      log.warn("[revenue-facts] upsert failed", {
        tenantId,
        rowsAttempted: chunk.length,
        error: error.message,
        code: (error as { code?: unknown }).code,
      });
      return { ok: false };
    }
  }
  return { ok: true };
}

/** Test-only export of internals. */
export const __testing = { TABLE, WINDOW_DAYS, READ_PAGE, MAX_READ_ROWS, UPSERT_CHUNK };
