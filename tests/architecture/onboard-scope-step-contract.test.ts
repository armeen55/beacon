/**
 * Architecture invariants — Gap C.2 (2026-05-07).
 *
 * Pins the /onboard/scope form + saveScopeProfile action + new
 * /onboard/competitors placeholder. Behavioral validation tests live
 * in `src/domains/onboarding/scope-validation.test.ts`; this file
 * locks the route + action contract.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const SCOPE_PAGE = join(REPO_ROOT, "src/app/(shell)/onboard/scope/page.tsx");
const SCOPE_FORM = join(REPO_ROOT, "src/app/(shell)/onboard/scope/scope-form.tsx");
const SCOPE_ACTIONS = join(REPO_ROOT, "src/app/(shell)/onboard/scope/actions.ts");
const COMPETITORS_PAGE = join(REPO_ROOT, "src/app/(shell)/onboard/competitors/page.tsx");
const VALIDATION = join(REPO_ROOT, "src/domains/onboarding/scope-validation.ts");

const SCOPE_PAGE_SRC = readFileSync(SCOPE_PAGE, "utf8");
const SCOPE_FORM_SRC = readFileSync(SCOPE_FORM, "utf8");
const SCOPE_ACTIONS_SRC = readFileSync(SCOPE_ACTIONS, "utf8");
const COMPETITORS_SRC = readFileSync(COMPETITORS_PAGE, "utf8");
const VALIDATION_SRC = readFileSync(VALIDATION, "utf8");

/**
 * Strip block + line + JSX comments before searching for forbidden tokens.
 * Also strips code-level references to the destructured `tenant`/`ctx`
 * variables bound by `requireOnboardingTenant()` — those appear in
 * destructuring + JSX expression interpolations and are not visitor-rendered.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // import { ... } from "..."; — module paths (e.g. provision-tenant) are
    // not visitor-rendered copy. Mirrors the competitors/launch contracts.
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "")
    .replace(/\bconst\s*\{[^}]*?\btenant\b[^}]*\}\s*=[^;]+;/g, "")
    .replace(/\btenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    // ctx.tenant.foo
    .replace(/\bctx\.tenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    // const ctx = await requireOnboardingTenant();
    .replace(/\bconst\s+ctx\s*=[^;]+;/g, "");
}

describe("Gap C.2 — /onboard/scope step (form replaces placeholder)", () => {
  it("page + form + action all exist", () => {
    expect(existsSync(SCOPE_PAGE)).toBe(true);
    expect(existsSync(SCOPE_FORM)).toBe(true);
    expect(existsSync(SCOPE_ACTIONS)).toBe(true);
  });

  it("page is force-dynamic + uses requireOnboardingTenant", () => {
    expect(SCOPE_PAGE_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(SCOPE_PAGE_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("page is step={2} of 4 in OnboardingShell", () => {
    expect(SCOPE_PAGE_SRC).toMatch(/<OnboardingShell[\s\S]*?step=\{2\}/);
  });

  it("page renders the ScopeForm (replaces Gap C.1 placeholder)", () => {
    expect(SCOPE_PAGE_SRC).toMatch(/<ScopeForm[\s\S]*?\/>/);
  });

  it("form collects exactly cities (textarea) + projectMix (checkboxes)", () => {
    // Cities textarea
    expect(SCOPE_FORM_SRC).toMatch(/<textarea[^>]*\bid="cities"/);
    // Project-mix checkboxes
    expect(SCOPE_FORM_SRC).toMatch(/type="checkbox"[\s\S]{0,200}name="projectMix"/);
    // No other input types that would collect extra info
    expect(SCOPE_FORM_SRC).not.toContain('type="password"');
    expect(SCOPE_FORM_SRC).not.toMatch(/credit\s*card/i);
    expect(SCOPE_FORM_SRC).not.toMatch(/stripe/i);
    expect(SCOPE_FORM_SRC).not.toMatch(/\bcvv\b/i);
  });

  it("form does NOT expose tenant/admin/RLS/schema language to the visitor", () => {
    const code = stripComments(SCOPE_FORM_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });

  it("page does NOT expose tenant/admin/RLS/schema language to the visitor", () => {
    const code = stripComments(SCOPE_PAGE_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });
});

describe("Gap C.2 — saveScopeProfile server action contract", () => {
  it('marked as "use server"', () => {
    expect(SCOPE_ACTIONS_SRC).toMatch(/^"use server"/m);
  });

  it("validates input via validateScopeProfile (pure)", () => {
    expect(SCOPE_ACTIONS_SRC).toMatch(
      /import \{[\s\S]*?validateScopeProfile[\s\S]*?\} from "@\/domains\/onboarding\/scope-validation"/,
    );
    expect(SCOPE_ACTIONS_SRC).toMatch(/validateScopeProfile\(input\)/);
  });

  it("uses the service-role admin client for the update", () => {
    expect(SCOPE_ACTIONS_SRC).toMatch(/getSupabaseAdmin/);
  });

  it("UPDATE is gated by status='pending_onboarding' (no active-tenant mutation)", () => {
    const code = stripComments(SCOPE_ACTIONS_SRC);
    expect(code).toMatch(
      /\.update\([\s\S]{0,400}\.eq\("id",[\s\S]{0,200}\.eq\("status",\s*"pending_onboarding"\)/,
    );
  });

  it("does NOT flip status to 'active' anywhere in the action", () => {
    const code = stripComments(SCOPE_ACTIONS_SRC);
    expect(code).not.toMatch(/\.update\(\s*\{[^}]*status:\s*"active"/);
    expect(code).not.toMatch(/status:\s*"active"\s*as\s*const/);
  });

  it("does NOT create prompts, tracked_entities, or other rows", () => {
    const code = stripComments(SCOPE_ACTIONS_SRC);
    expect(code).not.toMatch(/\.from\("tracked_prompts"\)/);
    expect(code).not.toMatch(/\.from\("tracked_entities"\)/);
    expect(code).not.toMatch(/\.from\("prompt_answer_observations"\)/);
    expect(code).not.toMatch(/\.from\("recommended_edits"\)/);
    expect(code).not.toMatch(/\.from\("daily_metric_snapshots"\)/);
    const tableMatches = [...code.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    const allowed = new Set(["tenants"]);
    for (const t of tableMatches) {
      expect(allowed.has(t)).toBe(true);
    }
  });

  it("does NOT call paid APIs", () => {
    expect(SCOPE_ACTIONS_SRC).not.toContain("openai");
    expect(SCOPE_ACTIONS_SRC).not.toContain("perplexity");
    expect(SCOPE_ACTIONS_SRC).not.toContain("runNativePoll");
    expect(SCOPE_ACTIONS_SRC).not.toContain("runWebsiteScan");
    expect(SCOPE_ACTIONS_SRC).not.toContain("acceptAllHighConfidence");
    expect(SCOPE_ACTIONS_SRC).not.toContain("syncRecommendedEdits");
  });

  it("redirects to /onboard/competitors on success", () => {
    expect(SCOPE_ACTIONS_SRC).toMatch(/redirect\("\/onboard\/competitors"\)/);
  });

  it("returns structured error on validation failure (no redirect)", () => {
    expect(SCOPE_ACTIONS_SRC).toMatch(/error:\s*"validation_failed"/);
  });

  it("rejects when count === 0 (race with operator activation)", () => {
    expect(SCOPE_ACTIONS_SRC).toMatch(/already_launched/);
  });

  it("only writes cities_served + project_mix + updated_at (not other fields)", () => {
    // Pin the field-set: confirm we're not inadvertently writing tos/role/budget/etc.
    const code = stripComments(SCOPE_ACTIONS_SRC);
    const updateBlock = code.match(/\.update\(\s*\{([\s\S]*?)\}/);
    expect(updateBlock).toBeTruthy();
    if (!updateBlock) return;
    const body = updateBlock[1];
    // Allowed keys only.
    const keyMatches = [...body.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
    expect(keyMatches.sort()).toEqual([
      "cities_served",
      "project_mix",
      "updated_at",
    ]);
  });
});

describe("Gap C.2 — /onboard/competitors route exists (form contract owned by Gap C.3)", () => {
  // Gap C.2 introduced /onboard/competitors as a placeholder. Gap C.3
  // then replaced the placeholder with a real form. The form contract
  // (inputs, action, redirects) is owned by
  // tests/architecture/onboard-competitors-step-contract.test.ts.
  // Here we keep just the route-level invariants Gap C.2 established.

  it("page exists at src/app/(shell)/onboard/competitors/page.tsx", () => {
    expect(existsSync(COMPETITORS_PAGE)).toBe(true);
  });

  it("is force-dynamic + uses access guard with same status gate", () => {
    expect(COMPETITORS_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(COMPETITORS_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("is step={3} of 4 in OnboardingShell", () => {
    expect(COMPETITORS_SRC).toMatch(/<OnboardingShell[\s\S]*?step=\{3\}/);
  });

  it("page itself does NOT mutate persisted rows or call paid APIs (writes go through the action)", () => {
    expect(COMPETITORS_SRC).not.toContain("openai");
    expect(COMPETITORS_SRC).not.toContain("perplexity");
    expect(COMPETITORS_SRC).not.toContain("runNativePoll");
    expect(COMPETITORS_SRC).not.toContain("runWebsiteScan");
    expect(COMPETITORS_SRC).not.toMatch(/\.upsert\(/);
    expect(COMPETITORS_SRC).not.toMatch(/\.insert\(/);
    expect(COMPETITORS_SRC).not.toMatch(/\.update\(/);
    expect(COMPETITORS_SRC).not.toMatch(/\.delete\(/);
  });

  it("does NOT expose tenant/admin/RLS/schema language to the visitor", () => {
    const code = stripComments(COMPETITORS_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });
});

describe("Gap C.2 — scope-validation exports", () => {
  it("exports normalizeCityList + validateScopeProfile + PROJECT_MIX_TAGS + PROJECT_MIX_LABELS + isProjectMixTag", () => {
    expect(VALIDATION_SRC).toMatch(/export function normalizeCityList/);
    expect(VALIDATION_SRC).toMatch(/export function validateScopeProfile/);
    expect(VALIDATION_SRC).toMatch(/export function isProjectMixTag/);
    expect(VALIDATION_SRC).toMatch(/export const PROJECT_MIX_TAGS/);
    expect(VALIDATION_SRC).toMatch(/export const PROJECT_MIX_LABELS/);
  });

  it("PROJECT_MIX_TAGS satisfies ReadonlyArray<ProjectMixTag> (build-time pin)", () => {
    expect(VALIDATION_SRC).toMatch(/satisfies\s+ReadonlyArray<ProjectMixTag>/);
  });
});

describe("Gap C.2 — pending tenants remain excluded from cron", () => {
  it("nothing in /onboard/scope or /onboard/competitors flips status to 'active'", () => {
    const all = [SCOPE_PAGE_SRC, SCOPE_FORM_SRC, SCOPE_ACTIONS_SRC, COMPETITORS_SRC]
      .map(stripComments)
      .join("\n");
    expect(all).not.toMatch(/status:\s*"active"/);
  });

  it("nothing in scope step creates prompts or tracked_entities", () => {
    const all = [SCOPE_PAGE_SRC, SCOPE_FORM_SRC, SCOPE_ACTIONS_SRC, COMPETITORS_SRC]
      .join("\n");
    expect(all).not.toMatch(/\.from\("tracked_prompts"\)/);
    expect(all).not.toMatch(/\.from\("tracked_entities"\)/);
    expect(all).not.toMatch(/insertTrackedPrompt/);
    expect(all).not.toMatch(/createPromptCluster/);
  });
});
