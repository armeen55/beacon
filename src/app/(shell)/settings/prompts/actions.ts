"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { log } from "@/lib/logger";

/**
 * Settings/Prompts server actions (Phase v5 Commit 4, 2026-04-24).
 *
 * Minimum-viable prompt management: toggle active, add new prompt.
 * No inline editing (deactivate + re-add if needed). No deletion.
 * No bulk actions. Writes go straight to Supabase; canonical-store
 * consumers re-read on next render via ensureCanonicalStoresSeeded.
 */

export type TogglePromptActiveResult = {
  success: boolean;
  error?: string;
};

export async function togglePromptActive(
  promptId: string,
  isActive: boolean,
): Promise<TogglePromptActiveResult> {
  const started = Date.now();
  log.info("Action started", {
    action: "togglePromptActive",
    params: { promptId, isActive },
  });
  try {
    const { error } = await getSupabaseAdmin()
      .from("tracked_prompts")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", promptId);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/prompts");
    revalidatePath("/prompts");
    revalidatePath("/");
    log.info("Action completed", {
      action: "togglePromptActive",
      durationMs: Date.now() - started,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Action failed", {
      action: "togglePromptActive",
      durationMs: Date.now() - started,
      error: message,
    });
    return { success: false, error: message };
  }
}

export type CreatePromptInput = {
  text: string;
  topic_id: string;
  location_scope?: string | null;
  platforms?: string[];
};

export type CreatePromptResult =
  | { success: true; promptId: string }
  | { success: false; error: string };

export async function createPrompt(
  input: CreatePromptInput,
): Promise<CreatePromptResult> {
  const started = Date.now();
  log.info("Action started", {
    action: "createPrompt",
    params: {
      topic_id: input.topic_id,
      text_len: input.text.length,
      platforms_len: input.platforms?.length ?? 0,
    },
  });

  const text = input.text.trim();
  const topicId = input.topic_id.trim();
  if (text.length === 0) {
    return { success: false, error: "Prompt text required." };
  }
  if (topicId.length === 0) {
    return { success: false, error: "Topic id required." };
  }

  const platforms = (input.platforms ?? ["perplexity", "chatgpt"]).filter(
    (p) => p.trim().length > 0,
  );
  if (platforms.length === 0) {
    return { success: false, error: "At least one platform required." };
  }

  const nowIso = new Date().toISOString();
  const promptId = `prompt-${randomUUID()}`;

  try {
    const { error } = await getSupabaseAdmin()
      .from("tracked_prompts")
      .insert({
        id: promptId,
        account_id: currentTenantId(),
        text,
        topic_id: topicId,
        location_scope: input.location_scope?.trim() || null,
        service_scope: null,
        intent_type: "recommendation",
        platforms,
        tags: [],
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      });
    if (error) throw new Error(error.message);
    revalidatePath("/settings/prompts");
    revalidatePath("/prompts");
    revalidatePath("/");
    log.info("Action completed", {
      action: "createPrompt",
      durationMs: Date.now() - started,
    });
    return { success: true, promptId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Action failed", {
      action: "createPrompt",
      durationMs: Date.now() - started,
      error: message,
    });
    return { success: false, error: message };
  }
}
