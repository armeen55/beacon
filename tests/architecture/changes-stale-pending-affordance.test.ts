/**
 * D5 (operator audit, 2026-05-05) — /changes stale-pending affordance.
 *
 * Pre-D5: a /changes row whose linked recommended_edit was in
 * `recommended` lifecycle state for ≥3 days got the yellow stale-tint
 * + a tooltip that read "Accepted N days ago — scan hasn't confirmed
 * it on the page yet." That tooltip was wrong (the row was NOT yet
 * accepted) and the Mark Shipped button was hidden (M4 gate). Net
 * effect: yellow visual + hidden button + misleading tooltip = "looks
 * broken."
 *
 * Post-D5: tooltip + pill copy disambiguate by lifecycle state:
 *   • `accepted` stale row — "Accepted N days ago — scan hasn't
 *     confirmed it on the page yet. Mark shipped to start the verdict
 *     clock now." Pill: "Nd pending". Mark Shipped button visible.
 *   • `recommended` stale row — "Pending for N days. Accept this
 *     recommendation first (open /recommendations), then mark shipped
 *     once it's live on the page." Pill: "Nd — accept first". Mark
 *     Shipped button still hidden (M4 contract).
 *
 * The yellow tint stays on both — both states ARE genuinely pending
 * and the visual cue is correct. D5 fixes the COPY, not the visual.
 *
 * Source-text invariant rather than full DOM render: the scorecard is
 * a `"use client"` component nested under multiple data props that
 * change shape often; pinning the lexical contract on the copy strings
 * + lifecycle gate is more robust than a DOM probe.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SCORECARD_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/scorecard-client.tsx",
);
const SRC = readFileSync(SCORECARD_PATH, "utf-8");

describe("D5 — recommended-state stale row uses 'accept first' copy", () => {
  it("scorecard source contains the recommended-state pill label '${ageDays}d — accept first'", () => {
    expect(
      SRC.includes("d — accept first"),
      "scorecard-client.tsx must include the 'd — accept first' pill label for `recommended` stale rows (D5)",
    ).toBe(true);
  });

  it("scorecard source contains the recommended-state tooltip 'Pending for … Accept this recommendation first'", () => {
    expect(
      SRC.includes("Accept this recommendation first"),
      "scorecard-client.tsx must include the 'Accept this recommendation first' tooltip copy (D5)",
    ).toBe(true);
    expect(
      SRC.includes("then mark shipped once it's live on the page"),
      "scorecard-client.tsx must include 'then mark shipped once it's live on the page' guidance (D5)",
    ).toBe(true);
  });

  it("recommended stale row does NOT show 'Accepted N days ago' wording (no false acceptance claim)", () => {
    // Both stalePillLabel and staleTooltip branch on lifecycleStatus
    // === "accepted". The "Accepted N days ago" string MUST live in
    // the accepted branch only. Verify the branching shape is correct.
    expect(
      SRC.match(
        /lifecycleStatus\s*===\s*"accepted"\s*\?[^:]*Accepted\s+\$\{ageDays\}/,
      ),
      "The 'Accepted N days ago' tooltip must be gated to lifecycleStatus === 'accepted' branch (D5)",
    ).not.toBeNull();
  });
});

describe("D5 — accepted stale row keeps Mark Shipped affordance", () => {
  it("scorecard source pins canMarkShipped on lifecycleStatus === 'accepted'", () => {
    // Restate the M4 contract — D5 must NOT loosen it.
    expect(
      SRC.includes('canMarkShipped = lifecycleStatus === "accepted"'),
      "Mark Shipped gate must remain `lifecycleStatus === 'accepted'` (D5 + M4)",
    ).toBe(true);
  });

  it("Mark Shipped button still renders inside `{canMarkShipped && (…)}` (M4 invariant preserved)", () => {
    const guardIdx = SRC.indexOf("{canMarkShipped &&");
    const buttonIdx = SRC.indexOf("Mark shipped", guardIdx);
    expect(guardIdx).toBeGreaterThan(0);
    expect(buttonIdx).toBeGreaterThan(guardIdx);
  });

  it("accepted stale tooltip mentions 'Mark shipped to start the verdict clock'", () => {
    expect(
      SRC.includes("Mark shipped to start the verdict clock now."),
      "Accepted stale tooltip must include the 'Mark shipped to start the verdict clock now.' copy so the operator knows the affordance (D5)",
    ).toBe(true);
  });
});

describe("D5 — copy is gated on lifecycleStatus (no leakage between states)", () => {
  it("staleTooltip branches on lifecycleStatus === 'accepted'", () => {
    expect(
      SRC.match(
        /staleTooltip\s*=\s*\n?\s*lifecycleStatus\s*===\s*"accepted"\s*\?/,
      ),
      "staleTooltip must branch on lifecycleStatus === 'accepted' (D5)",
    ).not.toBeNull();
  });

  it("stalePillLabel branches on lifecycleStatus === 'accepted'", () => {
    expect(
      SRC.match(
        /stalePillLabel\s*=\s*\n?\s*lifecycleStatus\s*===\s*"accepted"\s*\?/,
      ),
      "stalePillLabel must branch on lifecycleStatus === 'accepted' (D5)",
    ).not.toBeNull();
  });

  it("data-stale-pending-state attribute exposes the lifecycle for tests / debugging", () => {
    expect(
      SRC.includes("data-stale-pending-state"),
      "stale row must expose `data-stale-pending-state` attribute carrying the lifecycle (D5)",
    ).toBe(true);
  });

  it("data-stale-pill-state attribute on the pill exposes the lifecycle", () => {
    expect(
      SRC.includes("data-stale-pill-state"),
      "stale pill must expose `data-stale-pill-state` attribute carrying the lifecycle (D5)",
    ).toBe(true);
  });
});

describe("D5 — yellow tint still fires on both pending states (D5 fixes copy, not visual)", () => {
  it("isStalePending check still includes both `recommended` and `accepted`", () => {
    // Visual cue is correct on both; only the copy disambiguates.
    expect(
      SRC.match(
        /isPendingForStaleness\s*=\s*\n?\s*lifecycleStatus\s*===\s*"recommended"\s*\|\|\s*lifecycleStatus\s*===\s*"accepted"/,
      ),
      "Yellow stale tint must still fire on BOTH recommended and accepted (D5 — visual unchanged)",
    ).not.toBeNull();
  });
});
