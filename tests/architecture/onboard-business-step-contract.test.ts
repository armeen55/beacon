/**
 * Architecture invariants — Gap C.1 (2026-05-07).
 *
 * Pins the /onboard/business + /onboard/scope wizard scaffold. The
 * pure validation logic has its own behavioral tests in
 * `src/domains/onboarding/profile-validation.test.ts`; this file
 * locks the *route + action contract* so a future regression that
 * accidentally activates a tenant, calls a paid API, or drops the
 * status guard will fail the build.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const BUSINESS_PAGE = join(REPO_ROOT, "src/app/(shell)/onboard/business/page.tsx");
const BUSINESS_FORM = join(REPO_ROOT, "src/app/(shell)/onboard/business/business-form.tsx");
const BUSINESS_ACTIONS = join(REPO_ROOT, "src/app/(shell)/onboard/business/actions.ts");
const SCOPE_PAGE = join(REPO_ROOT, "src/app/(shell)/onboard/scope/page.tsx");
const ONBOARD_SHELL = join(REPO_ROOT, "src/components/onboard/onboarding-shell.tsx");
const ACCESS_GUARD = join(REPO_ROOT, "src/domains/onboarding/access.ts");
const VALIDATION = join(REPO_ROOT, "src/domains/onboarding/profile-validation.ts");
const LISTER = join(REPO_ROOT, "scripts/list-active-tenants.ts");

const BUSINESS_PAGE_SRC = readFileSync(BUSINESS_PAGE, "utf8");
const BUSINESS_FORM_SRC = readFileSync(BUSINESS_FORM, "utf8");
const BUSINESS_ACTIONS_SRC = readFileSync(BUSINESS_ACTIONS, "utf8");
const SCOPE_PAGE_SRC = readFileSync(SCOPE_PAGE, "utf8");
const ONBOARD_SHELL_SRC = readFileSync(ONBOARD_SHELL, "utf8");
const ACCESS_GUARD_SRC = readFileSync(ACCESS_GUARD, "utf8");
const VALIDATION_SRC = readFileSync(VALIDATION, "utf8");

/**
 * Strip block + line + JSX comments before searching for forbidden tokens.
 * Also strips code-level references to the `tenant` variable bound by
 * `requireOnboardingTenant()` — those appear in destructuring + JSX
 * expression interpolations and are not visitor-rendered text.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // const { tenant, ... } = await requireOnboardingTenant();
    .replace(/\bconst\s*\{[^}]*?\btenant\b[^}]*\}\s*=[^;]+;/g, "")
    // {tenant.x}, tenant.x — member access used in JSX expressions or props
    .replace(/\btenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "");
}

describe("Gap C.1 — /onboard/business step exists with form", () => {
  it("page file + form + action all exist at expected paths", () => {
    expect(existsSync(BUSINESS_PAGE)).toBe(true);
    expect(existsSync(BUSINESS_FORM)).toBe(true);
    expect(existsSync(BUSINESS_ACTIONS)).toBe(true);
  });

  it("page is force-dynamic (auth read at request time)", () => {
    expect(BUSINESS_PAGE_SRC).toContain('export const dynamic = "force-dynamic"');
  });

  it("page imports the access guard and calls it (route gating)", () => {
    expect(BUSINESS_PAGE_SRC).toMatch(
      /import \{ requireOnboardingTenant \} from "@\/domains\/onboarding\/access"/,
    );
    expect(BUSINESS_PAGE_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("page renders the BusinessForm client component", () => {
    expect(BUSINESS_PAGE_SRC).toMatch(/<BusinessForm[\s\S]*?\/>/);
  });

  it("page uses the OnboardingShell with step={1}", () => {
    expect(BUSINESS_PAGE_SRC).toMatch(/<OnboardingShell[\s\S]*?step=\{1\}/);
  });

  it("form does NOT collect payment info / passwords / Stripe", () => {
    expect(BUSINESS_FORM_SRC).not.toContain('type="password"');
    expect(BUSINESS_FORM_SRC).not.toMatch(/credit\s*card/i);
    expect(BUSINESS_FORM_SRC).not.toMatch(/stripe/i);
    expect(BUSINESS_FORM_SRC).not.toMatch(/\bcvv\b/i);
  });

  it("form collects exactly business name + website (no other inputs)", () => {
    // Inputs must include businessName and domain.
    expect(BUSINESS_FORM_SRC).toMatch(/id="businessName"/);
    expect(BUSINESS_FORM_SRC).toMatch(/id="domain"/);
    // Whitelist the input ids — anything else is suspicious for step 1.
    const inputIdMatches = [...BUSINESS_FORM_SRC.matchAll(/<input[^>]*\bid="([^"]+)"/g)];
    const ids = inputIdMatches.map((m) => m[1]).sort();
    expect(ids).toEqual(["businessName", "domain"]);
  });

  it("form does NOT expose tenant/admin/RLS/schema language to the visitor", () => {
    const code = stripComments(BUSINESS_FORM_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });

  it("page does NOT expose tenant/admin/RLS/schema language to the visitor", () => {
    const code = stripComments(BUSINESS_PAGE_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });
});

describe("Gap C.1 — saveBusinessProfile server action contract", () => {
  it('marked as "use server"', () => {
    expect(BUSINESS_ACTIONS_SRC).toMatch(/^"use server"/m);
  });

  it("validates input via validateBusinessProfile (pure)", () => {
    expect(BUSINESS_ACTIONS_SRC).toMatch(
      /import \{[\s\S]*?validateBusinessProfile[\s\S]*?\} from "@\/domains\/onboarding\/profile-validation"/,
    );
    expect(BUSINESS_ACTIONS_SRC).toMatch(/validateBusinessProfile\(input\)/);
  });

  it("uses the service-role admin client for the update", () => {
    expect(BUSINESS_ACTIONS_SRC).toMatch(/getSupabaseAdmin/);
  });

  it("UPDATE is gated by status='pending_onboarding' (no active-tenant mutation)", () => {
    const code = stripComments(BUSINESS_ACTIONS_SRC);
    // The .update() call must be followed (within a small window) by
    // both .eq("id", ...) AND .eq("status", "pending_onboarding").
    expect(code).toMatch(/\.update\([\s\S]{0,400}\.eq\("id",[\s\S]{0,200}\.eq\("status",\s*"pending_onboarding"\)/);
  });

  it("does NOT flip status to 'active' anywhere in the action", () => {
    const code = stripComments(BUSINESS_ACTIONS_SRC);
    // Allow the literal "active" only in a status-check / error
    // string. It must NEVER appear inside an .update({...}) payload.
    expect(code).not.toMatch(/\.update\(\s*\{[^}]*status:\s*"active"/);
    expect(code).not.toMatch(/status:\s*"active"\s*as\s*const/);
  });

  it("does NOT create prompts, tracked_entities, or other rows", () => {
    const code = stripComments(BUSINESS_ACTIONS_SRC);
    expect(code).not.toMatch(/\.from\("tracked_prompts"\)/);
    expect(code).not.toMatch(/\.from\("tracked_entities"\)/);
    expect(code).not.toMatch(/\.from\("prompt_answer_observations"\)/);
    expect(code).not.toMatch(/\.from\("recommended_edits"\)/);
    expect(code).not.toMatch(/\.from\("daily_metric_snapshots"\)/);
    // Only allowed table reads/writes in this action: tenants + tenant_members (via lookupExistingMembership).
    const tableMatches = [...code.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    const allowed = new Set(["tenants"]);
    for (const t of tableMatches) {
      expect(allowed.has(t)).toBe(true);
    }
  });

  it("does NOT call paid APIs (openai / perplexity / runNativePoll / runWebsiteScan)", () => {
    expect(BUSINESS_ACTIONS_SRC).not.toContain("openai");
    expect(BUSINESS_ACTIONS_SRC).not.toContain("perplexity");
    expect(BUSINESS_ACTIONS_SRC).not.toContain("runNativePoll");
    expect(BUSINESS_ACTIONS_SRC).not.toContain("runWebsiteScan");
    expect(BUSINESS_ACTIONS_SRC).not.toContain("acceptAllHighConfidence");
    expect(BUSINESS_ACTIONS_SRC).not.toContain("syncRecommendedEdits");
  });

  it("redirects to /onboard/scope on success", () => {
    expect(BUSINESS_ACTIONS_SRC).toMatch(/redirect\("\/onboard\/scope"\)/);
  });

  it("returns structured error on validation failure (does NOT redirect)", () => {
    expect(BUSINESS_ACTIONS_SRC).toMatch(/error:\s*"validation_failed"/);
  });

  it("rejects the action when count === 0 (race with operator activation)", () => {
    expect(BUSINESS_ACTIONS_SRC).toMatch(/already_launched/);
  });
});

describe("Gap C.1 — /onboard/scope route exists (form contract owned by Gap C.2)", () => {
  // Gap C.1 introduced /onboard/scope as a placeholder. Gap C.2 then
  // replaced the placeholder with a real form. The form contract
  // (inputs, action, redirects) is owned by
  // tests/architecture/onboard-scope-step-contract.test.ts. Here we
  // keep just the route-level invariants Gap C.1 established.

  it("page exists at src/app/(shell)/onboard/scope/page.tsx", () => {
    expect(existsSync(SCOPE_PAGE)).toBe(true);
  });

  it("is force-dynamic + uses access guard with same status gate", () => {
    expect(SCOPE_PAGE_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(SCOPE_PAGE_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("is step 2 of 4 in the OnboardingShell", () => {
    expect(SCOPE_PAGE_SRC).toMatch(/<OnboardingShell[\s\S]*?step=\{2\}/);
  });

  it("page itself does NOT mutate persisted rows or call paid APIs (writes go through the action)", () => {
    expect(SCOPE_PAGE_SRC).not.toContain("openai");
    expect(SCOPE_PAGE_SRC).not.toContain("perplexity");
    expect(SCOPE_PAGE_SRC).not.toContain("runNativePoll");
    expect(SCOPE_PAGE_SRC).not.toContain("runWebsiteScan");
    expect(SCOPE_PAGE_SRC).not.toMatch(/\.upsert\(/);
    expect(SCOPE_PAGE_SRC).not.toMatch(/\.insert\(/);
    expect(SCOPE_PAGE_SRC).not.toMatch(/\.update\(/);
    expect(SCOPE_PAGE_SRC).not.toMatch(/\.delete\(/);
  });

  it("does NOT expose tenant/admin/RLS/schema language to the visitor", () => {
    const code = stripComments(SCOPE_PAGE_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });
});

describe("Gap C.1 — requireOnboardingTenant access guard", () => {
  it("file exists, server-only", () => {
    expect(existsSync(ACCESS_GUARD)).toBe(true);
    expect(ACCESS_GUARD_SRC).toMatch(/^import "server-only"/m);
  });

  it("redirects unauthenticated users to /login", () => {
    expect(ACCESS_GUARD_SRC).toMatch(/redirect\("\/login\?next=\/onboard\/business"\)/);
  });

  it("redirects users without a tenant_members row to /signup", () => {
    expect(ACCESS_GUARD_SRC).toMatch(/redirect\("\/signup\?error=no_tenant"\)/);
  });

  it("redirects active tenants to / (already launched)", () => {
    // Status === "active" → redirect to /
    expect(ACCESS_GUARD_SRC).toMatch(
      /tenant\.status\s*===\s*"active"[\s\S]{0,80}redirect\("\/"\)/,
    );
  });

  it("only allows status='pending_onboarding' to fall through", () => {
    expect(ACCESS_GUARD_SRC).toMatch(/pending_onboarding/);
  });

  it("does NOT mutate the tenant (read-only guard)", () => {
    expect(ACCESS_GUARD_SRC).not.toMatch(/\.upsert\(/);
    expect(ACCESS_GUARD_SRC).not.toMatch(/\.insert\(/);
    expect(ACCESS_GUARD_SRC).not.toMatch(/\.update\(/);
    expect(ACCESS_GUARD_SRC).not.toMatch(/\.delete\(/);
  });
});

describe("Gap C.1 — OnboardingShell + validation exports", () => {
  it("OnboardingShell file exists", () => {
    expect(existsSync(ONBOARD_SHELL)).toBe(true);
  });

  it("OnboardingShell renders a Step N of 4 indicator", () => {
    expect(ONBOARD_SHELL_SRC).toMatch(/Step \$\{current\} of \$\{ONBOARDING_TOTAL_STEPS\}/);
    expect(ONBOARD_SHELL_SRC).toMatch(/ONBOARDING_TOTAL_STEPS\s*=\s*4/);
  });

  it("profile-validation exports normalizeDomain + validateBusinessProfile", () => {
    expect(VALIDATION_SRC).toMatch(/export function normalizeDomain/);
    expect(VALIDATION_SRC).toMatch(/export function validateBusinessProfile/);
  });
});

describe("Gap C.1 — pending tenants remain excluded from cron", () => {
  it("scripts/list-active-tenants.ts still filters status='active'", () => {
    const lister = readFileSync(LISTER, "utf8");
    expect(lister).toMatch(/\.eq\(\s*"status"\s*,\s*"active"\s*\)/);
  });

  it("nothing in /onboard/* code flips a tenant to status='active'", () => {
    const allOnboardSrc = [
      BUSINESS_PAGE_SRC,
      BUSINESS_FORM_SRC,
      BUSINESS_ACTIONS_SRC,
      SCOPE_PAGE_SRC,
      ACCESS_GUARD_SRC,
      ONBOARD_SHELL_SRC,
    ]
      .map(stripComments)
      .join("\n");
    expect(allOnboardSrc).not.toMatch(/status:\s*"active"/);
  });
});
