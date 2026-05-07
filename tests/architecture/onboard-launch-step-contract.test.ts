/**
 * Architecture invariants — Gap C.4 (2026-05-07).
 *
 * Pins the launchTenant action + LaunchForm + /onboard/review Launch
 * surface. The behavioral contract (transaction semantics, dedup,
 * rollback) is owned by `launch-flow.test.ts`; this file pins the
 * source-level invariants — no paid APIs, customer-safe copy, no
 * activation outside this single code path, etc.
 *
 * Treat this as the highest-priority guard rail in the onboarding
 * stack: regressions here can leak prompts cross-tenant, leak
 * tenant/cron language to customers, or accidentally trigger paid
 * polling at Launch time.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const REVIEW_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/review/page.tsx",
);
const LAUNCH_FORM = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/review/launch-form.tsx",
);
const LAUNCH_ACTIONS = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/review/actions.ts",
);
const LAUNCH_FLOW = join(
  REPO_ROOT,
  "src/app/(shell)/onboard/review/launch-flow.ts",
);
const LISTER = join(REPO_ROOT, "scripts/list-active-tenants.ts");

const REVIEW_SRC = readFileSync(REVIEW_PAGE, "utf8");
const LAUNCH_FORM_SRC = readFileSync(LAUNCH_FORM, "utf8");
const LAUNCH_ACTIONS_SRC = readFileSync(LAUNCH_ACTIONS, "utf8");
const LAUNCH_FLOW_SRC = readFileSync(LAUNCH_FLOW, "utf8");

/**
 * Combined source of the action wrapper + the transaction helper.
 * Most invariants apply to either file — pin the behavior at the
 * combined level so refactors that move code between the two
 * modules don't break the test.
 */
const LAUNCH_COMBINED_SRC = LAUNCH_ACTIONS_SRC + "\n" + LAUNCH_FLOW_SRC;

