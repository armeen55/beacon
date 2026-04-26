/**
 * Prompt Library — managed, journey-tagged prompt corpus for native querying.
 *
 * Stage 1: Initialized from Profound tracked prompts (100 rows).
 * Stage 2: Expanded via prompt mining + validation.
 * Stage 3: Auto-expansion from answer text patterns.
 *
 * Sprint 7 Phase 7.8e-4c (2026-04-26): module-level top-level await removed
 * in favor of Pattern A cached async getter. The store remains classified
 * as GLOBAL (operator-shared corpus, no tenant_id on rows). Mutators
 * (`addPrompt`, `initFromTrackedPrompts`) preserve in-memory array
 * mutation semantics by retrieving and operating on the cached array
 * reference — `Array.push`/index assignment behave identically to the
 * pre-7.8e-4c module-level array.
 */

import "server-only";

import { cache } from "react";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { LibraryPrompt, JourneyStage, PromptSource } from "./types";
import { classifyJourneyStage } from "./journey-stages";

const STORE_NAME = "prompt-library";

let _state: LibraryPrompt[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await readStore<LibraryPrompt>(STORE_NAME);
});

export const getPromptLibrary = cache(
  async (): Promise<LibraryPrompt[]> => {
    await ensureLoaded();
    return _state!;
  },
);

export async function persistPromptLibrary(): Promise<void> {
  await writeStore(STORE_NAME, await getPromptLibrary());
}

export async function getActivePrompts(): Promise<LibraryPrompt[]> {
  return (await getPromptLibrary()).filter((p) => p.is_active);
}

export async function getPromptsByJourneyStage(
  stage: JourneyStage,
): Promise<LibraryPrompt[]> {
  return (await getPromptLibrary()).filter(
    (p) => p.is_active && p.journey_stage === stage,
  );
}

export async function getPromptsByTopic(topic: string): Promise<LibraryPrompt[]> {
  const t = topic.toLowerCase();
  return (await getPromptLibrary()).filter(
    (p) => p.is_active && p.topic?.toLowerCase() === t,
  );
}

export async function addPrompt(opts: {
  prompt_text: string;
  topic?: string | null;
  city?: string | null;
  service_type?: string | null;
  journey_stage?: JourneyStage;
  source: PromptSource;
}): Promise<LibraryPrompt> {
  const id = `prm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const prompt: LibraryPrompt = {
    id,
    prompt_text: opts.prompt_text,
    topic: opts.topic ?? null,
    city: opts.city ?? null,
    service_type: opts.service_type ?? null,
    journey_stage:
      opts.journey_stage ?? classifyJourneyStage(opts.prompt_text),
    source: opts.source,
    is_active: true,
    created_at: new Date().toISOString(),
  };

  const promptLibrary = await getPromptLibrary();
  const existing = promptLibrary.findIndex(
    (p) => p.prompt_text.toLowerCase() === opts.prompt_text.toLowerCase(),
  );
  if (existing >= 0) {
    promptLibrary[existing] = { ...promptLibrary[existing], ...prompt, id: promptLibrary[existing].id };
    return promptLibrary[existing];
  }

  promptLibrary.push(prompt);
  return prompt;
}

/**
 * Initialize the prompt library from Profound tracked prompts.
 * Only adds prompts that don't already exist in the library.
 */
export async function initFromTrackedPrompts(
  trackedPrompts: Array<{
    id: string;
    text: string;
    topic_id: string | null;
    location_scope: string | null;
    service_scope: string | null;
    intent_type: string | null;
    is_active: boolean;
  }>,
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  const promptLibrary = await getPromptLibrary();
  const existingTexts = new Set(
    promptLibrary.map((p) => p.prompt_text.toLowerCase()),
  );

  for (const tp of trackedPrompts) {
    if (existingTexts.has(tp.text.toLowerCase())) {
      skipped++;
      continue;
    }

    const prompt: LibraryPrompt = {
      id: `prm-pf-${tp.id.slice(0, 8)}`,
      prompt_text: tp.text,
      topic: tp.topic_id,
      city: tp.location_scope,
      service_type: tp.service_scope,
      journey_stage: classifyJourneyStage(tp.text),
      source: "profound",
      is_active: tp.is_active,
      created_at: new Date().toISOString(),
    };

    promptLibrary.push(prompt);
    existingTexts.add(tp.text.toLowerCase());
    added++;
  }

  return { added, skipped };
}

export async function getLibrarySummary(): Promise<{
  total: number;
  active: number;
  byJourneyStage: Record<string, number>;
  bySource: Record<string, number>;
  byTopic: Record<string, number>;
}> {
  const byJourneyStage: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  let active = 0;

  const promptLibrary = await getPromptLibrary();
  for (const p of promptLibrary) {
    if (p.is_active) active++;
    byJourneyStage[p.journey_stage] =
      (byJourneyStage[p.journey_stage] ?? 0) + 1;
    bySource[p.source] = (bySource[p.source] ?? 0) + 1;
    const topic = p.topic ?? "untagged";
    byTopic[topic] = (byTopic[topic] ?? 0) + 1;
  }

  return {
    total: promptLibrary.length,
    active,
    byJourneyStage,
    bySource,
    byTopic,
  };
}

/** Test-only reset hook. */
export function _resetPromptLibraryForTests(): void {
  _state = null;
}
