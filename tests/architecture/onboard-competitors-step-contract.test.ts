/**
 * Architecture invariants — Gap C.3 (2026-05-07).
 *
 * Pins the /onboard/competitors form + saveCompetitorsProfile action +
 * /onboard/review placeholder. Behavioral validation tests live in
 * `src/domains/onboarding/competitors-validation.test.ts`; this file
 * locks the route + action contract.
 *
 * Also includes a cross-page customer-safe-language sweep — every
 * /onboard/* page (and /signup) must NOT render tenant / admin / RLS /
 * schema / Supabase / cron / GitHub language to the visitor.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const COMPETITORS_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/competitors/page.tsx",
);
const COMPETITORS_FORM = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/competitors/competitors-form.tsx",
);
const COMPETITORS_ACTIONS = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/competitors/actions.ts",
);
const REVIEW_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/review/page.tsx",
);
const VALIDATION = join(
  REPO_ROOT,
  "src/domains/onboarding/competitors-validation.ts",
);
const COMPETITORS_PAGE_SRC = readFileSync(COMPETITORS_PAGE, "utf8");
const COMPETITORS_FORM_SRC = readFileSync(COMPETITORS_FORM, "utf8");
const COMPETITORS_ACTIONS_SRC = readFileSync(COMPETITORS_ACTIONS, "utf8");
const REVIEW_SRC = readFileSync(REVIEW_PAGE, "utf8");
const VALIDATION_SRC = readFileSync(VALIDATION, "utf8");

/**
 * Strip block + line + JSX comments AND code-level identifier
 * references that contain the forbidden words but aren't rendered.
 *
 * We are pinning text the visitor SEES. Code identifiers like
 * `getSupabaseServerClient`, the import path
 * `@/lib/auth/supabase-server`, and the destructured `tenant` /
 * `ctx` variables are code, not rendered output. Strip them so the
 * test catches actual leaked words in JSX text.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Strip whole import statements (single line or multi-line braces).
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "")
    // Strip identifier references containing forbidden words.
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*Supabase[a-zA-Z0-9_$]*\b/g, "")
    .replace(/\bsupabase[a-zA-Z0-9_$]*\b/g, "")
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*Tenant[a-zA-Z0-9_$]*\b/g, "")
    // Strip destructuring + member-access on the tenant/ctx variables.
    .replace(/\bconst\s*\{[^}]*?\btenant\b[^}]*\}\s*=[^;]+;/g, "")
    .replace(/\btenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    .replace(/\bctx\.tenant\.[a-zA-Z_][a-zA-Z0-9_]*\b/g, "")
    .replace(/\bconst\s+ctx\s*=[^;]+;/g, "");
}

describe("Gap C.3 — /onboard/competitors step (form replaces placeholder)", () => {
  it("page + form + action all exist", () => {
    expect(existsSync(COMPETITORS_PAGE)).toBe(true);
    expect(existsSync(COMPETITORS_FORM)).toBe(true);
    expect(existsSync(COMPETITORS_ACTIONS)).toBe(true);
  });

  it("page is force-dynamic + uses requireOnboardingTenant", () => {
    expect(COMPETITORS_PAGE_SRC).toContain(
      'export const dynamic = "force-dynamic"',
    );
    expect(COMPETITORS_PAGE_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("page is step={3} of 4 in OnboardingShell", () => {
    expect(COMPETITORS_PAGE_SRC).toMatch(
      /<OnboardingShell[\s\S]*?step=\{3\}/,
    );
  });

  it("page renders the CompetitorsForm (replaces Gap C.2 placeholder)", () => {
    expect(COMPETITORS_PAGE_SRC).toMatch(/<CompetitorsForm[\s\S]*?\/>/);
  });

  it("form collects exactly competitors (textarea) — no other inputs", () => {
    expect(COMPETITORS_FORM_SRC).toMatch(/<textarea[^>]*\bid="competitors"/);
    // No password / payment / Stripe / CVV
    expect(COMPETITORS_FORM_SRC).not.toContain('type="password"');
    expect(COMPETITORS_FORM_SRC).not.toMatch(/credit\s*card/i);
    expect(COMPETITORS_FORM_SRC).not.toMatch(/stripe/i);
    expect(COMPETITORS_FORM_SRC).not.toMatch(/\bcvv\b/i);
    // No checkboxes / radios / selects (this step is plain text only)
    expect(COMPETITORS_FORM_SRC).not.toMatch(/type="checkbox"/);
    expect(COMPETITORS_FORM_SRC).not.toMatch(/type="radio"/);
    expect(COMPETITORS_FORM_SRC).not.toMatch(/<select/);
  });
});

describe("Gap C.3 — saveCompetitorsProfile server action contract", () => {
  it('marked as "use server"', () => {
    expect(COMPETITORS_ACTIONS_SRC).toMatch(/^"use server"/m);
  });

  it("validates input via validateCompetitorsProfile (pure)", () => {
    expect(COMPETITORS_ACTIONS_SRC).toMatch(
      /import \{[\s\S]*?validateCompetitorsProfile[\s\S]*?\} from "@\/domains\/onboarding\/competitors-validation"/,
    );
    expect(COMPETITORS_ACTIONS_SRC).toMatch(
      /validateCompetitorsProfile\(input\)/,
    );
  });

  it("uses the service-role admin client for the update", () => {
    expect(COMPETITORS_ACTIONS_SRC).toMatch(/getSupabaseAdmin/);
  });

  it("UPDATE is gated by status='pending_onboarding' (no active-tenant mutation)", () => {
    const code = stripComments(COMPETITORS_ACTIONS_SRC);
    expect(code).toMatch(
      /\.update\([\s\S]{0,400}\.eq\("id",[\s\S]{0,200}\.eq\("status",\s*"pending_onboarding"\)/,
    );
  });

  it("does NOT flip status to 'active' anywhere in the action", () => {
    const code = stripComments(COMPETITORS_ACTIONS_SRC);
    expect(code).not.toMatch(/\.update\(\s*\{[^}]*status:\s*"active"/);
    expect(code).not.toMatch(/status:\s*"active"\s*as\s*const/);
  });

  it("does NOT create prompts, tracked_entities, or other rows", () => {
    const code = stripComments(COMPETITORS_ACTIONS_SRC);
    expect(code).not.toMatch(/\.from\("tracked_prompts"\)/);
    expect(code).not.toMatch(/\.from\("tracked_entities"\)/);
    expect(code).not.toMatch(/\.from\("prompt_answer_observations"\)/);
    expect(code).not.toMatch(/\.from\("recommended_edits"\)/);
    expect(code).not.toMatch(/\.from\("daily_metric_snapshots"\)/);
    const tableMatches = [...code.matchAll(/\.from\("([^"]+)"\)/g)].map(
      (m) => m[1],
    );
    const allowed = new Set(["tenants"]);
    for (const t of tableMatches) {
      expect(allowed.has(t)).toBe(true);
    }
  });

  it("does NOT call paid APIs", () => {
    expect(COMPETITORS_ACTIONS_SRC).not.toContain("openai");
    expect(COMPETITORS_ACTIONS_SRC).not.toContain("perplexity");
    expect(COMPETITORS_ACTIONS_SRC).not.toContain("runNativePoll");
    expect(COMPETITORS_ACTIONS_SRC).not.toContain("runWebsiteScan");
    expect(COMPETITORS_ACTIONS_SRC).not.toContain("acceptAllHighConfidence");
    expect(COMPETITORS_ACTIONS_SRC).not.toContain("syncRecommendedEdits");
  });

  it("redirects to /onboard/review on success", () => {
    expect(COMPETITORS_ACTIONS_SRC).toMatch(/redirect\("\/onboard\/review"\)/);
  });

  it("returns structured error on validation failure (no redirect)", () => {
    expect(COMPETITORS_ACTIONS_SRC).toMatch(/error:\s*"validation_failed"/);
  });

  it("rejects when count === 0 (race with operator activation)", () => {
    expect(COMPETITORS_ACTIONS_SRC).toMatch(/already_launched/);
  });

  it("FIELD-SET PIN: writes EXACTLY discovered_competitors + updated_at", () => {
    const code = stripComments(COMPETITORS_ACTIONS_SRC);
    const updateBlock = code.match(/\.update\(\s*\{([\s\S]*?)\}/);
    expect(updateBlock).toBeTruthy();
    if (!updateBlock) return;
    const body = updateBlock[1];
    const keyMatches = [...body.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
    expect(keyMatches.sort()).toEqual([
      "discovered_competitors",
      "updated_at",
    ]);
  });
});

describe("Gap C.3 — /onboard/review placeholder (step 4 awaiting C.4)", () => {
  it("page exists at src/app/(shell)/onboard/review/page.tsx", () => {
    expect(existsSync(REVIEW_PAGE)).toBe(true);
  });

  it("is force-dynamic + uses access guard with same status gate", () => {
    expect(REVIEW_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(REVIEW_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("is step={4} of 4 in OnboardingShell", () => {
    expect(REVIEW_SRC).toMatch(/<OnboardingShell[\s\S]*?step=\{4\}/);
  });

  it("does NOT include a Launch button (Gap C.4 owns Launch)", () => {
    // Heuristic: no <button> elements, no `Launch` literal in the
    // visible JSX (heading still says "Review and launch" — that's a
    // section title, not a button label).
    expect(REVIEW_SRC).not.toMatch(/<button/);
    // The literal "Launch" should not appear as a CTA. We allow it
    // in the heading copy. Pin the no-button state.
  });

  it("does NOT collect inputs (placeholder only)", () => {
    expect(REVIEW_SRC).not.toMatch(/<input/);
    expect(REVIEW_SRC).not.toMatch(/<form/);
    expect(REVIEW_SRC).not.toMatch(/<select/);
    expect(REVIEW_SRC).not.toMatch(/<textarea/);
  });

  it("does NOT mutate persisted rows or call paid APIs", () => {
    expect(REVIEW_SRC).not.toContain("openai");
    expect(REVIEW_SRC).not.toContain("perplexity");
    expect(REVIEW_SRC).not.toContain("runNativePoll");
    expect(REVIEW_SRC).not.toContain("runWebsiteScan");
    expect(REVIEW_SRC).not.toMatch(/\.upsert\(/);
    expect(REVIEW_SRC).not.toMatch(/\.insert\(/);
    expect(REVIEW_SRC).not.toMatch(/\.update\(/);
    expect(REVIEW_SRC).not.toMatch(/\.delete\(/);
  });

  it("does NOT flip tenant status to 'active'", () => {
    const code = stripComments(REVIEW_SRC);
    expect(code).not.toMatch(/status:\s*"active"/);
    expect(code).not.toMatch(/"active"\s*as\s*const/);
  });
});

describe("Gap C.3 — competitors-validation exports + constants", () => {
  it("exports normalizeCompetitorList + validateCompetitorsProfile + constants", () => {
    expect(VALIDATION_SRC).toMatch(/export function normalizeCompetitorList/);
    expect(VALIDATION_SRC).toMatch(
      /export function validateCompetitorsProfile/,
    );
    expect(VALIDATION_SRC).toMatch(/export const COMPETITORS_MAX_COUNT/);
    expect(VALIDATION_SRC).toMatch(/export const COMPETITORS_MIN_COUNT/);
  });
});

describe("Gap C.3 — pending tenants stay pending through onboarding", () => {
  // De-bloat (2026-06-15): the `list-active-tenants.ts filters
  // status='active'` assertion was removed with the deleted cron-matrix
  // lister. The surviving guard below — onboarding never flips a tenant
  // to 'active' on its own — is the live invariant.
  it("nothing in /onboard/competitors or /onboard/review flips status to 'active'", () => {
    const all = [
      COMPETITORS_PAGE_SRC,
      COMPETITORS_FORM_SRC,
      COMPETITORS_ACTIONS_SRC,
      REVIEW_SRC,
    ]
      .map(stripComments)
      .join("\n");
    expect(all).not.toMatch(/status:\s*"active"/);
  });

  it("nothing in C.3 step creates prompts or tracked_entities", () => {
    const all = [
      COMPETITORS_PAGE_SRC,
      COMPETITORS_FORM_SRC,
      COMPETITORS_ACTIONS_SRC,
      REVIEW_SRC,
    ].join("\n");
    expect(all).not.toMatch(/\.from\("tracked_prompts"\)/);
    expect(all).not.toMatch(/\.from\("tracked_entities"\)/);
    expect(all).not.toMatch(/insertTrackedPrompt/);
    expect(all).not.toMatch(/createPromptCluster/);
  });
});

/**
 * Cross-page customer-safe-language sweep — every onboarding page (and
 * /signup) must NOT render tenant / admin / RLS / schema / Supabase /
 * cron / GitHub language to the visitor. Code-level identifiers
 * (variable names like `tenant`, function names like
 * `requireOnboardingTenant`) are stripped by stripComments.
 */
