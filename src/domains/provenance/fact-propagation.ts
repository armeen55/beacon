/**
 * fact-propagation (BEACON_500 R13b / N26, 2026-07-03) - when the operator
 * corrects a fact, spread the same fix to every OTHER owned page still
 * carrying the old value.
 *
 * PURE / no I/O / no LLM. The I/O seam is registerShippedDraftClaims in
 * claim-graph-loader.ts (the same ship seam N8 factual entailment occupies):
 * a shipped draft whose extracted claim MATERIALLY differs from a prior
 * record on the same subject (numbers more than 5 percent apart, dates
 * differing - never punctuation) IS the operator correcting that fact, and
 * it covers both named correction paths (the N8 dated-evidence correction
 * and a claim-conflict resolution, which is the operator shipping the right
 * value onto one of the disagreeing pages).
 *
 * ONE bundled plan per correction:
 *
 *   "You fixed the year Persepolis was built on /persepolis. The old year
 *    still appears on 3 other pages: /iran-history, /achaemenid-empire,
 *    /timeline. I prepared the same one-line fix for each."
 *
 * Carriers come from the corrected record's affectedPages (the SAME
 * value-plus-subject-token rule the graph uses), minus the page that was
 * just fixed. Each carrier gets a prepared one-line fix (the exact stored
 * sentence with the old value swapped for the new one) - the same
 * current_text/proposed_text atomic-edit shape the stage machinery consumes.
 * Every fix is operator-approved per page and NEVER auto-pushed: nothing
 * here enters the push path; the plan renders on /diagnostics/provenance
 * and the operator applies each line.
 *
 * Once-only: the plan stamps propagationPlannedAt on the corrected claim
 * record (preserved across nightly rebuilds like firstSeenAt), so a
 * correction emits its plan once, not nightly forever.
 */

import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import {
  pathOfUrl,
  subjectLabelFor,
  valuesMateriallyDiffer,
  type ClaimRecord,
  type ClaimValue,
} from "./claim-graph";

/** One bundled plan never fans out wider than the graph's own page cap. */
export const MAX_PROPAGATION_CARRIERS = 10;

export type FactCorrection = {
  /** The prior record whose value the shipped draft corrected. */
  oldRecord: ClaimRecord;
  /** The corrected value the operator just shipped. */
  newValue: ClaimValue;
};

export type FactPropagationCarrierFix = {
  pageUrl: string;
  pagePath: string;
  /** The exact stored sentence still carrying the old value; null when the
   *  stored page text no longer shows it (the fix falls back to a plain
   *  swap instruction). */
  currentLine: string | null;
  /** The same sentence with the old value swapped for the corrected one;
   *  null when no line could be prepared. */
  proposedLine: string | null;
  /** Always renderable: the plain instruction for this page. */
  instruction: string;
};

export type FactPropagationPlan = {
  tenant_id: string;
  /** Stable per correction: same claim + same new value = same plan id. */
  id: string;
  claimId: string;
  subjectLabel: string;
  oldValue: string;
  newValue: string;
  correctedPageUrl: string;
  correctedPagePath: string;
  carriers: FactPropagationCarrierFix[];
  /** The bundled operator sentence (pinned by tests). */
  summary: string;
  plannedAt: string;
};

/**
 * Which prior records did this shipped draft correct? Same subjectKey,
 * materially different number/date value, no plan emitted yet (once-only),
 * deterministic order (existing graph order = traffic order).
 */
export function findFactCorrections(args: {
  existing: readonly ClaimRecord[];
  registered: readonly ClaimRecord[];
}): FactCorrection[] {
  const out: FactCorrection[] = [];
  const claimed = new Set<string>();
  for (const old of args.existing) {
    if (old.value.kind !== "number" && old.value.kind !== "date") continue;
    if (old.propagationPlannedAt) continue; // once-only: already planned
    if (claimed.has(old.id)) continue;
    const reg = args.registered.find(
      (r) => r.subjectKey === old.subjectKey && valuesMateriallyDiffer(old.value, r.value),
    );
    if (!reg) continue;
    claimed.add(old.id);
    out.push({ oldRecord: old, newValue: reg.value });
  }
  return out;
}

/** Every OTHER affected page: the corrected record's affectedPages minus the
 *  page that was just fixed, deduped by path, capped. */
