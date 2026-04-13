"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  rolloutWaves,
  persistRolloutWaves,
  generateWaveHandoff,
  type WaveStatus,
} from "@/domains/pages/wave-planner";
import type { PlaybookBrief } from "@/domains/pages/playbook";
import { convertBriefToIssue } from "./issue-actions";

export async function updateWaveStatus(
  waveId: string,
  status: WaveStatus
): Promise<{ success: boolean }> {
  const action = "updateWaveStatus";
  const t0 = Date.now();
  log.info("Action started", { action, params: { waveId, status } });
  const wave = rolloutWaves.find((w) => w.rolloutWaveId === waveId);
  if (!wave) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "wave not found",
    });
    return { success: false };
  }

  wave.status = status;
  await persistRolloutWaves();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function adoptWave(
  waveId: string
): Promise<{ success: boolean }> {
  const action = "adoptWave";
  const t0 = Date.now();
  log.info("Action started", { action, params: { waveId } });
  const wave = rolloutWaves.find((w) => w.rolloutWaveId === waveId);
  if (!wave) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "wave not found",
    });
    return { success: false };
  }

  if (wave.status === "proposed") {
    wave.status = "proposed";
  }

  await persistRolloutWaves();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function handOffWave(
  waveId: string,
  briefs: PlaybookBrief[]
): Promise<{ success: boolean; handoffText: string }> {
  const action = "handOffWave";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { waveId, briefCount: briefs.length },
  });
  const wave = rolloutWaves.find((w) => w.rolloutWaveId === waveId);
  if (!wave) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "wave not found",
    });
    return { success: false, handoffText: "" };
  }

  const issueIds: string[] = [];
  for (const briefId of wave.briefIds) {
    const brief = briefs.find((b) => b.id === briefId);
    if (!brief) continue;
    const result = await convertBriefToIssue(
      briefId,
      brief.title,
      brief.type,
      brief.pageUrl,
      brief.pagePath,
      brief.patternId,
      false,
      brief.spec,
      brief.gapTrigger,
      brief.recommendations,
      brief.verificationChecklist
    );
    if (result.success) issueIds.push(result.issueId);
  }

  wave.issueIds = issueIds;
  wave.status = "handed_off";
  const handoffText = generateWaveHandoff(wave, briefs);

  await persistRolloutWaves();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, handoffText };
}
