"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  recordResponse,
  persistResponses,
  ensureRecommendationResponsesSeeded,
  type RecommendationResponseStatus,
} from "@/domains/product/recommendation-response-store";
import { currentTenantId } from "@/lib/tenant-context";

export async function respondToRecommendation(
  recId: string,
  status: RecommendationResponseStatus,
  context?: { targetPageUrl?: string | null; patternId?: string | null },
): Promise<{ success: boolean }> {
  const action = "respondToRecommendation";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      recId,
      status,
      hasTarget: Boolean(context?.targetPageUrl),
      hasPattern: Boolean(context?.patternId),
    },
  });
  // Phase 3.5C: merge DB state into the in-memory array before mutating so
  // we don't overwrite existing rows on a cold Vercel lambda.
  await ensureRecommendationResponsesSeeded();
  recordResponse(recId, status, context);
  await persistResponses(await currentTenantId());
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
