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
): Promise<{ success: boolean }> {
  const action = "respondToRecommendation";
  const t0 = Date.now();
  log.info("Action started", { action, params: { recId, status } });
  recordResponse(recId, status);
  await persistResponses();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
