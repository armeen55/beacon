/**
 * js-shell-content (2026-07-03, BEACON_500 R19 / N22) - the trigger adapter that
 * turns the pure js-shell heuristic's findings into capped, demand-ranked
 * RecommendationCandidateRow[].
 *
 * PURE. The loader pre-loads the snapshot body signals + GSC demand, runs
 * classifyJsShell per page, and passes the findings here.
 *
 * Uses the `fix_page_experience` action type: a directive-only, generatorActive:
 * false, technical type (no LLM ever drafts a fix, no push route rewrites the
 * page). Emits at `confidence: "low"` so applyQueueRules routes it to
 * `diagnostic_only` - honest, because this is a HEURISTIC (it detects the shell
 * smell, it does not run a headless render), so the operator confirms before
 * acting. Nothing auto-executes.
 *
 * DEMAND-RANKED + CAPPED like buried-page.ts. Byte-identical when nothing smells
 * like a shell. No em or en dashes.
 */

import type { JsShellFinding } from "@/domains/lifecycle/js-shell";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";

export type JsShellContentTriggerInput = {
  tenantId: string;
  findings: ReadonlyArray<JsShellFinding>;
  /** Per-page 90-day impressions (canonical URL key) - the demand-first
   *  ordering only; the classifier already applied its own demand gate. */
  impressionsByUrl: ReadonlyMap<string, number>;
  signalAt: string;
  maxEmissions?: number;
};

/** How many JS-shell cards, at most, per run - highest-demand first. */
export const MAX_JS_SHELL_EMISSIONS = 5;

/**
 * @no-classifier-required: consumes pre-classified findings whose page universe
 * was already assembled from owned, non-asset snapshots in the loader.
 */
export function jsShellContent(
  input: JsShellContentTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, impressionsByUrl, signalAt } = input;
  const max = input.maxEmissions ?? MAX_JS_SHELL_EMISSIONS;
  if (findings.length === 0) return [];

  const ranked = [...findings].sort((a, b) => {
    const ia = impressionsByUrl.get(a.url) ?? 0;
    const ib = impressionsByUrl.get(b.url) ?? 0;
    return ib - ia || a.url.localeCompare(b.url);
  });

  const actionType = "fix_page_experience" as const;
  const topicClusterLabel = "Content only renders with JavaScript";
  const out: RecommendationCandidateRow[] = [];
  for (const f of ranked.slice(0, max)) {
    const targetUrl = f.url;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "js_shell_content",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: f.evidence }],
      confidence: "low",
      impact_estimate: "high",
      customer_copy: f.reason,
      operator_evidence:
        "signal=js_shell_content; url=" +
        f.url +
        "; impressions_90d=" +
        String(impressionsByUrl.get(f.url) ?? 0) +
        "; play=dual_fetch_heuristic; " +
        f.evidence,
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
