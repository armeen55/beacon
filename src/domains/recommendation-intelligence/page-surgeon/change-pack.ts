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
import type { ReviewDecisionRow, ReviewVerdict } from "./review-store";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

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

/** Operator-facing label for an artifact's pushability method (PSQ4 clarity). */
export function pushMethodLabel(m: PushMethod): string {
  switch (m) {
    case "wix_cms_field": return "Wix field ready";
    case "manual_cms_edit": return "Manual CMS edit needed";
    case "no_write_path": return "Blocked: no write path for this change type";
    case "blocked_no_mapping": return "Blocked: no Wix mapping";
    case "not_applicable": return "Not applicable";
  }
}
export function rollbackLabel(rollbackReady: boolean): string {
  return rollbackReady ? "Rollback ready" : "Rollback best-effort";
}

/** Compact per-page Page Surgeon status for the QUEUE (list) surface — derived
 *  from the brief + QA + latest review. `hasPack` is always true here (the loader
 *  only emits summaries for pages that HAVE a brief; absence ⇒ no pack). */
export type PageSurgeonSummary = {
  hasPack: true;
  pageUrl: string;
  /** Path (host-stripped) for matching against a rec's target URL. */
  path: string;
  qaPass: boolean;
  factCheckRequired: boolean;
  headlineAction: PageAtomicDecision["recommended_atomic_action"];
  reviewVerdict: ReviewVerdict | null;
  reviewNote: string | null;
};

/** The four operator queue buckets. A row maps to exactly one. */
export type PageSurgeonBucket = "reviewed" | "ready" | "needs_edit" | "legacy";

/** Classify a queue row by its Page Surgeon summary (undefined ⇒ no pack ⇒ legacy).
 *  Pure — drives the operator tabs + reorder. Precedence: an explicit approve is
 *  "reviewed"; a needs-edit/reject OR a QA-withheld pack is "needs_edit"; a clean
 *  unreviewed pack is "ready"; no pack at all is "legacy". */
export function bucketForSummary(summary: PageSurgeonSummary | undefined): PageSurgeonBucket {
  if (!summary) return "legacy";
  if (summary.reviewVerdict === "approve") return "reviewed";
  if (summary.reviewVerdict === "needs_edit" || summary.reviewVerdict === "reject" || !summary.qaPass) return "needs_edit";
  return "ready";
}

const CMS_FIELD_ACTIONS = new Set<ChangeArtifact["action"]>(["title", "meta", "h1", "schema"]);
const CONTENT_BODY_ACTIONS = new Set<ChangeArtifact["action"]>([
  "intro_answer_block", "faq", "section_add", "section_remove", "section_reorder",
]);
/** Body actions the push layer can now APPLY when the collection's body
 *  field is mapped (BEACON_500 item 2): additive sections only. Removals
 *  and reorders stay manual (Beacon never deletes live content). */
const BODY_PUSHABLE_ACTIONS = new Set<ChangeArtifact["action"]>([
  "intro_answer_block", "faq", "section_add",
]);

/** Honest operator copy for a one-click body-section push. */
export const BODY_PUSH_READY_REASON =
  "I can apply this section for you in Wix; I save the old version first and can restore it in one click.";

/** Classify a single composed artifact: can the product apply it, and is its
 *  rollback real? Pure — derived from the artifact + the packet's publish channel. */
