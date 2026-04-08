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

const DATA_DIR = join(process.cwd(), ".data");

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Answer texts — a single JSON map { id: text }
// ---------------------------------------------------------------------------

let _answerTextsCache: Map<string, string> | null = null;

export function getAnswerText(observationId: string): string | null {
  if (!_answerTextsCache) {
    const path = join(DATA_DIR, "answer-texts.json");
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const obj = JSON.parse(raw) as Record<string, string>;
    _answerTextsCache = new Map(Object.entries(obj));
  }
  return _answerTextsCache.get(observationId) ?? null;
}

export function writeAnswerTexts(texts: Record<string, string>): void {
  ensureDir(DATA_DIR);
  const path = join(DATA_DIR, "answer-texts.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(texts), "utf-8");
  renameSync(tmp, path);
  _answerTextsCache = null;
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
  _answerTextsCache = null;
}
