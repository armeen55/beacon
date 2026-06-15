/**
 * Architecture invariants — Gap B (2026-05-07).
 *
 * Pins the public-signup + auth-callback-provisioning + /onboard
 * placeholder contract. Behavioral tests for the provisioner itself
 * live in `src/domains/onboarding/provision-tenant.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SIGNUP_PAGE = join(REPO_ROOT, "src/app/(public)/signup/page.tsx");
const SIGNUP_FORM = join(REPO_ROOT, "src/app/(public)/signup/signup-form.tsx");
const SIGNUP_ACTIONS = join(REPO_ROOT, "src/app/(public)/signup/actions.ts");
const CALLBACK_ROUTE = join(REPO_ROOT, "src/app/auth/callback/route.ts");
const ONBOARD_PAGE = join(REPO_ROOT, "src/app/(shell)/onboard/business/page.tsx");
const MIDDLEWARE = join(REPO_ROOT, "src/lib/auth/supabase-middleware.ts");
const PROVISIONER = join(REPO_ROOT, "src/domains/onboarding/provision-tenant.ts");

const SIGNUP_PAGE_SRC = readFileSync(SIGNUP_PAGE, "utf8");
const SIGNUP_FORM_SRC = readFileSync(SIGNUP_FORM, "utf8");
const SIGNUP_ACTIONS_SRC = readFileSync(SIGNUP_ACTIONS, "utf8");
const CALLBACK_SRC = readFileSync(CALLBACK_ROUTE, "utf8");
const ONBOARD_SRC = readFileSync(ONBOARD_PAGE, "utf8");
const MIDDLEWARE_SRC = readFileSync(MIDDLEWARE, "utf8");
const PROVISIONER_SRC = readFileSync(PROVISIONER, "utf8");

describe("Gap B — /signup public route exists with magic-link UX", () => {
  it("page file exists at src/app/(public)/signup/page.tsx", () => {
    expect(existsSync(SIGNUP_PAGE)).toBe(true);
  });

  it("page is dynamic (not prerendered — auth state read at request time)", () => {
    expect(SIGNUP_PAGE_SRC).toContain('export const dynamic = "force-dynamic"');
  });

  it("page renders 'Create your Beacon account' branding (customer-safe)", () => {
    expect(SIGNUP_PAGE_SRC).toContain("Create your Beacon account");
  });

  it("page does NOT expose tenant/admin language to the visitor", () => {
    // Strip JSX comments AND top-level block/line comments — intentional
    // documentation may mention internal terms; what matters is the rendered
    // surface doesn't.
    const code = SIGNUP_PAGE_SRC
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\btenant\b/i);
    expect(code).not.toMatch(/\badmin\b/i);
    expect(code).not.toMatch(/\bRLS\b/);
    expect(code).not.toMatch(/\bschema\b/i);
  });

  it("form uses magic-link sign-in (signInWithOtp via the action)", () => {
    expect(SIGNUP_ACTIONS_SRC).toContain("signInWithOtp");
    expect(SIGNUP_ACTIONS_SRC).toContain("shouldCreateUser: true");
  });

  it("form does NOT collect payment info or password", () => {
    expect(SIGNUP_FORM_SRC).not.toContain('type="password"');
    expect(SIGNUP_FORM_SRC).not.toMatch(/credit\s*card/i);
    expect(SIGNUP_FORM_SRC).not.toMatch(/stripe/i);
    expect(SIGNUP_PAGE_SRC).not.toMatch(/credit\s*card/i);
  });

  it("magic-link redirectTo points at /auth/callback (which provisions the tenant)", () => {
    expect(SIGNUP_ACTIONS_SRC).toMatch(/auth\/callback/);
  });
});

describe("Gap B — /auth/callback provisioning contract", () => {
  it("imports provisionTenantForNewUser from the onboarding domain", () => {
    expect(CALLBACK_SRC).toMatch(
      /import \{ provisionTenantForNewUser \} from "@\/domains\/onboarding\/provision-tenant"/,
    );
  });

  it("uses the service-role admin client (provisioner needs to bypass RLS)", () => {
    expect(CALLBACK_SRC).toContain("getSupabaseAdmin");
  });

  it("calls provisioner with the resolved Supabase auth user", () => {
    expect(CALLBACK_SRC).toMatch(
      /provisionTenantForNewUser\(\s*admin\s*,\s*\{\s*userId: user\.id/,
    );
  });

  it("redirects first-time signups (created: true) to /onboard/business", () => {
    expect(CALLBACK_SRC).toMatch(/provision\.created[\s\S]{0,200}\/onboard\/business/);
  });

  it("repeat sign-in (created: false) redirects to caller's `next` or `/`", () => {
    // The post-membership redirect uses the `next` param (default '/').
    expect(CALLBACK_SRC).toMatch(/origin\}\$\{next\}/);
  });

  it("provisioning failure routes back to /signup with structured error param", () => {
    expect(CALLBACK_SRC).toMatch(/\/signup\?error=\$\{encodeURIComponent\(`provisioning_/);
  });

  it("does NOT call recommendation LLMs / paid polling / scans", () => {
    expect(CALLBACK_SRC).not.toContain("openai");
    expect(CALLBACK_SRC).not.toContain("perplexity");
    expect(CALLBACK_SRC).not.toContain("runNativePoll");
    expect(CALLBACK_SRC).not.toContain("runWebsiteScan");
    expect(CALLBACK_SRC).not.toContain("acceptAllHighConfidence");
  });
});

describe("Gap B — /onboard/business route exists (form contract owned by Gap C.1)", () => {
  // The page itself was repurposed from a Gap B placeholder into the
  // Gap C.1 step-1 form. Gap B's invariants here pin the route-level
  // contract that Gap B established (route exists, is dynamic, no
  // paid APIs from the page itself, lives under (shell)). The form +
  // submit + access-guard contract is owned by
  // tests/architecture/onboard-business-step-contract.test.ts.

  it("page file exists at src/app/(shell)/onboard/business/page.tsx", () => {
    expect(existsSync(ONBOARD_PAGE)).toBe(true);
  });

  it("page is dynamic (auth + tenant status read at request time)", () => {
    expect(ONBOARD_SRC).toContain('export const dynamic = "force-dynamic"');
  });

  it("page itself does NOT call paid APIs (server action is separate)", () => {
    expect(ONBOARD_SRC).not.toContain("openai");
    expect(ONBOARD_SRC).not.toContain("perplexity");
    expect(ONBOARD_SRC).not.toContain("runNativePoll");
    expect(ONBOARD_SRC).not.toContain("runWebsiteScan");
  });

  it("page itself does NOT mutate persisted rows (writes go through the action)", () => {
    expect(ONBOARD_SRC).not.toMatch(/\.upsert\(/);
    expect(ONBOARD_SRC).not.toMatch(/\.insert\(/);
    expect(ONBOARD_SRC).not.toMatch(/\.update\(/);
    expect(ONBOARD_SRC).not.toMatch(/\.delete\(/);
  });

  it("uses shell layout (lives under (shell) route group)", () => {
    // Path-level invariant: the route group locates this under (shell).
    expect(ONBOARD_PAGE).toContain("(shell)/onboard/business");
  });
});

describe("Gap B — middleware exposes /signup as public", () => {
  it("isPublic predicate includes /signup", () => {
    expect(MIDDLEWARE_SRC).toMatch(/path\.startsWith\("\/signup"\)/);
  });

  it("isPublic predicate still includes /login + /auth (no regression)", () => {
    expect(MIDDLEWARE_SRC).toMatch(/path\.startsWith\("\/login"\)/);
    expect(MIDDLEWARE_SRC).toMatch(/path\.startsWith\("\/auth"\)/);
  });
});

describe("Gap B — provisioner does not self-activate the tenant", () => {
  it("PROVISIONING_DEFAULTS.status is 'pending_onboarding' (NOT 'active')", () => {
    expect(PROVISIONER_SRC).toMatch(
      /status:\s*"pending_onboarding"\s+as\s+const/,
    );
    // Negative: must not contain a literal that flips status to 'active'
    // in the defaults block. Active is allowed in comments/types.
    const code = PROVISIONER_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/PROVISIONING_DEFAULTS[\s\S]{0,400}status:\s*"active"/);
  });

  it("daily_budget_usd defaults to 5 (small operator-locked safety cap)", () => {
    expect(PROVISIONER_SRC).toMatch(/daily_budget_usd:\s*5\b/);
  });

  it("inserts via upsert with ignoreDuplicates: true (idempotency)", () => {
    expect(PROVISIONER_SRC).toMatch(/ignoreDuplicates:\s*true/);
  });

  it("provisioner does NOT call paid APIs / scans / queue mutations", () => {
    expect(PROVISIONER_SRC).not.toContain("openai");
    expect(PROVISIONER_SRC).not.toContain("perplexity");
    expect(PROVISIONER_SRC).not.toContain("runNativePoll");
    expect(PROVISIONER_SRC).not.toContain("runWebsiteScan");
    expect(PROVISIONER_SRC).not.toContain("syncRecommendedEdits");
    expect(PROVISIONER_SRC).not.toContain("syncUrlChangeOutcomes");
  });

  it("provisioner does NOT add a second active tenant (status='active' on insert)", () => {
    // Re-pin the defaults safety: status='active' must never appear in
    // the active code as a literal value being inserted.
    const code = PROVISIONER_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The defaults const is the only place status is set on the row.
    // It must be pending_onboarding.
    expect(code).toMatch(/status:\s*PROVISIONING_DEFAULTS\.status/);
  });
});

// De-bloat (2026-06-15): "Gap B — pending tenants are NOT picked up by
// Gap A's lister" was removed with scripts/list-active-tenants.ts. The
// lister was the cron-matrix plumbing for the deleted scheduled
// poll/scan/generation workflows; with the crons gone there is no lister
// to exclude pending tenants from. The pending_onboarding default on the
// provisioned row is still pinned above (Gap A / provisioning-defaults).