/**
 * Strip block + line + JSX comments + import statements +
 * identifier-style references (Supabase / Tenant) + tenant variable
 * destructuring. Same helper as the C.3/E.1 cross-page sweep.
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

describe("Gap C.4 — files exist", () => {
  it("review page + launch form + actions + flow helper all exist", () => {
    expect(existsSync(REVIEW_PAGE)).toBe(true);
    expect(existsSync(LAUNCH_FORM)).toBe(true);
    expect(existsSync(LAUNCH_ACTIONS)).toBe(true);
    expect(existsSync(LAUNCH_FLOW)).toBe(true);
  });
});

describe("Gap C.4 — /onboard/review renders LaunchForm + preview", () => {
  it("page is force-dynamic + uses access guard", () => {
    expect(REVIEW_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(REVIEW_SRC).toMatch(/await requireOnboardingTenant\(\)/);
  });

  it("page renders the preview list AND the LaunchForm", () => {
    expect(REVIEW_SRC).toMatch(/generateStarterPrompts\(/);
    expect(REVIEW_SRC).toMatch(/<LaunchForm/);
  });

  it("page itself does NOT mutate (writes go through the action)", () => {
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

  it("uses the customer-safe Launch copy", () => {
    // Required brief copy: "Launch Beacon" + the daily-reading line.
    // The daily-reading line lives on the page subtitle; the button
    // label lives on the form. Pin both surfaces.
    expect(LAUNCH_FORM_SRC).toMatch(/Launch Beacon/);
    expect(REVIEW_SRC).toMatch(
      /Beacon will start tracking these prompts on the next daily reading/,
    );
  });
});

describe("Gap C.4 — LaunchForm UX contract", () => {
  it("Launch button is disabled until TOS checkbox is checked", () => {
    // Pin the disabled-when-not-tosAccepted guard.
    expect(LAUNCH_FORM_SRC).toMatch(/canLaunch\s*=\s*[\s\S]{0,80}tosAccepted/);
    expect(LAUNCH_FORM_SRC).toMatch(/disabled=\{\s*!canLaunch[\s\S]{0,40}\}/);
  });

  it("contains a TOS checkbox input", () => {
    expect(LAUNCH_FORM_SRC).toMatch(/type="checkbox"/);
    expect(LAUNCH_FORM_SRC).toMatch(/tosAccepted/);
  });

  it("submit calls launchTenant server action", () => {
    expect(LAUNCH_FORM_SRC).toMatch(
      /import\s+\{\s*launchTenant\s*\}\s+from\s+["']\.\/actions["']/,
    );
    expect(LAUNCH_FORM_SRC).toMatch(/launchTenant\(\s*\{\s*tosAccepted/);
  });

  it("does NOT submit prompts from the client (server regenerates)", () => {
    // The form must not pass any prompt list to launchTenant — the
    // server action regenerates server-side from the saved tenant
    // row. Pin that the action is called with ONLY { tosAccepted }.
    const callMatch = LAUNCH_FORM_SRC.match(
      /launchTenant\(\s*\{[\s\S]*?\}\s*\)/,
    );
    expect(callMatch).toBeTruthy();
    if (callMatch) {
      const body = callMatch[0];
      // The only key allowed is tosAccepted.
      expect(body).toMatch(/tosAccepted/);
      expect(body).not.toMatch(/prompts:/);
      expect(body).not.toMatch(/drafts:/);
    }
  });

  it("does NOT collect payment / passwords / Stripe / CVV", () => {
    expect(LAUNCH_FORM_SRC).not.toContain('type="password"');
    expect(LAUNCH_FORM_SRC).not.toMatch(/credit\s*card/i);
    expect(LAUNCH_FORM_SRC).not.toMatch(/stripe/i);
    expect(LAUNCH_FORM_SRC).not.toMatch(/\bcvv\b/i);
  });

  it("does NOT expose tenant/admin/RLS/schema/Supabase/cron/GitHub language", () => {
    const code = stripComments(LAUNCH_FORM_SRC);
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
    expect(code).not.toMatch(/\bSupabase\b/i);
    expect(code).not.toMatch(/\bcron\b/i);
    expect(code).not.toMatch(/\bGitHub\b/i);
  });
});

describe("Gap C.4 — launchTenant server action contract", () => {
  it('marked as "use server"', () => {
    expect(LAUNCH_ACTIONS_SRC).toMatch(/^"use server"/m);
  });

  it("re-generates prompts SERVER-SIDE from saved tenant fields (does not trust client)", () => {
    // Action calls generateStarterPrompts internally with tenant.* inputs.
    expect(LAUNCH_FLOW_SRC).toMatch(
      /import \{[\s\S]*?generateStarterPrompts[\s\S]*?\} from "@\/domains\/onboarding\/prompt-generator"/,
    );
    expect(LAUNCH_FLOW_SRC).toMatch(/generateStarterPrompts\(\s*\{/);
  });

  it("returns no_prompts_generated when the generator output is empty", () => {
    expect(LAUNCH_FLOW_SRC).toMatch(/no_prompts_generated/);
  });

  it("UPDATE has the double-click guard (status='pending_onboarding' AND tos_accepted_at IS NULL)", () => {
    const code = stripComments(LAUNCH_FLOW_SRC);
    // The .update() chain must include both .eq("status", "pending_onboarding")
    // AND .is("tos_accepted_at", null). They appear within the same chain.
    expect(code).toMatch(
      /\.update\([\s\S]{0,500}\.eq\("status",\s*"pending_onboarding"\)[\s\S]{0,200}\.is\("tos_accepted_at",\s*null\)/,
    );
  });

  it("UPDATE flips status to 'active' AND sets tos_accepted_at + updated_at", () => {
    const code = stripComments(LAUNCH_FLOW_SRC);
    expect(code).toMatch(/\.update\(\s*\{[\s\S]{0,400}status:\s*"active"/);
    expect(code).toMatch(/\.update\(\s*\{[\s\S]{0,400}tos_accepted_at:/);
    expect(code).toMatch(/\.update\(\s*\{[\s\S]{0,400}updated_at:/);
  });

  it("the activating UPDATE is the ONLY place status:'active' appears in launch sources", () => {
    // No accidental other code path that flips status. Pin the
    // single occurrence across both action wrapper + flow helper.
    const code = stripComments(LAUNCH_COMBINED_SRC);
    const matches = code.match(/status:\s*"active"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("INSERT runs BEFORE UPDATE (order pinned in source)", () => {
    const code = stripComments(LAUNCH_FLOW_SRC);
    const insertIdx = code.search(
      /\.from\("tracked_prompts"\)[\s\S]{0,200}\.insert\(/,
    );
    const updateIdx = code.search(
      /\.from\("tenants"\)[\s\S]{0,200}\.update\(/,
    );
    expect(insertIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeLessThan(updateIdx);
  });

  it("rollback DELETE filters by both id IN (...) AND account_id (defense in depth)", () => {
    const code = stripComments(LAUNCH_FLOW_SRC);
    expect(code).toMatch(
      /\.delete\(\)[\s\S]{0,200}\.in\("id",[\s\S]{0,200}\.eq\("account_id",/,
    );
  });

  it("inserted prompts have account_id sourced from tenant.slug (not from input)", () => {
    // Pin that the row's account_id comes from the resolved tenant.slug,
    // never from a request parameter. Use the RAW source — stripComments
    // would strip `tenant.slug` member access we want to find.
    expect(LAUNCH_FLOW_SRC).toMatch(
      /account_id:\s*tenant\.slug|accountId:\s*tenant\.slug/,
    );
  });

  it("inserted prompts have is_active=true (cron-visible after status flip)", () => {
    const code = stripComments(LAUNCH_FLOW_SRC);
    expect(code).toMatch(/is_active:\s*true/);
  });

  it("does NOT call paid APIs", () => {
    // Note: "perplexity" / "chatgpt" appear as platform identifiers in
    // PROMPT_PLATFORMS_DEFAULT (legitimate string values that label
    // the prompt's destination). The forbidden things are imports
    // from paid-API adapter modules + calls to the paid runners.
    const code = stripComments(LAUNCH_COMBINED_SRC);
    expect(code).not.toMatch(/from\s+["']@\/adapters\/openai/);
    expect(code).not.toMatch(/from\s+["']@\/adapters\/perplexity/);
    expect(code).not.toMatch(/from\s+["']openai["']/);
    expect(code).not.toMatch(/from\s+["']@anthropic/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toContain("runNativePoll");
    expect(code).not.toContain("runWebsiteScan");
    expect(code).not.toContain("acceptAllHighConfidence");
    expect(code).not.toContain("syncRecommendedEdits");
  });

  it("does NOT trigger an immediate poll (Gap F's job)", () => {
    const code = stripComments(LAUNCH_COMBINED_SRC);
    expect(code).not.toContain("runNativePoll");
    expect(code).not.toContain("triggerPoll");
    expect(code).not.toContain("/api/poll/run");
  });

  it("redirects to /today on success (and on race-lost / already-launched)", () => {
    // The action wrapper calls `redirect(outcome.to)` where outcome.to
    // is constrained to "/today" by the LaunchTransactionOutcome type.
    expect(LAUNCH_ACTIONS_SRC).toMatch(/redirect\(outcome\.to\)/);
    // The flow helper only ever returns `to: "/today"` literals.
    const flowToMatches = LAUNCH_FLOW_SRC.match(/to:\s*"([^"]+)"/g) ?? [];
    for (const m of flowToMatches) {
      expect(m).toBe('to: "/today"');
    }
  });

  it("only writes to tenants and tracked_prompts tables (no other side effects)", () => {
    const code = stripComments(LAUNCH_COMBINED_SRC);
    const tableMatches = [...code.matchAll(/\.from\("([^"]+)"\)/g)].map(
      (m) => m[1],
    );
    const allowed = new Set(["tenants", "tracked_prompts", "tenant_members"]);
    // tenant_members allowed only via lookupExistingMembership (read).
    for (const t of tableMatches) {
      expect(allowed.has(t)).toBe(true);
    }
  });

  it("does NOT touch any other table (no observations / changelog / recs)", () => {
    expect(LAUNCH_COMBINED_SRC).not.toMatch(/\.from\("prompt_answer_observations"\)/);
    expect(LAUNCH_COMBINED_SRC).not.toMatch(/\.from\("recommended_edits"\)/);
    expect(LAUNCH_COMBINED_SRC).not.toMatch(/\.from\("changelog_entries"\)/);
    expect(LAUNCH_COMBINED_SRC).not.toMatch(/\.from\("daily_metric_snapshots"\)/);
    expect(LAUNCH_COMBINED_SRC).not.toMatch(/\.from\("tracked_entities"\)/);
  });
});

describe("Gap C.4 — pending tenants remain excluded from cron until Launch", () => {
  it("scripts/list-active-tenants.ts still filters status='active' (Gap A guard intact)", () => {
    const lister = readFileSync(LISTER, "utf8");
    expect(lister).toMatch(/\.eq\(\s*"status"\s*,\s*"active"\s*\)/);
  });

  it("the only place status='active' is set in onboarding code is the launch action", () => {
    // Sweep onboarding action files: only review/actions.ts may set
    // status='active'. C.1/C.2/C.3 actions must never do so.
    const otherActions = [
      "src/app/(shell)/onboard/business/actions.ts",
      "src/app/(shell)/onboard/scope/actions.ts",
      "src/app/(shell)/onboard/competitors/actions.ts",
    ];
    for (const f of otherActions) {
      const src = readFileSync(join(REPO_ROOT, f), "utf8");
      const code = stripComments(src);
      expect(code).not.toMatch(/status:\s*"active"/);
    }
  });

  it("Ritz prompts cannot be touched: account_id scoping pinned everywhere", () => {
    // Every tracked_prompts INSERT/UPDATE/DELETE in the flow helper
    // includes an account_id filter or an account_id payload key.
    // Use RAW source for tenant.slug grep (stripComments would
    // erase member access).
    expect(LAUNCH_FLOW_SRC).toMatch(
      /account_id:\s*tenant\.slug|accountId:\s*tenant\.slug/,
    );
    // SELECT for dedup: filtered by account_id.
    expect(LAUNCH_FLOW_SRC).toMatch(
      /\.from\("tracked_prompts"\)[\s\S]{0,400}\.select\([\s\S]{0,200}\.eq\("account_id",/,
    );
    // DELETE for rollback: filtered by account_id.
    expect(LAUNCH_FLOW_SRC).toMatch(
      /\.delete\(\)[\s\S]{0,400}\.eq\("account_id",/,
    );
  });
});

describe("Gap C.4 — customer-safe-language sweep on all onboarding pages includes review", () => {
  it("/onboard/review renders no tenant/admin/RLS/schema/Supabase/cron/GitHub", () => {
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

describe("Gap C.4 — wrapper launchTenant resolves user from session (not from input)", () => {
  it("calls supabase.auth.getUser to resolve the current user", () => {
    expect(LAUNCH_ACTIONS_SRC).toMatch(/supabase\.auth\.getUser\(\)/);
  });

  it("looks up tenant via tenant_members (lookupExistingMembership)", () => {
    expect(LAUNCH_ACTIONS_SRC).toMatch(
      /import \{[\s\S]*?lookupExistingMembership[\s\S]*?\}/,
    );
    expect(LAUNCH_ACTIONS_SRC).toMatch(
      /lookupExistingMembership\(admin,\s*user\.id\)/,
    );
  });

  it("does NOT accept tenantId as an input parameter (defense in depth)", () => {
    // The exposed action signature must take only LaunchTenantInput =
    // { tosAccepted: boolean }. tenantId is resolved server-side.
    expect(LAUNCH_ACTIONS_SRC).toMatch(
      /export type LaunchTenantInput\s*=\s*\{\s*tosAccepted:\s*boolean;\s*\}/,
    );
  });
});
