/**
 * Frontier Compiler — turns frontier opportunities into concrete attack packages.
 *
 * Compiles move-type-specific execution plans with linked pages, briefs,
 * waves, missing-page plans, and verification expectations.
 */

import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { FrontierOpportunity, RecommendedMoveType } from "./frontier-planner";
import type { PlaybookBrief, MinedPattern } from "./playbook";
import type { RolloutWave } from "./wave-planner";
import type { PageSnapshot } from "./types";
import type { AssetResponse } from "./asset-response";

// ── Types ──

export type PackageStatus = "proposed" | "compiled" | "launched" | "handed_off" | "in_progress" | "partially_verified" | "completed" | "dismissed";

export type MissingPagePlan = {
  suggestedTitle: string;
  pageType: string;
  targetTopic: string;
  targetCity: string | null;
  targetService: string | null;
  rationale: string;
  suggestedComponents: string[];
  suggestedInternalLinksIn: string[];
  suggestedInternalLinksOut: string[];
  verificationExpectations: string[];
};

export type FrontierAttackPackage = {
  frontierAttackPackageId: string;
  frontierOpportunityId: string;
  title: string;
  createdAt: string;
  status: PackageStatus;
  recommendedMoveType: RecommendedMoveType;
  linkedPages: string[];
  pagesToRepair: string[];
  pagesToCreate: MissingPagePlan[];
  comparisonTargets: string[];
  internalLinkTargets: { from: string; to: string; reason: string }[];
  linkedBriefIds: string[];
  linkedWaveIds: string[];
  rationale: string;
  executionSteps: string[];
  verificationPlan: string[];
  priorityScore: number;
  assetResponseSummary: string | null;
  notes: string | null;
};

type CompilerState = {
  attackPackages: FrontierAttackPackage[] | null;
  trackedMissingPages: TrackedMissingPage[] | null;
};

const _state: CompilerState = {
  attackPackages: null,
  trackedMissingPages: null,
};

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state.attackPackages !== null) return;
  const repo = getRepository();
  const [ap, tmp] = await Promise.all([
    repo.getFrontierAttackPackages(),
    repo.getTrackedMissingPages(),
  ]);
  _state.attackPackages = ap;
  _state.trackedMissingPages = tmp;
});

export const getAttackPackages = cache(
  async (): Promise<FrontierAttackPackage[]> => {
    await ensureLoaded();
    return _state.attackPackages!;
  },
);

export async function persistAttackPackages(): Promise<void> {
  await writeStore("frontier-attack-packages", await getAttackPackages());
}

// ── Compiler ──

export function compileFrontierAttack(
  frontier: FrontierOpportunity,
  snapshots: PageSnapshot[],
  briefs: PlaybookBrief[],
  waves: RolloutWave[],
  patterns: MinedPattern[],
  assetResponse?: AssetResponse | null
): FrontierAttackPackage {
  const now = new Date().toISOString();
  const snapByUrl = new Map<string, PageSnapshot>();
  for (const s of snapshots) snapByUrl.set(s.url.replace(/\/+$/, "").toLowerCase(), s);

  const linkedBriefs = briefs.filter((b) => frontier.linkedBriefIds.includes(b.id));
  const linkedWaves = waves.filter((w) => frontier.linkedWaveIds.includes(w.rolloutWaveId));

  let pkg: FrontierAttackPackage;
  switch (frontier.recommendedMoveType) {
    case "repair_existing_pages":
      pkg = compileRepair(frontier, snapByUrl, linkedBriefs, linkedWaves, now); break;
    case "roll_out_validated_pattern":
      pkg = compileRollout(frontier, snapByUrl, linkedBriefs, linkedWaves, patterns, now); break;
    case "create_missing_page":
      pkg = compileMissingPage(frontier, snapByUrl, linkedBriefs, now); break;
    case "expand_internal_link_cluster":
      pkg = compileInternalLinks(frontier, snapByUrl, now); break;
    case "comparison_content_play":
      pkg = compileComparison(frontier, snapByUrl, now); break;
    default:
      pkg = compileGeneric(frontier, linkedBriefs, linkedWaves, now); break;
  }

  if (assetResponse) {
    const label = assetResponse.recommendedAssetType.replace(/_/g, " ");
    const conf = assetResponse.confidenceLabel.replace(/_/g, " ");
    const parity = assetResponse.responseType.replace(/_/g, " ");
    pkg.assetResponseSummary = `${label} (${conf}) — ${parity}. ${assetResponse.ownedEquivalentExists ? "Owned equivalent exists." : "No owned equivalent."}`;
    pkg.rationale = `${pkg.rationale} Asset response: ${label} (${conf}).`;
  }

  return pkg;
}

