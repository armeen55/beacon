"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  recommendationResponses,
  recordResponse,
  persistResponses,
  ensureRecommendationResponsesSeeded,
} from "@/domains/product/recommendation-response-store";
import { createChangelogEntry } from "@/domains/changelog/actions";
import { updateChangelogHypothesis } from "@/domains/changelog/actions";
import type {
  RecommendationCandidate,
  RecommendationType,
} from "@/domains/recommendations/generate";
import type {
  RecommendationAction,
  RecommendationMotive,
} from "@/domains/recommendations/resolved-types";
import { NEEDS_NEW_PAGE } from "@/domains/recommendations/resolved-types";
import type { PageBrief, SuggestedEdit } from "@/domains/recommendations/adjudicator-schema";
import { buildResolvedRecommendationTitle } from "@/domains/recommendations/build-title";
import { sanitizeOperatorCopy } from "@/domains/recommendations/copy-sanitize";
import type { SignalType, AssetType } from "@/lib/constants";

/**
 * Server actions for /recommendations (Phase v6 Commit 4, 2026-04-23).
 *
 * Accept / defer / dismiss record operator decisions in the existing
 * recommendation-response store (keyed by stableKey). Accept ALSO stamps
 * a changelog entry when the rec implies an observable site change — the
 * Z-score url-watcher then picks it up and starts watching automatically.
 *
 * The rec payload is passed from the client so this action doesn't need
 * to re-run the generator/prioritizer just to find the rec again.
 */

export type RecommendationActionResponse = {
  success: boolean;
  error?: string;
  changeId?: string;
};

/** A minimal slice of RecommendationCandidate that the client sends back
 *  with the accept action. Decoupling the action from the full candidate
 *  shape makes the client surface stable across small generator tweaks.
 *
 *  v7 Commit 5 (2026-04-23): carries the resolver's output so Accept
 *  stamps the changelog with the resolved URL + brief. Legacy fields
 *  stay for backward compatibility. */
export type RecommendationActionPayload = {
  stableKey: string;
  type: RecommendationType;
  title: string;
  description: string;
  clusterLabel: string | null;
  clusterKind: "geo" | "topic" | null;
  /** v7: resolver / adjudicator output (optional for safety). */
  resolution?: {
    action: RecommendationAction;
    motive: RecommendationMotive;
    targetUrl: string;
    reasoning: string;
    operatorTitle?: string;
    specificRecommendation?: string;
    suggestedEdits?: SuggestedEdit[];
    pageBrief?: PageBrief | null;
    proposedSlug?: string | null;
    risks?: string[];
  };
};

/** Determine whether an Accept should create a changelog entry. Watch recs
 *  and explicit Review recs don't — there's no action implied yet. */
function shouldStampChangelog(
  type: RecommendationType,
  action: RecommendationAction | null,
): boolean {
  // watch / needs_review / split_or_separate_page all require explicit
  // operator confirmation before creating a tracked experiment.
  if (
    action === "watch" ||
    action === "needs_review" ||
    action === "split_or_separate_page"
  )
    return false;
  return type !== "watch_winning_cluster";
}

/** Map a rec into the shape `createChangelogEntry` expects. */
function mapRecToChangelogShape(rec: RecommendationActionPayload): {
  signalType: SignalType;
  assetType: AssetType;
  topicTargeted: string;
  cityTargeted: string | null;
  url: string | null;
} {
  const action: RecommendationAction | null = rec.resolution?.action ?? null;

  // v7 Commit 5: map the resolved action (not the raw candidate type) to
  // changelog signal/asset types so /changes correctly categorizes it.
  const isNewPage =
    action === "create_new_page" ||
    (!action &&
      (rec.type === "create_cluster_page" || rec.type === "create_single"));
  const isStructural =
    action === "add_section_or_faq" || action === "merge_or_dedupe";

  const signalType: SignalType = isNewPage ? "page" : isStructural ? "technical" : "content";

  let assetType: AssetType;
  if (rec.clusterKind === "geo") {
    assetType = "city_page";
  } else if (rec.type === "create_cluster_page") {
    assetType = "hub_page";
  } else {
    assetType = "service_page";
  }

  const topicTargeted =
    rec.clusterKind === "topic"
      ? (rec.clusterLabel ?? "prompt cluster")
      : (rec.clusterLabel ?? "prompt decision");
  const cityTargeted =
    rec.clusterKind === "geo" ? (rec.clusterLabel ?? null) : null;

  // Prefer the resolved URL when it's a real page (not the sentinel).
  const resolvedUrl =
    rec.resolution &&
    rec.resolution.targetUrl &&
    rec.resolution.targetUrl !== NEEDS_NEW_PAGE
      ? rec.resolution.targetUrl
      : null;

  return {
    signalType,
    assetType,
    topicTargeted,
    cityTargeted,
    url: resolvedUrl,
  };
}

/** Build the notes body that travels with the changelog entry. Contains
 *  the adjudicator brief when present so it's reviewable at /changes. */
