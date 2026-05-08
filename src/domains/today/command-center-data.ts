/**
 * command-center-data — UX.2 (2026-05-07).
 *
 * Pure-ish resolver for the Beacon Command Center section that sits
 * above the existing /today layout. Reads ONLY existing artifacts:
 *
 *   - .data/_reports/brain-health-*.json  (newest by filename)
 *   - .data/tenants/<slug>/brain/manifest.json
 *
 * No DB writes. No paid APIs. No new backend job. Re-derives on every
 * /today render. Failures → null fields → cards render empty states.
 *
 * Customer-safe: every output string is operator-readable but
 * customer-friendly. NEVER mentions cron / 07:00 UTC / GitHub /
 * Supabase / schema / SQL / raw UUIDs. The brain-health JSON's own
 * `one_line_summary` field is already operator-friendly so we
 * surface it verbatim.
 */

import "server-only";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type CommandCenterGrade = "A" | "B" | "C" | "D" | "F";

export type CommandCenterSection = {
  /** Operator-friendly label, e.g. "Data health". */
  label: string;
  /** Grade letter — "A" / "B" / "C" / "D" / "F". */
  grade: CommandCenterGrade;
  /**
   * One-line operator-readable summary of why the section earned this
   * grade. Sourced from the section's lowest-graded metric reason +
   * value. Customer-safe.
   */
  summary: string;
};

export type CommandCenterBrain = {
  /** Top-level brain readiness grade. */
  grade: CommandCenterGrade;
  /** Operator-friendly one-line summary from the report. */
  oneLine: string;
  /** Four sub-sections in the canonical order: Data, Score, Rec, Attribution. */
  sections: ReadonlyArray<CommandCenterSection>;
  /** ISO timestamp when the report was generated. Used for "as of" copy. */
  generatedAt: string;
};

export type CommandCenterManifest = {
  /** ISO timestamp when the AEO intelligence files last rebuilt. */
  builtAt: string;
  /** Number of files in the manifest (e.g. 14 for Ritz today). */
  fileCount: number;
  /** Source observation count powering the manifest. */
  sourceObservationCount: number;
};

export type CommandCenterData = {
  /** True when at least one of brain/manifest could be loaded. Cards
   *  render their own empty state when their slice is null. */
  hasAnyData: boolean;
  brain: CommandCenterBrain | null;
  manifest: CommandCenterManifest | null;
};

const REPO_ROOT = resolve(process.cwd());

function safeJsonRead<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Find the newest brain-health-*.json report by lexicographic sort
 * on the timestamp suffix (the filenames embed an ISO timestamp).
 */
function findLatestBrainHealthReport(): string | null {
  const reportsDir = join(REPO_ROOT, ".data", "_reports");
  try {
    if (!existsSync(reportsDir)) return null;
    const files = readdirSync(reportsDir)
      .filter(
        (n) => n.startsWith("brain-health-") && n.endsWith(".json"),
      )
      .sort();
    if (files.length === 0) return null;
    return join(reportsDir, files[files.length - 1]);
  } catch {
    return null;
  }
}

/**
 * Coerce an arbitrary string to one of the known grade letters.
 * Defaults to "C" on miss — never throws — so the UI always has a
 * renderable value.
 */
function coerceGrade(value: unknown): CommandCenterGrade {
  if (typeof value !== "string") return "C";
  const upper = value.trim().toUpperCase();
  if (upper === "A" || upper === "B" || upper === "C" || upper === "D" || upper === "F") {
    return upper;
  }
  return "C";
}

/** Map raw section name from the brain-health JSON to operator-friendly label. */
function labelForSection(rawName: string): string {
  switch (rawName) {
    case "Data Health":
      return "Data health";
    case "Score Health":
      return "Score health";
    case "Recommendation Health":
      return "Recommendation health";
    case "Attribution Health":
      return "Attribution health";
    default:
      return rawName;
  }
}

type RawBrainSection = {
  name?: unknown;
  grade?: unknown;
  metrics?: unknown;
};