function compileRepair(
  f: FrontierOpportunity, snaps: Map<string, PageSnapshot>,
  briefs: PlaybookBrief[], waves: RolloutWave[], now: string
): FrontierAttackPackage {
  const pagesToRepair = f.linkedPages.filter((url) => {
    const snap = snaps.get(url.replace(/\/+$/, "").toLowerCase());
    return snap && (snap.faqs.length === 0 || snap.schema_types.length === 0);
  });

  return {
    frontierAttackPackageId: `attack-${f.frontierOpportunityId}-${Date.now()}`,
    frontierOpportunityId: f.frontierOpportunityId,
    title: `Repair ${pagesToRepair.length} page${pagesToRepair.length !== 1 ? "s" : ""} for "${f.topic}"`,
    createdAt: now,
    status: "compiled",
    recommendedMoveType: "repair_existing_pages",
    linkedPages: f.linkedPages,
    pagesToRepair,
    pagesToCreate: [],
    comparisonTargets: [],
    internalLinkTargets: [],
    linkedBriefIds: briefs.map((b) => b.id),
    linkedWaveIds: waves.map((w) => w.rolloutWaveId),
    rationale: `${pagesToRepair.length} owned pages lack FAQ/schema for "${f.topic}". ${f.ownedShare}% owned share vs ${f.competitorCitations} competitor citations. Repairing structure is the highest-leverage first move.`,
    executionSteps: [
      `Identify the ${pagesToRepair.length} pages needing FAQ + schema`,
      ...pagesToRepair.map((p) => {
        const snap = snaps.get(p.replace(/\/+$/, "").toLowerCase());
        const path = p.replace(/^https?:\/\/[^/]+/, "");
        return `${path}: add ${snap?.faqs.length === 0 ? "FAQ section + " : ""}FAQPage JSON-LD`;
      }),
      briefs.length > 0 ? `${briefs.length} brief${briefs.length !== 1 ? "s" : ""} already generated — convert to tracked issues` : "Generate page-level briefs in Pages workbench",
      waves.length > 0 ? `${waves.length} wave${waves.length !== 1 ? "s" : ""} already proposed` : "Bundle compatible pages into a rollout wave",
      "Verify each page after deployment via Beacon page scanner",
    ],
    verificationPlan: [
      "Page scanner confirms FAQ count > 0 and schema present on each page",
      "Render check passes (raw = rendered) on repaired pages",
      "Monitor citation changes after 14–21 days via outcome watch",
    ],
    priorityScore: f.priorityScore + (briefs.length > 0 ? 30 : 0),
    assetResponseSummary: null,
    notes: null,
  };
}

function compileRollout(
  f: FrontierOpportunity, snaps: Map<string, PageSnapshot>,
  briefs: PlaybookBrief[], waves: RolloutWave[], patterns: MinedPattern[], now: string
): FrontierAttackPackage {
  const validated = patterns.filter((p) => p.evidence.executionConfidence === "execution_validated");
  const targetPages = f.linkedPages.filter((url) => {
    const snap = snaps.get(url.replace(/\/+$/, "").toLowerCase());
    return snap && (snap.faqs.length === 0 || snap.schema_types.length === 0);
  });

  return {
    frontierAttackPackageId: `attack-${f.frontierOpportunityId}-${Date.now()}`,
    frontierOpportunityId: f.frontierOpportunityId,
    title: `Roll out validated pattern to ${targetPages.length} page${targetPages.length !== 1 ? "s" : ""} for "${f.topic}"`,
    createdAt: now, status: "compiled",
    recommendedMoveType: "roll_out_validated_pattern",
    linkedPages: f.linkedPages, pagesToRepair: targetPages,
    pagesToCreate: [], comparisonTargets: [], internalLinkTargets: [],
    linkedBriefIds: briefs.map((b) => b.id),
    linkedWaveIds: waves.map((w) => w.rolloutWaveId),
    rationale: `${validated.length} validated pattern${validated.length !== 1 ? "s" : ""} available. ${targetPages.length} pages ready for rollout in "${f.topic}".`,
    executionSteps: [
      `Apply ${validated[0]?.name ?? "validated pattern"} to ${targetPages.length} pages`,
      ...targetPages.map((p) => `${p.replace(/^https?:\/\/[^/]+/, "")}: apply pattern components`),
      "Bundle into wave for coordinated handoff",
      "Verify structure via page scanner after deployment",
    ],
    verificationPlan: [
      "Scanner confirms pattern components present on all target pages",
      "Outcome watch monitors citation delta after 21+ days",
    ],
    priorityScore: f.priorityScore + (validated.length * 50),
    assetResponseSummary: null,
    notes: null,
  };
}

