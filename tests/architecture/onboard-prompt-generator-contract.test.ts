/**
 * Architecture invariants — Gap E.1 (2026-05-07).
 *
 * Pins the prompt-generator + /onboard/review-renders-preview
 * contract. Behavioral generator tests live in
 * `src/domains/onboarding/prompt-generator.test.ts`; this file locks
 * the source-level contracts (no paid APIs, no external imports, no
 * Ritz hardcoding, preview-only persistence, cron isolation
 * unchanged).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const GENERATOR = join(
  REPO_ROOT,
  "src/domains/onboarding/prompt-generator.ts",
);
const REVIEW_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/review/page.tsx",
);
const GENERATOR_SRC = readFileSync(GENERATOR, "utf8");
const REVIEW_SRC = readFileSync(REVIEW_PAGE, "utf8");

/**
 * Strip block + line + JSX comments AND code identifiers that
 * legitimately contain words we'd otherwise flag in rendered text.
 * Same helper as the C.3 cross-page sweep.
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
    .replace(/\bconst\s+ctx\s*=[^;]+;/g, "");
}

describe("Gap E.1 — prompt-generator file exists + exports", () => {
  it("file exists at src/domains/onboarding/prompt-generator.ts", () => {
    expect(existsSync(GENERATOR)).toBe(true);
  });

  it("exports generateStarterPrompts + STARTER_PROMPT_MAX_COUNT + types", () => {
    expect(GENERATOR_SRC).toMatch(/export function generateStarterPrompts/);
    expect(GENERATOR_SRC).toMatch(
      /export const STARTER_PROMPT_MAX_COUNT\s*=\s*25/,
    );
    expect(GENERATOR_SRC).toMatch(/export type PromptDraft/);
    expect(GENERATOR_SRC).toMatch(/export type PromptCategory/);
    expect(GENERATOR_SRC).toMatch(/export type StarterPromptInput/);
  });
});

describe("Gap E.1 — generator is pure + deterministic", () => {
  it("does NOT import from node:fs / node:path / persistence layer", () => {
    // Pure module — no I/O, no env, no Supabase.
    expect(GENERATOR_SRC).not.toMatch(/from\s+["']node:fs["']/);
    expect(GENERATOR_SRC).not.toMatch(/from\s+["']node:path["']/);
    expect(GENERATOR_SRC).not.toMatch(/from\s+["']fs["']/);
    expect(GENERATOR_SRC).not.toMatch(/from\s+["']path["']/);
    expect(GENERATOR_SRC).not.toMatch(/getSupabase/);
    expect(GENERATOR_SRC).not.toMatch(/from\s+["']next\//);
    expect(GENERATOR_SRC).not.toMatch(/process\.env/);
  });

  it("does NOT use Math.random / Date.now / new Date (deterministic guarantee)", () => {
    const code = stripComments(GENERATOR_SRC);
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now/);
    expect(code).not.toMatch(/new Date\(/);
  });

  it("does NOT call paid APIs / external HTTP", () => {
    expect(GENERATOR_SRC).not.toContain("openai");
    expect(GENERATOR_SRC).not.toContain("perplexity");
    expect(GENERATOR_SRC).not.toContain("anthropic");
    expect(GENERATOR_SRC).not.toContain("google");
    expect(GENERATOR_SRC).not.toMatch(/\bfetch\(/);
    expect(GENERATOR_SRC).not.toMatch(/\bXMLHttpRequest\b/);
    expect(GENERATOR_SRC).not.toMatch(/\baxios\b/);
    expect(GENERATOR_SRC).not.toContain("runNativePoll");
    expect(GENERATOR_SRC).not.toContain("runWebsiteScan");
    expect(GENERATOR_SRC).not.toContain("syncRecommendedEdits");
  });
});

describe("Gap E.1 — generator does NOT hardcode Ritz / Beacon / operator data", () => {
  // We grep the CODE (post-comment-strip), not the docstring. The
  // generator's JSDoc legitimately mentions Ritz when explaining the
  // "no hardcoding" rule and uses Atherton in examples — those are
  // documentation, not behavior.

  it("does NOT contain Ritz-specific tokens in executable code", () => {
    const code = stripComments(GENERATOR_SRC);
    const ritzTokens = [
      "Ritz",
      "ritz-builders",
      "ritz-founder",
      "ritzbuilders",
      "Atherton-93022",
      "tenant-ritz",
    ];
    for (const t of ritzTokens) {
      expect(code).not.toContain(t);
    }
  });

  it("does NOT contain known Ritz competitor names as string literals", () => {
    // Competitor names should only appear via the `competitors` input
    // parameter, not as literal strings in the generator.
    const code = stripComments(GENERATOR_SRC);
    const knownCompetitors = [
      "De Mattei",
      "Kasten",
      "Supple Homes",
      "BNB Builders",
    ];
    for (const c of knownCompetitors) {
      expect(code).not.toContain(`"${c}"`);
      expect(code).not.toContain(`'${c}'`);
    }
  });

  it("does NOT contain Ritz-specific city names as string literals", () => {
    // City names should only appear via citiesServed input, not literals.
    const code = stripComments(GENERATOR_SRC);
    const ritzCities = [
      "Atherton",
      "Menlo Park",
      "Los Altos",
      "Palo Alto",
      "Woodside",
    ];
    for (const city of ritzCities) {
      expect(code).not.toContain(`"${city}"`);
      expect(code).not.toContain(`'${city}'`);
    }
  });
});

describe("Gap E.1 — /onboard/review renders the generated preview", () => {
  it("imports generateStarterPrompts from the onboarding domain", () => {
    expect(REVIEW_SRC).toMatch(
      /import\s+\{[\s\S]*?generateStarterPrompts[\s\S]*?\}\s+from\s+["']@\/domains\/onboarding\/prompt-generator["']/,
    );
  });

  it("calls generateStarterPrompts() with the saved tenant inputs", () => {
    expect(REVIEW_SRC).toMatch(/generateStarterPrompts\(\s*\{/);
    // Inputs threaded through from saved tenant row (either inline
    // member access or via intermediate const — both are fine).
    expect(REVIEW_SRC).toMatch(/businessName:/);
    expect(REVIEW_SRC).toMatch(/citiesServed:/);
    expect(REVIEW_SRC).toMatch(/projectMix/);
    expect(REVIEW_SRC).toMatch(/competitors/);
    // The saved fields must be sourced from the tenant row.
    expect(REVIEW_SRC).toMatch(/tenant\.business_name/);
    expect(REVIEW_SRC).toMatch(/tenant\.cities_served/);
    expect(REVIEW_SRC).toMatch(/tenant\.project_mix/);
    expect(REVIEW_SRC).toMatch(/tenant\.discovered_competitors/);
  });

  it("renders the Beacon-will-track copy", () => {
    // Gap C.4 changed the copy — review page now says "Beacon will
    // start tracking these prompts on the next daily reading."
    expect(REVIEW_SRC).toMatch(/Beacon will start tracking these prompts/i);
  });
});

describe("Gap E.1 — /onboard/review page itself is read-only (writes go through Launch action)", () => {
  // Gap C.4 added the Launch action. The PAGE itself still does not
  // write — writes happen in the action invoked by LaunchForm. These
  // invariants pin that the server component is a pure read.

  it("page does NOT directly query tracked_prompts (writes are in actions.ts)", () => {
    const code = stripComments(REVIEW_SRC);
    expect(code).not.toMatch(/\.from\(["']tracked_prompts["']\)/);
    expect(code).not.toMatch(/insertTrackedPrompt/);
    expect(code).not.toMatch(/createPromptCluster/);
    expect(code).not.toMatch(/syncTrackedPrompts/);
  });

  it("page does NOT directly write to ANY persisted store", () => {
    expect(REVIEW_SRC).not.toMatch(/\.upsert\(/);
    expect(REVIEW_SRC).not.toMatch(/\.insert\(/);
    expect(REVIEW_SRC).not.toMatch(/\.update\(/);
    expect(REVIEW_SRC).not.toMatch(/\.delete\(/);
  });

  it("page does NOT call paid APIs", () => {
    expect(REVIEW_SRC).not.toContain("openai");
    expect(REVIEW_SRC).not.toContain("perplexity");
    expect(REVIEW_SRC).not.toContain("runNativePoll");
    expect(REVIEW_SRC).not.toContain("runWebsiteScan");
  });

  it("page does NOT directly flip tenant status to 'active' (only the action does)", () => {
    const code = stripComments(REVIEW_SRC);
    expect(code).not.toMatch(/status:\s*"active"/);
    expect(code).not.toMatch(/"active"\s*as\s*const/);
  });

  it("page does NOT directly invoke any server action (LaunchForm does)", () => {
    // The page is a server component that resolves data + renders.
    // Action calls happen in the client form (LaunchForm).
    const code = stripComments(REVIEW_SRC);
    expect(code).not.toMatch(/\bsaveBusinessProfile\(/);
    expect(code).not.toMatch(/\bsaveScopeProfile\(/);
    expect(code).not.toMatch(/\bsaveCompetitorsProfile\(/);
    expect(code).not.toMatch(/\blaunchTenant\(/);
    expect(code).not.toMatch(/\bactivateTenant\(/);
  });
});

describe("Gap E.1 — pending tenants stay pending through onboarding", () => {
  // De-bloat (2026-06-15): the `list-active-tenants.ts filters
  // status='active'` assertion was removed with the deleted cron-matrix
  // lister. The surviving preview-only contract below is the live
  // invariant.
  it("/onboard/review never inserts into tracked_prompts (preview-only contract)", () => {
    expect(REVIEW_SRC).not.toMatch(/\.from\(["']tracked_prompts["']\)/);
  });

  it("prompt-generator never inserts into tracked_prompts (it's a pure helper)", () => {
    expect(GENERATOR_SRC).not.toMatch(/\.from\(["']tracked_prompts["']\)/);
  });
});

describe("Gap E.1 — generator output cap pinned + family contract", () => {
  it("STARTER_PROMPT_MAX_COUNT = 25 (operator-locked)", () => {
    expect(GENERATOR_SRC).toMatch(/STARTER_PROMPT_MAX_COUNT\s*=\s*25/);
  });

  it("PromptCategory union pins exactly 4 families", () => {
    // The contract: 4 family categories. Adding more in the future
    // requires a deliberate edit + invariant update.
    expect(GENERATOR_SRC).toMatch(/"brand_discovery"/);
    expect(GENERATOR_SRC).toMatch(/"competitor_comparison"/);
    expect(GENERATOR_SRC).toMatch(/"service_in_city"/);
    expect(GENERATOR_SRC).toMatch(/"cost_query"/);
  });

  it("SERVICE_PROMPT_TERMS covers every ProjectMixTag (build-time pin via Record)", () => {
    // The Record<ProjectMixTag, string> annotation means TypeScript
    // catches missing entries at compile time. Pin the literal map
    // exists.
    expect(GENERATOR_SRC).toMatch(
      /SERVICE_PROMPT_TERMS:\s*Record<ProjectMixTag,\s*string>/,
    );
    // Spot-check that each tag name appears as a key.
    expect(GENERATOR_SRC).toMatch(/new_construction:/);
    expect(GENERATOR_SRC).toMatch(/whole_home_remodel:/);
    expect(GENERATOR_SRC).toMatch(/kitchen_bath:/);
    expect(GENERATOR_SRC).toMatch(/adu_addition:/);
    expect(GENERATOR_SRC).toMatch(/teardown_rebuild:/);
    expect(GENERATOR_SRC).toMatch(/commercial_residential:/);
  });
});

describe("Gap E.1 — review page customer-safe-language sweep", () => {
  it("/onboard/review does NOT render tenant/admin/RLS/schema/Supabase/cron/GitHub", () => {
    const code = stripComments(REVIEW_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
    expect(code).not.toMatch(/\bSupabase\b/i);
    expect(code).not.toMatch(/\bcron\b/i);
    expect(code).not.toMatch(/\bGitHub\b/i);
  });
});
