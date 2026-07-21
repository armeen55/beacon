/**
 * CONSTITUTION §12 — Customer-copy floor (THE one consolidated copy-honesty
 * guard).
 *
 * ONE parameterized file — not per-surface clones. Consolidated from
 * forbidden-customer-vocabulary-contract, no-operator-jargon,
 * no-banned-dash-display-surfaces, and no-ritz-in-recommendation-copy.
 * Every forbidden term / banned dash / vendor + lab word / tonight-claim
 * table is preserved verbatim; deleting a row retires an invariant.
 *
 * Four parameterized checks:
 *   A. Forbidden operator/lab vocabulary in customer-facing rendered copy
 *      (cron-time leaks, Z-score, lifecycle, decision queue, native
 *      observations, dual-write, evidence tier, raw enum labels).
 *   B. No operator jargon / vendor names / "Decide tonight" / causal
 *      overclaim in src/app + src/components (+ the M3 correlation phrasing
 *      MUST be present on the live win-card surface).
 *   C. No em/en/figure/bar dash in curated display surfaces, and the pure
 *      label/sentence functions never return one.
 *   D. No rendered "Ritz" tenant leak in recommendation copy.
 */

import fs from "node:fs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path, { resolve, join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { actionLabel } from "@/domains/insight/page-primary";
import {
  proofOutcomeSentence,
  type GscProofVerdict,
} from "@/domains/proof-gsc/measure";

const REPO_ROOT = resolve(__dirname, "../..");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*$/gm, "")
    .replace(/^\s*import\s+["'][^"']+["']\s*;?\s*$/gm, "")
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["']\s*;?\s*$/gm, "");
}

function walk(root: string, excludeSegments: readonly string[], exts: RegExp): string[] {
  const out: string[] = [];
  function rec(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        rec(full);
        continue;
      }
      if (!exts.test(name)) continue;
      if (excludeSegments.some((s) => full.includes(s))) continue;
      out.push(full);
    }
  }
  rec(root);
  return out;
}

// ═══ A. Forbidden customer vocabulary ═══════════════════════════════
type ForbiddenRule = { phrase: string; rationale: string; allowedFiles?: readonly string[] };

const FORBIDDEN: readonly ForbiddenRule[] = [
  { phrase: "07:00, 08:30", rationale: "Cron schedule leak." },
  { phrase: "10:00 UTC", rationale: "Cron-time leak." },
  { phrase: "10:45 UTC", rationale: "Backup-canary cron-time leak." },
  { phrase: "scheduled poll", rationale: "Operator vocabulary." },
  { phrase: "Next poll at", rationale: "Cron-schedule leak." },
  {
    phrase: "Z-score",
    rationale: "Statistical jargon; operator-only surfaces may keep it.",
    allowedFiles: ["src/domains/attribution/verdict-provenance.ts"],
  },
  { phrase: "Recommendation lifecycle", rationale: "Operator vocabulary." },
  { phrase: "decision queue", rationale: "Old internal name for /recommendations." },
  {
    phrase: "decision matrix",
    rationale: "Internal compute layer.",
    allowedFiles: ["src/domains/prompts/decision-matrix"],
  },
  { phrase: "pattern brain", rationale: "Internal subsystem name." },
  {
    phrase: "answer-intelligence",
    rationale: "Internal subsystem name.",
    allowedFiles: ["src/domains/answer-intelligence"],
  },
  { phrase: "native observations", rationale: "Operator vocabulary." },
  { phrase: "native observation", rationale: "Operator vocabulary (singular)." },
  { phrase: "Lambda cold", rationale: "Infrastructure jargon." },
  { phrase: "dual-write", rationale: "Infrastructure jargon." },
  { phrase: "evidence tier", rationale: "Internal classifier label." },
  { phrase: "First Appearance", rationale: "Raw enum label." },
  { phrase: "Visibility Regained", rationale: "Raw enum label." },
  { phrase: "Mention Surge", rationale: "Raw enum label." },
  { phrase: "Visibility Lost", rationale: "Raw enum label." },
  { phrase: "Mention Decline", rationale: "Raw enum label." },
  { phrase: "Loading the decision queue", rationale: "Operator vocabulary." },
];

