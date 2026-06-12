/**
 * forecast-for-recommended-edit — the bridge from a recommended Move to its
 * causal self-forecast (2026-06-11 day shift).
 *
 * A recommended edit is keyed by (action_type, target_url); the Proof Engine
 * keys its persisted outcomes by (primary_bucket, url_type). This bridges
 * them through the canonical, already-grounded path:
 *
 *     action_type → ACTION_TYPE_REGISTRY[action_type].signalType / .changelogAssetType
 *                 → deriveTaxonomyTarget(signalType, assetType, target_url)
 *                 → { primary_bucket, url_type }
 *                 → loadCausalSelfForecast(...)
 *
 * Using `deriveTaxonomyTarget` (the SAME helper the changelog classifier uses
 * to label a SHIPPED edit) guarantees the forecast's reference class is the
 * exact bucket/url_type the edit's own outcome will later be filed under —
 * no drift between "what we forecast on" and "what we prove on".
 *
 * The registry's signalType↔action_type contract is the documented source of
 * truth (action-types.ts: "Maps 1:1 to the existing SignalType enum used on
 * changelog_entries.signal_type"; the Accept path resolves a shipped edit's
 * signal_type from exactly this field).
 *
 * Pure target-resolver + a thin async loader (delegates I/O to the forecast
 * loader's injectable deps). No LLM, no paid API. Pinned by the test beside it.
 */

import {
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "@/domains/recommendations/action-types";
import { deriveTaxonomyTarget } from "./changelog-classifier";
import {
  loadCausalSelfForecast,
  type CausalSelfForecast,
  type CausalSelfForecastDeps,
} from "./causal-self-forecast";

export type ForecastableEdit = {
  action_type: ActionType;
  target_url: string | null;
};

/**
 * Resolve the forecast reference-class key for a proposed edit, or null when
 * the action type can't carry a URL-level causal forecast. Only change-layer
 * edits qualify — offsite / infra / noise actions never produce `computed`
 * outcomes, so a forecast for them would always be an empty reference class.
 */
export function forecastTargetForActionType(
  actionType: ActionType,
  targetUrl: string | null | undefined,
): { primary_bucket: string; url_type: string | null } | null {
  const spec = ACTION_TYPE_REGISTRY[actionType];
  if (!spec) return null;
  const t = deriveTaxonomyTarget(
    spec.signalType,
    spec.changelogAssetType,
    targetUrl,
  );
  if (t.layer !== "change") return null;
  return { primary_bucket: t.primary_bucket, url_type: t.url_type };
}

/**
 * Load the causal self-forecast for a recommended edit, or null when the
 * edit isn't forecastable or the tenant has no causal-grade history for its
 * reference class yet. Tenant-scoped via the forecast loader's default
 * (ambient) store reader; deps stay injectable for tests.
 */
export async function loadForecastForRecommendedEdit(
  edit: ForecastableEdit,
  deps: CausalSelfForecastDeps = {},
): Promise<CausalSelfForecast | null> {
  const target = forecastTargetForActionType(edit.action_type, edit.target_url);
  if (!target) return null;
  return loadCausalSelfForecast(target, deps);
}