function compileMissingPage(
  f: FrontierOpportunity, snaps: Map<string, PageSnapshot>,
  briefs: PlaybookBrief[], now: string
): FrontierAttackPackage {
  const adjacentPages = f.linkedPages.filter((url) => {
    const snap = snaps.get(url.replace(/\/+$/, "").toLowerCase());
    return snap && snap.faqs.length > 0;
  });

  const missingPage: MissingPagePlan = {
    suggestedTitle: f.geography
      ? `${f.geography.charAt(0).toUpperCase() + f.geography.slice(1)} ${f.service ?? "Custom Home Builder"}`
      : f.service
        ? `${f.service.charAt(0).toUpperCase() + f.service.slice(1)} Services`
        : `${f.topic} Guide`,
    pageType: f.geography ? "city_page" : f.service ? "service_page" : "guide_page",
    targetTopic: f.topic,
    targetCity: f.geography,
    targetService: f.service,
    rationale: `Only ${f.ownedPageCount} owned page${f.ownedPageCount !== 1 ? "s" : ""} for a ${f.citationOpportunity}-citation topic. Dedicated coverage page would strengthen owned position.`,
    suggestedComponents: [
      "Topic-specific H1 and meta description",
      "1500+ words of original, relevant content",
      "FAQ section with 8–12 topic-specific questions",
      "FAQPage JSON-LD schema",
      f.geography ? "Location-specific content and signals" : "Service-specific process and capability content",
      "Internal links to/from related pages",
    ],
    suggestedInternalLinksIn: adjacentPages.slice(0, 5).map((p) => p.replace(/^https?:\/\/[^/]+/, "")),
    suggestedInternalLinksOut: ["/", "/services", ...adjacentPages.slice(0, 3).map((p) => p.replace(/^https?:\/\/[^/]+/, ""))],
    verificationExpectations: [
      "Page indexed and appearing in sitemap",
      "Scanner confirms FAQ + schema present",
      "Internal links verified bidirectionally",
      "Monitor for citation pickup within 30 days",
    ],
  };

  return {
    frontierAttackPackageId: `attack-${f.frontierOpportunityId}-${Date.now()}`,
    frontierOpportunityId: f.frontierOpportunityId,
    title: `Create missing page for "${f.topic}"`,
    createdAt: now, status: "compiled",
    recommendedMoveType: "create_missing_page",
    linkedPages: f.linkedPages, pagesToRepair: [],
    pagesToCreate: [missingPage],
    comparisonTargets: [], internalLinkTargets: [],
    linkedBriefIds: briefs.map((b) => b.id), linkedWaveIds: [],
    rationale: missingPage.rationale,
    executionSteps: [
      `Create new ${missingPage.pageType}: "${missingPage.suggestedTitle}"`,
      "Build with suggested components: FAQ, schema, 1500+ words",
      `Add internal links from ${missingPage.suggestedInternalLinksIn.length} existing pages`,
      "Publish and add to sitemap",
      "Run Beacon page scanner to verify structure",
    ],
    verificationPlan: missingPage.verificationExpectations,
    priorityScore: f.priorityScore + 40,
    assetResponseSummary: null,
    notes: null,
  };
}

function compileInternalLinks(
  f: FrontierOpportunity, snaps: Map<string, PageSnapshot>, now: string
): FrontierAttackPackage {
  const targets: FrontierAttackPackage["internalLinkTargets"] = [];
  const pages = f.linkedPages;
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length && j < i + 4; j++) {
      const from = pages[i].replace(/^https?:\/\/[^/]+/, "");
      const to = pages[j].replace(/^https?:\/\/[^/]+/, "");
      targets.push({ from, to, reason: `Both serve "${f.topic}" — strengthen cluster authority` });
    }
  }

  return {
    frontierAttackPackageId: `attack-${f.frontierOpportunityId}-${Date.now()}`,
    frontierOpportunityId: f.frontierOpportunityId,
    title: `Expand link cluster for "${f.topic}" (${targets.length} links)`,
    createdAt: now, status: "compiled",
    recommendedMoveType: "expand_internal_link_cluster",
    linkedPages: f.linkedPages, pagesToRepair: [], pagesToCreate: [],
    comparisonTargets: [], internalLinkTargets: targets,
    linkedBriefIds: [], linkedWaveIds: [],
    rationale: `${f.ownedPageCount} pages serve this topic but may lack cross-linking. Adding ${targets.length} internal links strengthens cluster authority.`,
    executionSteps: [
      ...targets.map((t) => `Link ${t.from} → ${t.to}`),
      "Verify links via page scanner internal link count",
    ],
    verificationPlan: ["Scanner shows increased internal link count on target pages"],
    priorityScore: f.priorityScore - 50,
    assetResponseSummary: null,
    notes: null,
  };
}

