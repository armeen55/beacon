/**
 * proof-engine — per-tenant causal Proof orchestrator (2026-06-11 day shift).
 *
 * THE ACTIVATION. Ties the fully-built-but-unwired Proof Engine into the
 * live per-tenant flow:
 *
 *   getChangelogEntries (tenant, ambient-routed)
 *     → classifyChangelogEntries  (deterministic, enum-grounded)
 *     → buildUrlCitationHistory   (tenant native-regime series)
 *     → attributeAll              (diff-in-diff vs comparable untreated URLs)
 *     → fromNaturalControlResult  (→ StoredChangeOutcome)
 *     → persistChangeOutcomes     (tenant-scoped store)
 *
 * After this runs, `loadChangeOutcomeById` populates and the customer's
 * causal "Proof" drilldown on /changes/[id] finally renders — the
 * category wedge (the only ROI claim that survives scrutiny) made real
 * for a live tenant. Before this, those calls returned null in
 * production and the surface was dark.
 *
 * Discipline / honesty (grounded; see changelog-classifier.ts header for
 * the ≥5 sources on diff-in-diff + parallel-trends + synthetic control):
 *   - 100% deterministic, NO LLM, NO paid API (rail). The only external
 *     read is the tenant's already-persisted citation history.
 *   - Persists ONLY engine-honest outcomes: `computed` (a real causal
 *     diff-in-diff lift, backed by ≥minControls comparable URLs) and the
 *     `raw`/weak buckets (`weak_estimate` / `no_controls` /
 *     `insufficient_post_data` — treated-only descriptives, explicitly
 *     NOT a causal claim). Ineligible events (wrong layer/scope, no URL,
 *     zero signal) are SKIPPED — never persisted as fake proof.
 *   - Per-tenant by construction (ambient changelog + ambient store);
 *     no hardcoding.
 *
 * I/O lives behind injectable deps so the orchestration is unit-tested
 * with fixtures and never touches the network/disk in tests.
 */

import "server-only";

import { buildUrlCitationHistory } from "@/domains/product/url-citation-history";
import type { UrlCitationHistory } from "@/domains/product/url-citation-history";
import type { ChangelogEntry } from "@/domains/changelog/types";
import {
  attributeAll,
  DEFAULT_CONFIG,
  type NaturalControlResult,
  type ResultStatus,
} from "./natural-controls";
import { CLASSIFIER_VERSION, inferUrlType } from "./change-taxonomy";
import { alignTreatmentDates, type LiveEditLike } from "./align-treatment-dates";
import { classifyChangelogEntries } from "./changelog-classifier";
import {
  fromNaturalControlResult,
  persistChangeOutcomes,
  type StoredChangeOutcome,
} from "./change-outcome-store";

/** Statuses that produce a customer-facing outcome row. `computed` is a
 *  causal claim; the raw buckets (weak_estimate / no_controls /
 *  insufficient_post_data) are honest "still measuring" descriptives;
 *  `insufficient_baseline` is the honest "this eligible change lacks enough
 *  pre-change citation history to measure reliably — future changes will be
 *  measurable" state (carries NO computed/raw block — `buildProofSentence`
 *  renders it from the status alone). Persisting it means every ELIGIBLE
 *  shipped change gets a visible, honest per-change status on its drilldown
 *  instead of a silent empty panel (the common case for a young tenant or a
 *  change shipped before it accrued citation history). Only the
 *  truly-unmeasurable statuses (ineligible_layer/_event, unsupported_scope,
 *  zero_signal) stay skipped. proven-wins + the forecast denominator are
 *  computed-only, so these watching rows never inflate a win or a base
 *  rate. */
const PERSISTABLE_STATUSES: ReadonlySet<ResultStatus> = new Set([
  "computed",
  "weak_estimate",
  "no_controls",
  "insufficient_post_data",
  "insufficient_baseline",
]);

export type ProofEngineDeps = {
  loadChangelog?: () => Promise<ReadonlyArray<ChangelogEntry & { archived?: boolean }>>;
  /** Tenant's recommended_edits rows — only the live-state slice is read
   *  (audit fix #26: treatment dates realign to `live_at`). */
  loadEdits?: () => Promise<ReadonlyArray<LiveEditLike>>;
  loadHistory?: () => Promise<UrlCitationHistory>;
  persist?: (outcomes: StoredChangeOutcome[]) => Promise<void>;
  /** Test clock; defaults to the history's last date inside the engine. */
  today?: string;
};

