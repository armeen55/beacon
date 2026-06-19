/**
 * Insight layer — single page-primary adapter (operator-OS rebuild, Phase 1).
 *
 * The ONE resolver every surface (Today, Opportunity Map, Recommendations,
 * State of the Union) uses to decide a page's primary action + CTA, so they
 * stop contradicting each other. Precedence:
 *   1. Page Surgeon Change Pack exists  → its primary action ("Review Change Pack")
 *   2. else an opportunity diagnosis     → the diagnosis move ("Run Deep Audit")
 *   3. else legacy rec (Basic/quarantine only) → the legacy headline
 *
 * PURE. Callers pass what they already loaded (summary / opportunity / legacy).
 */

import type { PageSurgeonSummary } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { OpportunityItem } from "./opportunity";

export type PagePrimarySource = "change_pack" | "diagnosis" | "legacy" | "none";

export type PagePrimary = {
  source: PagePrimarySource;
  /** Operator-facing primary action headline. */
  headline: string;
  /** CTA label + href. NEVER "Open in Workbench" until /workbench exists. */
  cta: { label: string; href: string };
  hasPack: boolean;
};

/**
 * Where review happens TODAY. The Workbench (`/workbench/[page]`) doesn't exist
 * yet (Phase 2) — until it does, every CTA routes to the recommendations review
 * surface. Flip this one constant when the Workbench ships.
 */
export const REVIEW_HREF = "/recommendations";

/** Page Surgeon `recommended_atomic_action` → imperative operator headline.
 *  Keys mirror `AtomicChangeType` (+ the three non-change verdicts). */
export const PRIMARY_ACTION_LABEL: Record<string, string> = {
  title: "Rewrite the title",
  meta: "Rewrite the meta description",
  h1: "Fix the H1 / page headline",
  intro_answer_block: "Add a direct answer block",
  faq: "Add a visible Q&A",
  section_add: "Add a missing section",
  section_remove: "Remove a weak section",
  section_reorder: "Reorder the sections",
  internal_link: "Add internal links",
  schema: "Add structured data (JSON-LD)",
  image_alt: "Add image alt text",
  ux_cta_fix: "Fix UX / CTA",
  citation_source: "Cite a source",
  create_new_page: "Create a new page",
  keep_current: "Healthy — monitor",
  needs_more_evidence: "Needs more evidence",
  needs_llm_review: "Needs review",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "Review the page";
  return PRIMARY_ACTION_LABEL[action] ?? "Review the page";
}

/**
 * Resolve the single primary action + CTA for a page. Pure.
 * `summary` = Page Surgeon pack summary (or null); `opportunity` = the broad-scan
 * diagnosis (or null); `legacy` = a last-resort legacy headline for Basic/quarantine.
 */
export function resolvePagePrimary(args: {
  summary?: PageSurgeonSummary | null;
  opportunity?: Pick<OpportunityItem, "expectedLever" | "why"> | null;
  legacy?: { headline: string } | null;
}): PagePrimary {
  const { summary, opportunity, legacy } = args;

  if (summary?.hasPack) {
    return {
      source: "change_pack",
      headline: actionLabel(summary.headlineAction),
      cta: { label: "Review Change Pack", href: REVIEW_HREF },
      hasPack: true,
    };
  }
  if (opportunity) {
    return {
      source: "diagnosis",
      headline: opportunity.expectedLever || opportunity.why || "Review the page",
      cta: { label: "Run Deep Audit", href: REVIEW_HREF },
      hasPack: false,
    };
  }
  if (legacy) {
    return {
      source: "legacy",
      headline: legacy.headline,
      cta: { label: "Open", href: REVIEW_HREF },
      hasPack: false,
    };
  }
  return {
    source: "none",
    headline: "Run a deep audit to draft a Change Pack",
    cta: { label: "Run Deep Audit", href: REVIEW_HREF },
    hasPack: false,
  };
}

/** Confidence in the clicks-at-stake ESTIMATE (data-volume driven, not SERP). */
export function estimateConfidence(impressions: number): "high" | "medium" | "low" {
  if (impressions >= 3000) return "high";
  if (impressions >= 800) return "medium";
  return "low";
}

/**
 * Canonical clicks-at-stake label. Always carries window + confidence + SERP
 * status so a number never reads as a promise. Returns null when there's
 * nothing meaningful to show (caller hides the estimate).
 */
export function estClicksLabel(args: {
  estClicksAtStake: number;
  window: "28d" | "90d";
  confidence: "high" | "medium" | "low";
  serpStatusChip: string;
}): string | null {
  if (!args.estClicksAtStake || args.estClicksAtStake <= 0) return null;
  return `~${args.estClicksAtStake.toLocaleString()} est. clicks at stake over ${args.window} · ${args.confidence} confidence · ${args.serpStatusChip}`;
}