function compileComparison(
  f: FrontierOpportunity, snaps: Map<string, PageSnapshot>, now: string
): FrontierAttackPackage {
  const compTargets = f.linkedPages.slice(0, 3).map((p) => p.replace(/^https?:\/\/[^/]+/, ""));

  return {
    frontierAttackPackageId: `attack-${f.frontierOpportunityId}-${Date.now()}`,
    frontierOpportunityId: f.frontierOpportunityId,
    title: `Comparison content for "${f.topic}"`,
    createdAt: now, status: "compiled",
    recommendedMoveType: "comparison_content_play",
    linkedPages: f.linkedPages, pagesToRepair: [], pagesToCreate: [],
    comparisonTargets: compTargets, internalLinkTargets: [],
    linkedBriefIds: [], linkedWaveIds: [],
    rationale: `High competitor pressure (${f.competitorCitations} citations). Comparison content could differentiate owned positioning.`,
    executionSteps: [
      `Create comparison table/section on ${compTargets[0] ?? "primary page"}`,
      "Include entity differentiators, service scope, coverage area",
      "Add FAQPage schema for comparison questions",
      "Link from related city/service pages",
    ],
    verificationPlan: [
      "Scanner confirms comparison section + schema",
      "Monitor citation pickup for comparison queries",
    ],
    priorityScore: f.priorityScore - 30,
    assetResponseSummary: null,
    notes: "Speculative — comparison content effectiveness not yet validated by execution evidence",
  };
}

function compileGeneric(
  f: FrontierOpportunity, briefs: PlaybookBrief[], waves: RolloutWave[], now: string
): FrontierAttackPackage {
  return {
    frontierAttackPackageId: `attack-${f.frontierOpportunityId}-${Date.now()}`,
    frontierOpportunityId: f.frontierOpportunityId,
    title: `Strengthen "${f.topic}"`,
    createdAt: now, status: "compiled",
    recommendedMoveType: f.recommendedMoveType,
    linkedPages: f.linkedPages, pagesToRepair: [], pagesToCreate: [],
    comparisonTargets: [], internalLinkTargets: [],
    linkedBriefIds: briefs.map((b) => b.id), linkedWaveIds: waves.map((w) => w.rolloutWaveId),
    rationale: f.rationale,
    executionSteps: ["Review linked pages and briefs", "Execute appropriate structural improvements", "Verify via page scanner"],
    verificationPlan: ["Scanner confirms structural improvements", "Monitor outcome watch"],
    priorityScore: f.priorityScore,
    assetResponseSummary: null,
    notes: null,
  };
}

// ── Missing Page Tracked Object ──

export type MissingPageStatus = "planned" | "handed_off" | "drafted" | "launched" | "indexed" | "watching" | "completed" | "dismissed";

export type TrackedMissingPage = {
  missingPagePlanId: string;
  frontierAttackPackageId: string;
  title: string;
  pageType: string;
  targetTopic: string;
  targetCity: string | null;
  targetService: string | null;
  status: MissingPageStatus;
  rationale: string;
  suggestedComponents: string[];
  suggestedInternalLinksIn: string[];
  suggestedInternalLinksOut: string[];
  verificationExpectations: string[];
  createdAt: string;
  handedOffAt: string | null;
  launchedAt: string | null;
  indexedAt: string | null;
  notes: string | null;
};

export const getTrackedMissingPages = cache(
  async (): Promise<TrackedMissingPage[]> => {
    await ensureLoaded();
    return _state.trackedMissingPages!;
  },
);

export async function persistTrackedMissingPages(): Promise<void> {
  await writeStore("tracked-missing-pages", await getTrackedMissingPages());
}

export function _resetFrontierCompilerForTests(): void {
  _state.attackPackages = null;
  _state.trackedMissingPages = null;
}

// ── Package Progress ──

export type PackageProgress = {
  repairTotal: number;
  repairTracked: number;
  repairShipped: number;
  repairVerified: number;
  wavesLinked: number;
  wavesCompleted: number;
  missingTotal: number;
  missingLaunched: number;
  missingIndexed: number;
  totalActions: number;
  completedActions: number;
  pct: number;
};

