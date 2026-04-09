import "server-only";

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ConfiguredCompetitorEntry } from "./universe-types";
import { computeCompetitorUniverseFingerprint } from "./universe-fingerprint";
import {
  type CompetitorUniverseFile,
  isUniverseFileV2,
} from "./universe-schema";
import { normalizeCompetitorDomain } from "./universe-normalize";

const DATA = join(process.cwd(), ".data", "competitor-universe.json");

function slugId(domain: string): string {
  const s = normalizeCompetitorDomain(domain).replace(/[^a-z0-9]+/g, "-");
  return `cfg-${s.replace(/^-|-$/g, "") || "unknown"}`;
}

export type SaveUniverseResult =
  | { ok: true; universe_version: number; universe_fingerprint: string }
  | { ok: false; error: string };

function validateEntries(
  entries: ConfiguredCompetitorEntry[]
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.display_name?.trim()) return { ok: false, error: "Each row needs a display name." };
    const d = normalizeCompetitorDomain(e.domain);
    if (!d || !d.includes(".")) {
      return { ok: false, error: `Invalid domain: ${e.domain}` };
    }
    if (seen.has(d)) return { ok: false, error: `Duplicate domain: ${d}` };
    seen.add(d);
    if (!e.id?.trim()) return { ok: false, error: "Each row needs an id." };
  }
  return { ok: true };
}

/**
 * Replace workspace competitor universe; bumps `universe_version` and recomputes fingerprint.
 */
export function saveCompetitorUniverseToDisk(
  entries: ConfiguredCompetitorEntry[],
  nowIso: string
): SaveUniverseResult {
  const v = validateEntries(entries);
  if (!v.ok) return { ok: false, error: v.error };

  let prevVersion = 0;
  if (existsSync(DATA)) {
    try {
      const raw = JSON.parse(readFileSync(DATA, "utf8")) as CompetitorUniverseFile;
      if (isUniverseFileV2(raw)) prevVersion = raw.universe_version;
      else if (raw?.competitors?.length) prevVersion = 1;
    } catch {
      prevVersion = 0;
    }
  }

  const nextVersion = Math.max(0, prevVersion) + 1;
  const fingerprint = computeCompetitorUniverseFingerprint(entries);
  const out = {
    file_schema: 2 as const,
    universe_version: nextVersion,
    universe_fingerprint: fingerprint,
    updated_at: nowIso,
    competitors: entries.map((e) => ({
      ...e,
      id: e.id.trim(),
      display_name: e.display_name.trim(),
      domain: normalizeCompetitorDomain(e.domain),
      status: e.status,
      notes: e.notes?.trim() || null,
      tags: e.tags?.length ? e.tags.map((t) => t.trim()).filter(Boolean) : undefined,
    })),
  };

  const tmp = DATA + ".tmp";
  writeFileSync(tmp, JSON.stringify(out, null, 2), "utf8");
  renameSync(tmp, DATA);

  return { ok: true, universe_version: nextVersion, universe_fingerprint: fingerprint };
}

export function ensureConfiguredCompetitorId(
  entry: ConfiguredCompetitorEntry
): ConfiguredCompetitorEntry {
  if (entry.id?.trim()) return entry;
  return { ...entry, id: slugId(entry.domain) };
}
