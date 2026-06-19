/**
 * Page Opportunity Brief (2026-06-17) — the per-page synthesis that turns
 * Beacon from a flat rec list into a review-gated SEO/AEO operator's brief:
 * "here is ONE page, here is everything we know about it across sources, here
 * is the edit-vs-create call, and here are the FEW atomic changes worth making
 * — each with evidence, hypothesis, risk, before/after, pushability, and a
 * measurement plan."
 *
 * PURE / deterministic / no I/O. The caller (a loader) assembles the evidence
 * receipt from the live per-page signals (GSC/GA4/Clarity/SEMrush/AI-answers)
 * and the already-built atomic rec rows for the URL; this module composes them
 * into the brief. It REUSES the trust-audit machinery — `deriveRecQaDisplay`
 * (pushability + actionable + status), the row's QA verdict (evidence receipt,
 * hypothesis, risk), and the capped `derivedConfidence` — so the brief inherits
 * every honesty guarantee already pinned. No hardcoded vertical/keyword/brand
 * rules.
 *
 * Pinned by tests/domains/recommendations/page-opportunity-brief.test.ts.
 */

import type {
  ActionRowType,
  RecommendationActionRow,
} from "./recommendation-action-rows";
import { deriveRecQaDisplay } from "./recommendation-qa";
import type { FinalConfidence } from "./expert-verdict";

/** Cross-source evidence the brief shows up front — the "what we know" receipt.
 *  Each family is null when that source has nothing for the page (honest gaps).
 *  The caller derives this from the live signals; the brief never invents it. */
export type BriefEvidenceReceipt = {
  /** Google Search Console first-party demand. */
  gsc: {
    impressions90d: number;
    clicks90d: number;
    position90d: number | null;
    topQuery: string | null;
  } | null;
  /** SEMrush directional market data (volume/KD/striking-distance counts). */
  semrush: {
    rankedKeywords: number;
    strikingDistance: number;
  } | null;
  /** Microsoft Clarity on-page behaviour. */
  clarity: {
    sessions: number;
    frictionRate: number | null;
  } | null;
  /** GA4 engagement/traffic. */
  ga4: {
    sessions: number;
  } | null;
  /** AI-answer visibility (Profound / sampled observations). */
  aiAnswers: {
    observations: number;
  } | null;
};

export const EMPTY_RECEIPT: BriefEvidenceReceipt = {
  gsc: null,
  semrush: null,
  clarity: null,
  ga4: null,
  aiAnswers: null,
};

/** One atomic change on the page — the unit the operator reviews + approves. */
export type AtomicChange = {
  /** The change type (title / h1 / meta / schema / faq / section / link …). */
  kind: ActionRowType;
  /** Human-readable label ("Rewrite the title", already humanized + brand-cased). */
  title: string;
  /** Source families backing THIS change (from the QA verdict). */
  evidence: string[];
  /** Why this change should help (grounded; never an AI-citation claim). */
  hypothesis: string;
  /** What might be wrong / why it's capped — null when confidently actionable. */
  risk: string | null;
  /** Current on-page value, when known. */
  before: string | null;
  /** Proposed value, when Beacon drafted one. */
  after: string | null;
  /** Honest pushability. */
  pushability: "Paste-ready" | "Not publishable" | "Manual build";
  /** The deterministic confidence (already capped by the gate). */
  confidence: FinalConfidence;
  /** Whether this may be one-click accepted (the gate approved it). */
  actionable: boolean;
  /** How Beacon will measure it after it ships. */
  measurement: string | null;
};

export type EditDecision = "edit_existing" | "create_new" | "leave_as_is";

export type PageOpportunityBrief = {
  url: string;
  pageLabel: string;
  evidence: BriefEvidenceReceipt;
  decision: EditDecision;
  decisionReason: string;
  /** Atomic changes, sorted: actionable first, then by confidence, then kind. */
  atomicChanges: AtomicChange[];
  /** Count of changes the operator can act on now (gate-approved). */
  actionableCount: number;
  /** One-line, plain-English "what to do on this page". */
  summary: string;
};

const CONFIDENCE_RANK: Record<FinalConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
  needs_more_evidence: 3,
  rejected: 4,
};

/** A page genuinely lacks a target when its only rec is to create a page. */
function isCreatePageRow(row: RecommendationActionRow): boolean {
  return row.actionType === "create_page";
}

