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
// 2026-07-01 (FINAL PREMIUM PLAN item 101): the legacy today-data.ts was
// deleted; the live first-reading wiring is loadTodayV2GateData in
// today-v2-data.ts.
const TODAY_V2_DATA = join(REPO_ROOT, "src/app/(shell)/today-v2-data.ts");
const PAGE = join(REPO_ROOT, "src/app/(shell)/page.tsx");

const DETECTOR_SRC = readFileSync(DETECTOR, "utf8");
const WAITING_SRC = readFileSync(WAITING_COMPONENT, "utf8");
const TODAY_V2_DATA_SRC = readFileSync(TODAY_V2_DATA, "utf8");
// 2026-06-16: the legacy today-client.tsx was deleted (dual-surface collapse).
// The LIVE /today route is page.tsx (it renders FirstReadingWaiting on the
// first-reading gate), and TodayClient's props type moved to today-shared-types.
const PAGE_SRC = readFileSync(PAGE, "utf8");
const TODAY_PROPS_SRC = readFileSync(
  join(REPO_ROOT, "src/app/(shell)/today-shared-types.ts"),
  "utf8",
);

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
      /Connect your data sources and click Refresh to see your first/,
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

// 2026-07-01 (FINAL PREMIUM PLAN item 101): the legacy today-data.ts
// loader (and its resolveFirstReadingState helper) was deleted. The live
// first-reading decision runs in `loadTodayV2GateData` (today-v2-data.ts),
// so the wiring contract is pinned there instead.
describe("Gap F.1 - V2 gate wiring (today-v2-data.ts)", () => {
  const gateStart = TODAY_V2_DATA_SRC.indexOf(
    "export async function loadTodayV2GateData",
  );
  const gateTail = gateStart >= 0 ? TODAY_V2_DATA_SRC.slice(gateStart) : "";
  const gateNext = gateTail.search(
    /\nexport\s+(async\s+function|function|const|type)\s/,
  );
  const gateBody = gateNext > 0 ? gateTail.slice(0, gateNext) : gateTail;

  it("loads the detector + currentTenant on the cold-tenant path", () => {
    expect(gateBody).toMatch(/detectFirstReadingState/);
    expect(gateBody).toMatch(
      /import\(\s*\n?\s*["']@\/domains\/onboarding\/first-reading-state["']/,
    );
    expect(gateBody).toMatch(/currentTenant\b/);
  });

  it("calls detectFirstReadingState with both counts", () => {
    expect(gateBody).toMatch(/detectFirstReadingState\(\{/);
    expect(gateBody).toMatch(/activePromptCount/);
    expect(gateBody).toMatch(/observationCount/);
  });

  it("returns firstReading on the gate payload", () => {
    expect(gateBody).toMatch(/firstReading:\s*detectFirstReadingState\(/);
  });

  it("wraps currentTenant() in a try/catch (fail-soft for /today)", () => {
    expect(gateBody).toMatch(
      /try\s*\{[\s\S]{0,400}await\s+currentTenant\(\)[\s\S]{0,600}catch/,
    );
  });

  it("does NOT mutate any persisted store as part of the detection", () => {
    expect(gateBody).not.toMatch(/\.upsert\(/);
    expect(gateBody).not.toMatch(/\.insert\(/);
    expect(gateBody).not.toMatch(/\.update\(/);
    expect(gateBody).not.toMatch(/\.delete\(/);
    expect(gateBody).not.toContain("runNativePoll");
    expect(gateBody).not.toContain("openai");
    expect(gateBody).not.toContain("perplexity");
  });
});

describe("Gap F.1 — /today first-reading early-return (live page.tsx)", () => {
  it("imports FirstReadingWaiting", () => {
    expect(PAGE_SRC).toMatch(
      /import\s+\{\s*FirstReadingWaiting\s*\}\s+from\s+["']@\/components\/today\/first-reading-waiting["']/,
    );
  });

  it("accepts a firstReading prop typed as FirstReadingDetection", () => {
    expect(TODAY_PROPS_SRC).toMatch(/firstReading\?:\s*import\(/);
    expect(TODAY_PROPS_SRC).toMatch(/FirstReadingDetection/);
  });

  it("renders FirstReadingWaiting when the first-reading gate is true", () => {
    // The live /today route (page.tsx) early-returns FirstReadingWaiting from
    // the gate — replaces the deleted legacy today-client internal early-return.
    expect(PAGE_SRC).toMatch(
      /firstReading\.isFirstReading[\s\S]{0,200}<FirstReadingWaiting/,
    );
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
  // De-bloat (2026-06-15): the `scripts/list-active-tenants.ts still
  // filters status='active'` assertion was removed with the lister —
  // it was the cron-matrix plumbing for the deleted scheduled poll/scan/
  // generation workflows and has no live consumer post-pivot.
});

describe("Gap F.1 — does NOT trigger any immediate poll or paid API", () => {
  it("V2 gate wiring does not import paid-API runners", () => {
    // The first-reading decision lives in today-v2-data.ts. Pin that the
    // file's imports don't gain new paid-API surfaces during F.1.
    // (Existing imports unrelated to F.1 are untouched; we just check
    // that F.1's wiring doesn't add new ones.)
    expect(TODAY_V2_DATA_SRC).not.toMatch(/from\s+["']@\/adapters\/openai/);
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
