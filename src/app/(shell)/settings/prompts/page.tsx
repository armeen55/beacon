import "server-only";

import { ensureCanonicalStoresSeeded } from "@/storage/canonical-store";
import { trackedPrompts } from "@/storage/canonical-store";
import { SettingsPromptsClient } from "./settings-prompts-client";

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
          10:00 UTC cron. {inactiveCount > 0 ? `${inactiveCount} inactive.` : null}
        </p>
      </header>
      <SettingsPromptsClient rows={rows} />
    </div>
  );
}
