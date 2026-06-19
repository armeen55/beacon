/**
 * Page Surgeon — ATOMIC CHANGE PACK (the diagnostics→product bridge object).
 *
 * One reusable, serializable object that carries everything a reviewer needs to
 * decide on a page's plan: the primary change, supporting + deferred changes,
 * the evidence receipt + source coverage, the auto-QA verdict, the persisted
 * review decision, the per-artifact measurement / rollback / pushability, and
 * (optionally) the append-only history. It composes the existing pieces — it does
 * not re-decide anything; the deterministic gate remains the sole authority.
 *
 * PURE. No I/O — callers assemble the inputs (see bridge.ts for the loader).
 */

import type { EvidencePacket } from "./contract";
import type { ArtifactBundle, ChangeArtifact } from "./artifact-bundle";
import type { QaVerdict } from "./artifact-qa";
import type { PageAtomicDecision, SourceCoverage } from "./page-decision";
import type { BriefHistoryEntry } from "./brief-store";
import type { ReviewDecisionRow } from "./review-store";

/** How (if at all) a single artifact can actually be applied to the live site. */
export type PushMethod =
  | "wix_cms_field" // a mapped Wix CMS SEO field (title/meta/h1/schema) — automatable
  | "manual_cms_edit" // a real change, but no automated write path → operator edits the CMS
  | "no_write_path" // content-body change (answer block/FAQ/section) — no automated writer exists yet
  | "not_applicable" // e.g. image_alt with no crawled image data
  | "blocked_no_mapping"; // the site/page has no Wix mapping at all

export type ArtifactPushability = {
  action: ChangeArtifact["action"];
  method: PushMethod;
  /** Could a one-click push apply this today (mapping + field + within limits)? */
  canAutoApply: boolean;
  /** Is the exact field/element this targets known? */
  fieldTargetKnown: boolean;
  /** Does this artifact have a REAL rollback (exact prior value, or a reversible
   *  add/remove)? false ⇒ rollback is unknown/fake — surface it, don't pretend. */
  rollbackReady: boolean;
  /** Plain-English reason for the method/blocked state. */
  reason: string;
};

export type AtomicChangePack = {
  tenantId: string;
  pageUrl: string;
  canonUrl: string;
  headlineAction: PageAtomicDecision["recommended_atomic_action"];
  confidence: PageAtomicDecision["confidence"];
  decidedBy: PageAtomicDecision["decided_by"];
  operatorInsight: string;
  evidenceHash: string;
  /** When the underlying brief was generated (ISO), if known. */
  generatedAt: string | null;
  /** Composed, finished artifacts (primary + supporting + deferred). */
  bundle: ArtifactBundle;
  /** Auto-QA verdict (pass/score/failures/fact-check). */
  qa: QaVerdict;
  /** What evidence was actually used vs connected-but-empty vs absent. */
  sourceCoverage: SourceCoverage[];
  /** Per-artifact pushability + rollback readiness (primary first, then supporting). */
  pushability: ArtifactPushability[];
  /** Pack-level: can ANY change be auto-applied today? */
  anyAutoApplicable: boolean;
  /** Human-readable blockers to live publish (empty ⇒ at least one path is ready). */
  publishBlockers: string[];
  /** The operator's latest persisted review verdict for this page, if any. */
  reviewDecision: ReviewDecisionRow | null;
  /** Append-only change history (newest first); [] when not loaded. */
  history: BriefHistoryEntry[];
};

/** Result of resolving a recommendation's target URL to Page Surgeon output.
 *  Lives here (pure module) so client components can import the type without
 *  pulling in the server-only bridge loader. */
export type PageSurgeonForUrl =
  | { status: "pack"; pack: AtomicChangePack }
  | {
      // The page has real evidence but no Page Surgeon brief has been run yet.
      status: "evidence_only";
      canonUrl: string;
      pageUrl: string;
      hasGsc: boolean;
      sourceCoverage: SourceCoverage[];
    }
  | { status: "no_page" }; // no snapshot / demand maps to this URL

const CMS_FIELD_ACTIONS = new Set<ChangeArtifact["action"]>(["title", "meta", "h1", "schema"]);
const CONTENT_BODY_ACTIONS = new Set<ChangeArtifact["action"]>([
  "intro_answer_block", "faq", "section_add", "section_remove", "section_reorder",
]);

/** Classify a single composed artifact: can the product apply it, and is its
 *  rollback real? Pure — derived from the artifact + the packet's publish channel. */