export function classifyArtifactPushability(
  a: ChangeArtifact,
  packet: EvidencePacket,
  opts: { mappingExists?: boolean; bodyFieldMapped?: boolean } = {},
): ArtifactPushability {
  const mapped = packet.current.cmsFieldMapped; // true ⇒ wix_cms channel
  const channel = packet.current.publishChannel;

  if (a.action === "image_alt") {
    return { action: a.action, method: "not_applicable", canAutoApply: false, fieldTargetKnown: false, rollbackReady: false, reason: "No crawled image/alt data; not applicable." };
  }

  if (CMS_FIELD_ACTIONS.has(a.action)) {
    const fieldTargetKnown = a.cmsField != null || a.action === "schema";
    if (!mapped) {
      return { action: a.action, method: "blocked_no_mapping", canAutoApply: false, fieldTargetKnown, rollbackReady: a.before != null, reason: `No Wix CMS mapping for this page (channel: ${channel}). Connect + map the collection to enable a field push.` };
    }
    // On Wix CMS but the specific page has no url-map row → the push layer can't
    // resolve the data item, so it's truly blocked until the collection is synced.
    if (opts.mappingExists === false) {
      return { action: a.action, method: "blocked_no_mapping", canAutoApply: false, fieldTargetKnown, rollbackReady: a.before != null, reason: "On Wix CMS, but this exact page has no url-map entry yet. Sync/map its collection to enable a one-click field push." };
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
          ? "Mapped Wix CMS field: one-click pushable; exact prior value captured for rollback."
          : "Mapped Wix CMS field: pushable, but the exact current value isn't captured, so rollback would be best-effort."
        : !withinLimit
          ? "Copy exceeds the CMS field limit; trim before it can be pushed."
          : "Field target not resolved; needs a mapping.",
    };
  }

  if (CONTENT_BODY_ACTIONS.has(a.action)) {
    // BEACON_500 item 2 (2026-07-01): an ADDITIVE body section on a Wix page
    // whose collection has a mapped body field IS one-click applicable now.
    // The push layer snapshots the full prior body, merges locally (never
    // wiping the original), and can restore the old version in one click.
    if (
      BODY_PUSHABLE_ACTIONS.has(a.action) &&
      mapped &&
      opts.mappingExists !== false &&
      opts.bodyFieldMapped === true
    ) {
      return {
        action: a.action,
        method: "wix_cms_field",
        canAutoApply: true,
        fieldTargetKnown: true,
        rollbackReady: true,
        reason: BODY_PUSH_READY_REASON,
      };
    }
    // Reversibility: an ADD is undone by removing it; a remove/reorder by restoring.
    const rollbackReady = true;
    return { action: a.action, method: "no_write_path", canAutoApply: false, fieldTargetKnown: false, rollbackReady, reason: "Body-content change (answer block / FAQ / section): no automated CMS writer for this page yet; apply manually in the CMS. Reversible (add can be removed)." };
  }

  // internal_link, citation_source, ux_cta_fix, create_new_page → manual / out-of-band.
  return { action: a.action, method: "manual_cms_edit", canAutoApply: false, fieldTargetKnown: false, rollbackReady: a.before != null, reason: "No automated write path for this change type; apply manually." };
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
  /** Whether THIS page has a Wix url-map entry (resolved by the loader). undefined
   *  ⇒ not checked → fall back to the publish-channel inference. */
  mappingExists?: boolean;
  /** Whether this page's collection has an operator-mapped BODY field
   *  (BEACON_500 item 2). true ⇒ additive section drafts are one-click
   *  applicable; undefined/false ⇒ they stay manual (today's behavior). */
  bodyFieldMapped?: boolean;
};

/** Assemble the pack from already-composed pieces. Pure. */
export function buildAtomicChangePack(input: BuildChangePackInput): AtomicChangePack {
  const { bundle, packet } = input;
  const artifacts: ChangeArtifact[] = [bundle.primary, ...bundle.supporting].filter(
    (c): c is ChangeArtifact => c != null,
  );
  const pushability = artifacts
    .map((a) =>
      classifyArtifactPushability(a, packet, {
        mappingExists: input.mappingExists,
        bodyFieldMapped: input.bodyFieldMapped,
      }),
    )
    // Enforce the no-em-dash rule on the displayed pushability reasons (and, via
    // the publishBlockers below, the blocker list) at the read-path chokepoint.
    .map((p) => ({ ...p, reason: stripBannedDashes(p.reason) }));

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
    // Cached LLM free-text: strip banned dashes at read (can't re-run the model here).
    operatorInsight: input.decision.operator_insight
      ? stripBannedDashes(input.decision.operator_insight)
      : input.decision.operator_insight,
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
