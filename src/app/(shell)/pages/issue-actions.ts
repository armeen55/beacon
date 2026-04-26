"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  getPageIssues,
  persistPageIssues,
  getRolloutExecutions,
  persistRolloutExecutions,
  getPatternEvidence,
  persistPatternEvidence,
  issueIdFromBrief,
  type IssueStatus,
  type PersistedIssue,
  type OutcomeStatus,
} from "@/domains/pages/issues";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function getCitationCount(pageUrl: string): number | null {
  try {
    const ciPath = join(process.cwd(), ".data", "citation-evidence-index.json");
    if (!existsSync(ciPath)) return null;
    const ci = JSON.parse(readFileSync(ciPath, "utf8"));
    const normUrl = pageUrl.replace(/\/+$/, "").toLowerCase();
    let count = 0;
    for (const r of ci.by_page_and_topic ?? []) {
      if (r.is_owned && r.page_url.replace(/\/+$/, "").toLowerCase() === normUrl) {
        count += r.total_citations;
      }
    }
    return count;
  } catch {
    return null;
  }
}
import { verifyPageFix } from "./verify-action";

export async function updateIssueStatus(
  issueId: string,
  status: IssueStatus,
  meta?: { pageUrl?: string; pagePath?: string; category?: string }
): Promise<{ success: boolean }> {
  const action = "updateIssueStatus";
  const t0 = Date.now();
  log.info("Action started", { action, params: { issueId, status } });
  const now = new Date().toISOString();
  const [pageIssues, rolloutExecutions, patternEvidence] = await Promise.all([
    getPageIssues(),
    getRolloutExecutions(),
    getPatternEvidence(),
  ]);
  let issue = pageIssues.find((i) => i.issueId === issueId);

  if (!issue) {
    issue = {
      issueId,
      pageUrl: meta?.pageUrl ?? "",
      pagePath: meta?.pagePath ?? "",
      category: meta?.category ?? "",
      status,
      handedOffAt: null,
      shippedAt: null,
      verifiedAt: null,
      updatedAt: now,
      verifyResult: null,
    };
    pageIssues.push(issue);
  }

  issue.status = status;
  issue.updatedAt = now;

  if (status === "handed_off" && !issue.handedOffAt) issue.handedOffAt = now;
  if (status === "shipped" && !issue.shippedAt) issue.shippedAt = now;
  if (status === "verified") issue.verifiedAt = now;

  if (status === "new") {
    issue.shippedAt = null;
    issue.verifiedAt = null;
    issue.verifyResult = null;
    issue.verificationObservationRunId = null;
    issue.verificationBaselineObservationRunId = null;
  }

  const matchingExec = rolloutExecutions.find((r) => r.issueId === issueId);
  if (matchingExec) {
    if (status === "handed_off") matchingExec.handedOffAt = now;
    if (status === "shipped") matchingExec.shippedAt = now;
    await persistRolloutExecutions();
  }

  const matchingEvidence = patternEvidence.find((e) => e.issueId === issueId);
  if (matchingEvidence) {
    if (status === "shipped") matchingEvidence.shippedAt = now;
    if (status === "handed_off" && !matchingEvidence.preShipCitationCount) {
      matchingEvidence.preShipCitationCount = getCitationCount(meta?.pageUrl ?? "");
    }
    await persistPatternEvidence();
  }

  await persistPageIssues();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function verifyAndUpdateIssue(
  issueId: string,
  pageUrl: string
): Promise<{
  success: boolean;
  cleared: boolean;
  remaining: string[];
  summary: string;
  error?: string;
}> {
  const action = "verifyAndUpdateIssue";
  const t0 = Date.now();
  log.info("Action started", { action, params: { issueId } });
  const result = await verifyPageFix(pageUrl);

  if (!result.success) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: result.error?.slice(0, 500) ?? "verification failed",
    });
    return {
      success: false,
      cleared: false,
      remaining: [],
      summary: result.error ?? "Verification failed",
      error: result.error,
    };
  }

  const now = new Date().toISOString();
  const [pageIssues, rolloutExecutions, patternEvidence] = await Promise.all([
    getPageIssues(),
    getRolloutExecutions(),
    getPatternEvidence(),
  ]);
  let issue = pageIssues.find((i) => i.issueId === issueId);

  if (!issue) {
    issue = {
      issueId,
      pageUrl,
      pagePath: pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/",
      category: "",
      status: "new",
      handedOffAt: null,
      shippedAt: null,
      verifiedAt: null,
      updatedAt: now,
      verifyResult: null,
    };
    pageIssues.push(issue);
  }

  const cleared = result.cleared.length > 0 && result.remaining.length === 0;
  issue.verifyResult = {
    cleared,
    remaining: result.remaining,
    summary: cleared
      ? "All issues resolved"
      : result.remaining.length > 0
        ? `Still open: ${result.remaining.join(", ")}`
        : "No change detected",
  };

  if (result.verificationObservationRunId) {
    issue.verificationObservationRunId = result.verificationObservationRunId;
    issue.verificationBaselineObservationRunId =
      result.verificationBaselineObservationRunId ?? null;
  }

  if (cleared) {
    issue.status = "verified";
    issue.verifiedAt = now;
  } else {
    issue.status = "not_fixed";
  }
  issue.updatedAt = now;

  const matchingExec = rolloutExecutions.find((r) => r.issueId === issueId);
  if (matchingExec) {
    matchingExec.verifiedAt = now;
    matchingExec.verificationResult = issue.verifyResult.summary;
    await persistRolloutExecutions();
  }

  const matchingEvidence = patternEvidence.find((e) => e.issueId === issueId);
  if (matchingEvidence) {
    matchingEvidence.verifiedAt = now;
    matchingEvidence.structuralVerificationResult = issue.verifyResult.summary;
    matchingEvidence.postShipCitationCount = getCitationCount(pageUrl);

    let outcomeStatus: OutcomeStatus;
    if (!cleared) {
      outcomeStatus = "verification_failed";
    } else {
      const pre = matchingEvidence.preShipCitationCount;
      const post = matchingEvidence.postShipCitationCount;
      if (pre != null && post != null && post > pre) {
        outcomeStatus = "structurally_verified_with_positive_signal";
      } else if (pre != null && post != null && post <= pre) {
        outcomeStatus = "structurally_verified_no_clear_impact_yet";
      } else {
        outcomeStatus = "structurally_verified_outcome_too_early";
      }
    }
    matchingEvidence.outcomeStatus = outcomeStatus;
    await persistPatternEvidence();
  }

  await persistPageIssues();
  revalidatePath("/", "layout");

  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return {
    success: true,
    cleared,
    remaining: result.remaining,
    summary: issue.verifyResult.summary,
  };
}

