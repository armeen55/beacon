/**
 * Prompt Library — managed, journey-tagged prompt corpus for native querying.
 *
 * Stage 1: Initialized from Profound tracked prompts (100 rows).
 * Stage 2: Expanded via prompt mining + validation.
 * Stage 3: Auto-expansion from answer text patterns.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { LibraryPrompt, JourneyStage, PromptSource } from "./types";
import { classifyJourneyStage } from "./journey-stages";

const STORE_NAME = "prompt-library";

export const promptLibrary: LibraryPrompt[] =
  readStore<LibraryPrompt>(STORE_NAME);

export async function persistPromptLibrary(): Promise<void> {
  await writeStore(STORE_NAME, promptLibrary);
}

export function getActivePrompts(): LibraryPrompt[] {
  return promptLibrary.filter((p) => p.is_active);
}

export function getPromptsByJourneyStage(
  stage: JourneyStage,
): LibraryPrompt[] {
  return promptLibrary.filter(
    (p) => p.is_active && p.journey_stage === stage,
  );
}

export function getPromptsByTopic(topic: string): LibraryPrompt[] {
  const t = topic.toLowerCase();
  return promptLibrary.filter(
    (p) => p.is_active && p.topic?.toLowerCase() === t,
  );
}

export function addPrompt(opts: {
  prompt_text: string;
  topic?: string | null;
  city?: string | null;
  service_type?: string | null;
  journey_stage?: JourneyStage;
  source: PromptSource;
}): LibraryPrompt {
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
export function initFromTrackedPrompts(
  trackedPrompts: Array<{
    id: string;
    text: string;
    topic_id: string | null;
    location_scope: string | null;
    service_scope: string | null;
    intent_type: string | null;
    is_active: boolean;
  }>,
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;

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

export function getLibrarySummary(): {
  total: number;
  active: number;
  byJourneyStage: Record<string, number>;
  bySource: Record<string, number>;
  byTopic: Record<string, number>;
} {
  const byJourneyStage: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  let active = 0;

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
