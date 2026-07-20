import "server-only";
import { cache } from "react";

/**
 * Citation Proof window reader (master plan item 5) - the I/O half of the
 * AI-citation verdict lane. Mirrors ga4-window's posture: bounded, tenant-scoped,
 * lean-projection reads; fail-soft (null/empty on any error, so the proof lane
 * degrades to silence, never noise); NO paid calls (both sources are already
 * synced nightly).
 *
 * Two evidence sources, matched to the record's pages by canonical URL
 * (pure matcher in citation-outcome.ts):
 *   - prompt_answer_observations: the native nightly poll (chatgpt/perplexity
 *     plus the item-4 gemini/claude engine rows; per-engine metadata.source
 *     tags all live on the SAME table, so one read covers every engine).
 *     Filtered at the DB to rows that cite the tenant's own site at all
 *     (owned_citation_count > 0) - the only rows that can match a proof page.
 *   - profound_citation_rows: the imported per-URL per-model per-day counts.
 *
 * Every reader is react cache()'d per request (like loadProofLedgerCached), so
 * a ledger measuring N shipped changes with the same ship date shares ONE read
 * per source instead of N.
 *
 * Source-activity honesty: "no citations" is only meaningful when something was
 * actually measuring. The pre/post activity probes are 1-row reads UNFILTERED
 * by owned citations (a poll night with zero wins still counts as measured),
 * so an unmeasured window reads insufficient_data, never a fake loss.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getRepository } from "@/lib/persistence/repositories";
import { log } from "@/lib/logger";
import { addDays, PROOF_WINDOW_DAYS, PROOF_BASELINE_WINDOW_DAYS } from "./measure";
import {
  computeCitationOutcome,
  matchCitationEvents,
  eventsInWindow,
  type CitationOutcome,
  type NativeCitationRow,
  type ImportedCitationRow,
} from "./citation-outcome";

/** Row caps: bounded reads, generous for a 56-day tenant span. */
const MAX_OBSERVATION_ROWS = 6000;
const MAX_IMPORTED_ROWS = 20000;

const dateOnly = (iso: string): string => (iso.length > 10 ? iso.slice(0, 10) : iso);

