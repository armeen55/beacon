/**
 * load-indexation-sweep (R17c / P2, v1 item 138) - the I/O edge for the
 * budgeted "are your top pages indexed" sweep.
 *
 * Selects the highest-demand owned pages from the SAME per-page GSC signal read
 * every other GSC surface uses (loadGscPageSignalsForTenant, 90-day window, $0)
 * and inspects each one's index state through the SAME bounded adapter the
 * indexability page uses (loadGscSignal - a 24h Supabase-cached URL Inspection
 * call). The batch is capped at GSC_INSPECT_PER_RENDER_LIMIT BEFORE any
 * inspection runs, so the sweep can never exceed the render budget - there is
 * no raw loop and no per-URL fresh fetch past the cap.
 *
 * Fail-soft EVERYWHERE: no signals, no GSC property configured, or a failed
 * inspection returns a sweep with a null line (the surface self-hides). A
 * single URL's inspection failing (adapter null) counts as an INCONCLUSIVE
 * verdict, never as "not indexed" - we only ever report a page as missing when
 * Google explicitly said so.
 *
 * Request-deduped via react cache.
 */

import "server-only";

import { cache } from "react";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGscSignal, GSC_INSPECT_PER_RENDER_LIMIT } from "@/domains/indexability/load-gsc-signal";
import { log } from "@/lib/logger";
import {
  buildIndexationSweep,
  selectIndexationBatch,
  type IndexationCandidate,
  type IndexationSweep,
  type IndexationVerdict,
} from "./indexation-sweep";

export const loadIndexationSweep = cache(
  async (tenantId: string): Promise<IndexationSweep | null> => {
    if (!tenantId) return null;
    try {
      const signals = await loadGscPageSignalsForTenant(tenantId);
      const candidates: IndexationCandidate[] = [];
      for (const s of signals.values()) {
        candidates.push({ page: s.page, impressions90d: s.impressions90d });
      }
      const batch = selectIndexationBatch(candidates, GSC_INSPECT_PER_RENDER_LIMIT);
      if (batch.length === 0) return null;

      // Sequential, budget-bounded inspection. `batch` is already capped at the
      // render budget, so each URL gets ONE bounded (24h-cached) inspection.
      const verdicts: IndexationVerdict[] = [];
      for (const c of batch) {
        let indexed: boolean | null = null;
        try {
          const signal = await loadGscSignal({
            tenantId,
            inspectionUrl: c.page,
            allowFreshFetch: true,
          });
          indexed = signal?.indexed ?? null;
        } catch {
          // An inspection error is inconclusive, never a false "not indexed".
          indexed = null;
        }
        verdicts.push({ page: c.page, indexed });
      }
      return buildIndexationSweep(verdicts);
    } catch (e) {
      log.warn("[gsc-indexation-sweep] load failed (surface self-hides)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },
);
