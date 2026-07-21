import "server-only";

/**
 * 2026-06-16 (collapsed 2026-07-21, CORE 100K Lane D): resolve the
 * deterministic QA verdict for ONE persisted edit, server-side.
 *
 * The armed one-click publish action (`stageChangeForRecord`) needs the rec's
 * QA verdict at PUSH time as defense-in-depth: the card already gates which
 * CTA it shows, but the server must independently confirm the rec is
 * approved + paste-ready before routing a click to a LIVE write (a stale page
 * could otherwise post a since-downgraded rec).
 *
 * The old implementation rebuilt the ENTIRE /recommendations action-row table
 * (`buildRecommendationActionRows`, deleted with that page) just to read one
 * row's `detail.qaVerdict`. This version assembles only what
 * `buildRecommendationQaVerdict` actually reads for the matching edit and
 * returns the same `{ detail: { qaVerdict } }` shape the push gate consumes.
 * The null cases mirror the rows the old table never emitted (the gate then
 * stays lenient, exactly as before): a dismissed rec, a deferred-active rec,
 * a dismissed / not-found edit, an answer-side FAQ edit, and an orphan FAQ
 * question. `affectedPromptTexts` is intentionally empty: this caller never
 * had a prompt-text lookup, and prompt texts only prettify titles, never the
 * verdict's `approve` / `pushReadiness` (the only fields the publish gate
 * reads).
 */

import { loadPersistedRecommendationQueueForPage } from "./load-queue";
import { NEEDS_NEW_PAGE, type RecommendationMotive } from "./resolved-types";
import { shouldExcludeFromCompetitorRanking } from "./entity-pollution-filter";
import {
  buildAeoEvidenceLines,
  buildClarityEvidenceLines,
  buildGscEvidenceLines,
} from "@/domains/recommendation-intelligence/evidence-summary";
import { pageNameFromUrl } from "./recommendation-title-humanizer";
import { extractElementKeyHashSuffix } from "./element-key";
import { actionRowTypeForEdit } from "./recommendation-action-rows";
import {
  buildRecommendationQaVerdict,
  type RecQaVerdict,
} from "./recommendation-qa";

/** The slice of a row the push gate reads: only the QA verdict. */
export type ActionRowQaResult = {
  readonly detail: { readonly qaVerdict: RecQaVerdict };
};

/** Mirrors the deleted row builder's motive map (drives the QA's whyExists). */
const MOTIVE_LABEL: Record<RecommendationMotive, string> = {
  counter_competitor: "A competitor is currently winning this answer.",
  capture_absent_cluster: "AI isn't citing your site for this topic yet.",
  improve_close_prompt: "Your site is close, but the page needs more coverage.",
  defend_winning_cluster:
    "Your site is currently the primary answer, keep it that way.",
  resolve_cannibalization:
    "Multiple of your pages compete for the same answer.",
  improve_citation_depth:
    "Your site is cited but ranks low, strengthen the page.",
};

/**
 * Drop a target URL into a clean operator-facing label ("Homepage" /
 * "Palo Alto page" / "New page"). Feeds the QA's topic-fit page title and
 * whyExists fallback, same as the deleted table did.
 */
function targetLabelForUrl(url: string | null): string {
  if (!url || url === NEEDS_NEW_PAGE) return "New page";
  const phrase = pageNameFromUrl(url);
  if (phrase === "homepage") return "Homepage";
  if (phrase === "target page") return "Target page";
  return `${phrase} page`;
}

