import "server-only";

import type { IntentType, TrackedPrompt } from "@/domains/tracked-prompts/types";
import { parseCSV } from "@/lib/persistence/csv-parser";

type ProfoundPromptRow = {
  ID: string;
  Topic: string;
  Prompt: string;
  Tags: string;
  Regions: string;
  Language: string;
  Platforms: string;
  Personas: string;
  Type: string;
  Created: string;
  Updated: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Profound export uses "M/D/YYYY, h:mm AM/PM" in US locale. Parsed in the host's local timezone. */
function parseProfoundUsDateTime(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const m = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!m) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  let hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const ap = m[6].toUpperCase();
  if (ap === "PM" && hour !== 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  const d = new Date(year, month, day, hour, minute, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function splitCommaSpaceList(raw: string): string[] {
  const v = raw.trim();
  if (!v) return [];
  return v
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * City-style topics are "{City} Construction" (e.g. Atherton Construction).
 * Topics with ":" (e.g. Shield: …) are excluded from this pattern.
 */
function locationScopeFromTopic(topic: string): string | null {
  const t = topic.trim();
  if (!t || t.includes(":")) return null;
  const m = /^(.+?)\s+Construction$/i.exec(t);
  return m ? m[1].trim() : null;
}

function inferIntentType(topic: string): IntentType {
  const t = topic.trim();
  if (/^shield\s*:/i.test(t)) return "comparison";
  if (locationScopeFromTopic(t)) return "local_discovery";
  return "informational";
}

export type ParseProfoundPromptsResult = {
  prompts: TrackedPrompt[];
  warnings: string[];
};

/**
 * Parse a Profound prompts export CSV into canonical {@link TrackedPrompt} rows.
 */
export function parseProfoundPrompts(
  filePath: string,
  accountId: string
): ParseProfoundPromptsResult {
  const rows = parseCSV<ProfoundPromptRow>(filePath);
  const warnings: string[] = [];
  const prompts: TrackedPrompt[] = [];
  const seenIds = new Set<string>();

  if (!accountId.trim()) {
    warnings.push("accountId is empty; prompts will still be parsed.");
  }

  rows.forEach((row, index) => {
    const rowLabel = `row ${index + 2}`;
    const id = row.ID?.trim() ?? "";
    const text = row.Prompt?.trim() ?? "";
    const topic = row.Topic?.trim() ?? "";

    if (!id) {
      warnings.push(`${rowLabel}: missing ID; skipped.`);
      return;
    }
    if (!UUID_RE.test(id)) {
      warnings.push(`${rowLabel}: ID "${id}" is not a well-formed UUID.`);
    }
    if (seenIds.has(id)) {
      warnings.push(`${rowLabel}: duplicate ID "${id}"; skipped duplicate.`);
      return;
    }
    seenIds.add(id);

    if (!text) {
      warnings.push(`${rowLabel}: missing Prompt text.`);
    }

    const createdAt = parseProfoundUsDateTime(row.Created ?? "");
    const updatedAt = parseProfoundUsDateTime(row.Updated ?? "");
    if (!createdAt) {
      warnings.push(
        `${rowLabel} (id ${id}): invalid or missing Created datetime "${row.Created ?? ""}".`
      );
    }
    if (!updatedAt) {
      warnings.push(
        `${rowLabel} (id ${id}): invalid or missing Updated datetime "${row.Updated ?? ""}".`
      );
    }

    const nowIso = new Date().toISOString();
    const location_scope = locationScopeFromTopic(topic);
    const intent_type = inferIntentType(topic);

    prompts.push({
      id,
      account_id: accountId,
      text,
      topic_id: topic.length > 0 ? topic : null,
      location_scope,
      service_scope: null,
      intent_type,
      platforms: splitCommaSpaceList(row.Platforms ?? ""),
      tags: splitCommaSpaceList(row.Tags ?? ""),
      is_active: true,
      created_at: createdAt ?? nowIso,
      updated_at: updatedAt ?? createdAt ?? nowIso,
    });
  });

  return { prompts, warnings };
}
