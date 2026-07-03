/**
 * load-back-of-results (R17b / P2 slice 2) - the I/O edge for the deep-rank
 * demand register.
 *
 * Reuses the SAME per-page GSC signal read every other GSC surface uses (the
 * gsc_page_signals_v1 RPC via loadGscPageSignalsForTenant - exact, bounded,
 * 90-day window) and flattens each page's top queries WITH their page into
 * the register input. Brand tokens come from the configured business
 * identity through the ONE brand classifier. $0 - no new sync, no API call.
 *
 * Honest floor note: the per-page signal keeps each page's top queries by
 * impressions, so the register counts the deep searches Beacon can PROVE,
 * never an extrapolation (same convention as the striking portfolio).
 *
 * ONE NUMBER RULE: the keywords section and the question-universe feed both
 * call THIS loader, so the register can never differ between them.
 * Request-deduped via react cache. Fail-soft: any error returns null (the
 * section self-hides, the universe feed stays empty).
 */

import "server-only";

import { cache } from "react";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { getBusinessConfig } from "@/lib/business-config";
import { log } from "@/lib/logger";
import { brandTokensForConfig } from "./brand-split";
import {
  buildBackOfResultsRegister,
  type BackOfResultsInput,
  type BackOfResultsRegister,
} from "./back-of-results";

/** The per-page signal window (gsc-page-signals.ts WINDOW_DAYS). */
const SIGNAL_WINDOW_DAYS = 90;

export const loadBackOfResultsRegister = cache(
  async (tenantId: string): Promise<BackOfResultsRegister | null> => {
    if (!tenantId) return null;
    try {
      const signals = await loadGscPageSignalsForTenant(tenantId);
      const rows: BackOfResultsInput[] = [];
      for (const signal of signals.values()) {
        for (const q of signal.topQueries) {
          rows.push({
            query: q.query,
            clicks: q.clicks,
            impressions: q.impressions,
            position: q.position,
            page: signal.page,
          });
        }
      }
      let brandTokens: string[] = [];
      try {
        const cfg = getBusinessConfig(tenantId);
        brandTokens = brandTokensForConfig({ name: cfg.name, domain: cfg.domain });
      } catch {
        brandTokens = [];
      }
      return buildBackOfResultsRegister(rows, {
        windowDays: SIGNAL_WINDOW_DAYS,
        brandTokens,
      });
    } catch (e) {
      log.warn("[back-of-results] load failed", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },
);