export async function generateHandoffText(
  issueId: string,
  brief: {
    issueSummary: string;
    pageUrl: string;
    pagePath: string;
    severity: string;
    citationCount: number;
    expectedState: string[];
    observedState: string[];
    likelyCauses: string[];
    verificationChecklist: string[];
    bestNextMove: string;
    intentConflict: boolean;
    intentDetail: string | null;
  }
): Promise<{ success: boolean; text: string }> {
  const action = "generateHandoffText";
  const t0 = Date.now();
  log.info("Action started", { action, params: { issueId } });
  const lines: string[] = [
    `## Page Issue: ${brief.issueSummary}`,
    "",
    `**Page:** ${brief.pageUrl}`,
    `**Severity:** ${brief.severity}`,
    `**Citations:** ${brief.citationCount}`,
    brief.intentConflict ? `**⚠ Intent conflict:** ${brief.intentDetail}` : "",
    "",
    "### Why this matters",
    `This page has ${brief.citationCount} citations across AI platforms. ${brief.issueSummary}.`,
    "",
    "### Expected state",
    ...brief.expectedState.map((s) => `- ${s}`),
    "",
    "### Observed state",
    ...brief.observedState.map((s) => `- ${s}`),
    "",
    "### Likely correlates",
    ...brief.likelyCauses.map((s) => `- ${s}`),
    "",
    "### Best next move",
    brief.bestNextMove,
    "",
    "### Verification checklist",
    ...brief.verificationChecklist.map((s, i) => `${i + 1}. ${s}`),
    "",
    "---",
    "_Generated by Beacon Page Scanner_",
  ].filter(Boolean);

  await updateIssueStatus(issueId, "handed_off", {
    pageUrl: brief.pageUrl,
    pagePath: brief.pagePath,
    category: issueId.replace(/^issue-/, "").replace(/-[^-]+$/, ""),
  });

  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, text: lines.join("\n") };
}

