import "server-only";

/**
 * 2026-06-09 — Semrush domain report readers (typed + normalized).
 *
 * Maps the raw CSV column codes to Beacon's normalized shapes. Each
 * reader is fail-soft (delegates to `semrushRawFetch`) and pure beyond
 * the single fetch. Column codes per the Semrush Analytics docs:
 *   domain_ranks:           Db,Dn,Rk,Or,Ot,Oc,Ad
 *   domain_organic_organic: Dn,Cr,Np,Or,Ot,Oc
 */

import {
  semrushRawFetch,
  parseSemrushCsv,
  semrushNum,
  type SemrushRawFetchDeps,
} from "./client";
import type {
  SemrushDomainOverview,
  SemrushOrganicCompetitor,
  SemrushFetchResult,
} from "./types";

const OVERVIEW_COLUMNS = "Db,Dn,Rk,Or,Ot,Oc,Ad";
const COMPETITOR_COLUMNS = "Dn,Cr,Np,Or,Ot,Oc";

/**
 * Domain overview (`domain_ranks`) — a single row of headline organic
 * metrics for `domain`. 1 unit-line by design.
 */
export async function fetchDomainOverview(
  args: { tenantId: string; domain: string; database?: string },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushFetchResult<SemrushDomainOverview>> {
  const res = await semrushRawFetch(
    {
      tenantId: args.tenantId,
      type: "domain_ranks",
      domain: args.domain,
      database: args.database,
      exportColumns: OVERVIEW_COLUMNS,
      displayLimit: 1,
    },
    deps,
  );
  if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };

  const rows = parseSemrushCsv(res.csv);
  if (rows.length === 0) return { ok: false, reason: "empty" };
  const r = rows[0]!;
  return {
    ok: true,
    rows: [
      {
        database: r.Db ?? args.database ?? "",
        domain: r.Dn ?? args.domain,
        rank: semrushNum(r.Rk),
        organicKeywords: semrushNum(r.Or),
        organicTraffic: semrushNum(r.Ot),
        organicCostUsd: semrushNum(r.Oc),
        adwordsKeywords: semrushNum(r.Ad),
      },
    ],
  };
}

/**
 * Organic competitors (`domain_organic_organic`) — domains competing
 * with `domain` on organic keywords, ranked by Semrush relevance.
 */
export async function fetchOrganicCompetitors(
  args: {
    tenantId: string;
    domain: string;
    database?: string;
    limit?: number;
  },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushFetchResult<SemrushOrganicCompetitor>> {
  const res = await semrushRawFetch(
    {
      tenantId: args.tenantId,
      type: "domain_organic_organic",
      domain: args.domain,
      database: args.database,
      exportColumns: COMPETITOR_COLUMNS,
      displayLimit: args.limit ?? 10,
    },
    deps,
  );
  if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };

  const rows = parseSemrushCsv(res.csv);
  if (rows.length === 0) return { ok: false, reason: "empty" };
  return {
    ok: true,
    rows: rows
      .map((r) => ({
        domain: r.Dn ?? "",
        competitionLevel: semrushNum(r.Cr),
        commonKeywords: semrushNum(r.Np),
        organicKeywords: semrushNum(r.Or),
        organicTraffic: semrushNum(r.Ot),
      }))
      .filter((c) => c.domain !== ""),
  };
}