type RawBrainMetric = {
  label?: unknown;
  value?: unknown;
  grade?: unknown;
  reason?: unknown;
};

/**
 * Build the one-line section summary by picking the LOWEST-graded
 * metric and quoting its `reason` field. This puts the friction
 * visible at a glance without surfacing the full breakdown
 * (operator drills into /diagnostics/brain for that).
 */
function summariseSection(section: RawBrainSection): string {
  const metrics = Array.isArray(section.metrics) ? section.metrics : [];
  if (metrics.length === 0) return "No metrics yet — gathering data.";

  // Order grades worst → best so we can find the worst.
  const gradeRank: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };
  let worst: RawBrainMetric | null = null;
  let worstRank = Infinity;
  for (const m of metrics as RawBrainMetric[]) {
    const g = typeof m.grade === "string" ? m.grade.trim().toUpperCase() : "C";
    const rank = gradeRank[g] ?? 2;
    if (rank < worstRank) {
      worstRank = rank;
      worst = m;
    }
  }
  if (!worst) return "All metrics steady.";
  const label = typeof worst.label === "string" ? worst.label : "metric";
  const value = typeof worst.value === "string" ? worst.value : "";
  // Customer-safe phrasing: don't surface the formula text from `reason`
  // (it has things like "≥600 / 7d for healthy 100-prompt × 2-platform polling"
  // which is operator/methodology-shaped). Use label + value instead.
  return value ? `${label}: ${value}.` : `${label} steady.`;
}

function loadBrain(): CommandCenterBrain | null {
  const path = findLatestBrainHealthReport();
  if (!path) return null;
  type Report = {
    generated_at?: unknown;
    brain_readiness_grade?: unknown;
    one_line_summary?: unknown;
    sections?: unknown;
  };
  const data = safeJsonRead<Report>(path);
  if (!data) return null;

  const generatedAt =
    typeof data.generated_at === "string" ? data.generated_at : "";
  const grade = coerceGrade(data.brain_readiness_grade);
  const oneLine =
    typeof data.one_line_summary === "string" && data.one_line_summary.trim()
      ? data.one_line_summary.trim()
      : "Brain readings are coming in.";

  const rawSections = Array.isArray(data.sections) ? (data.sections as RawBrainSection[]) : [];
  const sections: CommandCenterSection[] = rawSections.map((s) => ({
    label: labelForSection(typeof s.name === "string" ? s.name : ""),
    grade: coerceGrade(s.grade),
    summary: summariseSection(s),
  }));

  return {
    grade,
    oneLine,
    sections,
    generatedAt,
  };
}

function loadManifest(tenantSlug: string): CommandCenterManifest | null {
  const path = join(
    REPO_ROOT,
    ".data",
    "tenants",
    tenantSlug,
    "brain",
    "manifest.json",
  );
  type RawManifest = {
    built_at?: unknown;
    files?: unknown;
    source_observations_count?: unknown;
  };
  const data = safeJsonRead<RawManifest>(path);
  if (!data) return null;
  return {
    builtAt: typeof data.built_at === "string" ? data.built_at : "",
    fileCount: Array.isArray(data.files) ? data.files.length : 0,
    sourceObservationCount:
      typeof data.source_observations_count === "number"
        ? data.source_observations_count
        : 0,
  };
}

/**
 * Resolve the Command Center data slice for a single tenant. Pure
 * read. Returns null fields when artifacts are missing — the UI
 * decides how to present empty states.
 */
export function resolveCommandCenterData(args: {
  tenantSlug: string;
}): CommandCenterData {
  const brain = loadBrain();
  const manifest = loadManifest(args.tenantSlug);
  return {
    hasAnyData: brain !== null || manifest !== null,
    brain,
    manifest,
  };
}

/**
 * Operator-mode flag — used to decide whether to render the small
 * `/diagnostics/brain` link at the bottom of the Command Center.
 * The /diagnostics/brain page itself is independently gated; this
 * is purely a visibility decision for the link.
 */
export function isOperatorMode(): boolean {
  return process.env.BEACON_OPERATOR_MODE === "true";
}