const VOCAB_FILES = [
  ...walk(resolve(REPO_ROOT, "src/app/(shell)"), [`${sep}diagnostics${sep}`, ".test.ts", ".test.tsx", `${sep}__tests__${sep}`], /\.(ts|tsx)$/),
  ...walk(resolve(REPO_ROOT, "src/components"), [".test.ts", ".test.tsx", `${sep}__tests__${sep}`], /\.(ts|tsx)$/),
];
const VOCAB_STRIPPED = new Map<string, string>();
const strippedOf = (f: string) => {
  let c = VOCAB_STRIPPED.get(f);
  if (c === undefined) {
    c = stripComments(readFileSync(f, "utf8"));
    VOCAB_STRIPPED.set(f, c);
  }
  return c;
};

describe("A — forbidden customer vocabulary in rendered copy", () => {
  it("scans a non-trivial number of customer-facing files", () => {
    expect(VOCAB_FILES.length).toBeGreaterThan(40);
  });
  for (const rule of FORBIDDEN) {
    it(`rejects '${rule.phrase}'`, () => {
      const needle = rule.phrase.toLowerCase();
      const hits: string[] = [];
      for (const file of VOCAB_FILES) {
        if (rule.allowedFiles?.some((p) => file.includes(p.replace(/\//g, sep)))) continue;
        strippedOf(file)
          .split("\n")
          .forEach((line, i) => {
            if (line.toLowerCase().includes(needle))
              hits.push(`${file.replace(REPO_ROOT + sep, "")}:${i + 1}`);
          });
      }
      expect(hits, `'${rule.phrase}' — ${rule.rationale}\n${hits.join("\n")}`).toEqual([]);
    });
  }
});

// ═══ B. No operator jargon / vendor names / causal overclaim ════════
const BANNED: readonly { needle: string; reason: string }[] = [
  { needle: "Decide tonight", reason: 'operator jargon — use "Action queue"' },
  { needle: '"Heuristic"', reason: "lab word — use Pattern-based / Rule of thumb" },
  { needle: "'Heuristic'", reason: "lab word — use Pattern-based / Rule of thumb" },
  { needle: "Profound-style", reason: "vendor reference must not leak to UI" },
  { needle: "is winning after", reason: "M3 causal overclaim" },
  { needle: "winning after your", reason: "M3 causal overclaim" },
];

function jargonHits(file: string): string[] {
  const stripped = stripComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const b of BANNED)
    if (stripped.includes(b.needle))
      out.push(`${path.relative(REPO_ROOT, file)} — ${b.needle} (${b.reason})`);
  return out;
}

describe("B — no operator jargon / vendor names in src/app + src/components", () => {
  const files = [
    ...walk(join(REPO_ROOT, "src/app"), [".test.", ".stories.", "__mocks__", "__fixtures__"], /\.(ts|tsx|js|jsx)$/),
    ...walk(join(REPO_ROOT, "src/components"), [".test.", ".stories.", "__mocks__", "__fixtures__"], /\.(ts|tsx|js|jsx)$/),
  ];
  it("no banned operator-facing strings", () => {
    const violations = files.flatMap(jargonHits);
    expect(violations, violations.join("\n")).toEqual([]);
  });
  it("the live win-card surface leads with correlation phrasing (M3 positive presence)", () => {
    const src = readFileSync(join(REPO_ROOT, "src/app/(shell)/today-v2-data.ts"), "utf8");
    expect(src.includes("Citation lift detected")).toBe(true);
    expect(src.includes("URL-level correlation")).toBe(true);
  });
});

// ═══ C. No banned dash on display surfaces ══════════════════════════
const BANNED_DASH = /[‒–—―]/;
function stripForDash(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => (line.includes("://") ? line : line.replace(/\/\/.*$/, "")))
    .join("\n");
}
const DISPLAY_SURFACES = [
  "src/app/(shell)/today-v2-data.ts",
  "src/app/(shell)/changes/page.tsx",
  "src/app/(shell)/changes/changes-v2-client.tsx",
  "src/app/(shell)/changes/proof-ledger-strip.tsx",
  "src/app/(shell)/results/page.tsx",
  "src/app/(shell)/results/proof-summary-section.tsx",
  "src/app/(shell)/results/proof-ledger-client.tsx",
  "src/app/(shell)/opportunities/page.tsx",
  "src/components/recommendations/v2/recommendation-v2-card.tsx",
  "src/domains/recommendation-intelligence/page-surgeon/change-pack.ts",
  "src/domains/insight/connection-health.ts",
  "src/domains/insight/page-primary.ts",
  "src/domains/proof-gsc/measure.ts",
  "src/domains/proof-gsc/measurement-maturity.ts",
  "src/app/(shell)/connections/page.tsx",
  "src/app/(shell)/settings/connectors/actions.ts",
  "src/app/(shell)/settings/connectors/connectors-client.tsx",
  "src/app/(shell)/settings/connectors/page.tsx",
  "src/app/(shell)/settings/connectors/publishing-mode-card.tsx",
  "src/components/connectors/connector-capability-copy.ts",
  "src/domains/recommendation-intelligence/page-surgeon/bridge.ts",
  "src/domains/recommendation-intelligence/evidence-summary.ts",
  "src/domains/recommendations/evidence-summary.ts",
  "src/lib/connectors/gsc/readiness.ts",
  "src/components/today/action-card.tsx",
  "src/components/today/ai-visibility-hero.tsx",
  "src/components/today/first-reading-waiting.tsx",
  "src/components/today/health-strip.tsx",
  "src/components/today/how-we-know-panel.tsx",
  "src/components/today/refresh-my-data-button.tsx",
  "src/components/today/today-scoreboard.tsx",
  "src/components/today/visibility-leaderboard.tsx",
  "src/components/today/visibility-score-chart.tsx",
  "src/app/(shell)/scoreboard-section.tsx",
  "src/app/(shell)/settings/config/revenue-model-card.tsx",
  "src/domains/scoreboard/scoreboard.ts",
  "src/domains/revenue/compute-unit-economics.ts",
  "src/domains/revenue/load-revenue.ts",
  "src/lib/connectors/adnetwork/types.ts",
  "src/lib/connectors/adnetwork/registry.ts",
];

describe("C — no banned dash in display surfaces (hard rule)", () => {
  it.each(DISPLAY_SURFACES)("%s has no em/en dash outside comments", (rel) => {
    const stripped = stripForDash(readFileSync(join(REPO_ROOT, rel), "utf8"));
    const offending = stripped
      .split("\n")
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => BANNED_DASH.test(l));
    expect(offending.map(({ l, n }) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  it("actionLabel never returns a banned dash", () => {
    for (const k of [
      "edit_title",
      "edit_meta",
      "change_h1",
      "intro_answer_block",
      "section_add",
      "faq",
      "schema",
      "add_internal_link",
      "keep_current",
      "monitor",
      "change",
      null,
      undefined,
    ])
      expect(BANNED_DASH.test(actionLabel(k))).toBe(false);
  });

  it("proofOutcomeSentence never returns a banned dash", () => {
    const basis = {
      day: 28 as const,
      checkOn: "2026-07-18",
      ran: true,
      treatedDelta: 30,
      controlDelta: 2,
      adjustedLift: 28,
      treatedCtrDelta: 0.01,
      controlCtrDelta: 0.002,
      adjustedCtrLift: 0.008,
      treatedPosDelta: 1.5,
      controlPosDelta: 0.3,
      adjustedPosLift: 1.2,
      controlsUsed: 3,
    };
    for (const verdict of [
      "measuring",
      "won",
      "lost",
      "inconclusive",
      "insufficient_data",
    ] as GscProofVerdict[]) {
      const s = proofOutcomeSentence({ verdict, confidence: "high", basis });
      expect(BANNED_DASH.test(s), `verdict=${verdict}: "${s}"`).toBe(false);
    }
  });
});

// ═══ D. No rendered tenant name in recommendation copy ══════════════
describe("D — no rendered 'Ritz' in recommendation copy", () => {
  const isComment = (line: string) => {
    const t = line.trim();
    return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
  };
  for (const rel of [
    "src/domains/recommendations/recommendation-action-rows.ts",
    "src/domains/recommendations/recommendation-evidence-preview.ts",
  ]) {
    it(`${rel}: every 'Ritz' is in a comment, never a rendered string`, () => {
      const offenders = readFileSync(join(REPO_ROOT, rel), "utf-8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /Ritz/.test(line) && !isComment(line))
        .map((o) => `${rel}:${o.n}: ${o.line.trim()}`);
      expect(offenders).toEqual([]);
    });
  }
});
