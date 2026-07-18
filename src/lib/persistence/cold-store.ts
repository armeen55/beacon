/**
 * Sharded cold storage for large data that should not be loaded eagerly.
 *
 * Used for:
 * - answer_texts (9,596 entries, ~27 MB) — keyed by observation ID
 * - citation-observations (85,004 rows, ~20-35 MB) — sharded by date
 *
 * These are never loaded at startup. They are read on-demand and cached
 * in-process after first access.
 */

import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { syncAnswerTexts } from "./dual-write";
import { resolveDataPath } from "./resolve-data-path";

const DATA_DIR = join(process.cwd(), ".data");

function ensureDir(dir: string) {
  // Vercel/serverless FS is read-only under process.cwd(); skip mkdir on hosted.
  if (process.env.VERCEL === "1") return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Answer texts — a per-tenant JSON map { observationId: text }
//
// Finding A (2026-07-18): answer-texts was GLOBAL, so this module read/wrote a
// single flat `.data/answer-texts.json` that merged every tenant's answer text.
// The store is now TENANT_SCOPED (store-classification.ts), and reads/writes
// route through resolveDataPath to `.data/tenants/{slug}/answer-texts.json`.
// The in-process cache is keyed by tenant so tenant A can never observe tenant
// B's map. A TEMPORARY legacy-flat read fallback (see below) keeps existing
// local data working until every environment re-imports.
// ---------------------------------------------------------------------------

/** Per-tenant read-through cache. Keyed by tenantId — never shared. */
const _answerTextsByTenant = new Map<string, Map<string, string>>();

/** Legacy flat file — the pre-finding-A cross-tenant blob. Read-only fallback. */
function legacyFlatAnswerTexts(): Record<string, string> {
  const path = join(DATA_DIR, "answer-texts.json");
  if (!existsSync(path)) return {};
  try {
    const obj = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function readAnswerTextsObject(routedPath: string): Record<string, string> {
  if (existsSync(routedPath)) {
    try {
      const obj = JSON.parse(readFileSync(routedPath, "utf-8")) as Record<string, string>;
      if (obj && typeof obj === "object") return obj;
    } catch {
      /* corrupted routed file — fall through to legacy */
    }
  }
  // TEMPORARY (finding A): the tenant-routed file is absent (never re-imported
  // since the split). Fall back to the legacy flat blob so nothing breaks. It
  // is mixed-tenant, but every caller looks up only its OWN observation ids
  // (globally unique, one tenant each), so no other tenant's text can surface
  // through this path. Remove once every environment has re-imported.
  return legacyFlatAnswerTexts();
}

/**
 * Load the answer-texts map for one tenant, cached in-process per tenant.
 * The map is the tenant-routed file (or the temporary legacy-flat fallback).
 */
export async function loadTenantAnswerTexts(tenantId: string): Promise<Map<string, string>> {
  const cached = _answerTextsByTenant.get(tenantId);
  if (cached) return cached;
  const resolved = await resolveDataPath("answer-texts", tenantId);
  const map = new Map(Object.entries(readAnswerTextsObject(resolved.routedPath)));
  _answerTextsByTenant.set(tenantId, map);
  return map;
}

export async function writeAnswerTexts(
  texts: Record<string, string>,
  tenantId: string,
): Promise<void> {
  const resolved = await resolveDataPath("answer-texts", tenantId);
  // Vercel/serverless FS is read-only under process.cwd(): skip disk, refresh
  // the in-process cache, and rely on the Supabase dual-write for durability
  // (same discipline as json-store's atomicWrite).
  if (process.env.VERCEL !== "1") {
    ensureDir(resolved.routedDir);
    const tmp = resolved.routedPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(texts), "utf-8");
    renameSync(tmp, resolved.routedPath);
  }
  _answerTextsByTenant.set(tenantId, new Map(Object.entries(texts)));
  // Best-effort dual-write — fire and forget. NOTE: the Supabase `answer_texts`
  // table is keyed by observation_id only (no tenant_id column), so its
  // isolation still rests on observation-id uniqueness.
  syncAnswerTexts(texts).catch(() => {});
}

/** Full tenant map from disk (for merge imports). Does not populate the cache. */
export async function readAnswerTextsFromDisk(tenantId: string): Promise<Record<string, string>> {
  const resolved = await resolveDataPath("answer-texts", tenantId);
  return { ...readAnswerTextsObject(resolved.routedPath) };
}

// ---------------------------------------------------------------------------
// Sharded citations — one file per date in .data/citations-by-date/
// ---------------------------------------------------------------------------

import type { CitationObservation } from "@/domains/citation-observations/types";

const CITATION_DIR = join(DATA_DIR, "citations-by-date");

const _citationShardCache = new Map<string, CitationObservation[]>();

function citationShardPath(date: string): string {
  return join(CITATION_DIR, `${date}.json`);
}

export function getCitationsForDate(date: string): CitationObservation[] {
  if (_citationShardCache.has(date)) {
    return _citationShardCache.get(date)!;
  }
  const path = citationShardPath(date);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as CitationObservation[];
  _citationShardCache.set(date, data);
  return data;
}

export function getCitationsForObservation(
  promptAnswerId: string,
  date: string
): CitationObservation[] {
  const all = getCitationsForDate(date);
  return all.filter((c) => c.prompt_answer_id === promptAnswerId);
}

export function getAllCitationDates(): string[] {
  if (!existsSync(CITATION_DIR)) return [];
  return readdirSync(CITATION_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

export function writeCitationShard(
  date: string,
  citations: CitationObservation[]
): void {
  ensureDir(CITATION_DIR);
  const path = citationShardPath(date);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(citations), "utf-8");
  renameSync(tmp, path);
  _citationShardCache.set(date, citations);
}

export function clearCitationCache(): void {
  _citationShardCache.clear();
  _answerTextsByTenant.clear();
}