export function classifyArtifactPushability(
  a: ChangeArtifact,
  packet: EvidencePacket,
): ArtifactPushability {
  const mapped = packet.current.cmsFieldMapped; // true ⇒ wix_cms channel + field map
  const channel = packet.current.publishChannel;

  if (a.action === "image_alt") {
    return { action: a.action, method: "not_applicable", canAutoApply: false, fieldTargetKnown: false, rollbackReady: false, reason: "No crawled image/alt data — not applicable." };
  }

  if (CMS_FIELD_ACTIONS.has(a.action)) {
    const fieldTargetKnown = a.cmsField != null || a.action === "schema";
    if (!mapped) {
      return { action: a.action, method: "blocked_no_mapping", canAutoApply: false, fieldTargetKnown, rollbackReady: a.before != null, reason: `No Wix CMS mapping for this page (channel: ${channel}) — connect + map the collection to enable a field push.` };
    }
    const withinLimit = a.cmsField ? a.cmsField.withinLimit : true;
    const canAutoApply = fieldTargetKnown && withinLimit;
    // A field change has a REAL rollback only when we know the exact prior value.
    const rollbackReady = a.before != null && a.before.trim().length > 0;
    return {
      action: a.action,
      method: "wix_cms_field",
      canAutoApply,
      fieldTargetKnown,
      rollbackReady,
      reason: canAutoApply
        ? rollbackReady
          ? "Mapped Wix CMS field — one-click pushable; exact prior value captured for rollback."
          : "Mapped Wix CMS field — pushable, but the exact current value isn't captured, so rollback would be best-effort."
        : !withinLimit
          ? "Copy exceeds the CMS field limit — trim before it can be pushed."
          : "Field target not resolved — needs a mapping.",
    };
  }

  if (CONTENT_BODY_ACTIONS.has(a.action)) {
    // Reversibility: an ADD is undone by removing it; a remove/reorder by restoring.
    const rollbackReady = true;
    return { action: a.action, method: "no_write_path", canAutoApply: false, fieldTargetKnown: false, rollbackReady, reason: "Body-content change (answer block / FAQ / section) — no automated CMS writer exists yet; apply manually in the CMS. Reversible (add can be removed)." };
  }

  // internal_link, citation_source, ux_cta_fix, create_new_page → manual / out-of-band.
  return { action: a.action, method: "manual_cms_edit", canAutoApply: false, fieldTargetKnown: false, rollbackReady: a.before != null, reason: "No automated write path for this change type — apply manually." };
}

export type BuildChangePackInput = {
  tenantId: string;
  canonUrl: string;
  decision: PageAtomicDecision;
  packet: EvidencePacket;
  bundle: ArtifactBundle;
  qa: QaVerdict;
  evidenceHash: string;
  generatedAt?: string | null;
  reviewDecision?: ReviewDecisionRow | null;
  history?: BriefHistoryEntry[];
};

/** Assemble the pack from already-composed pieces. Pure. */
export function buildAtomicChangePack(input: BuildChangePackInput): AtomicChangePack {
  const { bundle, packet } = input;
  const artifacts: ChangeArtifact[] = [bundle.primary, ...bundle.supporting].filter(
    (c): c is ChangeArtifact => c != null,
  );
  const pushability = artifacts.map((a) => classifyArtifactPushability(a, packet));

  const anyAutoApplicable = pushability.some((p) => p.canAutoApply);
  const publishBlockers: string[] = [];
  if (artifacts.length === 0) {
    publishBlockers.push("No change to publish (keep_current / needs-review).");
  } else if (!anyAutoApplicable) {
    // Summarize WHY nothing is one-click pushable.
    const reasons = new Set(pushability.map((p) => p.reason));
    for (const r of reasons) publishBlockers.push(r);
  }
  if (!input.qa.pass) publishBlockers.push(`Auto-QA withheld this plan (${input.qa.failures.join("; ")}).`);
  if (input.qa.factCheckRequired) publishBlockers.push("Fact-check required before publishing (claims not grounded in the crawled page).");

  return {
    tenantId: input.tenantId,
    pageUrl: packet.current.pageUrl,
    canonUrl: input.canonUrl,
    headlineAction: input.decision.recommended_atomic_action,
    confidence: input.decision.confidence,
    decidedBy: input.decision.decided_by,
    operatorInsight: input.decision.operator_insight,
    evidenceHash: input.evidenceHash,
    generatedAt: input.generatedAt ?? null,
    bundle,
    qa: input.qa,
    sourceCoverage: input.decision.source_coverage,
    pushability,
    anyAutoApplicable,
    publishBlockers,
    reviewDecision: input.reviewDecision ?? null,
    history: input.history ?? [],
  };
}
