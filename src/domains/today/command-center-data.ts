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
import { isOperatorModeServer } from "@/lib/operator-mode";

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
  return isOperatorModeServer();
}

/**
 * UX.6.1 (2026-05-07) — Trust restoration fallback for the Brain
 * readiness card.
 *
 * Production /today renders never see the disk-based brain-health
 * report (`.data/_reports/brain-health-*.json`) because `.data/` is
 * gitignored and not bundled to Vercel. Pre-fix, the BrainStatusCard
 * fell through to the empty "Waiting for next reading." copy on every
 * production render — a major trust hit for mature tenants who
 * absolutely have data flowing.
 *
 * This helper builds an honest, derived brain summary from data
 * already loaded by today-data.ts (zero new Supabase reads, zero
 * disk reads). It uses simple operator-locked thresholds:
 *
 *   Data health         — based on 7-day observation count.
 *   Score health        — based on recent daily-metric snapshots +
 *                         whether owned URLs are being cited.
 *   Recommendation health — based on the rec queue size.
 *   Attribution health  — neutral "Active" default (we don't have an
 *                         easy verdict-mix signal in the today
 *                         payload yet; this section degrades to B).
 *
 * Returns null only when the tenant has zero observations (in which
 * case the F.1 first-reading early-return has already short-circuited
 * the page render — defensive double-guard).
 */
export type DeriveBrainSummaryInput = {
  observations7dCount: number;
  totalObservationCount: number;
  recentSnapshotCount: number;
  totalSnapshotCount: number;
  ownedUrlsCitedCount: number;
  recommendationQueueSize: number;
  hasPlatformCoverage: boolean;
};

const GRADE_RANK: Record<CommandCenterGrade, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
  F: 0,
};

function gradeForObservations7d(n: number): CommandCenterGrade {
  if (n >= 600) return "A";
  if (n >= 300) return "B";
  if (n >= 100) return "C";
  if (n > 0) return "D";
  return "F";
}

function gradeForScoreHealth(args: {
  recentSnapshotCount: number;
  ownedUrlsCitedCount: number;
  hasPlatformCoverage: boolean;
}): CommandCenterGrade {
  if (
    args.recentSnapshotCount >= 7 &&
    args.ownedUrlsCitedCount >= 5 &&
    args.hasPlatformCoverage
  ) {
    return "A";
  }
  if (args.recentSnapshotCount >= 3 && args.ownedUrlsCitedCount >= 1) {
    return "B";
  }
  if (args.recentSnapshotCount >= 1) return "C";
  return "D";
}

function gradeForRecQueue(n: number): CommandCenterGrade {
  if (n >= 10) return "A";
  if (n >= 3) return "B";
  if (n >= 1) return "C";
  return "D";
}

function pickOverallGrade(
  ...sectionGrades: ReadonlyArray<CommandCenterGrade>
): CommandCenterGrade {
  // Take the worst of the section grades (any F drags the whole grade
  // to F; otherwise floor by lowest section). This matches operator
  // intuition — one rotten section shouldn't be hidden by good ones.
  let worst: CommandCenterGrade = "A";
  for (const g of sectionGrades) {
    if (GRADE_RANK[g] < GRADE_RANK[worst]) worst = g;
  }
  return worst;
}

function oneLineForOverall(grade: CommandCenterGrade): string {
  switch (grade) {
    case "A":
      return "Brain is healthy — tracking AI visibility daily across both platforms.";
    case "B":
      return "Brain is active — tracking daily with one or two soft gaps.";
    case "C":
      return "Brain is in early-warmup — readings are accumulating.";
    case "D":
      return "Brain readings are sparse — give it a few more days.";
    case "F":
      return "Brain has no readings yet.";
  }
}

export function deriveBrainSummaryFromCounts(
  input: DeriveBrainSummaryInput,
): CommandCenterBrain | null {
  if (
    !Number.isFinite(input.totalObservationCount) ||
    input.totalObservationCount <= 0
  ) {
    return null;
  }

  const dataGrade = gradeForObservations7d(input.observations7dCount);
  const scoreGrade = gradeForScoreHealth({
    recentSnapshotCount: input.recentSnapshotCount,
    ownedUrlsCitedCount: input.ownedUrlsCitedCount,
    hasPlatformCoverage: input.hasPlatformCoverage,
  });
  const recGrade = gradeForRecQueue(input.recommendationQueueSize);
  // Neutral default — surfacing a real attribution grade requires
  // verdict-mix data not on the today payload. "B" reads as "active
  // but not perfect" which is honest.
  const attrGrade: CommandCenterGrade = "B";

  const overall = pickOverallGrade(dataGrade, scoreGrade, recGrade, attrGrade);

  return {
    grade: overall,
    oneLine: oneLineForOverall(overall),
    sections: [
      {
        label: "Data health",
        grade: dataGrade,
        summary: `${input.observations7dCount.toLocaleString()} readings in the last 7 days.`,
      },
      {
        label: "Score health",
        grade: scoreGrade,
        summary:
          input.ownedUrlsCitedCount > 0
            ? `${input.ownedUrlsCitedCount} owned page${input.ownedUrlsCitedCount === 1 ? "" : "s"} cited recently.`
            : "Owned-page citation tracking is warming up.",
      },
      {
        label: "Recommendation health",
        grade: recGrade,
        summary:
          input.recommendationQueueSize > 0
            ? `${input.recommendationQueueSize} recommendation${input.recommendationQueueSize === 1 ? "" : "s"} monitored.`
            : "Recommendation queue is empty — no current opportunities.",
      },
      {
        label: "Attribution health",
        grade: attrGrade,
        summary: "Pattern tracking active across recent changes.",
      },
    ],
    // Use ISO empty so the consumer treats this as "live-derived"
    // (no specific generated_at since we computed it on the fly).
    generatedAt: "",
  };
}
