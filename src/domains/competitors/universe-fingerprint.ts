import { createHash } from "node:crypto";
import type { ConfiguredCompetitorEntry } from "./universe-types";
import { normalizeCompetitorDomain } from "./universe-normalize";

/**
 * Deterministic content hash over the full configured set (active + inactive).
 * Changes when any competitor row materially changes.
 */
export function computeCompetitorUniverseFingerprint(
  entries: ConfiguredCompetitorEntry[]
): string {
  const normalized = [...entries]
    .filter((e) => e?.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      display_name: e.display_name.trim(),
      domain: normalizeCompetitorDomain(e.domain),
      status: e.status,
      notes: (e.notes ?? "").trim() || null,
      tags: [...(e.tags ?? [])].map((t) => t.trim()).filter(Boolean).sort(),
    }));
  const h = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
  return `sha256-${h}`;
}
