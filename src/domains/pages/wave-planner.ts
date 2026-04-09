/**
 * Wave Planner — groups compatible playbook briefs into coordinated rollout waves.
 *
 * Waves are a coordination layer above page-level issues.
 * They bundle related briefs by pattern, page type, and urgency
 * so the operator can ship coherent batches.
 */

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PlaybookBrief, PatternEvidence, PatternType } from "./playbook";
import type { PersistedIssue, RolloutExecution } from "./issues";

// ── Types ──

export type WaveType =
  | "quick_fix_wave"
  | "pattern_rollout_wave"
  | "verification_wave"
  | "mixed_operator_wave";

export type WaveStatus =
  | "proposed"
  | "handed_off"
  | "in_progress"
  | "partially_shipped"
  | "shipped"
  | "partially_verified"
  | "completed"
  | "dismissed";

export type RolloutWave = {
  rolloutWaveId: string;
  title: string;
  sourcePatternId: string;
  waveType: WaveType;
  createdAt: string;
  status: WaveStatus;
  targetPages: string[];
  briefIds: string[];
  issueIds: string[];
  rationale: string;
  priorityScore: number;
  expectedVerificationMode: string;
  notes: string | null;
};

const repo = getRepository();

export const rolloutWaves: RolloutWave[] = await repo.getRolloutWaves();

export async function persistRolloutWaves(): Promise<void> {
  await writeStore("rollout-waves", rolloutWaves);
}

// ── Wave Progress ──

export type WaveProgress = {
  totalPages: number;
  tracked: number;
  shipped: number;
  verified: number;
  blocked: number;
  pct: number;
};

export function computeWaveProgress(
  wave: RolloutWave,
  issues: PersistedIssue[]
): WaveProgress {
  const total = wave.targetPages.length;
  const issueMap = new Map<string, PersistedIssue>();
  for (const i of issues) issueMap.set(i.issueId, i);

  let tracked = 0, shipped = 0, verified = 0, blocked = 0;
  for (const iid of wave.issueIds) {
    const issue = issueMap.get(iid);
    if (!issue) continue;
    tracked++;
    if (issue.status === "shipped" || issue.status === "verified" || issue.status === "not_fixed") shipped++;
    if (issue.status === "verified") verified++;
    if (issue.status === "not_fixed") blocked++;
  }

  return {
    totalPages: total,
    tracked,
    shipped,
    verified,
    blocked,
    pct: total > 0 ? Math.round((verified / total) * 100) : 0,
  };
}

export function deriveWaveStatus(
  wave: RolloutWave,
  issues: PersistedIssue[]
): WaveStatus {
  if (wave.status === "dismissed") return "dismissed";
  if (wave.issueIds.length === 0) return "proposed";

  const progress = computeWaveProgress(wave, issues);
  if (progress.verified === progress.totalPages && progress.totalPages > 0) return "completed";
  if (progress.verified > 0) return "partially_verified";
  if (progress.shipped === progress.totalPages && progress.totalPages > 0) return "shipped";
  if (progress.shipped > 0) return "partially_shipped";
  if (progress.tracked > 0) return "handed_off";
  return "proposed";
}

// ── Wave Grouping ──

type BriefGroup = {
  key: string;
  patternId: string;
  waveType: WaveType;
  briefs: PlaybookBrief[];
  avgPriority: number;
  totalCitations: number;
  patternEvidence: PatternEvidence;
};

const PAGE_TYPE_FROM_URL: Record<string, string> = {};

function pageTypeFromUrl(url: string): string {
  if (url.includes("/locations/")) return "city";
  if (url.includes("/services/")) return "service";
  if (url.includes("/explore-projects/")) return "project";
  if (url.match(/\/$/) && !url.includes("/", 9)) return "homepage";
  return "other";
}

