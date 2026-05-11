import "server-only";

import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import { SettingsPromptsClient } from "./settings-prompts-client";

/**
 * EGRESS-P0 (2026-05-07) — narrow the canonical read to a 1-day
 * observation window so this page never pulls the full
 * prompt_answer_observations table just to render the prompt-management
 * list. The `trackedPrompts` array is the only field this page uses;
 * a tight window keeps the parallel `getPromptAnswerObservations` call
 * inside `loadFreshCanonicalData` from blowing egress.
 */
const SETTINGS_PROMPTS_OBS_WINDOW_DAYS = 1;
const SETTINGS_PROMPTS_SNAP_WINDOW_DAYS = 1;

/**
 * /settings/prompts — minimum-viable prompt-set management hub
 * (Phase v5 Commit 4, 2026-04-24).
 *
 * Operator-facing: "which prompts run tomorrow's cron, toggle any off,
 * add a new one." No inline editing; no bulk ops; no tenant picker
 * (single-tenant today). Intentionally thin.
 */
export default async function SettingsPromptsPage() {
  await ensureCanonicalStoresSeeded();

  // Phase 4.9 (Sprint 4, 2026-04-24): fresh per-render canonical read.
  // EGRESS-P0 (2026-05-07): pass tight windows so parallel
  // observation/snapshot reads don't drag the full tables across the
  // wire — this page only consumes `trackedPrompts`.
  const NOW_MS = Date.now();
  const observationsSince = new Date(
    NOW_MS - SETTINGS_PROMPTS_OBS_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const snapshotsSince = new Date(
    NOW_MS - SETTINGS_PROMPTS_SNAP_WINDOW_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const { trackedPrompts } = await loadFreshCanonicalData({
    observationsSince,
    snapshotsSince,
  });

  const rows = [...trackedPrompts]
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.text.localeCompare(b.text);
    })
    .map((p) => ({
      id: p.id,
      text: p.text,
      topic_id: p.topic_id,
      location_scope: p.location_scope,
      platforms: p.platforms,
      is_active: p.is_active,
    }));

  const activeCount = rows.filter((r) => r.is_active).length;
  const inactiveCount = rows.length - activeCount;

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Prompts</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          {activeCount} prompt{activeCount === 1 ? "" : "s"} run in tomorrow&apos;s
          daily AI check. {inactiveCount > 0 ? `${inactiveCount} inactive.` : null}
        </p>
      </header>
      <SettingsPromptsClient rows={rows} />
    </div>
  );
}