function buildChangelogNotes(rec: RecommendationActionPayload): string | null {
  const r = rec.resolution;
  if (!r) return null;
  const parts: string[] = [];
  if (r.specificRecommendation) {
    parts.push(`Specific recommendation:\n${r.specificRecommendation}`);
  }
  if (r.pageBrief) {
    parts.push(
      [
        "Page brief:",
        `- Title: ${r.pageBrief.recommendedTitle}`,
        `- H1: ${r.pageBrief.recommendedH1}`,
        r.pageBrief.mustCoverAngles.length > 0
          ? `- Must cover: ${r.pageBrief.mustCoverAngles.join("; ")}`
          : "",
        r.pageBrief.competitorAnglesToCounter.length > 0
          ? `- Counter competitors: ${r.pageBrief.competitorAnglesToCounter.join("; ")}`
          : "",
        r.pageBrief.internalLinksToAdd.length > 0
          ? `- Link internally: ${r.pageBrief.internalLinksToAdd.join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (r.suggestedEdits && r.suggestedEdits.length > 0) {
    const editLines = r.suggestedEdits.map((e) => {
      const title = e.title ? ` — ${e.title}` : "";
      return `- [${e.type}/${e.scope}]${title}: ${e.body ?? ""} (why: ${e.why})`;
    });
    parts.push(`Suggested edits:\n${editLines.join("\n")}`);
  }
  if (r.risks && r.risks.length > 0) {
    parts.push(`Risks:\n- ${r.risks.join("\n- ")}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export async function acceptRecommendation(
  payload: RecommendationActionPayload,
): Promise<RecommendationActionResponse> {
  const action = "acceptRecommendation";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { stableKey: payload.stableKey, type: payload.type },
  });

  const resolvedUrlForStore =
    payload.resolution?.targetUrl &&
    payload.resolution.targetUrl !== NEEDS_NEW_PAGE
      ? payload.resolution.targetUrl
      : null;

  await ensureRecommendationResponsesSeeded();
  recordResponse(payload.stableKey, "accepted", {
    targetPageUrl: resolvedUrlForStore,
    patternId: null,
  });
  await persistResponses();

  const resolvedAction = payload.resolution?.action ?? null;
  let changeId: string | undefined;
  if (shouldStampChangelog(payload.type, resolvedAction)) {
    const shape = mapRecToChangelogShape(payload);
    // Phase 1 (2026-04-24): server-side defense. Pass the resolution back
    // through the shared title builder + sanitizer so the changelog entry
    // never carries a raw generator title or Shield:/Internal: prefix,
    // even if a legacy or misbehaving caller sent one in payload.title.
    const operatorTitle = buildResolvedRecommendationTitle({
      clusterLabel: payload.clusterLabel,
      promptTextFallback: sanitizeOperatorCopy(payload.title),
      resolution: payload.resolution
        ? {
            action: payload.resolution.action,
            motive: payload.resolution.motive,
            targetUrl: payload.resolution.targetUrl,
            confidence: "medium",
            confidenceReason: "",
            tier: "observation",
            reasoning: payload.resolution.reasoning,
            cannibalization: null,
            evidenceRefs: [],
            operatorTitle: payload.resolution.operatorTitle,
            specificRecommendation: payload.resolution.specificRecommendation,
            suggestedEdits: payload.resolution.suggestedEdits,
            pageBrief: payload.resolution.pageBrief ?? null,
            proposedSlug: payload.resolution.proposedSlug ?? null,
            risks: payload.resolution.risks,
          }
        : undefined,
    });
    const changeDescription = sanitizeOperatorCopy(
      payload.resolution?.specificRecommendation ??
        payload.resolution?.reasoning ??
        payload.description,
    );
    const notes = buildChangelogNotes(payload);

    const fd = new FormData();
    fd.set("asset_name", operatorTitle);
    fd.set("change_description", changeDescription);
    fd.set("signal_type", shape.signalType);
    fd.set("asset_type", shape.assetType);
    fd.set("topic_targeted", sanitizeOperatorCopy(shape.topicTargeted));
    if (shape.cityTargeted)
      fd.set("city_targeted", sanitizeOperatorCopy(shape.cityTargeted));
    if (shape.url) fd.set("url", shape.url);
    fd.set("hypothesis", operatorTitle);
    if (notes) fd.set("notes", notes);

    const result = await createChangelogEntry(fd);
    if (!result.success) {
      log.error("Action failed", {
        action,
        durationMs: Date.now() - t0,
        error: `changelog creation failed: ${result.error ?? "unknown"}`,
      });
      return {
        success: false,
        error: `Changelog entry failed: ${result.error ?? "unknown error"}`,
      };
    }
    changeId = result.changeId;
    if (changeId) {
      await updateChangelogHypothesis(changeId, operatorTitle, "recommendation");
    }
  }

  revalidatePath("/recommendations");
  revalidatePath("/", "layout");
  log.info("Action completed", {
    action,
    durationMs: Date.now() - t0,
    params: { changeId: changeId ?? null },
  });
  return { success: true, changeId };
}

export async function deferRecommendation(
  stableKey: string,
): Promise<RecommendationActionResponse> {
  const action = "deferRecommendation";
  const t0 = Date.now();
  log.info("Action started", { action, params: { stableKey } });

  await ensureRecommendationResponsesSeeded();
  recordResponse(stableKey, "deferred");
  await persistResponses();

  revalidatePath("/recommendations");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function dismissRecommendation(
  stableKey: string,
): Promise<RecommendationActionResponse> {
  const action = "dismissRecommendation";
  const t0 = Date.now();
  log.info("Action started", { action, params: { stableKey } });

  await ensureRecommendationResponsesSeeded();
  recordResponse(stableKey, "dismissed");
  await persistResponses();

  revalidatePath("/recommendations");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function undoRecommendationResponse(
  stableKey: string,
): Promise<RecommendationActionResponse> {
  const action = "undoRecommendationResponse";
  const t0 = Date.now();
  log.info("Action started", { action, params: { stableKey } });

  await ensureRecommendationResponsesSeeded();
  const idx = recommendationResponses.findIndex((r) => r.recId === stableKey);
  if (idx >= 0) {
    recommendationResponses.splice(idx, 1);
    await persistResponses();
  }
  revalidatePath("/recommendations");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