export function planWaves(
  briefs: PlaybookBrief[],
  issues: PersistedIssue[],
  executions: RolloutExecution[],
  existingWaves: RolloutWave[]
): RolloutWave[] {
  const activeIssuePages = new Set<string>();
  for (const i of issues) {
    if (i.status !== "dismissed" && i.status !== "verified") {
      activeIssuePages.add(i.pageUrl.replace(/\/+$/, "").toLowerCase());
    }
  }

  const existingWavePages = new Set<string>();
  for (const w of existingWaves) {
    if (w.status !== "dismissed" && w.status !== "completed") {
      for (const p of w.targetPages) existingWavePages.add(p.replace(/\/+$/, "").toLowerCase());
    }
  }

  const eligibleBriefs = briefs.filter((b) => {
    const normUrl = b.pageUrl.replace(/\/+$/, "").toLowerCase();
    return !activeIssuePages.has(normUrl) && !existingWavePages.has(normUrl);
  });

  if (eligibleBriefs.length === 0) return [];

  // Group by patternId + briefType
  const groups = new Map<string, BriefGroup>();
  for (const b of eligibleBriefs) {
    const key = `${b.patternId}-${b.type}`;
    let group = groups.get(key);
    if (!group) {
      const waveType: WaveType = b.type === "fix" && b.structureGap >= 0.8
        ? "quick_fix_wave"
        : b.type === "growth"
          ? "pattern_rollout_wave"
          : "mixed_operator_wave";
      group = {
        key,
        patternId: b.patternId,
        waveType,
        briefs: [],
        avgPriority: 0,
        totalCitations: 0,
        patternEvidence: b.patternEvidence,
      };
      groups.set(key, group);
    }
    group.briefs.push(b);
    group.totalCitations += b.citationOpportunity;
  }

  // Compute averages
  for (const g of groups.values()) {
    g.avgPriority = Math.round(g.briefs.reduce((s, b) => s + b.priority, 0) / g.briefs.length);
  }

  // Convert to waves (only groups with 2+ briefs or single high-priority)
  const waves: RolloutWave[] = [];
  const now = new Date().toISOString();

  for (const g of groups.values()) {
    if (g.briefs.length < 2 && g.avgPriority < 900) continue;

    const sorted = g.briefs.sort((a, b) => b.priority - a.priority);
    const batch = sorted.slice(0, 8);
    const pageType = pageTypeFromUrl(batch[0].pageUrl);

    let title: string;
    if (g.waveType === "quick_fix_wave") {
      title = `Fix ${batch.length} ${pageType} page${batch.length !== 1 ? "s" : ""}: ${g.patternEvidence.trustBasis.replace("Trust basis: ", "").slice(0, 60)}`;
    } else if (g.waveType === "pattern_rollout_wave") {
      title = `Roll out ${batch[0].patternName} to ${batch.length} page${batch.length !== 1 ? "s" : ""}`;
    } else {
      title = `${batch.length} page${batch.length !== 1 ? "s" : ""}: ${batch[0].patternName}`;
    }

    const evidenceBoost = g.patternEvidence.executionConfidence === "execution_validated" ? 100
      : g.patternEvidence.executionConfidence === "execution_mixed" ? 20
      : 0;

    waves.push({
      rolloutWaveId: `wave-${g.key}-${Date.now()}`,
      title,
      sourcePatternId: g.patternId,
      waveType: g.waveType,
      createdAt: now,
      status: "proposed",
      targetPages: batch.map((b) => b.pageUrl),
      briefIds: batch.map((b) => b.id),
      issueIds: [],
      rationale: `${g.totalCitations} total citations across ${batch.length} pages. ${g.patternEvidence.evidenceSummary}`,
      priorityScore: g.avgPriority + evidenceBoost,
      expectedVerificationMode: "Page scanner rescan after deployment",
      notes: null,
    });
  }

  return waves.sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── Wave Handoff ──

export function generateWaveHandoff(wave: RolloutWave, briefs: PlaybookBrief[]): string {
  const waveBriefs = briefs.filter((b) => wave.briefIds.includes(b.id));
  const lines: string[] = [
    `## Rollout Wave: ${wave.title}`,
    "",
    `**Type:** ${wave.waveType.replace(/_/g, " ")}`,
    `**Pages:** ${wave.targetPages.length}`,
    `**Priority:** ${wave.priorityScore}`,
    `**Pattern:** ${wave.sourcePatternId}`,
    "",
    "### Why this batch",
    wave.rationale,
    "",
    "### Pages in this wave",
  ];

  for (const b of waveBriefs) {
    lines.push(`\n#### ${b.pagePath || "/"}`);
    lines.push(`- **Gap:** ${b.gapTrigger}`);
    lines.push(`- **Citations:** ${b.citationOpportunity}`);
    if (b.spec) {
      if (b.spec.schemaPackage.length > 0) lines.push(`- **Schema:** ${b.spec.schemaPackage.join(", ")}`);
      lines.push(`- **FAQ target:** ${b.spec.faqCountTarget}`);
      if (b.spec.wordCountTarget) lines.push(`- **Words:** ${b.spec.wordCountTarget}+`);
    }
    lines.push(`- **Steps:** ${b.recommendations.slice(0, 3).join("; ")}`);
  }

  lines.push("", "### Verification", wave.expectedVerificationMode);
  lines.push("", "---", "_Generated by Beacon Wave Planner_");
  return lines.join("\n");
}

// ── Wave status labels ──

export const WAVE_STATUS_LABELS: Record<WaveStatus, string> = {
  proposed: "Proposed",
  handed_off: "Handed off",
  in_progress: "In progress",
  partially_shipped: "Partially shipped",
  shipped: "Shipped",
  partially_verified: "Partially verified",
  completed: "Completed",
  dismissed: "Dismissed",
};

export const WAVE_TYPE_LABELS: Record<WaveType, string> = {
  quick_fix_wave: "Quick fix",
  pattern_rollout_wave: "Pattern rollout",
  verification_wave: "Verification",
  mixed_operator_wave: "Mixed",
};