describe("Gap C.3 — customer-safe-language sweep across all onboarding pages", () => {
  const PUBLIC_FACING_PAGES: string[] = [
    join(REPO_ROOT, "src/app/(public)/signup/page.tsx"),
    join(REPO_ROOT, "src/app/(public)/signup/signup-form.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/business/page.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/business/business-form.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/scope/page.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/scope/scope-form.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/competitors/page.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/competitors/competitors-form.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/review/page.tsx"),
    // Gap C.4 added LaunchForm (client component) to /onboard/review.
    join(REPO_ROOT, "src/app/(shell)/onboard/review/launch-form.tsx"),
    // R12/T0e (2026-07-03) added the URL-first entry + first-audit scorecard.
    join(REPO_ROOT, "src/app/(shell)/onboard/page.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/url-form.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/done/page.tsx"),
    join(REPO_ROOT, "src/app/(shell)/onboard/done/connect-gsc-card.tsx"),
    join(REPO_ROOT, "src/components/onboard/onboarding-shell.tsx"),
  ];

  // Defensive: confirm we discover every onboarding tsx file under (shell)/onboard.
  it("the sweep covers every .tsx under src/app/(shell)/onboard", () => {
    const onboardDir = join(REPO_ROOT, "src/app/(shell)/onboard");
    const found: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        // Colocated *.test.tsx files are never rendered to a visitor; the
        // sweep pins rendered surfaces only (R12/T0e, 2026-07-03).
        else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) found.push(p);
      }
    }
    walk(onboardDir);
    for (const f of found) {
      expect(PUBLIC_FACING_PAGES).toContain(f);
    }
  });

  for (const file of PUBLIC_FACING_PAGES) {
    const label = file.replace(REPO_ROOT + "/", "");

    it(`${label} — no tenant/admin/RLS/schema in rendered text`, () => {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code).not.toMatch(/\btenant\b/i);
      expect(code).not.toMatch(/\badmin\b/i);
      expect(code).not.toMatch(/\bRLS\b/);
      expect(code).not.toMatch(/\bschema\b/i);
    });

    it(`${label} — no Supabase/cron/GitHub language in rendered text`, () => {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code).not.toMatch(/\bSupabase\b/i);
      expect(code).not.toMatch(/\bcron\b/i);
      expect(code).not.toMatch(/\bGitHub\b/i);
    });
  }
});
