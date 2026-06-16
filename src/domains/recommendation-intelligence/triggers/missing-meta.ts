/**
 * 2026-05-19 — Slice 4.5.B.α₀ + α₂.2 trigger predicate:
 * `missing_meta`.
 *
 * Fires when `snapshot.meta_description` is null or whitespace-
 * only AND the URL is an HTML page (not a `.txt` / `.xml` /
 * `.json` / `.pdf` / image / etc. technical asset). Emits an
 * `edit_meta` candidate with `confidence: "high"`.
 *
 * α₂.2 (2026-05-19) added the `isNonHtmlAsset` gate.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { missingMetaCopy, improveMetaCopy } from "../customer-copy-templates";
import { selectMetaSource } from "../draft-enrichment";
import { isNonHtmlAsset } from "../page-classifier";
import { isLikelyEmptyShellSnapshot } from "./empty-shell-snapshot";

export type MissingMetaInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  /**
   * Site-wide chrome detector (2026-06-16) — `buildChromeDetector(...)` from
   * draft-enrichment, built ONCE per tenant by the loader. Threaded in so the
   * trigger's `selectMetaSource` check matches the enrichment composeMeta call
   * EXACTLY (no divergence). Optional: absent → treat nothing as chrome, so
   * the predicate stays pure + testable in isolation (the loader always
   * passes it in production).
   */
  chromeDetector?: (text: string) => boolean;
};

export function missingMeta(
  input: MissingMetaInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, chromeDetector } = input;
  // α₂.2: skip technical assets (`.txt`, `.xml`, images, etc.).
  if (isNonHtmlAsset(snapshot.url)) return [];
  // Skip failed JS-shell captures (title+h1+meta all empty at 200) — but a
  // page with title+h1 present and ONLY meta empty (e.g. koobideh-kabob) is a
  // real gap and still fires.
  if (isLikelyEmptyShellSnapshot(snapshot)) return [];
  const meta = snapshot.meta_description;
  if (meta != null && meta.trim().length > 0) return [];

  // Root-cause-#3 gap (2026-06-16): can the deterministic composeMeta
  // auto-draft a meta from this page? `selectMetaSource` is the EXACT
  // source-selection composeMeta uses; null means there's no liftable prose
  // (list/label-soup, common on Wix). When it CAN draft → emit `edit_meta`
  // exactly as before (a publishable draft, pushable). When it CANNOT →
  // emit a NON-PUSHABLE `improve_meta` DIRECTIVE telling the owner what to
  // write, instead of a blank, render-suppressed `edit_meta` card with a
  // NULL draft.
  const isChrome = chromeDetector ?? (() => false);
  const canAutoDraft = selectMetaSource(snapshot, isChrome) !== null;

  const targetUrl = snapshot.url;
  const topicClusterLabel = "Meta description";
  const operatorEvidenceBase =
    "PageSnapshot.meta_description is " +
    (meta == null ? "null" : "empty / whitespace-only");

  if (canAutoDraft) {
    const actionType = "edit_meta" as const;
    return [
      {
        tenant_id: tenantId,
        trigger_signal: "missing_meta",
        action_type: actionType,
        generator_kind: "deterministic",
        target_url: targetUrl,
        topic_cluster_label: topicClusterLabel,
        evidence: [
          {
            kind: "page_snapshot",
            ref: targetUrl,
            detail: "meta_description field is null or empty",
          },
        ],
        confidence: "high",
        impact_estimate: "medium",
        customer_copy: missingMetaCopy(),
        operator_evidence: operatorEvidenceBase,
        dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
        cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
        created_from_signal_at: snapshot.fetched_at,
        safety_flags: [],
      },
    ];
  }

  // No liftable prose → directive. Keep trigger_signal "missing_meta" (the
  // gap is the same); the action_type flips to the non-pushable directive.
  const actionType = "improve_meta" as const;
  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_meta",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "meta_description is null or empty AND no liftable prose to auto-draft one",
        },
      ],
      confidence: "high",
      impact_estimate: "medium",
      customer_copy: improveMetaCopy(),
      operator_evidence:
        operatorEvidenceBase +
        "; composeMeta cannot auto-draft (selectMetaSource null) — emitting improve_meta directive",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