function toAtomicChange(row: RecommendationActionRow): AtomicChange {
  const qa = row.detail.qaVerdict ?? null;
  // The brief is always about fresh suggestions; reuse the SAME display
  // derivation the list + detail use, so pushability/actionable can't drift.
  const display = deriveRecQaDisplay({ qaVerdict: qa, isSuggestion: true });
  const confidence: FinalConfidence = qa?.confidence ?? "needs_more_evidence";
  const hypothesis =
    qa?.whyMatchValid?.trim() ||
    qa?.whyExists?.trim() ||
    row.detail.why?.trim() ||
    "";
  // Risk is only meaningful when the gate did NOT confidently approve it.
  const risk =
    qa != null && !qa.approve ? qa.confidenceReason?.trim() || null : null;
  return {
    kind: row.actionType,
    title: row.title,
    evidence: qa?.evidenceSupports ?? [],
    hypothesis,
    risk,
    before: row.detail.currentText ?? null,
    after: row.detail.proposedText ?? null,
    pushability: display.pushLabel,
    confidence,
    actionable: display.actionable,
    measurement: row.detail.measurementPlan ?? null,
  };
}

/** Order: actionable first, then confidence (high→low), then alphabetical kind
 *  for stable output — so the brief leads with the few changes worth making. */
function sortAtomicChanges(a: AtomicChange, b: AtomicChange): number {
  if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
  const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  if (c !== 0) return c;
  return a.kind.localeCompare(b.kind);
}

function receiptHasAnySignal(r: BriefEvidenceReceipt): boolean {
  return (
    r.gsc != null ||
    r.semrush != null ||
    r.clarity != null ||
    r.ga4 != null ||
    r.aiAnswers != null
  );
}

function decide(
  rows: RecommendationActionRow[],
  changes: AtomicChange[],
  receipt: BriefEvidenceReceipt,
): { decision: EditDecision; reason: string } {
  const actionable = changes.filter((c) => c.actionable);
  // No page exists yet (only a create-page rec, or no on-page change candidates
  // while there IS demand) → create.
  const onlyCreate =
    rows.length > 0 && rows.every(isCreatePageRow);
  if (onlyCreate) {
    return {
      decision: "create_new",
      reason:
        "No page targets this topic yet — there's nothing for search or AI assistants to surface, so the move is to create one.",
    };
  }
  if (actionable.length > 0) {
    return {
      decision: "edit_existing",
      reason: `This page already exists and has ${actionable.length} safe, evidence-backed change${
        actionable.length === 1 ? "" : "s"
      } worth making — edit it rather than rebuild.`,
    };
  }
  // Page exists, signals present, but nothing is confidently actionable yet.
  if (receiptHasAnySignal(receipt)) {
    return {
      decision: "leave_as_is",
      reason:
        "The page has signal but no change clears Beacon's evidence bar yet — leave it as-is until the evidence is stronger (don't make a change that wouldn't beat what's there).",
    };
  }
  return {
    decision: "leave_as_is",
    reason:
      "Not enough connected data on this page to recommend a confident change. Connect more sources or refresh to deepen the evidence.",
  };
}

function summarize(
  decision: EditDecision,
  changes: AtomicChange[],
  pageLabel: string,
): string {
  const actionable = changes.filter((c) => c.actionable);
  if (decision === "create_new") {
    return `Create a new page for this topic — nothing covers it yet.`;
  }
  if (decision === "edit_existing" && actionable.length > 0) {
    const lead = actionable[0]!;
    const more =
      actionable.length > 1
        ? ` (+${actionable.length - 1} more atomic change${
            actionable.length - 1 === 1 ? "" : "s"
          })`
        : "";
    return `On ${pageLabel}: start with "${lead.title}"${more}.`;
  }
  return `${pageLabel}: nothing confidently worth changing right now — hold.`;
}

/**
 * Build the per-page opportunity brief. `rows` are the already-built atomic rec
 * rows whose target is this page (each carrying its QA verdict + copy). The
 * caller assembles `evidence` from the page's live signals.
 */
export function buildPageOpportunityBrief(input: {
  url: string;
  pageLabel: string;
  rows: ReadonlyArray<RecommendationActionRow>;
  evidence?: BriefEvidenceReceipt;
}): PageOpportunityBrief {
  const evidence = input.evidence ?? EMPTY_RECEIPT;
  const rows = [...input.rows];
  const atomicChanges = rows.map(toAtomicChange).sort(sortAtomicChanges);
  const { decision, reason } = decide(rows, atomicChanges, evidence);
  const actionableCount = atomicChanges.filter((c) => c.actionable).length;
  return {
    url: input.url,
    pageLabel: input.pageLabel,
    evidence,
    decision,
    decisionReason: reason,
    atomicChanges,
    actionableCount,
    summary: summarize(decision, atomicChanges, input.pageLabel),
  };
}
