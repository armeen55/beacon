/**
 * load-striking-portfolio (R17a / P2 slice 1) - the I/O edge for the
 * striking-distance portfolio headline.
 *
 * Reuses the SAME per-page GSC signal read every other GSC surface uses (the
 * gsc_page_signals_v1 RPC via loadGscPageSignalsForTenant - exact, bounded,
 * 90-day window) and flattens each page's top queries into the portfolio
 * input. Sizing rides the tenant's own CTR curve (R9). Brand tokens come from
 * the configured business identity through the ONE brand classifier.
 *
 * ONE NUMBER RULE: both surfaces that show this portfolio (the keywords hero
 * second line and the Today demand band) call THIS loader, so the count can
 * never differ between them. Request-deduped via react cache.
 *
 * Honest floor note: the per-page signal keeps each page's top queries by
 * impressions, so the portfolio counts the striking searches Beacon can PROVE,
 * never an extrapolation.
 *
 * Fail-soft: any read/config error returns null (the surfaces self-hide).
 */

import "server-only";

import { cache } from "react";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadTenantCtrCurve } from "@/domains/forecast/load-tenant-ctr-curve";
import { getBusinessConfig } from "@/lib/business-config";
import { log } from "@/lib/logger";
import { brandTokensForConfig } from "./brand-split";
import {
  buildStrikingPortfolio,
  type StrikingPortfolio,
  type StrikingQueryInput,
} from "./striking-portfolio";

/** The per-page signal window (gsc-page-signals.ts WINDOW_DAYS). */
const SIGNAL_WINDOW_DAYS = 90;

export const loadStrikingPortfolio = cache(
  async (tenantId: string): Promise<StrikingPortfolio | null> => {
    if (!tenantId) return null;
    try {
      const [signals, curve] = await Promise.all([
        loadGscPageSignalsForTenant(tenantId),
        loadTenantCtrCurve(tenantId).catch(() => null),
      ]);
      const rows: StrikingQueryInput[] = [];
      for (const signal of signals.values()) {
        for (const q of signal.topQueries) {
          rows.push({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position });
        }
      }
      let brandTokens: string[] = [];
      try {
        const cfg = getBusinessConfig(tenantId);
        brandTokens = brandTokensForConfig({ name: cfg.name, domain: cfg.domain });
      } catch {
        brandTokens = [];
      }
      return buildStrikingPortfolio(rows, { windowDays: SIGNAL_WINDOW_DAYS, brandTokens, curve });
    } catch (e) {
      log.warn("[striking-portfolio] load failed", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },
);
