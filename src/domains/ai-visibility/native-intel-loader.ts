/**
 * native-intel-loader (2026-07-02, master plan item D1) - the I/O boundary
 * around native-intel.ts. Pages prompt_answer_observations past the 1000-row
 * PostgREST cap (same pattern as answer-drift-loader.ts / second-order-
 * citations.ts / answer-alignment-store.ts), maps rows into
 * NativeObservationInput, and calls the pure report builder.
 *
 * Bounded at MAX_PAGES * PAGE_SIZE = 1000 rows (item spec: "1000-row cap") -
 * this reads the MOST RECENT 1000 rows (ordered observed_at desc) so the
 * report always reflects the freshest poll, never a stale first page.
 *
 * Fail-soft throughout: no Supabase, no tenant domain, or a read error all
 * degrade to an honest empty report - never a thrown error, never fabricated
 * data.
 */

import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { getTenant } from "@/domains/tenants/store";
import { rootDomain } from "@/domains/serp/serp-provider";
import { ENGINE_PLAIN_NAME } from "./engine-types";
import {
  buildNativeIntelReport,
  type NativeIntelReport,
  type NativeObservationInput,
} from "./native-intel";

const PAGE_SIZE = 1000;
/** Item spec: "1000-row cap" on the page read. One page, most-recent-first. */
const ROW_CAP = 1000;

type ObservationRow = {
  prompt_id: string;
  observed_at: string;
  platform: string;
  topic: string | null;
  citation_domains: string[] | null;
  citation_urls: string[] | null;
  tracked_brand_mentioned: boolean | null;
  tracked_brand_cited: boolean | null;
  metadata: Record<string, unknown> | null;
};

const KNOWN_ENGINES = new Set<string>(Object.keys(ENGINE_PLAIN_NAME));

function answerExcerptOf(row: ObservationRow): string {
  const v = row.metadata?.["answer_excerpt"];
  return typeof v === "string" ? v : "";
}

function promptTextOf(row: ObservationRow): string {
  const v = row.metadata?.["prompt_text"];
  return typeof v === "string" && v.trim() ? v : row.prompt_id;
}

/** Paginated, tenant-scoped, most-recent-first read of the columns
 *  native-intel needs. Bounded at ROW_CAP rows total. Fail-soft -> []. */
async function readObservationRows(tenantId: string): Promise<ObservationRow[]> {
  if (!isSupabaseConfigured() || !tenantId) return [];
  const out: ObservationRow[] = [];
  try {
    const sb = getSupabaseAdmin();
    for (let from = 0; from < ROW_CAP; from += PAGE_SIZE) {
      const to = Math.min(from + PAGE_SIZE, ROW_CAP) - 1;
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select(
          "prompt_id, observed_at, platform, topic, citation_domains, citation_urls, tracked_brand_mentioned, tracked_brand_cited, metadata",
        )
        .eq("tenant_id", tenantId)
        .order("observed_at", { ascending: false })
        .range(from, to);
      if (error) {
        log.warn("[native-intel-loader] prompt_answer_observations read failed", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as ObservationRow[];
      out.push(...rows);
      if (rows.length < to - from + 1) break;
    }
  } catch (e) {
    log.warn("[native-intel-loader] prompt_answer_observations read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

function toInput(row: ObservationRow): NativeObservationInput | null {
  if (!row.prompt_id || !row.observed_at || !KNOWN_ENGINES.has(row.platform)) return null;
  return {
    promptId: row.prompt_id,
    promptText: promptTextOf(row),
    engine: row.platform,
    topic: row.topic || null,
    observedAt: row.observed_at,
    answerText: answerExcerptOf(row),
    citationDomains: row.citation_domains ?? [],
    citationUrls: row.citation_urls ?? [],
    trackedBrandMentioned: row.tracked_brand_mentioned,
    trackedBrandCited: row.tracked_brand_cited,
  };
}

const EMPTY_REPORT: NativeIntelReport = {
  recurringDomains: [],
  recurringPages: [],
  presence: { rows: [], totals: { promptsChecked: 0, present: 0, absent: 0 } },
  nativeQuestions: [],
  rowsScanned: 0,
  enginesSeen: [],
};

async function loadUncached(tenantId: string): Promise<NativeIntelReport> {
  if (!tenantId) return EMPTY_REPORT;
  try {
    const [rows, tenant] = await Promise.all([readObservationRows(tenantId), getTenant(tenantId)]);
    if (rows.length === 0) return EMPTY_REPORT;

    const ownedRoot = tenant?.domain ? rootDomain(tenant.domain) : "";
    const brandVariants = [tenant?.business_name, ownedRoot.replace(/\..*$/, "")].filter(
      (v): v is string => typeof v === "string" && v.length >= 2,
    );

    const inputs = rows.map(toInput).filter((r): r is NativeObservationInput => r !== null);
    return buildNativeIntelReport(inputs, { ownedRoot, brandVariants });
  } catch (e) {
    log.warn("[native-intel-loader] load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return EMPTY_REPORT;
  }
}

/** Explicit-tenant native-intel report. $0 - reads only the already-polled
 *  observation rows. Sole live consumer: demand-graph/load-fanout-seeds.ts. */
export async function loadNativeIntelForTenant(tenantId: string): Promise<NativeIntelReport> {
  return loadUncached(tenantId);
}
