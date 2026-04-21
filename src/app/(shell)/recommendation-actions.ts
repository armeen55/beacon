"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  recordResponse,
  persistResponses,
  type RecommendationResponseStatus,
} from "@/domains/product/recommendation-response-store";

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
  recordResponse(recId, status, context);
  await persistResponses();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
