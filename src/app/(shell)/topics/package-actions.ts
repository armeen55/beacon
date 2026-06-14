"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  getAttackPackages,
  persistAttackPackages,
  getTrackedMissingPages,
  persistTrackedMissingPages,
  generatePackageHandoff,
  type PackageStatus,
  type FrontierAttackPackage,
  type MissingPagePlan,
} from "@/domains/pages/frontier-compiler";
import { convertBriefToIssue } from "@/app/(shell)/pages/issue-actions";
import type { PlaybookBrief } from "@/domains/pages/playbook";

export async function launchAttackPackage(
  pkg: FrontierAttackPackage,
  briefs: PlaybookBrief[]
): Promise<{ success: boolean; handoffText: string }> {
  const action = "launchAttackPackage";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      packageId: pkg.frontierAttackPackageId,
      briefCount: briefs.length,
    },
  });
  const now = new Date().toISOString();

  const [attackPackages, trackedMissingPages] = await Promise.all([
    getAttackPackages(),
    getTrackedMissingPages(),
  ]);
  let persisted = attackPackages.find((p) => p.frontierAttackPackageId === pkg.frontierAttackPackageId);
  if (!persisted) {
    persisted = { ...pkg, status: "launched" as const, createdAt: now };
    attackPackages.push(persisted);
  } else {
    persisted.status = "launched";
  }

  const issueIds: string[] = [];
  for (const briefId of pkg.linkedBriefIds) {
    const brief = briefs.find((b) => b.id === briefId);
    if (!brief) continue;
    const result = await convertBriefToIssue(
      briefId, brief.title, brief.type, brief.pageUrl, brief.pagePath,
      brief.patternId, false, brief.spec, brief.gapTrigger,
      brief.recommendations, brief.verificationChecklist
    );
    if (result.success) issueIds.push(result.issueId);
  }
  persisted.linkedBriefIds = [...new Set([...persisted.linkedBriefIds, ...issueIds])];

  for (const mp of pkg.pagesToCreate) {
    const existing = trackedMissingPages.find(
      (t) => t.frontierAttackPackageId === pkg.frontierAttackPackageId && t.title === mp.suggestedTitle
    );
    if (!existing) {
      trackedMissingPages.push({
        missingPagePlanId: `mp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        frontierAttackPackageId: pkg.frontierAttackPackageId,
        title: mp.suggestedTitle,
        pageType: mp.pageType,
        targetTopic: mp.targetTopic,
        targetCity: mp.targetCity,
        targetService: mp.targetService,
        status: "planned",
        rationale: mp.rationale,
        suggestedComponents: mp.suggestedComponents,
        suggestedInternalLinksIn: mp.suggestedInternalLinksIn,
        suggestedInternalLinksOut: mp.suggestedInternalLinksOut,
        verificationExpectations: mp.verificationExpectations,
        createdAt: now,
        handedOffAt: null,
        launchedAt: null,
        indexedAt: null,
        notes: null,
      });
    }
  }

  await persistAttackPackages();
  await persistTrackedMissingPages();

  const handoffText = generatePackageHandoff(persisted, trackedMissingPages);

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, handoffText };
}

export async function updatePackageStatus(
  packageId: string,
  status: PackageStatus
): Promise<{ success: boolean }> {
  const action = "updatePackageStatus";
  const t0 = Date.now();
  log.info("Action started", { action, params: { packageId, status } });
  const pkg = (await getAttackPackages()).find((p) => p.frontierAttackPackageId === packageId);
  if (!pkg) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "package not found",
    });
    return { success: false };
  }
  pkg.status = status;
  await persistAttackPackages();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function updateMissingPageStatus(
  planId: string,
  status: string
): Promise<{ success: boolean }> {
  const action = "updateMissingPageStatus";
  const t0 = Date.now();
  log.info("Action started", { action, params: { planId, status } });
  const plan = (await getTrackedMissingPages()).find((p) => p.missingPagePlanId === planId);
  if (!plan) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "plan not found",
    });
    return { success: false };
  }
  const now = new Date().toISOString();
  plan.status = status as typeof plan.status;
  if (status === "handed_off") plan.handedOffAt = now;
  if (status === "launched") plan.launchedAt = now;
  if (status === "indexed") plan.indexedAt = now;
  await persistTrackedMissingPages();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function refreshCompetitorEvidence(): Promise<{ success: boolean; topicCount: number }> {
  const action = "refreshCompetitorEvidence";
  const t0 = Date.now();
  log.info("Action started", { action, params: {} });
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { computeCompetitorEvidence, persistComputedEvidence } = await import("@/domains/pages/competitor-evidence");
  const { computeAllAssetResponses, persistComputedAssetResponses } = await import("@/domains/pages/asset-response");
  const { computeFrontiers, getCurrentTenantFrontierVocab } = await import("@/domains/pages/frontier-planner");
  const { minePatterns, generateBriefs } = await import("@/domains/pages/playbook");
  const { getRolloutExecutions, getPatternEvidence } = await import("@/domains/pages/issues");
  const { getRolloutWaves } = await import("@/domains/pages/wave-planner");
  const { getResults, getChangelogEntries, getOpportunities } = await import("@/lib/seed-data.server");
  const { getEventDecisions } = await import("@/domains/attribution/store");
  const [results, changelogEntries, opportunities, rolloutExecutions, pe, rolloutWaves, eventDecisions] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getRolloutExecutions(),
    getPatternEvidence(),
    getRolloutWaves(),
    getEventDecisions(),
  ]);
  const { computeScorecard } = await import("@/domains/attribution/scorecard");

  const ciPath = join(process.cwd(), ".data", "citation-evidence-index.json");
  if (!existsSync(ciPath)) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "citation index missing",
    });
    return { success: false, topicCount: 0 };
  }
  const ci = JSON.parse(readFileSync(ciPath, "utf8"));

  const summaries = await computeCompetitorEvidence(ci);
  await persistComputedEvidence(summaries);

  let snaps: import("@/domains/pages/types").PageSnapshot[] = [];
  try {
    const snapPath = join(process.cwd(), ".data", "page-snapshots.json");
    if (existsSync(snapPath)) snaps = JSON.parse(readFileSync(snapPath, "utf8"));
  } catch {}

  const citMap = new Map<string, number>();
  for (const r of ci.by_page_and_topic ?? []) {
    if (r.is_owned) citMap.set(r.page_url.replace(/\/+$/, "").toLowerCase(), (citMap.get(r.page_url.replace(/\/+$/, "").toLowerCase()) ?? 0) + r.total_citations);
  }

  const rows = computeScorecard(changelogEntries, results, opportunities, eventDecisions);
  const patterns = minePatterns(snaps, citMap, rows, rolloutExecutions, pe);
  const briefs = generateBriefs(snaps, citMap, patterns);
  const frontierVocab = await getCurrentTenantFrontierVocab();
  const frontiers = computeFrontiers(ci, snaps, briefs, rolloutWaves, patterns, summaries, undefined, frontierVocab);

  const assetResps = computeAllAssetResponses(summaries, frontiers);
  await persistComputedAssetResponses(assetResps);

  revalidatePath("/", "layout");
  log.info("Action completed", {
    action,
    durationMs: Date.now() - t0,
  });
  return { success: true, topicCount: summaries.size };
}