export type ProofEngineRunResult = {
  tenant_id: string;
  events_classified: number;
  eligible_attempted: number;
  computed: number;
  weak: number;
  /** Eligible changes persisted as honest "not enough baseline yet"
   *  (insufficient_baseline) — visible on the drilldown, never a win. */
  watching: number;
  skipped_ineligible: number;
  persisted: number;
  /** Status histogram across ALL attributed events (for honest logging). */
  by_status: Record<string, number>;
};

/**
 * Run the causal Proof Engine for one tenant and persist the customer-
 * facing outcomes. Pure given its deps; the defaults wire the real
 * tenant-scoped sources.
 */
export async function buildAndPersistTenantProof(
  tenantId: string,
  deps: ProofEngineDeps = {},
): Promise<ProofEngineRunResult> {
  // TENANT-SCOPED reads (prod-bug fix, 2026-06-12). The ambient seed-data
  // getChangelogEntries() reads a NON-tenant-scoped repository
  // (getRepository() WITHOUT .forTenant) — on the per-tenant cron it bled
  // the founder tenant's changelog into every other tenant's proof run
  // (Iranopedia, which has 0 changelog rows, classified the founder's 289).
  // Read the changelog through the explicit per-tenant repository. And load
  // the FULL observation set (not the canonical-store's 60-day render
  // window) so changes whose pre/post windows predate the last 60 days
  // still get attributed — without it the engine returned
  // insufficient_baseline for every historical change (computed=0 on prod).
  const loadChangelog =
    deps.loadChangelog ??
    (async () => {
      const { getRepository } = await import("@/lib/persistence/repositories");
      return getRepository().forTenant(tenantId).getChangelogEntries();
    });
  // Audit fix #26 (2026-06-12): treatment dates anchor to the linked
  // edit's `live_at` (when the change actually hit the page), not the
  // changelog's accept-time stamp — see align-treatment-dates.ts. Read
  // through the same explicit per-tenant repository; fail-soft to []
  // (alignment is then a no-op and accept time stays the anchor).
  const loadEdits =
    deps.loadEdits ??
    (async () => {
      try {
        const { getRepository } = await import("@/lib/persistence/repositories");
        return await getRepository().forTenant(tenantId).getRecommendedEdits();
      } catch {
        return [];
      }
    });
  const loadHistory =
    deps.loadHistory ??
    (async () => {
      const { getRepository } = await import("@/lib/persistence/repositories");
      const observations = await getRepository()
        .forTenant(tenantId)
        .getPromptAnswerObservations();
      // Profound → proof bridge (2026-06-13): fuse the operator's paid
      // Profound AI-citation data (owned URLs) as a gap-fill third
      // measurement source — so watch windows measure even while native
      // polling is OpenAI-quota-blocked. Fail-soft [] → native-only.
      let profoundOwnedCitations: Awaited<
        ReturnType<typeof import("./profound-proof-observations").loadProfoundOwnedCitations>
      > = [];
      try {
        const { loadProfoundOwnedCitations } = await import(
          "./profound-proof-observations"
        );
        profoundOwnedCitations = await loadProfoundOwnedCitations(tenantId);
      } catch {
        profoundOwnedCitations = [];
      }
      return buildUrlCitationHistory({
        ownedOnly: true,
        observations,
        profoundOwnedCitations,
      });
    });
  const persist = deps.persist ?? persistChangeOutcomes;

  const entries = alignTreatmentDates(await loadChangelog(), await loadEdits());
  const events = classifyChangelogEntries(entries, tenantId);
  const history = await loadHistory();

  const config = deps.today
    ? { ...DEFAULT_CONFIG, today: deps.today }
    : DEFAULT_CONFIG;
  const results: NaturalControlResult[] = attributeAll(
    events,
    history,
    inferUrlType,
    CLASSIFIER_VERSION,
    config,
  );

  const by_status: Record<string, number> = {};
  let computed = 0;
  let weak = 0;
  let watching = 0;
  const outcomes: StoredChangeOutcome[] = [];
  for (const r of results) {
    by_status[r.status] = (by_status[r.status] ?? 0) + 1;
    if (!PERSISTABLE_STATUSES.has(r.status)) continue;
    if (r.status === "computed") computed++;
    else if (r.status === "insufficient_baseline") watching++;
    else weak++;
    outcomes.push(fromNaturalControlResult(r, history));
  }

  await persist(outcomes);

  return {
    tenant_id: tenantId,
    events_classified: events.length,
    eligible_attempted: results.filter((r) => r.status !== "ineligible_layer" && r.status !== "ineligible_event" && r.status !== "unsupported_scope").length,
    computed,
    weak,
    watching,
    skipped_ineligible: results.length - outcomes.length,
    persisted: outcomes.length,
    by_status,
  };
}
