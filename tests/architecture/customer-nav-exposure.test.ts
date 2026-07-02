/**
 * Architecture / contract test —
 * customer nav exposure surface.
 *
 * T-CustomerNav (2026-05-08). Locks in the customer-surface contract
 * after the audit revealed the sidebar + settings tabs were already
 * pruned (since 2026-04-17 / 2026-04-22) but a few peripheral
 * surfaces — the command palette + exit-gates settings hint — still
 * exposed hidden routes.
 *
 * Invariants permanently locked here:
 *
 *   1. SIDEBAR — `navigationGroups` exposes EXACTLY the 6 customer
 *      routes: /, /recommendations, /prompts, /changes,
 *      /settings/connectors, /settings. Adding a new route requires
 *      updating this test. (Connectors added 2026-06-15 goal pivot.)
 *
 *   2. CMD+K KEYBOARD SHORTCUTS — the `g+<key>` shortcuts in
 *      `command-palette.tsx` only target customer-surface routes.
 *      The map covers all six customer routes (g+t→/, g+r→
 *      /recommendations, g+p→/prompts, g+c→/changes, g+k→
 *      /settings/connectors, g+s→/settings). No shortcut routes to
 *      /pages, /competitors, /local, /topics, /diagnostics/*, /audit,
 *      /rank, /moves, /review, /expansion, /changes/truth.
 *
 *   3. CMD+K PALETTE GROUPS — the layout-built `paletteItems` only
 *      reference customer-surface routes (Navigate group via
 *      `allNavItems`, Changes group via `/changes/[id]` deep links).
 *      No "Market" group surfacing /competitors. No /pages, /local,
 *      /topics group.
 *
 *   4. SETTINGS TABS — `settings-tabs-client.tsx` exposes the
 *      customer-surface tabs led by Connectors (Connectors, Import,
 *      Config, Prompts, Data). No Health / Sign-offs / Methodology.
 *
 *   5. EXIT-GATES SETTINGS HINT — the server wrapper checks
 *      `BEACON_OPERATOR_MODE` before rendering. Customers don't see
 *      the "Internal sign-off" link even when exit-gates data
 *      becomes engaged.
 *
 * Static-analysis tests use file content reads + targeted regex
 * checks. Runtime invariants (#1) import the actual exported
 * `navigationGroups` so the lock is type-checked.
 *
 * If you intentionally widen the customer surface (e.g., promote
 * /competitors to a customer route), update THIS test in the same
 * commit so the architectural decision is visible in review.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { navigationGroups } from "@/lib/navigation";

const REPO_ROOT = resolve(__dirname, "..", "..");
function readSrc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

// ─── Invariant 1 — SIDEBAR ────────────────────────────────────────────────

describe("customer nav exposure — Invariant 1: SIDEBAR is the unified workflow nav", () => {
  // 2026-06-23 IA consolidation (operator directive: "everything should be
  // available to everyone, I literally have 0 users"). The former operator-only
  // tier (Opportunities / Experiments / Results / Competitors / Connections) is
  // folded into ONE nav so the app reads as a single product. The contract is
  // now "exactly this unified set" — adding a route still requires updating
  // this test so the decision is visible in review.
  // 2026-07-01 one-workflow consolidation: the sidebar is now Today (/) +
  // Changes (/worklist) + Results (/proof) + Research (/prompts, /competitors) +
  // Settings (/connections, /settings/connectors, /settings). "Drafts"
  // (/recommendations), "Ready to ship" (/experiments), /opportunities and
  // /moves are STAGES of a change reachable from the Changes list + direct URL
  // (their routes still exist as redirects), so they were removed from the
  // sidebar. Adding a route still requires updating this set so the decision is
  // visible in review.
  // 2026-07-02 (master plan item 59): added /ask, the ask-your-team chat, next
  // to Today/Changes/Results - it answers questions about the same change
  // lifecycle in plain language rather than being a separate deep-evidence
  // destination, so it belongs in the core workflow group, not Research.
  const EXPECTED_HREFS = new Set([
    "/",
    "/worklist",
    "/proof",
    "/ask",
    "/prompts",
    "/competitors",
        "/settings/connectors",
    "/settings",
  ]);

  it("navigationGroups exposes exactly the unified workflow routes", () => {
    const allHrefs = navigationGroups
      .flatMap((g) => g.items.map((i) => i.href))
      .sort();
    expect(new Set(allHrefs)).toEqual(EXPECTED_HREFS);
  });

  it("navigationGroups does NOT include any truly-dead / debug-only routes", () => {
    const allHrefs = new Set(
      navigationGroups.flatMap((g) => g.items.map((i) => i.href)),
    );
    // /competitors + /connections + /opportunities + /experiments + /proof are
    // now intentionally exposed (IA consolidation). These remain dead/debug.
    const FORBIDDEN = [
      "/pages",
      "/local",
      "/topics",
      "/audit",
      "/rank",
      "/review",
      "/expansion",
      "/diagnostics",
      "/diagnostics/brain",
      "/diagnostics/spikes",
      "/changes/truth",
      "/settings/health",
      "/settings/exit-gates",
    ];
    for (const h of FORBIDDEN) {
      expect(allHrefs.has(h), `forbidden route in sidebar: ${h}`).toBe(false);
    }
  });
});

// ─── Invariant 2 — CMD+K KEYBOARD SHORTCUTS ───────────────────────────────

describe("customer nav exposure — Invariant 2: CMD+K shortcuts target only customer routes", () => {
  it("g+<key> route map in command-palette.tsx contains only /, /changes, /settings", () => {
    const src = readSrc("src/components/shell/command-palette.tsx");
    // Find the route-shortcuts object literal. Match the shape:
    //   const routes: Record<string, string> = { t: "/", ... };
    // Loose match — just confirms no entries point at hidden routes.
    const FORBIDDEN_SHORTCUT_TARGETS = [
      `"/pages"`,
      `"/competitors"`,
      `"/local"`,
      `"/topics"`,
      `"/audit"`,
      `"/rank"`,
      `"/moves"`,
      `"/review"`,
      `"/expansion"`,
      `"/diagnostics"`,
      `"/changes/truth"`,
      `"/settings/health"`,
      `"/settings/exit-gates"`,
    ];
    for (const target of FORBIDDEN_SHORTCUT_TARGETS) {
      expect(
        src,
        `forbidden shortcut target in command-palette.tsx: ${target}`,
      ).not.toContain(target);
    }
  });

  it("the customer-route shortcuts (g+t/r/p/c/k/s) are wired 1:1 with the nav", () => {
    // 2026-06-14 — the g+<key> map was widened to cover the customer routes
    // so the help dialog + palette labels stop advertising shortcuts the
    // handler never fired. IA consolidation (2026-06-23): g+c now points at
    // Results (/proof) since Changes merged into it.
    const src = readSrc("src/components/shell/command-palette.tsx");
    expect(src).toMatch(/t:\s*"\/"/);
    expect(src).toMatch(/r:\s*"\/recommendations"/);
    expect(src).toMatch(/p:\s*"\/prompts"/);
    expect(src).toMatch(/c:\s*"\/proof"/);
    expect(src).toMatch(/k:\s*"\/settings\/connectors"/);
    expect(src).toMatch(/s:\s*"\/settings"/);
  });
});

// ─── Invariant 3 — CMD+K PALETTE GROUPS ───────────────────────────────────

describe("customer nav exposure — Invariant 3: CMD+K palette items have no Market group", () => {
  it('the (shell)/layout.tsx paletteItems builder does NOT include a "Market" group', () => {
    const src = readSrc("src/app/(shell)/layout.tsx");
    // Pre-T-CustomerNav had `group: "Market"` mapping topics →
    // /competitors. Locked out here: the literal string `group:
    // "Market"` (with that exact spelling) must not appear.
    expect(src).not.toMatch(/group:\s*"Market"/);
  });

  it("the (shell)/layout.tsx paletteItems builder does NOT reference /competitors", () => {
    const src = readSrc("src/app/(shell)/layout.tsx");
    expect(src).not.toContain('"/competitors"');
    expect(src).not.toContain('"/competitors#opportunities"');
  });

  it("the legitimate Navigate + Results groups are preserved", () => {
    const src = readSrc("src/app/(shell)/layout.tsx");
    expect(src).toMatch(/group:\s*"Navigate"/);
    // IA consolidation (2026-06-23): the deep-changelog palette group was
    // renamed Changes -> Results (links still target /changes/[id]).
    expect(src).toMatch(/group:\s*"Results"/);
  });
});

// ─── Invariant 4 — SETTINGS TABS ──────────────────────────────────────────

describe("customer nav exposure — Invariant 4: settings tabs", () => {
  it("settings-tabs-client.tsx exposes the customer tabs incl. Connectors", () => {
    const src = readSrc("src/app/(shell)/settings/settings-tabs-client.tsx");
    // Expected hrefs (2026-06-15 pivot: Connectors is now the primary
    // customer self-serve surface and leads the tab bar):
    expect(src).toContain('"/settings/connectors"');
    expect(src).toContain('"/settings/import"');
    expect(src).toContain('"/settings/config"');
    expect(src).toContain('"/settings/prompts"');
    expect(src).toContain('"/settings/history"');
    // Forbidden tabs (routes still alive but operator/internal-only):
    expect(src).not.toMatch(/href:\s*"\/settings\/health"/);
    expect(src).not.toMatch(/href:\s*"\/settings\/exit-gates"/);
    expect(src).not.toMatch(/href:\s*"\/settings\/methodology"/);
  });
});

// ─── Invariant 5 — EXIT-GATES SETTINGS HINT IS OPERATOR-GATED ─────────────

describe("customer nav exposure — Invariant 5: ExitGatesSettingsHint operator gate", () => {
  it("the server wrapper gates on isOperatorModeServer() before rendering", () => {
    const src = readSrc("src/app/(shell)/settings/exit-gates-settings-hint.tsx");
    // Post-2026-05-09 unification (C1): the gate goes through the
    // shared helper instead of reading process.env directly.
    expect(src).toContain("isOperatorModeServer");
    expect(src).not.toMatch(/process\.env\.BEACON_OPERATOR_MODE/);
    expect(src).toMatch(/if\s*\(!isOperatorModeServer\(\)\)\s*return\s*null/);
  });

  it('the rendered hint still links to "/settings/exit-gates" (the route remains accessible to operators)', () => {
    // The link target itself isn't forbidden — operators still need
    // to reach the page. We just gate the surface that exposes it.
    const src = readSrc(
      "src/app/(shell)/settings/exit-gates-settings-hint-client.tsx",
    );
    expect(src).toContain('"/settings/exit-gates"');
  });
});
