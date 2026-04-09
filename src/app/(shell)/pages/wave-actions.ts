"use server";

import { revalidatePath } from "next/cache";
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
  const wave = rolloutWaves.find((w) => w.rolloutWaveId === waveId);
  if (!wave) return { success: false };

  wave.status = status;
  await persistRolloutWaves();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function adoptWave(
  waveId: string
): Promise<{ success: boolean }> {
  const wave = rolloutWaves.find((w) => w.rolloutWaveId === waveId);
  if (!wave) return { success: false };

  if (wave.status === "proposed") {
    wave.status = "proposed";
  }

  await persistRolloutWaves();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function handOffWave(
  waveId: string,
  briefs: PlaybookBrief[]
): Promise<{ success: boolean; handoffText: string }> {
  const wave = rolloutWaves.find((w) => w.rolloutWaveId === waveId);
  if (!wave) return { success: false, handoffText: "" };

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
  return { success: true, handoffText };
}
