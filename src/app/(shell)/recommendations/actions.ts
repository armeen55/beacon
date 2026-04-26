"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  recordResponse,
  persistResponses,
  ensureRecommendationResponsesSeeded,
  deleteResponseByRecId,
} from "@/domains/product/recommendation-response-store";
import { createChangelogEntry } from "@/domains/changelog/actions";
import { updateChangelogHypothesis } from "@/domains/changelog/actions";
import { generateId, now } from "@/lib/actions";
import { writeStore } from "@/lib/persistence/json-store";
import { syncChangelogEntries } from "@/lib/persistence/dual-write";
import { changelogEntries } from "@/lib/seed-data.server";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { ChangelogEntry } from "@/domains/changelog/types";
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
import {
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "@/domains/recommendations/action-types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

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
  /** Backward-compat: first changelog id for single-entry path; first
   *  per-edit changelog id when N entries are created. */
  changeId?: string;
  /** Sprint 6A.1 Phase 12 — populated when Accept fanned out to N
   *  per-edit changelog entries. Empty array on the legacy single-
   *  entry path. */
  changeIds?: string[];
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
    /** Phase 5 (2026-04-24): surfaces through to changelog notes so the
     *  operator (and the URL-watcher) can see how confident the resolver
     *  was when the entry was stamped. Optional for safety. */
    confidence?: "low" | "medium" | "high";
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
 *  the decision summary (action / motive / confidence / reasoning), the
 *  adjudicator brief when present, proposed slug for create_new_page,
 *  suggested edits, and risks — so it's fully reviewable at /changes.
 *
 *  Phase 5 (2026-04-24): every string field is run through
 *  sanitizeOperatorCopy so Shield:/Internal: prefixes cannot reach the
 *  changelog even if the adjudicator ever emitted them. */
function buildChangelogNotes(rec: RecommendationActionPayload): string | null {
  const r = rec.resolution;
  if (!r) return null;
  const parts: string[] = [];

  // Decision summary — always present when resolution exists.
  const decisionLines = [
    `Action: ${r.action}`,
    `Motive: ${r.motive}`,
    r.confidence ? `Confidence: ${r.confidence}` : "",
    `Reasoning: ${sanitizeOperatorCopy(r.reasoning)}`,
  ].filter(Boolean);
  parts.push(`Decision:\n${decisionLines.join("\n")}`);

  if (r.specificRecommendation) {
    parts.push(
      `Specific recommendation:\n${sanitizeOperatorCopy(r.specificRecommendation)}`,
    );
  }
  // Proposed slug for create_new_page — needed so the operator can pick up
  // where the resolver left off when the eventual page is built.
  if (r.action === "create_new_page" && r.proposedSlug) {
    parts.push(`Proposed slug: ${sanitizeOperatorCopy(r.proposedSlug)}`);
  }
  if (r.pageBrief) {
    parts.push(
      [
        "Page brief:",
        `- Title: ${sanitizeOperatorCopy(r.pageBrief.recommendedTitle)}`,
        `- H1: ${sanitizeOperatorCopy(r.pageBrief.recommendedH1)}`,
        r.pageBrief.mustCoverAngles.length > 0
          ? `- Must cover: ${r.pageBrief.mustCoverAngles
              .map((a) => sanitizeOperatorCopy(a))
              .join("; ")}`
          : "",
        r.pageBrief.competitorAnglesToCounter.length > 0
          ? `- Counter competitors: ${r.pageBrief.competitorAnglesToCounter
              .map((a) => sanitizeOperatorCopy(a))
              .join("; ")}`
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
      const title = e.title ? ` — ${sanitizeOperatorCopy(e.title)}` : "";
      const body = e.body ? sanitizeOperatorCopy(e.body) : "";
      const why = sanitizeOperatorCopy(e.why);
      return `- [${e.type}/${e.scope}]${title}: ${body} (why: ${why})`;
    });
    parts.push(`Suggested edits:\n${editLines.join("\n")}`);
  }
  if (r.risks && r.risks.length > 0) {
    parts.push(
      `Risks:\n- ${r.risks.map((risk) => sanitizeOperatorCopy(risk)).join("\n- ")}`,
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Sprint 6A.1 Phase 12 (2026-04-24) — fan out Accept to N changelog
 * entries when the rec has typed `recommended_edits`.
 *
 * One changelog entry per edit. Each entry carries:
 *   - `action_type` (from the registry's enum)
 *   - `target_element_key` (stable key from page_element_inventory or
 *     `<type>[new]:<hash>` for additive)
 *   - `source_rec_id` (the rec's stableKey)
 *   - `change_description` = `displayLabel — why` (truncated)
 *   - `notes` = current/proposed text + evidence summary
 *
 * Pure server-side; pushes onto the in-memory `changelogEntries`
 * array AND dual-writes to Supabase (matches `createChangelogEntry`
 * semantics). Returns the array of created changelog ids.
 */
async function createChangelogEntriesForEdits(
  payload: RecommendationActionPayload,
  edits: ReadonlyArray<RecommendedEditRow>,
  shape: ReturnType<typeof mapRecToChangelogShape>,
  operatorTitle: string,
  tenantId: string,
): Promise<string[]> {
  const tsp = now();
  const ids: string[] = [];
  const newEntries: ChangelogEntry[] = [];

  for (const edit of edits) {
    const editId = generateId("cl");
    ids.push(editId);

    const spec = ACTION_TYPE_REGISTRY[edit.action_type as ActionType];
    // Pull signal_type from the registry when known; otherwise inherit
    // the rec-shape's signal_type as a safe default.
    const signalType = spec?.signalType ?? shape.signalType;

    // Per-edit description: short imperative the operator can scan
    // on /changes. Sanitized — no Shield:/Internal: prefixes.
    const editLabel = sanitizeOperatorCopy(
      edit.display_label ?? edit.action_type,
    );
    const editWhy = sanitizeOperatorCopy(edit.why);
    const description = `${editLabel} — ${editWhy}`;

    // Notes carry the structured before/after + evidence summary.
    const noteParts: string[] = [];
    if (edit.current_text) {
      noteParts.push(`Current:\n${sanitizeOperatorCopy(edit.current_text)}`);
    }
    if (edit.proposed_text) {
      noteParts.push(`Proposed:\n${sanitizeOperatorCopy(edit.proposed_text)}`);
    }
    if (edit.evidence && edit.evidence.length > 0) {
      const evidenceSummary = edit.evidence
        .map((ref) => {
          if (ref.type === "prompt") return `prompt:${ref.promptId}`;
          if (ref.type === "element") return `element:${ref.elementKey}`;
          if (ref.type === "owned_page") return `page:${ref.url}`;
          if (ref.type === "competitor")
            return `competitor:${ref.competitorName}`;
          if (ref.type === "prior_outcome")
            return `prior:${ref.actionType}`;
          return "";
        })
        .filter(Boolean)
        .join(" · ");
      if (evidenceSummary) noteParts.push(`Evidence: ${evidenceSummary}`);
    }
    if (edit.measurement_plan) {
      noteParts.push(
        `Measurement plan:\n${sanitizeOperatorCopy(edit.measurement_plan)}`,
      );
    }
    if (edit.risks && edit.risks.length > 0) {
      noteParts.push(
        `Risks:\n- ${edit.risks.map((r) => sanitizeOperatorCopy(r)).join("\n- ")}`,
      );
    }
    const notes = noteParts.length > 0 ? noteParts.join("\n\n") : null;

    const entry: ChangelogEntry = {
      id: editId,
      timestamp: tsp,
      signal_type: signalType,
      asset_type: shape.assetType,
      url: shape.url,
      asset_name: operatorTitle,
      change_description: description,
      topic_targeted: sanitizeOperatorCopy(shape.topicTargeted),
      city_targeted: shape.cityTargeted
        ? sanitizeOperatorCopy(shape.cityTargeted)
        : null,
      hypothesis: operatorTitle,
      hypothesis_source: "recommendation",
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes,
      created_at: tsp,
      updated_at: tsp,
      source_rec_id: payload.stableKey,
      action_type: edit.action_type,
      target_element_key: edit.target_element_key ?? undefined,
      tenant_id: edit.tenant_id ?? "",
    };
    newEntries.push(entry);
  }

  // Push all then persist once for efficiency.
  for (const entry of newEntries) {
    changelogEntries.push(entry);
  }
  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries(newEntries, tenantId);
  } catch (e) {
    console.error(
      "[recommendations] per-edit changelog Supabase sync failed:",
      e,
    );
  }
  return ids;
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

  // Phase 7.7b Commit 5 (2026-04-25): persistResponses now requires
  // tenantId; hoist resolution to the top of the action.
  const tenantId = await currentTenantId();

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
  await persistResponses(tenantId);

  const resolvedAction = payload.resolution?.action ?? null;
  let changeId: string | undefined;
  let changeIds: string[] | undefined;

  // Sprint 6A.1 Phase 12-fix (2026-04-25): fresh-read the rec's typed
  // edits BEFORE any gating. The presence of N typed edits in
  // `recommended_edits` IS the operator's explicit per-edit approval
  // (the UI button copy literally says "Accept — track N edits"), so
  // the fan-out must fire regardless of `shouldStampChangelog`'s
  // generic action-type gate. The gate still applies to the legacy
  // single-entry path below.
  // Sprint 7 Phase 7.5b Commit 2 (2026-04-25) — tenant-bound read.
  // Phase 7.7b Commit 2 (2026-04-25) — hoisted out of the try block so
  // the per-edit fan-out below can thread it into syncChangelogEntries.
  // Phase 7.7b Commit 5 (2026-04-25) — tenantId resolved at the top of
  // the action; reuse here.
  let editsForRec: RecommendedEditRow[] = [];
  try {
    const allEdits = await getRepository().forTenant(tenantId).getRecommendedEdits();
    editsForRec = allEdits.filter((e) => e.rec_id === payload.stableKey);
  } catch (e) {
    // Graceful degrade: if the repo read fails, log and fall back
    // to the legacy path. Acceptance never fails because edits read
    // failed.
    log.warn("acceptRecommendation: edits read failed; falling back", {
      stableKey: payload.stableKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }

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

  // Per-edit fan-out — fires whenever typed edits exist. Bypasses
  // `shouldStampChangelog` because the typed edits ARE the operator's
  // explicit, scoped approval (overrides the generic needs_review /
  // watch / split gate that protects the LEGACY single-entry path).
  if (editsForRec.length > 0) {
    try {
      changeIds = await createChangelogEntriesForEdits(
        payload,
        editsForRec,
        shape,
        operatorTitle,
        tenantId,
      );
      changeId = changeIds[0];
      // Stamp hypothesis for each so /changes shows the rec-derived
      // title immediately. Best-effort.
      for (const id of changeIds) {
        try {
          await updateChangelogHypothesis(id, operatorTitle, "recommendation");
        } catch (err) {
          log.warn("acceptRecommendation: hypothesis stamp failed", {
            changeId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      revalidatePath("/recommendations");
      revalidatePath("/", "layout");
      log.info("Action completed", {
        action,
        durationMs: Date.now() - t0,
        params: {
          changeIds,
          editCount: editsForRec.length,
          mode: "per-edit",
        },
      });
      return { success: true, changeId, changeIds };
    } catch (e) {
      log.error("acceptRecommendation: per-edit fan-out failed", {
        stableKey: payload.stableKey,
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        success: false,
        error: `Failed to create per-edit changelog entries: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  // Legacy single-entry path — runs ONLY when no typed edits exist
  // AND the rec's resolved action is changelog-worthy.
  if (shouldStampChangelog(payload.type, resolvedAction)) {
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
    params: {
      changeId: changeId ?? null,
      mode: changeId ? "single-entry" : "no-changelog",
    },
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
  await persistResponses(await currentTenantId());

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
  await persistResponses(await currentTenantId());

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

  // Phase 7.7c (2026-04-25): tenant-scoped Undo. Without this, a cross-
  // tenant rec_id collision would let one tenant's Undo silently delete
  // another tenant's response. `await currentTenantId()` here mirrors
  // the resolution pattern used by accept/defer/dismiss.
  const tenantId = await currentTenantId();

  await ensureRecommendationResponsesSeeded();
  // Sprint 6A.1.16 (2026-04-25): use the new deleteResponseByRecId
  // helper so the Supabase row is actually removed. The pre-fix path
  // spliced the in-memory array + called persistResponses (upsert-
  // only), which left a stale "accepted" / "dismissed" / "deferred"
  // row in production for any other lambda to read.
  const removed = await deleteResponseByRecId(stableKey, tenantId);
  log.info("Action completed", {
    action,
    durationMs: Date.now() - t0,
    params: { removed },
  });

  revalidatePath("/recommendations");
  return { success: true };
}
