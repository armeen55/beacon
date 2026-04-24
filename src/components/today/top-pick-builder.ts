/**
 * Pure builder that converts a prioritized + resolved rec into a
 * TopPickSummary with clean operator-facing copy. Extracted from
 * today-data.ts so it's unit-testable and doesn't pull in Supabase
 * reads by accident.
 *
 * Stabilization (2026-04-24): title + action always derive from the
 * resolver's output, never the raw generator title. Internal taxonomy
 * prefixes are stripped.
 */

import { sanitizeOperatorCopy } from "@/domains/recommendations/copy-sanitize";
import type { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import type { TopPickSummary } from "./top-pick-card";

type PrioritizedQueueItem = ReturnType<
  typeof prioritizeRecommendations
>["queue"][number];

export function buildTopPickSummary(
  top: PrioritizedQueueItem,
): TopPickSummary {
  const resolution = top.resolution;
  const action = resolution?.action ?? "create_new_page";
  const resolvedUrl =
    resolution &&
    resolution.targetUrl &&
    resolution.targetUrl !== "needs_new_page"
      ? resolution.targetUrl
      : null;

  let title: string;
  if (resolution?.operatorTitle && resolution.operatorTitle.trim().length > 0) {
    title = resolution.operatorTitle;
  } else {
    const cleanLabel = sanitizeOperatorCopy(top.clusterLabel ?? "") || null;
    if (action === "strengthen_existing_page" && resolvedUrl) {
      title = `Strengthen ${shortUrlPath(resolvedUrl)}${
        cleanLabel ? ` for ${cleanLabel} prompts` : ""
      }`;
    } else if (action === "expand_existing_page" && resolvedUrl) {
      title = `Expand ${shortUrlPath(resolvedUrl)}${
        cleanLabel ? ` to cover ${cleanLabel}` : ""
      }`;
    } else if (action === "merge_or_dedupe" && resolvedUrl) {
      title = `Merge owned pages into ${shortUrlPath(resolvedUrl)}`;
    } else if (action === "needs_review") {
      title = cleanLabel
        ? `Review ${cleanLabel} recommendation`
        : "Review recommendation";
    } else if (action === "watch") {
      title = cleanLabel ? `Watch ${cleanLabel}` : "Watch winning cluster";
    } else if (action === "add_section_or_faq" && resolvedUrl) {
      title = `Add section to ${shortUrlPath(resolvedUrl)}`;
    } else {
      title = cleanLabel
        ? `Create a ${cleanLabel} page`
        : "Create a new page";
    }
  }

  return {
    stableKey: top.stableKey,
    type: top.type,
    title,
    reasoning: resolution?.reasoning ?? top.reasoning,
    tier: top.tier,
    action,
    resolvedUrl,
  };
}

function shortUrlPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return url;
  }
}
