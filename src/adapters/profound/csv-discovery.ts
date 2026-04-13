/**
 * Discover Profound-shaped CSVs under `.data/` by **header signature**, not filename.
 * Multiple files of the same kind are merged in import order (mtime ascending; later overwrites same id).
 */

import "server-only";

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export type ProfoundCsvKind =
  | "prompts"
  | "raw_executions"
  | "citations"
  | "benchmark"
  | "changelog";

export type ProfoundCsvDiscovery = {
  /** Absolute paths, each kind sorted by mtime ascending (stable merge; newest wins on id collision). */
  byKind: Record<ProfoundCsvKind, string[]>;
  /** CSV files in `.data/` that were not classified (operator should remove or fix). */
  unclassified: string[];
};

const DATA_DIR = join(process.cwd(), ".data");

/** Normalize a single header cell for matching (BOM-safe, quoted, lowercased). */
export function normalizeHeaderCell(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase();
}

/** Read the first CSV row as column names (first ~256 KiB only). */
export function peekCsvHeaders(filePath: string): string[] {
  const fd = readFileSync(filePath, "utf8");
  const slice = fd.slice(0, Math.min(fd.length, 262_144));
  const nl = slice.indexOf("\n");
  const line = nl >= 0 ? slice.slice(0, nl) : slice;
  if (!line.trim()) return [];
  const rows = parse(line, {
    columns: false,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
  }) as string[][];
  const first = rows[0];
  if (!first) return [];
  return first.map(normalizeHeaderCell).filter(Boolean);
}

function headerSet(headers: string[]): Set<string> {
  return new Set(headers);
}

function hasAll(set: Set<string>, cols: string[]): boolean {
  return cols.every((c) => set.has(c));
}

function hasAny(set: Set<string>, cols: string[]): boolean {
  return cols.some((c) => set.has(c));
}

/**
 * Classify a Profound export CSV from normalized header names.
 * Order of checks matters (raw vs citations both have run_id, date, prompt, platform).
 */
export function classifyProfoundCsv(headers: string[]): ProfoundCsvKind | null {
  const set = headerSet(headers);

  if (hasAll(set, ["run_id", "date", "platform", "prompt"])) {
    if (hasAny(set, ["response", "citation_1", "mentioned?"])) {
      return "raw_executions";
    }
    if (
      hasAll(set, ["url", "hostname"]) &&
      hasAny(set, ["citationcategory", "citation_category", "category"])
    ) {
      return "citations";
    }
  }

  if (hasAll(set, ["id", "prompt", "topic"]) && !set.has("run_id")) {
    return "prompts";
  }

  if (
    hasAll(set, ["date", "asset", "platform"]) &&
    hasAny(set, ["visibility", "shareofvoice", "averageposition"])
  ) {
    return "benchmark";
  }

  if (
    hasAny(set, ["signal type", "signal_type"]) &&
    hasAny(set, ["asset type", "asset_type"]) &&
    hasAny(set, ["exact change made", "exact_change_made", "change_description"])
  ) {
    return "changelog";
  }

  return null;
}

function sortPathsByMtimeAsc(paths: string[]): string[] {
  return [...paths].sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

/**
 * Scan `.data/` for `*.csv` (non-recursive) and bucket by {@link ProfoundCsvKind}.
 */
export function discoverProfoundCsvFiles(dataDir: string = DATA_DIR): ProfoundCsvDiscovery {
  const byKind: ProfoundCsvDiscovery["byKind"] = {
    prompts: [],
    raw_executions: [],
    citations: [],
    benchmark: [],
    changelog: [],
  };
  const unclassified: string[] = [];

  if (!existsSync(dataDir)) {
    return { byKind, unclassified };
  }

  for (const name of readdirSync(dataDir) as string[]) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    const abs = join(dataDir, name);
    try {
      const headers = peekCsvHeaders(abs);
      if (headers.length === 0) {
        unclassified.push(abs);
        continue;
      }
      const kind = classifyProfoundCsv(headers);
      if (!kind) {
        unclassified.push(abs);
        continue;
      }
      byKind[kind].push(abs);
    } catch {
      unclassified.push(abs);
    }
  }

  for (const k of Object.keys(byKind) as ProfoundCsvKind[]) {
    byKind[k] = sortPathsByMtimeAsc(byKind[k]);
  }

  return { byKind, unclassified };
}