export async function convertBriefToIssue(
  briefId: string,
  briefTitle: string,
  briefType: "fix" | "growth",
  pageUrl: string,
  pagePath: string,
  sourcePatternId: string,
  copyHandoff?: boolean,
  spec?: {
    schemaPackage: string[];
    faqCountTarget: number;
    wordCountTarget: number | null;
    internalLinkTarget: number | null;
    requiredElements: string[];
  },
  gapTrigger?: string,
  recommendations?: string[],
  verificationChecklist?: string[]
): Promise<{ success: boolean; issueId: string; handoffText?: string }> {
  const action = "convertBriefToIssue";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { briefId, briefType, pageUrlLength: pageUrl.length },
  });
  const now = new Date().toISOString();
  const issueId = issueIdFromBrief(briefId, pageUrl);

  const [pageIssues, rolloutExecutions, patternEvidence] = await Promise.all([
    getPageIssues(),
    getRolloutExecutions(),
    getPatternEvidence(),
  ]);
  let issue = pageIssues.find((i) => i.issueId === issueId);
  if (!issue) {
    issue = {
      issueId,
      pageUrl,
      pagePath,
      category: `rollout-${briefType}`,
      status: copyHandoff ? "handed_off" : "new",
      handedOffAt: copyHandoff ? now : null,
      shippedAt: null,
      verifiedAt: null,
      updatedAt: now,
      verifyResult: null,
    };
    pageIssues.push(issue);
  }

  const existingExec = rolloutExecutions.find((r) => r.briefId === briefId && r.targetPage === pageUrl);
  const execId = existingExec?.executionId ?? `exec-${Date.now()}`;
  if (!existingExec) {
    rolloutExecutions.push({
      executionId: execId,
      briefId,
      issueId,
      sourcePatternId,
      targetPage: pageUrl,
      briefTitle,
      briefType,
      createdAt: now,
      handedOffAt: copyHandoff ? now : null,
      shippedAt: null,
      verifiedAt: null,
      verificationResult: null,
      notes: null,
    });
    await persistRolloutExecutions();
  }

  const existingEvidence = patternEvidence.find((e) => e.briefId === briefId && e.targetPage === pageUrl);
  if (!existingEvidence) {
    const preShipCit = getCitationCount(pageUrl);
    patternEvidence.push({
      patternEvidenceId: `pe-${Date.now()}`,
      sourcePatternId,
      briefId,
      issueId,
      rolloutExecutionId: execId,
      targetPage: pageUrl,
      createdAt: now,
      shippedAt: null,
      verifiedAt: null,
      structuralVerificationResult: null,
      preShipCitationCount: preShipCit,
      postShipCitationCount: null,
      outcomeStatus: "shipped_not_verified",
      notes: null,
    });
    await persistPatternEvidence();
  }

  await persistPageIssues();
  revalidatePath("/", "layout");

  let handoffText: string | undefined;
  if (copyHandoff) {
    const lines: string[] = [
      `## Ship checklist: ${briefTitle}`,
      "",
      `**Page:** ${pageUrl}`,
      `**Type:** ${briefType}`,
      `**Pattern:** ${sourcePatternId}`,
    ];
    if (gapTrigger) lines.push(`**Gap:** ${gapTrigger}`);
    lines.push("");

    if (spec) {
      lines.push("### Spec");
      if (spec.schemaPackage.length > 0) lines.push(`- **Schema:** ${spec.schemaPackage.join(", ")}`);
      lines.push(`- **FAQ target:** ${spec.faqCountTarget}`);
      if (spec.wordCountTarget) lines.push(`- **Word count:** ${spec.wordCountTarget}+`);
      if (spec.internalLinkTarget) lines.push(`- **Internal links:** ${spec.internalLinkTarget}+`);
      if (spec.requiredElements.length > 0) {
        lines.push("- **Required elements:**");
        spec.requiredElements.forEach((e) => lines.push(`  - ${e}`));
      }
      lines.push("");
    }

    if (recommendations && recommendations.length > 0) {
      lines.push("### Steps");
      recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
      lines.push("");
    }

    if (verificationChecklist && verificationChecklist.length > 0) {
      lines.push("### Verification");
      verificationChecklist.forEach((v, i) => lines.push(`${i + 1}. ${v}`));
      lines.push("");
    }

    lines.push("---", "_Generated by Beacon Playbook Engine_");
    handoffText = lines.join("\n");
  }

  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, issueId, handoffText };
}