export function propagationCarriers(
  oldRecord: Pick<ClaimRecord, "affectedPages">,
  correctedPageUrl: string,
): { pageUrl: string; pagePath: string }[] {
  const correctedPath = pathOfUrl(correctedPageUrl);
  const seen = new Set<string>();
  const out: { pageUrl: string; pagePath: string }[] = [];
  for (const pageUrl of oldRecord.affectedPages) {
    if (out.length >= MAX_PROPAGATION_CARRIERS) break;
    const pagePath = pathOfUrl(pageUrl);
    if (pagePath === correctedPath || seen.has(pagePath)) continue;
    seen.add(pagePath);
    out.push({ pageUrl, pagePath });
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Prepare one carrier page's one-line fix from its stored sentence (found by
 * the caller via findClaimSentence - the same rule as affectedPages). Falls
 * back to a plain swap instruction when the sentence is gone or the literal
 * old value cannot be located inside it.
 */
export function prepareCarrierFix(args: {
  pageUrl: string;
  pagePath: string;
  /** The carrier's stored sentence carrying the old value (findClaimSentence). */
  sentence: string | null;
  oldValueRaw: string;
  newValueRaw: string;
}): FactPropagationCarrierFix {
  const fallback = stripBannedDashes(
    `Open ${args.pagePath} and swap ${args.oldValueRaw} for ${args.newValueRaw}.`,
  );
  if (!args.sentence) {
    return { pageUrl: args.pageUrl, pagePath: args.pagePath, currentLine: null, proposedLine: null, instruction: fallback };
  }
  const currentLine = stripBannedDashes(args.sentence.trim());
  const valueRe = new RegExp(escapeRegExp(args.oldValueRaw), "i");
  if (!valueRe.test(currentLine)) {
    return { pageUrl: args.pageUrl, pagePath: args.pagePath, currentLine, proposedLine: null, instruction: fallback };
  }
  const proposedLine = currentLine.replace(valueRe, args.newValueRaw);
  return {
    pageUrl: args.pageUrl,
    pagePath: args.pagePath,
    currentLine,
    proposedLine,
    instruction: stripBannedDashes(
      `On ${args.pagePath}, replace "${currentLine}" with "${proposedLine}".`,
    ),
  };
}

/** "year" / "date" / "number" / "text" - the word the summary uses for the
 *  old value ("The old year still appears on 3 other pages"). */
export function propagationKindWord(value: ClaimValue): string {
  if (value.kind === "date") {
    const isYear = /\b\d{3,4}\s*(bc|bce|ad|ce)\b/i.test(value.raw) || /\b[12]\d{3}\b/.test(value.raw);
    return isYear ? "year" : "date";
  }
  if (value.kind === "number") return "number";
  return "text";
}

/** The bundled operator sentence (pinned by tests). */
export function propagationSummary(args: {
  subjectLabel: string;
  correctedPagePath: string;
  kindWord: string;
  carrierPaths: readonly string[];
}): string {
  const n = args.carrierPaths.length;
  const head = `You fixed ${args.subjectLabel} on ${args.correctedPagePath}.`;
  if (n === 1) {
    return stripBannedDashes(
      `${head} The old ${args.kindWord} still appears on 1 other page: ${args.carrierPaths[0]}. I prepared the same one-line fix for it.`,
    );
  }
  return stripBannedDashes(
    `${head} The old ${args.kindWord} still appears on ${n} other pages: ${args.carrierPaths.join(", ")}. I prepared the same one-line fix for each.`,
  );
}

/** fnv-1a, same dependency-free convention as claim-graph.ts. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Assemble one correction's bundled plan from already-prepared pieces. */
export function buildFactPropagationPlan(args: {
  tenantId: string;
  correction: FactCorrection;
  correctedPageUrl: string;
  carriers: readonly FactPropagationCarrierFix[];
  nowIso: string;
}): FactPropagationPlan {
  const { oldRecord, newValue } = args.correction;
  const subjectLabel = stripBannedDashes(subjectLabelFor(oldRecord));
  return {
    tenant_id: args.tenantId,
    id: `prop-${fnv1a(`${oldRecord.id}::${newValue.normalized}`)}`,
    claimId: oldRecord.id,
    subjectLabel,
    oldValue: oldRecord.value.raw,
    newValue: newValue.raw,
    correctedPageUrl: args.correctedPageUrl,
    correctedPagePath: pathOfUrl(args.correctedPageUrl),
    carriers: [...args.carriers],
    summary: propagationSummary({
      subjectLabel,
      correctedPagePath: pathOfUrl(args.correctedPageUrl),
      kindWord: propagationKindWord(oldRecord.value),
      carrierPaths: args.carriers.map((c) => c.pagePath),
    }),
    plannedAt: args.nowIso,
  };
}
