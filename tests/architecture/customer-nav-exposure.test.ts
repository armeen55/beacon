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
 *   4. SETTINGS TABS — one registry (`settings-sections.ts`) feeds
 *      BOTH the tab strip and the /settings index (FP4 2026-07-03),
 *      led by Connections. No Health / Sign-offs tabs.
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
  // Changes (/changes) + Results (/results) + Research (/prompts, /competitors) +
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
  // 2026-07-02 (FP10b): removed /competitors. It was an empty shell whose
  // promised content ("who AI cites instead of you") already lives, with real
  // intelligence, inside /prompts (AI questions) - /competitors now redirects
  // there so old links keep working, but the nav no longer duplicates it.
  // 2026-07-03 (FP4): route-name unification. The Changes list moved from
  // /worklist to /changes and the results page from /proof to /results so the
  // URL, the nav label, and the page h1 agree; the old URLs are permanent
  // redirects.
  // 2026-07-03 (R14a, P1 trust receipts): added /activity, the unified audit
  // log ("what has Beacon done while I was away"). It sits in the system group
  // next to Connections/Settings because it is a receipt surface over the
  // whole product, not a work stage.
  const EXPECTED_HREFS = new Set([
    "/",
    "/changes",
    "/results",
    "/ask",
    "/activity",
    "/prompts",
    "/research/keywords",
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
    // /connections + /opportunities + /experiments + /results are now
    // intentionally exposed (IA consolidation). These remain dead/debug.
    // /competitors rejoined this list 2026-07-02 (FP10b): it now redirects to
    // /prompts instead of being a nav destination.
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
      "/competitors",
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

  it("the customer-route shortcuts (g+t/c/e/a/p/k/s) are wired 1:1 with the nav", () => {
    // 2026-06-14 — the g+<key> map was widened to cover the customer routes
    // so the help dialog + palette labels stop advertising shortcuts the
    // handler never fired. FP4 (2026-07-03): URLs now match nav labels, so
    // the letters follow the names: g+c = Changes (/changes), g+e = Results
    // (/results), g+a = Ask. g+r was dropped with Drafts leaving the nav
    // (/recommendations is a redirect into /changes).
    const src = readSrc("src/components/shell/command-palette.tsx");
    expect(src).toMatch(/t:\s*"\/"/);
    expect(src).toMatch(/c:\s*"\/changes"/);
    expect(src).toMatch(/e:\s*"\/results"/);
    expect(src).toMatch(/a:\s*"\/ask"/);
    expect(src).toMatch(/p:\s*"\/prompts"/);
    expect(src).toMatch(/k:\s*"\/settings\/connectors"/);
    expect(src).toMatch(/s:\s*"\/settings"/);
    expect(src).not.toMatch(/r:\s*"\/recommendations"/);
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
  // FP4 (2026-07-03) settings merge: the tab strip and the /settings index
  // page both render the ONE registry in settings-sections.ts, so the two
  // menus can never disagree again. "How Beacon measures" + Spend joined the
  // shared list (they were reachable only from the index before, which is
  // exactly how the two menus drifted apart); exit-gates + health stay
  // operator/internal.
  it("settings-sections.ts is the ONE settings table of contents (Connections leads)", () => {
    const src = readSrc("src/app/(shell)/settings/settings-sections.ts");
    expect(src).toContain('"/settings/connectors"');
    expect(src).toContain('"/settings/config"');
    expect(src).toContain('"/settings/import"');
    expect(src).toContain('"/settings/prompts"');
    expect(src).toContain('"/settings/history"');
    expect(src).toContain('"/settings/spend"');
    expect(src).toContain('"/settings/methodology"');
    // The sidebar calls this page "Connections"; the tab must use the same word.
    expect(src).toContain('label: "Connections"');
    // Forbidden sections (routes still alive but operator/internal-only):
    expect(src).not.toContain('"/settings/health"');
    expect(src).not.toContain('"/settings/exit-gates"');
  });

  it("the tab strip and the /settings index both derive from settings-sections.ts", () => {
    const tabs = readSrc("src/app/(shell)/settings/settings-tabs-client.tsx");
    const index = readSrc("src/app/(shell)/settings/page.tsx");
    expect(tabs).toContain('from "./settings-sections"');
    expect(index).toContain('from "./settings-sections"');
    // Neither surface may carry its own parallel href list anymore.
    expect(tabs).not.toMatch(/href:\s*"\/settings\//);
    expect(index).not.toMatch(/href:\s*"\/settings\//);
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
