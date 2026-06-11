/**
 * Operator Brain Surface — Trust Sprint Mini-Phase T7.6.
 *
 * Single internal page that surfaces:
 *   - Brain Readiness Grade (T6.1)
 *   - 4 health-section grades (Data / Score / Recommendation / Attribution)
 *   - Latest local AEO intelligence summary (T6.2 + T7.4)
 *   - Top 5 opportunities (from prompt-opportunity-index)
 *   - Top 5 trust risks (from brain-health-report's next-3-fixes)
 *   - Last generated timestamp (manifest.built_at)
 *
 * Operator-only: gated behind BEACON_OPERATOR_MODE; 404s for everyone
 * else. Reads from local JSON files only (`.data/tenants/<slug>/brain/`
 * + `.data/_reports/`). Missing files render an empty state — never
 * crashes the build.
 *
 * Pure read. No paid APIs. No mutations. Vercel-safe.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";

export const dynamic = "force-dynamic";

function isOperatorMode(): boolean {
  // Server-only gate. Test extension preserves render-under-test.
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

const REPO_ROOT = resolve(process.cwd());
// Audit #36/#37: derive the slug from the deployment's tenant env — never
// a hardcoded "ritz-builders" (operator diagnostic; the operator's
// BEACON_TENANT_* env names the inspected tenant in a multi-tenant deploy).
const TENANT_SLUG =
  process.env.BEACON_TENANT_SLUG ??
  process.env.BEACON_TENANT_ID?.replace(/^tenant-/, "") ??
  "";
const BRAIN_DIR = join(REPO_ROOT, ".data", "tenants", TENANT_SLUG, "brain");
const REPORTS_DIR = join(REPO_ROOT, ".data", "_reports");

function safeRead<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function findLatestReport(prefix: string): string | null {
  try {
    if (!existsSync(REPORTS_DIR)) return null;
    const fs = require("node:fs") as typeof import("node:fs");
    const files = fs
      .readdirSync(REPORTS_DIR)
      .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
      .sort();
    if (files.length === 0) return null;
    return join(REPORTS_DIR, files[files.length - 1]);
  } catch {
    return null;
  }
}

type Manifest = {
  built_at: string;
  source_observations_count: number;
  source_prompts_count: number;
  source_entities_count: number;
  files: Array<{ name: string; rows: number; sha256: string }>;
};

type BrainHealthReport = {
  generated_at: string;
  tenant_id: string;
  brain_readiness_grade: "A" | "B" | "C" | "D";
  one_line_summary: string;
  sections: Array<{
    name: string;
    grade: "A" | "B" | "C" | "D";
    metrics: Array<{
      label: string;
      value: string;
      grade: "A" | "B" | "C" | "D";
      reason: string;
    }>;
  }>;
  next_three_fixes: Array<{
    rank: number;
    what: string;
    why: string;
    surface: string;
  }>;
};

type OpportunityRow = {
  prompt_id: string;
  prompt_text_snippet: string;
  intent_type: string | null;
  location_scope: string | null;
  service_scope: string | null;
  total_observations: number;
  brand_mention_rate: number;
  opportunity_score: number;
  status: "winning" | "competitive" | "absent" | "outranked" | "early";
  sample_full: boolean;
};

const GRADE_COLORS: Record<string, string> = {
  A: "bg-status-success/15 text-status-success border-status-success/30",
  B: "bg-accent-primary/15 text-accent-primary border-accent-primary/30",
  C: "bg-status-warning/15 text-status-warning border-status-warning/30",
  D: "bg-status-danger/15 text-status-danger border-status-danger/30",
};

function GradePill({ grade }: { grade: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${GRADE_COLORS[grade] ?? ""}`}
    >
      {grade}
    </span>
  );
}

export default async function OperatorBrainPage() {
  if (!isOperatorMode()) {
    notFound();
  }

  const manifest = safeRead<Manifest>(join(BRAIN_DIR, "manifest.json"));
  const opportunities = safeRead<OpportunityRow[]>(
    join(BRAIN_DIR, "prompt-opportunity-index.json"),
  );
  const cityStrength = safeRead<
    Array<{ city: string; brand_mention_rate: number; trend_vs_prior_window: number; sample_full: boolean }>
  >(join(BRAIN_DIR, "city-strength-index.json"));
  const competitorWeekly = safeRead<
    Array<{ competitor_name: string; recent_2w: number; trend_vs_prior_window: number; rising: boolean; falling: boolean }>
  >(join(BRAIN_DIR, "competitor-weekly-trajectory.json"));

  const latestBrainHealthPath = findLatestReport("brain-health-");
  const brainHealth = latestBrainHealthPath
    ? safeRead<BrainHealthReport>(latestBrainHealthPath)
    : null;

  const topOpportunities = (opportunities ?? [])
    .filter((o) => o.sample_full && o.opportunity_score > 0.5)
    .slice(0, 5);

  const topRisingCompetitors = (competitorWeekly ?? []).filter((c) => c.rising).slice(0, 5);
  const topFallingCompetitors = (competitorWeekly ?? []).filter((c) => c.falling).slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Operator Brain"
        description="Internal brain telemetry — health grade, intelligence summary, top opportunities, trust risks. Operator-mode only."
      />

      {/* Section 1 — Brain Readiness Grade */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Brain Readiness Grade
        </h2>
        {brainHealth ? (
          <>
            <div className="mb-2 flex items-center gap-3">
              <GradePill grade={brainHealth.brain_readiness_grade} />
              <span className="text-base font-medium">{brainHealth.one_line_summary}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Generated: {brainHealth.generated_at}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No brain-health report on disk yet. Run{" "}
            <code className="rounded bg-surface-inset/60 px-1 py-0.5 text-xs">
              npx tsx --require ./scripts/mock-server-only.cjs scripts/build-brain-health-report.ts
            </code>{" "}
            to generate one.
          </p>
        )}
      </section>

      {/* Section 2 — Health sections */}
      {brainHealth && (
        <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Section grades
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {brainHealth.sections.map((s) => (
              <div key={s.name} className="rounded border border-border/40 bg-bg/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">{s.name}</span>
                  <GradePill grade={s.grade} />
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {s.metrics.map((m) => (
                    <li key={m.label}>
                      <span className="font-mono">[{m.grade}]</span> {m.label}: {m.value}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 3 — AEO intelligence summary */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Local AEO intelligence summary
        </h2>
        {manifest ? (
          <>
            <p className="mb-2 text-sm">
              <span className="font-medium">{manifest.files.length}</span> derived files;{" "}
              <span className="font-medium">{manifest.source_observations_count.toLocaleString()}</span> observations,{" "}
              <span className="font-medium">{manifest.source_prompts_count}</span> prompts,{" "}
              <span className="font-medium">{manifest.source_entities_count}</span> entities.
            </p>
            <p className="text-xs text-muted-foreground">
              Built at: {manifest.built_at}
            </p>
            {cityStrength && cityStrength.length > 0 && (
              <div className="mt-3">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Top cities by brand mention rate
                </h3>
                <ul className="space-y-1 text-xs">
                  {cityStrength.slice(0, 5).map((c) => (
                    <li key={c.city}>
                      <span className="font-medium">{c.city}</span>:{" "}
                      {(c.brand_mention_rate * 100).toFixed(1)}% (trend{" "}
                      {c.trend_vs_prior_window >= 0 ? "+" : ""}
                      {(c.trend_vs_prior_window * 100).toFixed(0)}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No AEO intelligence on disk. Run{" "}
            <code className="rounded bg-surface-inset/60 px-1 py-0.5 text-xs">
              npx tsx --require ./scripts/mock-server-only.cjs scripts/build-local-aeo-intelligence.ts
            </code>
            .
          </p>
        )}
      </section>

      {/* Section 4 — Top 5 opportunities */}
      {topOpportunities.length > 0 && (
        <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Top 5 opportunities (from prompt-opportunity-index)
          </h2>
          <ul className="space-y-2">
            {topOpportunities.map((o) => (
              <li key={o.prompt_id} className="rounded border border-border/40 bg-bg/40 p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{o.prompt_text_snippet}</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    score {o.opportunity_score.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  status: <span className="font-medium">{o.status}</span> · brand-mention-rate{" "}
                  {(o.brand_mention_rate * 100).toFixed(1)}% · sample {o.total_observations} obs
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Section 5 — Top 5 trust risks */}
      {brainHealth && brainHealth.next_three_fixes.length > 0 && (
        <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Trust risks (from brain-health next-fixes)
          </h2>
          <ul className="space-y-2">
            {brainHealth.next_three_fixes.map((f) => (
              <li key={f.rank} className="rounded border border-border/40 bg-bg/40 p-2 text-sm">
                <p className="font-medium">{f.rank}. {f.what}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">why:</span> {f.why}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">surface:</span> {f.surface}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Section 6 — Competitor pulse */}
      {(topRisingCompetitors.length > 0 || topFallingCompetitors.length > 0) && (
        <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Competitor pulse (recent 2w trend)
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-status-warning">
                Rising
              </h3>
              {topRisingCompetitors.length === 0 ? (
                <p className="text-xs text-muted-foreground">no rising competitors</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {topRisingCompetitors.map((c) => (
                    <li key={c.competitor_name}>
                      {c.competitor_name}: +{(c.trend_vs_prior_window * 100).toFixed(0)}% (recent {c.recent_2w})
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-status-success">
                Falling
              </h3>
              {topFallingCompetitors.length === 0 ? (
                <p className="text-xs text-muted-foreground">no falling competitors</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {topFallingCompetitors.map((c) => (
                    <li key={c.competitor_name}>
                      {c.competitor_name}: {(c.trend_vs_prior_window * 100).toFixed(0)}% (recent {c.recent_2w})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Footer — links to relevant scripts */}
      <section className="rounded-lg border border-border/40 bg-bg/40 p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-medium uppercase tracking-wider">Operator scripts</p>
        <ul className="list-disc pl-4">
          <li>
            <code>npm run verify:brain-health</code> — full watchdog
          </li>
          <li>
            <code>scripts/build-brain-health-report.ts</code> — refresh grade
          </li>
          <li>
            <code>scripts/build-local-aeo-intelligence.ts</code> — refresh derived files
          </li>
          <li>
            <code>scripts/analyze-recommendation-outcomes.ts</code> — rec learning
          </li>
        </ul>
        <p className="mt-2">
          See also <Link href="/diagnostics" className="text-accent-primary underline">/diagnostics</Link> +{" "}
          <Link href="/diagnostics/spikes" className="text-accent-primary underline">/diagnostics/spikes</Link>
          .
        </p>
      </section>
    </div>
  );
}