export function computePackageProgress(
  pkg: FrontierAttackPackage,
  issues: import("./issues").PersistedIssue[],
  waves: RolloutWave[],
  missingPages: TrackedMissingPage[]
): PackageProgress {
  const issueMap = new Map(issues.map((i) => [i.issueId, i]));
  const waveMap = new Map(waves.map((w) => [w.rolloutWaveId, w]));

  const repairTotal = pkg.pagesToRepair.length;
  let repairTracked = 0, repairShipped = 0, repairVerified = 0;
  for (const iid of pkg.linkedBriefIds) {
    for (const issue of issues) {
      if (issue.issueId.includes(iid) || issue.category.includes("rollout")) {
        repairTracked++;
        if (issue.status === "shipped" || issue.status === "verified") repairShipped++;
        if (issue.status === "verified") repairVerified++;
        break;
      }
    }
  }

  let wavesCompleted = 0;
  for (const wid of pkg.linkedWaveIds) {
    const w = waveMap.get(wid);
    if (w?.status === "completed") wavesCompleted++;
  }

  const pkgMissing = missingPages.filter((m) => m.frontierAttackPackageId === pkg.frontierAttackPackageId);
  const missingTotal = pkgMissing.length;
  const missingLaunched = pkgMissing.filter((m) => m.status === "launched" || m.status === "indexed" || m.status === "watching" || m.status === "completed").length;
  const missingIndexed = pkgMissing.filter((m) => m.status === "indexed" || m.status === "watching" || m.status === "completed").length;

  const totalActions = repairTotal + missingTotal;
  const completedActions = repairVerified + pkgMissing.filter((m) => m.status === "completed").length;
  const pct = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;

  return {
    repairTotal, repairTracked, repairShipped, repairVerified,
    wavesLinked: pkg.linkedWaveIds.length, wavesCompleted,
    missingTotal, missingLaunched, missingIndexed,
    totalActions, completedActions, pct,
  };
}

// ── Package Handoff ──

export function generatePackageHandoff(pkg: FrontierAttackPackage, missingPages: TrackedMissingPage[]): string {
  const lines: string[] = [
    `## Campaign: ${pkg.title}`,
    "",
    `**Move type:** ${pkg.recommendedMoveType.replace(/_/g, " ")}`,
    `**Priority:** ${pkg.priorityScore}`,
    `**Pages involved:** ${pkg.linkedPages.length}`,
    "",
    "### Why now",
    pkg.rationale,
    "",
  ];

  if (pkg.pagesToRepair.length > 0) {
    lines.push("### Pages to repair");
    pkg.pagesToRepair.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  }

  const pkgMissing = missingPages.filter((m) => m.frontierAttackPackageId === pkg.frontierAttackPackageId);
  if (pkgMissing.length > 0) {
    lines.push("### Pages to create");
    for (const mp of pkgMissing) {
      lines.push(`\n**${mp.title}** (${mp.pageType})`);
      lines.push(`- Topic: ${mp.targetTopic}`);
      mp.suggestedComponents.forEach((c) => lines.push(`- ${c}`));
      if (mp.suggestedInternalLinksIn.length > 0) lines.push(`- Link from: ${mp.suggestedInternalLinksIn.join(", ")}`);
    }
    lines.push("");
  }

  if (pkg.internalLinkTargets.length > 0) {
    lines.push("### Internal links");
    pkg.internalLinkTargets.forEach((lt) => lines.push(`- ${lt.from} → ${lt.to}`));
    lines.push("");
  }

  lines.push("### Execution steps");
  pkg.executionSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");

  lines.push("### Verification");
  pkg.verificationPlan.forEach((v, i) => lines.push(`${i + 1}. ${v}`));
  lines.push("", "---", "_Generated by Beacon (draft plan — review before sending)_");

  return lines.join("\n");
}

// ── Derive package status ──

export function derivePackageStatus(
  pkg: FrontierAttackPackage,
  progress: PackageProgress
): PackageStatus {
  if (pkg.status === "dismissed") return "dismissed";
  if (progress.pct === 100 && progress.totalActions > 0) return "completed";
  if (progress.repairVerified > 0 || progress.missingIndexed > 0) return "partially_verified";
  if (progress.repairShipped > 0 || progress.missingLaunched > 0) return "in_progress";
  if (progress.repairTracked > 0 || progress.missingTotal > 0) return "launched";
  if (pkg.status === "launched" || pkg.status === "handed_off") return pkg.status;
  return pkg.status;
}

// ── Labels ──

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  proposed: "Proposed", compiled: "Compiled", launched: "Launched",
  handed_off: "Handed off", in_progress: "In progress",
  partially_verified: "Partially verified", completed: "Completed", dismissed: "Dismissed",
};
