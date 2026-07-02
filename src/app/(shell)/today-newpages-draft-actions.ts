"use server";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { saveMoveDraft, getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
import {
  draftFullPageStructured,
  assembleDraftPage,
  serializeFullPageDraft,
  deserializeFullPageDraft,
  reassembleFromPersisted,
  type FullPageBriefInput,
  type FullPageGroundingInput,
  type AssembledDraftPage,
} from "@/domains/llm/draft-full-page";

/**
 * today-newpages-draft-actions (BEACON 500 item 55, 2026-07-02) — the operator
 * action behind the New Pages card's "Draft the full page" button. One click
 * walks the already-persisted create_page_brief's outline section by section
 * (draftFullPageStructured), assembles a paste-ready page, and persists the
 * compact result (move_drafts, kind=full_page_draft) so it survives reload.
 *
 * Bounded on purpose: ONE page per click (no nightly auto-drafting this cycle),
 * max 8 sections (draft-full-page.ts's MAX_SECTIONS), everything through the
 * existing budget-gated/fail-closed callStructuredLLM. Operator-gated.
 */

export type DraftFullPageResponse =
  | { ok: false; reason: string }
  | { ok: true; page: AssembledDraftPage; costUsd: number; persisted: boolean };

export async function draftFullPageAction(input: {
  recId: string;
  topic: string;
  brief: FullPageBriefInput;
  grounding: Omit<FullPageGroundingInput, "tenantId">;
}): Promise<DraftFullPageResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const recId = input.recId?.trim();
  if (!recId) return { ok: false, reason: "No page id." };
  if (!input.brief.outline || input.brief.outline.length === 0) {
    return { ok: false, reason: "This brief has no outline yet. Prepare the page brief first." };
  }

  const tenantId = await currentTenantId();
  const result = await draftFullPageStructured(input.brief, { ...input.grounding, tenantId });
  if (result.status !== "drafted") {
    return { ok: false, reason: result.status === "off" ? "AI drafting is off." : "Budget reached for this month." };
  }

  const page = assembleDraftPage(input.brief, result);
  const content = serializeFullPageDraft(page);
  let persisted = false;
  if (content) {
    persisted = await saveMoveDraft(tenantId, recId, "full_page_draft", content).catch(() => false);
  }

  return { ok: true, page, costUsd: result.totalCostUsd, persisted };
}

/** Read a previously-persisted full_page_draft back into a paste-ready page,
 *  re-assembled against the SAME brief (title/meta/faq are not re-persisted —
 *  they already live in create_page_brief). Fail-soft -> null. */
export async function loadSavedFullPageDraftAction(
  recId: string,
  brief: FullPageBriefInput,
): Promise<AssembledDraftPage | null> {
  if (!(await isOperatorModeServer())) return null;
  const tenantId = await currentTenantId();
  const drafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
  const raw = drafts.get(`${recId}::full_page_draft`)?.content;
  const persisted = deserializeFullPageDraft(raw);
  if (!persisted) return null;
  return reassembleFromPersisted(brief, persisted);
}
