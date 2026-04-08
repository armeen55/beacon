/**
 * CSV parsing for Profound exports.
 * Uses csv-parse for well-formed CSVs (prompts, citations, benchmark).
 * Falls back to Python subprocess for the raw execution CSV which contains
 * unescaped quotes in multiline LLM response text.
 */

import "server-only";

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

/**
 * Parse a well-formed CSV file synchronously. Handles BOM stripping.
 * Use for prompts_export, citations, and summarized exports.
 */
export function parseCSV<T extends Record<string, string>>(
  filePath: string
): T[] {
  let content = readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  }) as T[];
}

/**
 * Parse a CSV with embedded unescaped quotes using Python's csv module.
 * Required for Profound exports containing LLM text or snippet fields.
 * Works for raw executions and citations CSVs.
 */
export function parseDirtyCSV<T extends Record<string, string>>(
  filePath: string
): T[] {
  const scriptPath = join(process.cwd(), "scripts", "parse-raw-csv.py");
  const stdout = execSync(`python3 ${JSON.stringify(scriptPath)} ${JSON.stringify(filePath)}`, {
    maxBuffer: 200 * 1024 * 1024,
    encoding: "utf-8",
  });
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Normalize a Profound hostname: strip www., m., lowercase.
 */
export function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  if (h.startsWith("m.")) h = h.slice(2);
  return h;
}

/**
 * Strip UTM params and text fragments from a URL.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_")) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Parse Profound position string "#N" → number | null.
 */
export function parsePosition(pos: string | undefined): number | null {
  if (!pos || !pos.startsWith("#")) return null;
  const n = parseInt(pos.slice(1), 10);
  return isNaN(n) ? null : n;
}

/**
 * Parse Profound percentage string "36.71%" → number | null.
 */
export function parsePercent(pct: string | undefined): number | null {
  if (!pct) return null;
  const n = parseFloat(pct.replace("%", ""));
  return isNaN(n) ? null : n;
}

/**
 * Parse Profound rank-position string "#2.9" → number | null.
 */
export function parseAvgPosition(pos: string | undefined): number | null {
  if (!pos) return null;
  const n = parseFloat(pos.replace("#", ""));
  return isNaN(n) ? null : n;
}
