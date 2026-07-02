/**
 * Architecture invariants — UX.2 Command Center (2026-05-07).
 *
 * Pins the Command Center surface contract:
 *   - Component is pure presentation (no mutations / paid APIs)
 *   - Resolver is read-only (no DB writes, no fetch)
 *   - Customer-safe language (no internal jargon in rendered text)
 *   - TodayClient renders the Command Center for mature tenants
 *     AFTER the demo + first-reading early returns (so Ritz never
 *     loses the regular dashboard, and brand-new tenants still see
 *     the F.1 waiting card first).
 *   - Existing /today layout (Tier 0–7) still renders below.
 *
 * Behavioral coverage of the resolver lives in
 * `src/domains/today/command-center-data.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const COMPONENT = join(
  REPO_ROOT,
  "src/components/today/command-center.tsx",
);
const RESOLVER = join(
  REPO_ROOT,
  "src/domains/today/command-center-data.ts",
);
const COMPONENT_SRC = readFileSync(COMPONENT, "utf8");
const RESOLVER_SRC = readFileSync(RESOLVER, "utf8");
// 2026-06-16: the legacy today-client.tsx was deleted (dual-surface collapse);
// TodayClient's props type (commandCenter: CommandCenterData) lives in
// today-shared-types.ts now.
const TODAY_PROPS_SRC = readFileSync(
  join(REPO_ROOT, "src/app/(shell)/today-shared-types.ts"),
  "utf8",
);

/**
 * Strip block + line + JSX comments + import lines + identifier-style
 * references to forbidden words. Same approach as the C.4/F.1 sweeps.
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
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*Tenant[a-zA-Z0-9_$]*\b/g, "");
}

describe("UX.2 — files exist + correct exports", () => {
  it("component + resolver files exist", () => {
    expect(existsSync(COMPONENT)).toBe(true);
    expect(existsSync(RESOLVER)).toBe(true);
  });

  it("resolver exports the public types + functions", () => {
    expect(RESOLVER_SRC).toMatch(/export function resolveCommandCenterData/);
    expect(RESOLVER_SRC).toMatch(/export function isOperatorMode/);
    expect(RESOLVER_SRC).toMatch(/export type CommandCenterData/);
    expect(RESOLVER_SRC).toMatch(/export type CommandCenterBrain/);
    expect(RESOLVER_SRC).toMatch(/export type CommandCenterManifest/);
    expect(RESOLVER_SRC).toMatch(/export type CommandCenterSection/);
    expect(RESOLVER_SRC).toMatch(/export type CommandCenterGrade/);
  });

  it("component exports CommandCenter + CommandCenterUrlMovement", () => {
    expect(COMPONENT_SRC).toMatch(/export function CommandCenter/);
    expect(COMPONENT_SRC).toMatch(/export type CommandCenterUrlMovement/);
  });
});

describe("UX.2 — resolver is read-only + no paid APIs", () => {
  it("does NOT write to any persisted store", () => {
    expect(RESOLVER_SRC).not.toMatch(/\.upsert\(/);
    expect(RESOLVER_SRC).not.toMatch(/\.insert\(/);
    expect(RESOLVER_SRC).not.toMatch(/\.update\(/);
    expect(RESOLVER_SRC).not.toMatch(/\.delete\(/);
    expect(RESOLVER_SRC).not.toMatch(/writeFileSync/);
    expect(RESOLVER_SRC).not.toMatch(/writeFile\(/);
  });

  it("does NOT call paid APIs / external HTTP", () => {
    expect(RESOLVER_SRC).not.toMatch(/\bfetch\(/);
    expect(RESOLVER_SRC).not.toContain("openai");
    expect(RESOLVER_SRC).not.toContain("perplexity");
    expect(RESOLVER_SRC).not.toContain("anthropic");
    expect(RESOLVER_SRC).not.toContain("runNativePoll");
    expect(RESOLVER_SRC).not.toContain("runWebsiteScan");
    expect(RESOLVER_SRC).not.toMatch(/from\s+["']@\/adapters\//);
  });

  it("declares server-only (resolver reads from disk)", () => {
    expect(RESOLVER_SRC).toMatch(/^import "server-only"/m);
  });
});

describe("UX.2 — component is pure presentation (no mutations / handlers)", () => {
  it("does NOT mutate / call APIs / use state hooks", () => {
    // NOTE: "perplexity" / "chatgpt" appear legitimately as
    // PollPlatform union members (e.g., `platformLabel(p: "perplexity"
    // | "chatgpt")`). The forbidden surfaces are paid-API imports +
    // runners, not the platform identifiers themselves.
    expect(COMPONENT_SRC).not.toMatch(/\.upsert\(/);
    expect(COMPONENT_SRC).not.toMatch(/\.insert\(/);
    expect(COMPONENT_SRC).not.toMatch(/\.update\(/);
    expect(COMPONENT_SRC).not.toMatch(/\.delete\(/);
    expect(COMPONENT_SRC).not.toMatch(/\bfetch\(/);
    expect(COMPONENT_SRC).not.toMatch(/from\s+["']@\/adapters\//);
    expect(COMPONENT_SRC).not.toMatch(/from\s+["']openai["']/);
    expect(COMPONENT_SRC).not.toMatch(/from\s+["']@anthropic/);
    expect(COMPONENT_SRC).not.toContain("runNativePoll");
    expect(COMPONENT_SRC).not.toContain("runWebsiteScan");
    expect(COMPONENT_SRC).not.toMatch(/useTransition/);
    expect(COMPONENT_SRC).not.toMatch(/useState/);
    expect(COMPONENT_SRC).not.toMatch(/useEffect/);
    expect(COMPONENT_SRC).not.toMatch(/onClick=/);
    expect(COMPONENT_SRC).not.toMatch(/onSubmit=/);
  });

  it("renders all 5 expected cards as named functions", () => {
    expect(COMPONENT_SRC).toMatch(/function BrainStatusCard/);
    expect(COMPONENT_SRC).toMatch(/function LatestReadingCard/);
    expect(COMPONENT_SRC).toMatch(/function TopMovementCard/);
    expect(COMPONENT_SRC).toMatch(/function NextBestActionCard/);
    // Operator-only link is rendered inline in the parent (no
    // dedicated function), pinned by the data-attribute below.
  });

  it("operator-only link is gated by isOperator prop", () => {
    expect(COMPONENT_SRC).toMatch(
      /isOperator\s*\?[\s\S]{0,400}data-command-center-operator-link="true"/,
    );
    expect(COMPONENT_SRC).toMatch(/href="\/diagnostics\/brain"/);
  });
});

describe("UX.2 — customer-safe copy (no internal jargon)", () => {
  it("component does NOT render scary/internal terms", () => {
    const code = stripComments(COMPONENT_SRC);
    expect(code).not.toMatch(/\bcron\b/i);
    expect(code).not.toMatch(/\bSupabase\b/i);
    expect(code).not.toMatch(/\bGitHub\b/i);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\bschema\b/i);
    expect(code).not.toMatch(/\bSQL\b/);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\b07:00\b/);
    expect(code).not.toMatch(/\bUTC\b/);
    expect(code).not.toMatch(/\bJSON\b/);
    expect(code).not.toMatch(/\baccount_id\b/);
    expect(code).not.toMatch(/\btenant_id\b/);
  });

  it("component renders the required executive headlines", () => {
    expect(COMPONENT_SRC).toMatch(/Beacon Command Center/);
    expect(COMPONENT_SRC).toMatch(/Brain readiness/);
    expect(COMPONENT_SRC).toMatch(/Latest reading/);
    expect(COMPONENT_SRC).toMatch(/Top movement/);
    expect(COMPONENT_SRC).toMatch(/Next best action/);
  });

  it("operator-only link copy is muted (not customer-loud)", () => {
    // The operator link should be visually de-emphasized — text
    // smaller, muted color, lowercase. We pin the lowercase prefix.
    expect(COMPONENT_SRC).toMatch(/internal:\s*brain diagnostics/);
  });

  it("Next-best-action button uses the required CTA copy", () => {
    expect(COMPONENT_SRC).toMatch(/Open recommendation/);
  });
});

describe("UX.2 — CommandCenterData prop type (today-shared-types)", () => {
  // The legacy today-client.tsx wiring assertions (import/render/source-order
  // of <CommandCenter>) were dropped with the dual-surface collapse (2026-06-16);
  // the live CommandCenter render lives on the V2 section path, and the
  // component itself is pinned by the COMPONENT_SRC describes above. The one
  // durable contract is the prop TYPE, which now lives in today-shared-types.
  it("the Today props expose commandCenter typed as CommandCenterData", () => {
    expect(TODAY_PROPS_SRC).toMatch(/CommandCenterData/);
  });
});

// The legacy "UX.2 today-data.ts wiring" describe was removed 2026-07-01 (FINAL
// PREMIUM PLAN item 101): the legacy today-data.ts loader (and its
// resolveCommandCenterFailSoft / deriveBrainFromTodayInputs helpers) was
// deleted. The CommandCenter component + resolver + props-type contracts
// above and below remain pinned.

describe("UX.2 — no scary/internal language in resolver output", () => {
  it("resolver labels are humanized (no Snake_case enum values returned)", () => {
    // The labelForSection mapper converts "Data Health" → "Data health".
    // Pin the conversion logic exists.
    expect(RESOLVER_SRC).toMatch(/return "Data health"/);
    expect(RESOLVER_SRC).toMatch(/return "Score health"/);
    expect(RESOLVER_SRC).toMatch(/return "Recommendation health"/);
    expect(RESOLVER_SRC).toMatch(/return "Attribution health"/);
  });

  it("resolver does NOT surface raw 'reason' methodology strings to the UI", () => {
    // The summariseSection helper builds a summary from label + value,
    // explicitly NOT from `reason` (which contains methodology
    // language like "≥600 / 7d for healthy 100-prompt × 2-platform").
    // Pin the summary builder uses label/value.
    expect(RESOLVER_SRC).toMatch(
      /function summariseSection[\s\S]*?\$\{label\}[\s\S]*?\$\{value\}/,
    );
    // And explicitly does NOT thread the metric `reason` into the
    // summary string returned to the UI.
    const fnMatch = RESOLVER_SRC.match(/function summariseSection[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    if (fnMatch) {
      // The helper may inspect `worst.reason` defensively but must
      // not return it. Pin: no `reason` token appears in any return
      // statement of the helper body.
      const body = fnMatch[0];
      expect(body).not.toMatch(/return[^;]*\.reason/);
      expect(body).not.toMatch(/return[^;]*\$\{[^}]*reason/);
    }
  });
});
