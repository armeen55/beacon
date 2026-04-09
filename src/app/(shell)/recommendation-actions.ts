"use server";

import { revalidatePath } from "next/cache";
import {
  recordResponse,
  persistResponses,
  type RecommendationResponseStatus,
} from "@/domains/product/recommendation-response-store";

export async function respondToRecommendation(
  recId: string,
  status: RecommendationResponseStatus,
): Promise<{ success: boolean }> {
  recordResponse(recId, status);
  await persistResponses();
  revalidatePath("/", "layout");
  return { success: true };
}
