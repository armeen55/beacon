/**
 * Architecture invariants — Gap F.1 (2026-05-07).
 *
 * Pins the first-reading waiting-state contract:
 *   - detector is pure (no paid APIs, no I/O, no Ritz hardcoding)
 *   - waiting-state component is customer-safe (no scary language)
 *   - /today page integration is fail-soft (Ritz must not regress)
 *   - the waiting state never mutates state or calls paid APIs
 *
 * Behavioral coverage of the detector lives in
 * `src/domains/onboarding/first-reading-state.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const DETECTOR = join(
  REPO_ROOT,
  "src/domains/onboarding/first-reading-state.ts",
);
const WAITING_COMPONENT = join(
  REPO_ROOT,
  "src/components/today/first-reading-waiting.tsx",
);
const TODAY_DATA = join(REPO_ROOT, "src/app/(shell)/today-data.ts");
const TODAY_CLIENT = join(REPO_ROOT, "src/app/(shell)/today-client.tsx");
const LISTER = join(REPO_ROOT, "scripts/list-active-tenants.ts");

const DETECTOR_SRC = readFileSync(DETECTOR, "utf8");
const WAITING_SRC = readFileSync(WAITING_COMPONENT, "utf8");
const TODAY_DATA_SRC = readFileSync(TODAY_DATA, "utf8");
const TODAY_CLIENT_SRC = readFileSync(TODAY_CLIENT, "utf8");

/**
 * Strip block + line + JSX comments + import lines + identifier-style
 * references containing forbidden words. Same helper as C.3/C.4
 * sweeps. The "tenant" word is the most-common false positive so we
 * strip member access + destructuring patterns too.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "")
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*Supabase[a-zA-Z0-9_$]*\b/g, "")
    .replace(/\bsupabase[a-zA-Z0-9_$]*\b/g, "")
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*Tenant[a-zA-Z0-9_$]*\b/g, "")
    .replace(/\bconst\s*\{[^}]*?\btenant\b[^}]*\}\s*=[^;]+;/g, "")
    .replace(/\btenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    .replace(/\bctx\.tenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    .replace(/\bcontext\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    .replace(/\bconst\s+ctx\s*=[^;]+;/g, "");
}

describe("Gap F.1 — files exist", () => {
  it("detector + waiting component exist", () => {
    expect(existsSync(DETECTOR)).toBe(true);
    expect(existsSync(WAITING_COMPONENT)).toBe(true);
  });
});

describe("Gap F.1 — detector is pure", () => {
  it("does NOT import from node:fs / persistence layer / Next.js", () => {
    expect(DETECTOR_SRC).not.toMatch(/from\s+["']node:/);
    expect(DETECTOR_SRC).not.toMatch(/getSupabase/);
    expect(DETECTOR_SRC).not.toMatch(/from\s+["']next\//);
    expect(DETECTOR_SRC).not.toMatch(/process\.env/);
  });

  it("does NOT call paid APIs or external HTTP", () => {
    expect(DETECTOR_SRC).not.toContain("openai");
    expect(DETECTOR_SRC).not.toContain("perplexity");
    expect(DETECTOR_SRC).not.toContain("anthropic");
    expect(DETECTOR_SRC).not.toMatch(/\bfetch\(/);
    expect(DETECTOR_SRC).not.toContain("runNativePoll");
    expect(DETECTOR_SRC).not.toContain("runWebsiteScan");
  });

  it("does NOT use Date.now / new Date / Math.random (deterministic)", () => {
    const code = stripComments(DETECTOR_SRC);
    expect(code).not.toMatch(/Date\.now/);
    expect(code).not.toMatch(/new\s+Date\(/);
    expect(code).not.toMatch(/Math\.random/);
  });

  it("exports detectFirstReadingState + types", () => {
    expect(DETECTOR_SRC).toMatch(/export function detectFirstReadingState/);
    expect(DETECTOR_SRC).toMatch(/export type FirstReadingDetection/);
    expect(DETECTOR_SRC).toMatch(/export type FirstReadingContext/);
  });

  it("trigger condition pinned: only when status='active' AND prompts > 0 AND observations === 0", () => {
    // Source-level pin so a future regression that flips one of the
    // three checks is caught at build time. Use RAW source for the
    // tenant.status pin (stripComments erases member access).
    expect(DETECTOR_SRC).toMatch(/tenant\.status\s*!==\s*"active"/);
    expect(DETECTOR_SRC).toMatch(/activePromptCount\s*<=\s*0|activePromptCount\s*<\s*1/);
    expect(DETECTOR_SRC).toMatch(/observationCount\s*>\s*0/);
  });
});

describe("Gap F.1 — detector does NOT hardcode Ritz", () => {
  it("no Ritz-specific tokens in executable code", () => {
    const code = stripComments(DETECTOR_SRC);
    const ritzTokens = [
      "Ritz",
      "ritz-builders",
      "ritz-founder",
      "ritzbuilders",
      "tenant-ritz",
    ];
    for (const t of ritzTokens) {
      expect(code).not.toContain(t);
    }
  });
});

describe("Gap F.1 — waiting-state component is customer-safe", () => {
  it("does NOT render scary/internal terms", () => {
    const code = stripComments(WAITING_SRC);
    // The brief explicitly forbids these in customer-facing copy.
    expect(code).not.toMatch(/\bcron\b/i);
    expect(code).not.toMatch(/\bSupabase\b/i);
    expect(code).not.toMatch(/\bGitHub\b/i);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\bschema\b/i);
    expect(code).not.toMatch(/poll\s+failure/i);
    expect(code).not.toMatch(/raw\s+observations/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/07:00/);
    expect(code).not.toMatch(/\bUTC\b/);
  });

  it("renders the required customer-safe headline + supporting copy", () => {
    // Pivot reframe (audit #22, 2026-06-14): headline no longer positions
    // the whole product as an "AI visibility" reading — Beacon leads with
    // the site's own search demand, AI-answer visibility is one signal.
    expect(WAITING_SRC).toMatch(
      /Beacon is preparing your first reading/,
    );
    expect(WAITING_SRC).toMatch(
      /Your first dashboard will appear after the next daily reading/,
    );
  });

  it("includes a 'Review tracked prompts' CTA", () => {
    expect(WAITING_SRC).toMatch(/Review tracked prompts/);
    expect(WAITING_SRC).toMatch(/href="\/prompts"/);
  });

  it("does NOT mutate state or call paid APIs", () => {
    expect(WAITING_SRC).not.toMatch(/\.upsert\(/);
    expect(WAITING_SRC).not.toMatch(/\.insert\(/);
    expect(WAITING_SRC).not.toMatch(/\.update\(/);
    expect(WAITING_SRC).not.toMatch(/\.delete\(/);
    expect(WAITING_SRC).not.toContain("openai");
    expect(WAITING_SRC).not.toContain("perplexity");
    expect(WAITING_SRC).not.toContain("runNativePoll");
    expect(WAITING_SRC).not.toContain("runWebsiteScan");
    expect(WAITING_SRC).not.toMatch(/\bfetch\(/);
  });

  it("is presentation-only (does not use 'use client' state hooks for mutation)", () => {
    // The component receives a context object via props and renders
    // it. No useState / useTransition / event handlers that fire
    // server actions. Pure render.
    expect(WAITING_SRC).not.toMatch(/useTransition/);
    expect(WAITING_SRC).not.toMatch(/useState/);
    expect(WAITING_SRC).not.toMatch(/onClick=/);
    expect(WAITING_SRC).not.toMatch(/onSubmit=/);
  });
});

describe("Gap F.1 — today-data.ts wiring", () => {
  it("imports the detector + currentTenant", () => {
    expect(TODAY_DATA_SRC).toMatch(
      /import \{[\s\S]*?detectFirstReadingState[\s\S]*?\} from "@\/domains\/onboarding\/first-reading-state"/,
    );
    expect(TODAY_DATA_SRC).toMatch(
      /import \{[\s\S]*?currentTenant[\s\S]*?\} from "@\/lib\/tenant-context"/,
    );
  });

  it("calls detectFirstReadingState with both counts", () => {
    // 2026-06-11: the call gained a second `derived` arg (the launch-
    // derived profile facts for the minute-one card), so the object
    // literal is no longer glued to the call parens — pin the call +
    // both count fields independently.
    expect(TODAY_DATA_SRC).toMatch(/detectFirstReadingState\(/);
    expect(TODAY_DATA_SRC).toMatch(/activePromptCount:/);
    expect(TODAY_DATA_SRC).toMatch(/observationCount:/);
  });

  it("returns firstReading on the resolver payload", () => {
    expect(TODAY_DATA_SRC).toMatch(/firstReading:\s*await/);
  });

  it("wraps currentTenant() in a try/catch (fail-soft for /today)", () => {
    // Match the resolver helper signature; the existence of try/catch
    // around currentTenant() is the contract.
    expect(TODAY_DATA_SRC).toMatch(
      /try\s*\{[\s\S]{0,200}await\s+currentTenant\(\)[\s\S]{0,400}catch/,
    );
  });

  it("does NOT mutate any persisted store as part of the detection", () => {
    // The detection-resolver helper must not write anywhere. We pin
    // the helper's source by name.
    const helperBody = TODAY_DATA_SRC.match(
      /async function resolveFirstReadingState[\s\S]*?\n\}/,
    );
    expect(helperBody).toBeTruthy();
    if (!helperBody) return;
    const body = helperBody[0];
    expect(body).not.toMatch(/\.upsert\(/);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
    expect(body).not.toContain("runNativePoll");
    expect(body).not.toContain("openai");
    expect(body).not.toContain("perplexity");
  });
});

describe("Gap F.1 — TodayClient early-return", () => {
  it("imports FirstReadingWaiting", () => {
    expect(TODAY_CLIENT_SRC).toMatch(
      /import\s+\{\s*FirstReadingWaiting\s*\}\s+from\s+["']@\/components\/today\/first-reading-waiting["']/,
    );
  });

  it("accepts a firstReading prop typed as FirstReadingDetection", () => {
    expect(TODAY_CLIENT_SRC).toMatch(/firstReading\?:\s*import\(/);
    expect(TODAY_CLIENT_SRC).toMatch(/FirstReadingDetection/);
  });

  it("renders FirstReadingWaiting when firstReading.isFirstReading is true", () => {
    expect(TODAY_CLIENT_SRC).toMatch(
      /firstReading\.isFirstReading[\s\S]{0,200}<FirstReadingWaiting/,
    );
  });

  it("the early-return runs BEFORE the regular dashboard JSX (Ritz unchanged)", () => {
    // The early-return must short-circuit; if it appeared after the
    // visibility chart render, mature tenants would still hit the
    // regular path. Pin the order: demo-mode early return → first-
    // reading early return → regular render.
    const demoIdx = TODAY_CLIENT_SRC.indexOf("if (isDemoMode)");
    const firstReadingIdx = TODAY_CLIENT_SRC.indexOf(
      "if (firstReading.isFirstReading)",
    );
    const visibilityChartIdx = TODAY_CLIENT_SRC.indexOf(
      "<VisibilityScoreChart",
    );
    expect(demoIdx).toBeGreaterThan(-1);
    expect(firstReadingIdx).toBeGreaterThan(-1);
    expect(visibilityChartIdx).toBeGreaterThan(-1);
    expect(demoIdx).toBeLessThan(firstReadingIdx);
    expect(firstReadingIdx).toBeLessThan(visibilityChartIdx);
  });
});

describe("Gap F.1 — Ritz-shaped tenant unchanged", () => {
  // Ritz is the long-running production tenant: status='active',
  // many prompts, many observations. Pin that the detector returns
  // false for that shape, so /today rendering for Ritz is unchanged.
  // Detector logic alone proves it; pin the contract source-side too.

  it("the detector requires observationCount > 0 to skip first-reading", () => {
    // Source-level pin. If a future change accidentally inverts the
    // condition (e.g., `observationCount === 0` to early-return false),
    // this test catches it.
    expect(DETECTOR_SRC).toMatch(/observationCount\s*>\s*0/);
  });

  it("scripts/list-active-tenants.ts still filters status='active' (Gap A intact)", () => {
    const lister = readFileSync(LISTER, "utf8");
    expect(lister).toMatch(/\.eq\(\s*"status"\s*,\s*"active"\s*\)/);
  });
});

describe("Gap F.1 — does NOT trigger any immediate poll or paid API", () => {
  it("today-data wiring does not import paid-API runners", () => {
    // The detection resolver lives in today-data.ts. Pin that the
    // file's imports don't gain new paid-API surfaces during F.1.
    // (Existing imports unrelated to F.1 are untouched; we just check
    // that F.1's helper doesn't add new ones.)
    expect(TODAY_DATA_SRC).not.toMatch(/from\s+["']@\/adapters\/openai/);
    // Existing perplexity import for poll-health is allowed; Gap F.1
    // adds no new ones. We check the resolver helper specifically
    // (already covered above by the helperBody not.toContain checks).
  });

  it("waiting component does not import any adapter or run-poll function", () => {
    expect(WAITING_SRC).not.toMatch(/from\s+["']@\/adapters/);
    expect(WAITING_SRC).not.toMatch(/runNativePoll/);
    expect(WAITING_SRC).not.toMatch(/triggerPoll/);
    expect(WAITING_SRC).not.toMatch(/\/api\/poll\/run/);
  });
});

describe("Gap F.1 — first-reading state never touches mutations / activation", () => {
  it("detector source has no .from(...) / .upsert / .insert / .update / .delete calls", () => {
    expect(DETECTOR_SRC).not.toMatch(/\.from\("/);
    expect(DETECTOR_SRC).not.toMatch(/\.upsert\(/);
    expect(DETECTOR_SRC).not.toMatch(/\.insert\(/);
    expect(DETECTOR_SRC).not.toMatch(/\.update\(/);
    expect(DETECTOR_SRC).not.toMatch(/\.delete\(/);
  });

  it("detector never sets status to anything (read-only)", () => {
    const code = stripComments(DETECTOR_SRC);
    expect(code).not.toMatch(/status:\s*"active"/);
    expect(code).not.toMatch(/status:\s*"pending_onboarding"/);
    expect(code).not.toMatch(/status:\s*"paused"/);
    expect(code).not.toMatch(/status:\s*"cancelled"/);
  });
});
