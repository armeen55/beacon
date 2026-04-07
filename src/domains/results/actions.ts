"use server";

import { revalidatePath } from "next/cache";
import { results } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import { METRIC_DIRECTION } from "@/lib/constants";
import type { Result } from "@/domains/results/types";
import type { Platform, MetricType } from "@/lib/constants";

export async function createResult(
  formData: FormData
): Promise<{ success: boolean; error?: string; resultId?: string }> {
  const metricType = formData.get("metric_type") as MetricType;
  const platform = formData.get("platform") as Platform;
  const metricValueRaw = formData.get("metric_value") as string;
  const previousValueRaw = (formData.get("previous_value") as string) || "";
  const snapshotDate =
    (formData.get("snapshot_date") as string) ||
    new Date().toISOString().split("T")[0];
  const topic = (formData.get("topic") as string)?.trim() || null;
  const city = (formData.get("city") as string)?.trim() || null;
  const urlMeasured = (formData.get("url_measured") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;

  const attributedIdsRaw = formData.get("attributed_changelog_ids") as string;
  const attributedChangelogIds = attributedIdsRaw
    ? attributedIdsRaw.split(",").filter(Boolean)
    : [];

  if (!metricType || !platform || !metricValueRaw) {
    return { success: false, error: "Metric, platform, and value are required." };
  }

  const metricValue = parseFloat(metricValueRaw);
  if (isNaN(metricValue)) {
    return { success: false, error: "Value must be a number." };
  }

  const previousValue = previousValueRaw ? parseFloat(previousValueRaw) : null;
  let delta: number | null = null;
  let deltaPercentage: number | null = null;

  if (previousValue !== null && !isNaN(previousValue)) {
    const dir = METRIC_DIRECTION[metricType];
    const rawDelta = metricValue - previousValue;
    delta = dir === "lower_is_better" ? -rawDelta : rawDelta;
    if (previousValue !== 0) {
      deltaPercentage = Math.round((rawDelta / Math.abs(previousValue)) * 1000) / 10;
    }
  }

  const resultId = generateId("res");

  const result: Result = {
    id: resultId,
    snapshot_date: snapshotDate,
    platform,
    metric_type: metricType,
    metric_value: metricValue,
    previous_value: previousValue,
    delta,
    delta_percentage: deltaPercentage,
    topic,
    city,
    url_measured: urlMeasured,
    attributed_changelog_ids: attributedChangelogIds,
    notes,
    created_at: now(),
  };

  results.push(result);

  revalidatePath("/", "layout");
  return { success: true, resultId };
}
