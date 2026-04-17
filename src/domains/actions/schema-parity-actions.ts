/**
 * Phase 1 — `schema_parity` Today ActionCard builder.
 *
 * Transforms `schema_missing_for_page_type` Findings into
 * `ActionCardAction`s that slot into the existing Today stack alongside the
 * brain's outcome-driven actions. The existing `<ActionCard>` component
 * renders these without any UI changes — same shape, new `actionClass`.
 *
 * Rules:
 *   - Max 1 schema_parity action in the stack at a time (top-1 by priority).
 *   - Sorted by severity desc (high > medium > low), then by citation count.
 *   - `href` links to `/changes/truth?focus=<url>` so the operator can review
 *     the event-level truth preview for the affected page in context.
 *   - Does NOT displace brain actions; caller decides insertion position.
 */

import type { Finding } from "@/domains/scanning/types";
import type { AssetType } from "@/lib/constants";
import type { ActionCardAction } from "@/components/today/action-card";
import { classifyAssetType } from "@/domains/pages/classify-asset-type";

const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export type BuildSchemaParityActionsInput = {
  /** All findings (pending + others); builder filters internally. */
  findings: Finding[];
  /** Optional — used for the card's `baselineCitations` field. */
  citationsByUrl?: Map<string, number>;
  /** Cap on returned actions. Plan rule: exactly 1. */
  maxActions?: number;
};

export function buildSchemaParityActions(
  input: BuildSchemaParityActionsInput,
): ActionCardAction[] {
  const max = input.maxActions ?? 1;

  const relevant = input.findings
    .filter(
      (f) =>
        f.type === "schema_missing_for_page_type" && f.status === "pending",
    )
    .sort((a, b) => {
      const sev = (SEV_RANK[a.severity] ?? 99) - (SEV_RANK[b.severity] ?? 99);
      if (sev !== 0) return sev;
      return (b.citationCount ?? 0) - (a.citationCount ?? 0);
    })
    .slice(0, max);

  return relevant.map((f) => findingToAction(f, input.citationsByUrl));
}

// ---------------------------------------------------------------------------
// Finding → ActionCardAction
// ---------------------------------------------------------------------------

function findingToAction(
  f: Finding,
  citationsByUrl?: Map<string, number>,
): ActionCardAction {
  const assetType = classifyAssetType(f.url);
  const missing = extractMissingTypes(f.currentState);
  const present = extractPresentTypes(f.previousState);
  const citations = citationsByUrl?.get(f.pagePath) ?? f.citationCount ?? 0;

  const assetLabel = humanAssetType(assetType);
  const missingLabel = missing.length === 1 ? "type" : "types";

  const headline = `Add ${missing.length} missing schema ${missingLabel} to ${f.pagePath}`;

  const rationale = buildRationale({
    assetType,
    assetLabel,
    present,
    missing,
    citations,
  });

  const expectedOutcome = `Within 14 days of deploying structured data for ${missing.join(", ")}, expect measurable citation movement on ${f.pagePath} above its current 14-day baseline.`;

  const sourceEvidence = `Scanner observed schema_types=[${present.join(", ") || "none"}]. Expected for ${assetLabel}s: the missing types above. Menlo-park is the in-account control — same content class, full schema stack, currently ${citations > 0 ? "cites reliably" : "is the reference"}.`;

  const bucket: ActionCardAction["bucket"] =
    f.severity === "high"
      ? "critical"
      : f.severity === "medium"
        ? "high_leverage"
        : "opportunistic";

  const confidence: ActionCardAction["confidence"] =
    f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low";

  return {
    id: f.id,
    headline,
    rationale,
    expectedOutcome,
    sourceEvidence,
    priorityScore: f.priorityScore,
    bucket,
    type: "schema_parity",
    confidence,
    href: `/changes/truth?focus=${encodeURIComponent(f.pagePath)}`,
    watchAfter: "Check 14 days after deploy",
    targetPageUrl: f.url,
    targetPagePath: f.pagePath,
    baselineCitations: citations > 0 ? citations : null,
    sourceChangeId: null,
    actionClass: "schema_experiment",
    specificMove: `Deploy page-scoped JSON-LD on ${f.pagePath}: ${missing.join(", ")}. Do not change visible content.`,
    confidenceReason:
      f.severity === "high"
        ? `High-citation ${assetLabel} with multiple missing required types.`
        : f.severity === "medium"
          ? `Multiple required types missing.`
          : `Single missing required type.`,
    hasExperiment: false,
    dataFreshness: null,
    lineageBullets: [
      `Page class: ${assetLabel}`,
      `Current schema: ${present.length > 0 ? present.join(", ") : "(none)"}`,
      `Missing required: ${missing.join(", ")}`,
      citations > 0
        ? `Current citation volume: ${citations}`
        : "No citation volume yet — schema parity may unlock initial citations",
    ],
    answerContext: null,
    expectedMetric: "citations_per_day",
    engineTiming: null,
    priorSuccess: null,
    targetSection: null,
  };
}

// ---------------------------------------------------------------------------
// String parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract missing schema types from the Finding.currentState string.
 * Format: `missing_required: [BreadcrumbList, WebPage, (one of) X | Y | Z]`
 */
function extractMissingTypes(currentState: string | null): string[] {
  if (!currentState) return [];
  const m = currentState.match(/missing_required:\s*\[(.*)\]/);
  if (!m) return [];
  return splitTopLevelCommaList(m[1]);
}

/**
 * Extract present schema types from the Finding.previousState string.
 * Format: `schema_types: [FAQPage, BreadcrumbList]`
 */
function extractPresentTypes(previousState: string | null): string[] {
  if (!previousState) return [];
  const m = previousState.match(/schema_types:\s*\[(.*)\]/);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Comma-split that keeps `(one of) A | B | C` chunks together. The bracketed
 * missing list from the detector uses commas as outer separators but the
 * oneOf labels use `|` internally, so a naive split on `,` works.
 */
function splitTopLevelCommaList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Labels + rationale
// ---------------------------------------------------------------------------

function humanAssetType(t: AssetType): string {
  return t.replace(/_/g, " ");
}

function buildRationale(opts: {
  assetType: AssetType;
  assetLabel: string;
  present: string[];
  missing: string[];
  citations: number;
}): string {
  const volume =
    opts.citations >= 100
      ? ` (currently cited ${opts.citations}× across AI platforms)`
      : opts.citations > 0
        ? ` (currently cited ${opts.citations}×)`
        : "";

  const currentSchema =
    opts.present.length > 0
      ? `has only ${opts.present.join(" + ")} schema`
      : `has no JSON-LD`;

  return `This ${opts.assetLabel}${volume} ${currentSchema}. AI engines rely on structured-data coverage to know what page class this is and what entities it describes. Adding ${opts.missing.length} missing required type${opts.missing.length === 1 ? "" : "s"} — ${opts.missing.join(", ")} — brings the page to parity with the peer pages of its class that already cite reliably.`;
}