export async function refreshOutcomeObservation(
  issueId: string,
  pageUrl: string
): Promise<{ success: boolean; summary: string }> {
  const action = "refreshOutcomeObservation";
  const t0 = Date.now();
  log.info("Action started", { action, params: { issueId } });
  const { generateOutcomeObservation, getOutcomeObservations, persistOutcomeObservations } = await import("@/domains/pages/outcome-watch");
  const { computeScorecard } = await import("@/domains/attribution/scorecard");
  const { detectOutcomeEvents } = await import("@/domains/attribution/events");
  const { partitionResultsByMode } = await import("@/domains/attribution/result-mode");
  const { getResults, getChangelogEntries, getOpportunities } = await import("@/lib/seed-data.server");
  const [results, changelogEntries, opportunities, outcomeObservations, eventDecisions, rolloutExecutions, patternEvidence, pageIssues] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getOutcomeObservations(),
    (await import("@/domains/attribution/store")).getEventDecisions(),
    getRolloutExecutions(),
    getPatternEvidence(),
    getPageIssues(),
  ]);

  const exec = rolloutExecutions.find((r) => r.issueId === issueId);
  if (!exec || !exec.verifiedAt) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "no shipped checklist",
    });
    return { success: false, summary: "No shipped checklist tied to this issue yet" };
  }

  const evRecord = patternEvidence.find((e) => e.issueId === issueId);
  const citCount = getCitationCount(pageUrl);

  const rows = computeScorecard(changelogEntries, results, opportunities, eventDecisions);
  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);

  const obs = generateOutcomeObservation(exec, evRecord, citCount, rows, events);

  const existingIdx = outcomeObservations.findIndex(
    (o) => o.issueId === issueId && o.rolloutExecutionId === exec.executionId
  );
  if (existingIdx >= 0) {
    outcomeObservations[existingIdx] = obs;
  } else {
    outcomeObservations.push(obs);
  }
  await persistOutcomeObservations();

  if (evRecord && obs.outcomeAssessment !== "too_early" && obs.outcomeAssessment !== "incubating") {
    const statusMap: Record<string, OutcomeStatus> = {
      early_movement: "structurally_verified_with_positive_signal",
      promising_but_ambiguous: "structurally_verified_with_positive_signal",
      mixed_signal: "structurally_verified_no_clear_impact_yet",
      likely_no_visible_effect_yet: "structurally_verified_no_clear_impact_yet",
    };
    const newStatus = statusMap[obs.outcomeAssessment];
    if (newStatus && evRecord.outcomeStatus !== newStatus) {
      evRecord.outcomeStatus = newStatus;
      evRecord.postShipCitationCount = citCount;
      await persistPatternEvidence();
    }
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, summary: obs.evidenceSummary };
}