/** Host-strip a URL/path for control-contamination comparison (same as siblings). */
const stripToPath = (u: string): string =>
  (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");

// ── Cached bounded readers (per request, per tenant [+ since day]) ──────────

/** Native poll rows citing the tenant's own site, observed on/after `sinceDay`.
 *  Lean projection. Fail-soft []. */
const readOwnedCitingObservationsSince = cache(
  async (tenantId: string, sinceDay: string): Promise<NativeCitationRow[]> => {
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select("prompt_id, observed_at, platform, citation_urls")
        .eq("tenant_id", tenantId)
        .gt("owned_citation_count", 0)
        .gte("observed_at", sinceDay)
        .limit(MAX_OBSERVATION_ROWS);
      if (error || !Array.isArray(data)) {
        log.warn("citation-window: native citing-observations read failed; treating as no citations", {
          tenant: tenantId,
          store: "prompt_answer_observations",
          error: error?.message ?? "no rows returned",
        });
        return [];
      }
      return data as unknown as NativeCitationRow[];
    } catch (err) {
      log.warn("citation-window: native citing-observations read threw; treating as no citations", {
        tenant: tenantId,
        store: "prompt_answer_observations",
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
);

/** Imported citation rows on/after `sinceDay`. Lean projection; URL matching
 *  happens in the pure matcher (only the tenant's own proof pages can match,
 *  so competitor-domain rows fall out for free). Fail-soft []. */
const readImportedCitationRowsSince = cache(
  async (tenantId: string, sinceDay: string): Promise<ImportedCitationRow[]> => {
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("profound_citation_rows")
        .select("date, model, url, citation_count")
        .eq("tenant_id", tenantId)
        .gte("date", sinceDay)
        .limit(MAX_IMPORTED_ROWS);
      if (error || !Array.isArray(data)) {
        log.warn("citation-window: imported citation-rows read failed; treating as no citations", {
          tenant: tenantId,
          store: "profound_citation_rows",
          error: error?.message ?? "no rows returned",
        });
        return [];
      }
      return data as unknown as ImportedCitationRow[];
    } catch (err) {
      log.warn("citation-window: imported citation-rows read threw; treating as no citations", {
        tenant: tenantId,
        store: "profound_citation_rows",
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
);

/** 1-row probe: the latest measured day for a source (any page, no owned
 *  filter). Gates how much post window has elapsed. Fail-soft null. */
const readLatestSourceDay = cache(
  async (tenantId: string, table: "prompt_answer_observations" | "profound_citation_rows"): Promise<string | null> => {
    const column = table === "prompt_answer_observations" ? "observed_at" : "date";
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from(table)
        .select(column)
        .eq("tenant_id", tenantId)
        .order(column, { ascending: false })
        .limit(1);
      if (error) {
        log.warn("citation-window: latest-source-day probe failed; treating window as unmeasured", {
          tenant: tenantId,
          store: table,
          error: error.message,
        });
        return null;
      }
      if (!Array.isArray(data) || data.length === 0) return null;
      const v = (data[0] as Record<string, unknown>)[column];
      return typeof v === "string" ? dateOnly(v) : null;
    } catch (err) {
      log.warn("citation-window: latest-source-day probe threw; treating window as unmeasured", {
        tenant: tenantId,
        store: table,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
);

/** 1-row probe: the earliest measured day on/after `sinceDay` for a source
 *  (any page, no owned filter) - the window-activity check. Fail-soft null. */
const readEarliestSourceDaySince = cache(
  async (
    tenantId: string,
    table: "prompt_answer_observations" | "profound_citation_rows",
    sinceDay: string,
  ): Promise<string | null> => {
    const column = table === "prompt_answer_observations" ? "observed_at" : "date";
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from(table)
        .select(column)
        .eq("tenant_id", tenantId)
        .gte(column, sinceDay)
        .order(column, { ascending: true })
        .limit(1);
      if (error) {
        log.warn("citation-window: earliest-source-day probe failed; treating window as unmeasured", {
          tenant: tenantId,
          store: table,
          error: error.message,
        });
        return null;
      }
      if (!Array.isArray(data) || data.length === 0) return null;
      const v = (data[0] as Record<string, unknown>)[column];
      return typeof v === "string" ? dateOnly(v) : null;
    } catch (err) {
      log.warn("citation-window: earliest-source-day probe threw; treating window as unmeasured", {
        tenant: tenantId,
        store: table,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
);

/** Tracked-question text per prompt id ("the questions I check"). Repository
 *  read (handles the account-slug mapping + file fallback). Fail-soft empty. */
const readPromptTextById = cache(async (tenantId: string): Promise<Map<string, string>> => {
  try {
    const prompts = await getRepository().forTenant(tenantId).getTrackedPrompts();
    const out = new Map<string, string>();
    for (const p of prompts) {
      if (p.id && typeof p.text === "string" && p.text.trim() !== "") out.set(p.id, p.text.trim());
    }
    return out;
  } catch (err) {
    log.warn("citation-window: tracked-prompt text read failed; question labels unavailable", {
      tenant: tenantId,
      store: "tracked-prompts",
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
});

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Compute the AI-citation outcome for one shipped change: read the pre window
 * (28d before ship) and the elapsed post window (capped at the largest proof
 * window) for the treated page AND its comparison pages, from both citation
 * sources, then run the pure control-adjusted verdict. Fail-soft null.
 *
 * Computed-only, like the GA4 traffic outcome: never persisted, recomputed on
 * every measure so it tracks live citation data. No mutation of the GSC
 * windows/verdict.
 */
export async function computeCitationOutcomeForRecord(args: {
  tenantId: string;
  record: { page: string; controlPages: string[]; shippedAt: string };
  /** Comparison-page paths that are THEMSELVES active treatments (contaminated) -
   *  excluded so the adjustment only subtracts natural drift. */
  excludeControlPaths?: Set<string>;
}): Promise<CitationOutcome | null> {
  const { tenantId, record } = args;
  const exclude = args.excludeControlPaths ?? new Set<string>();
  try {
    const shipDate = dateOnly(record.shippedAt);
    const maxWindow = Math.max(...PROOF_WINDOW_DAYS);
    const preStart = addDays(shipDate, -PROOF_BASELINE_WINDOW_DAYS);

    const [observations, importedRows, promptTextById, latestObs, latestImported, obsPreProbe, importedPreProbe] =
      await Promise.all([
        readOwnedCitingObservationsSince(tenantId, preStart),
        readImportedCitationRowsSince(tenantId, preStart),
        readPromptTextById(tenantId),
        readLatestSourceDay(tenantId, "prompt_answer_observations"),
        readLatestSourceDay(tenantId, "profound_citation_rows"),
        readEarliestSourceDaySince(tenantId, "prompt_answer_observations", preStart),
        readEarliestSourceDaySince(tenantId, "profound_citation_rows", preStart),
      ]);

    // Elapsed post window = ship..latest measured day inclusive, capped at the
    // largest proof window (mirrors the GA4 lane's elapsed math).
    const latestSource =
      latestObs != null && latestImported != null
        ? latestObs > latestImported
          ? latestObs
          : latestImported
        : (latestObs ?? latestImported);
    let elapsed = 0;
    if (latestSource != null && latestSource >= shipDate) {
      const diffDays = Math.round((Date.parse(latestSource) - Date.parse(shipDate)) / 86_400_000);
      elapsed = Math.min(maxWindow, Math.max(0, diffDays) + 1);
    }
    const postEnd = addDays(shipDate, elapsed);

    // Post-window activity probes (only when a post day exists).
    const [obsPostProbe, importedPostProbe] =
      elapsed > 0
        ? await Promise.all([
            readEarliestSourceDaySince(tenantId, "prompt_answer_observations", shipDate),
            readEarliestSourceDaySince(tenantId, "profound_citation_rows", shipDate),
          ])
        : [null, null];

    const controlPages = record.controlPages.filter((cp) => !exclude.has(stripToPath(cp)));
    const pages = [record.page, ...controlPages];
    const eventsByPage = matchCitationEvents({ pages, observations, importedRows, promptTextById });

    const treatedAll = eventsByPage.get(record.page) ?? [];
    const treatedPre = eventsInWindow(treatedAll, preStart, shipDate);
    const treatedPost = eventsInWindow(treatedAll, shipDate, postEnd);
    const controls = controlPages.map((cp) => {
      const all = eventsByPage.get(cp) ?? [];
      return {
        pre: eventsInWindow(all, preStart, shipDate),
        post: eventsInWindow(all, shipDate, postEnd),
      };
    });

    // A window was measured when either source has ANY row in it. Matched
    // events also imply measurement (belt and suspenders when a probe failed).
    const probeActive = (probe: string | null, start: string, end: string): boolean =>
      probe != null && probe >= start && probe < end;
    const sourceActiveInPre =
      probeActive(obsPreProbe, preStart, shipDate) ||
      probeActive(importedPreProbe, preStart, shipDate) ||
      treatedPre.length > 0 ||
      controls.some((c) => c.pre.length > 0);
    const sourceActiveInPost =
      elapsed > 0 &&
      (probeActive(obsPostProbe, shipDate, postEnd) ||
        probeActive(importedPostProbe, shipDate, postEnd) ||
        treatedPost.length > 0 ||
        controls.some((c) => c.post.length > 0));

    return computeCitationOutcome({
      shippedAt: shipDate,
      preWindowDays: PROOF_BASELINE_WINDOW_DAYS,
      postWindowDays: elapsed,
      treatedPre,
      treatedPost,
      controls,
      sourceActiveInPre,
      sourceActiveInPost,
    });
  } catch (err) {
    log.warn("citation-window: citation outcome computation failed; card self-hides", {
      tenant: tenantId,
      page: record.page,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