export async function loadActionRowByEditId(
  tenantId: string,
  editId: string,
): Promise<ActionRowQaResult | null> {
  const persisted = await loadPersistedRecommendationQueueForPage({ tenantId });

  // Tenant city vocabulary feeds the intent-fit gate's locale detection.
  let knownCities: string[] | undefined;
  try {
    const { getBusinessConfigForCurrentTenant } = await import(
      "@/lib/business-config"
    );
    const cfg = await getBusinessConfigForCurrentTenant();
    knownCities = cfg.locations;
  } catch {
    knownCities = undefined;
  }

  const now = Date.now();
  for (const item of persisted.queue) {
    const edit = item.edits.find((e) => e.id === editId);
    if (!edit) continue;
    const { rec, response, edits } = item;

    // Suppression parity with the deleted table: these recs emitted no rows,
    // so the lookup returned null and the push gate stayed lenient.
    const responseStatus = response?.status ?? null;
    if (responseStatus === "dismissed") return null;
    if (responseStatus === "deferred") {
      const deferUntil = response?.deferUntil
        ? new Date(response.deferUntil).getTime()
        : null;
      if (deferUntil != null && deferUntil > now) return null;
    }
    const lifecycle = edit.implementation_status ?? "recommended";
    if (lifecycle === "dismissed" || lifecycle === "not_found_after_7d") {
      return null;
    }

    // FAQ pairing parity: answer-side edits never had their own row, and a
    // question without its paired answer was suppressed as an orphan.
    const elementKey = edit.target_element_key ?? "";
    if (elementKey.startsWith("faq_answer[new]:")) return null;
    let measurementPlan = edit.measurement_plan;
    if (elementKey.startsWith("faq_question[new]:")) {
      const hash = extractElementKeyHashSuffix(elementKey);
      const answer = hash
        ? edits.find((e) => {
            const s = e.implementation_status ?? "recommended";
            return (
              s !== "dismissed" &&
              s !== "not_found_after_7d" &&
              (e.target_element_key ?? "").startsWith("faq_answer[new]:") &&
              extractElementKeyHashSuffix(e.target_element_key) === hash
            );
          })
        : undefined;
      if (!answer) return null;
      measurementPlan = edit.measurement_plan ?? answer.measurement_plan;
    }

    const resolution = rec.resolution ?? null;
    const resolvedUrl =
      resolution?.targetUrl && resolution.targetUrl !== NEEDS_NEW_PAGE
        ? resolution.targetUrl
        : null;
    const editAnchorUrl =
      typeof edit.target_url === "string" &&
      edit.target_url.length > 0 &&
      edit.target_url !== NEEDS_NEW_PAGE
        ? edit.target_url
        : null;
    const targetUrl = editAnchorUrl ?? resolvedUrl;

    // Top REAL competitor (filtered through the entity-pollution filter),
    // same computation the deleted table ran per rec.
    const topCompetitor = (() => {
      const c = rec.evidence.primaryCompetitors.find(
        (cc) =>
          cc &&
          typeof cc.name === "string" &&
          cc.name.trim().length > 0 &&
          !shouldExcludeFromCompetitorRanking(cc.name),
      );
      if (!c || c.totalAffectedPrompts === 0) return null;
      const pct = Math.round(
        (c.promptsWherePrimary / c.totalAffectedPrompts) * 100,
      );
      return { name: c.name, primaryPct: pct };
    })();

    const qaVerdict = buildRecommendationQaVerdict({
      row: {
        actionType: actionRowTypeForEdit(edit.action_type),
        targetLabel: targetLabelForUrl(targetUrl),
        targetUrl,
        detail: {
          proposedText: edit.proposed_text,
          motiveLabel: resolution?.motive
            ? MOTIVE_LABEL[resolution.motive] ?? null
            : null,
          measurementPlan,
          observationCount: rec.evidence.observationCount,
          topCompetitor,
          gscEvidenceLines: buildGscEvidenceLines(rec.gscSignal),
          clarityEvidenceLines: buildClarityEvidenceLines(rec.claritySignal),
          aeoEvidenceLines: buildAeoEvidenceLines([
            ...(resolution?.evidenceRefs ?? []),
            ...edits.flatMap((e) => e.evidence ?? []),
          ]),
        },
      },
      affectedPromptTexts: [],
      localeTerms: knownCities,
      preferredTopicFit: resolution?.topicFit ?? null,
      // Normalized evidence receipt, same floors the deleted table applied:
      // page-level GSC demand counts as core evidence only at the documented
      // 200-impression floor; aeo / competitor are read from the row detail.
      evidence: {
        gscDemand: (rec.gscSignal?.impressions90d ?? 0) >= 200,
        ga4Traffic: false,
        clarity: rec.claritySignal != null,
        aeo: false,
        competitor: false,
      },
    });

    return { detail: { qaVerdict } };
  }
  return null;
}
