import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * BEACON_500 item 15 - "Stage in Wix" architectural pins.
 *
 * The staging entry point is COMPOSITION over the existing push rails, and
 * both card surfaces offer it without ever weakening the paste fallback:
 *  1. NO NEW PUSH LOGIC: stage-change.ts routes exclusively through
 *     executePush (the single write authority) and never imports the Wix
 *     client itself; the Ritz hard block is checked in the entry point.
 *  2. DAILY CARD: "Stage in Wix" is offered only when the loader says the
 *     site is armed AND the lever has a route; the paste flow stays the
 *     visible fallback; the receipt renders on the card; the not-armed
 *     nudge points at the publishing settings.
 *  3. MOVE CARD: same treatment on the apply affordance, with the same
 *     fallback + nudge, and staging records the SAME accepted response
 *     Ship it records (the measure loop is unchanged).
 *  4. GATING: both server actions are operator-gated and thin (gate ->
 *     stageChangeForRecord -> revalidate).
 *  5. DASH GUARD: no em/en/figure/bar dash anywhere in the new modules or
 *     the two card files.
 */

const REPO_ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(REPO_ROOT, p), "utf8");

const stageChangeSrc = read("src/domains/push/stage-change.ts");
const stageRouteSrc = read("src/domains/push/stage-route.ts");
const actionsSrc = read("src/app/(shell)/stage-in-wix-actions.ts");
const moveCardSrc = read("src/app/(shell)/today-moves-card.tsx");
const movesDataSrc = read("src/app/(shell)/today-moves-data.ts");

const BANNED_DASH = /[‒–—―]/; // figure, en, em, horizontal bar

describe("item 15 - stage-change is composition over the existing push rails", () => {
  it("executes exclusively through executePush and never imports the Wix client", () => {
    expect(stageChangeSrc).toMatch(/import \{[\s\S]*?executePush[\s\S]*?\} from "\.\/push-service"/);
    expect(stageChangeSrc).toMatch(/await executePush\(/);
    expect(stageChangeSrc).not.toMatch(/connectors\/wix\/client/);
    expect(stageChangeSrc).not.toMatch(/wixUpdateDataItem|wixInsertDataItem|wixUpdateProductSeoData/);
  });

  it("hard-blocks Ritz in the entry point, before any rail runs", () => {
    const ritzGate = stageChangeSrc.indexOf("tenantId === RITZ_TENANT_ID");
    const pushCall = stageChangeSrc.indexOf("await executePush(");
    expect(ritzGate).toBeGreaterThan(-1);
    expect(pushCall).toBeGreaterThan(ritzGate);
  });

  it("requires the EXPLICIT armed mode and fails closed to the paste instruction", () => {
    expect(stageChangeSrc).toMatch(/modeState\.mode !== "armed"/);
    expect(stageChangeSrc).toMatch(/pasteFallbackLine/);
  });

  it("keeps the QA backstop the armed one-click accept uses (moves)", () => {
    expect(stageChangeSrc).toMatch(/loadActionRowByEditId/);
    expect(stageChangeSrc).toMatch(/pushReadiness !== "paste_ready"/);
  });
});

describe("item 15 - worklist MoveCard surface", () => {
  it("offers Stage in Wix through the operator-gated server action", () => {
    expect(moveCardSrc).toMatch(/import \{ stageMoveInWixAction \} from "\.\/stage-in-wix-actions"/);
    expect(moveCardSrc).toContain("Stage in Wix");
  });

  it("keeps the paste/manual flow as the visible fallback", () => {
    expect(moveCardSrc).toContain("or copy and paste it yourself");
    expect(moveCardSrc).toContain("I did it myself");
  });

  it("staging records the SAME accepted response Ship it records (loop unchanged)", () => {
    const staged = moveCardSrc.indexOf("stageMoveInWixAction({ moveId: m.id })");
    expect(staged).toBeGreaterThan(-1);
    const after = moveCardSrc.slice(staged);
    expect(after).toContain('respondToRecommendation(m.id, "accepted"');
  });

  it("renders the receipt line after staging", () => {
    expect(moveCardSrc).toMatch(/setStagedLine\(r\.receiptLine\)/);
    expect(moveCardSrc).toMatch(/\{stagedLine\}/);
  });

  it("nudges at the publishing settings when pushable but not armed", () => {
    expect(moveCardSrc).toMatch(/m\.staging\?\.nudge/);
    expect(moveCardSrc).toContain('href="/settings/connectors"');
  });

  it("never offers staging on a mid-measurement page (proof-window protection)", () => {
    expect(moveCardSrc).toMatch(/m\.staging\?\.enabled\) && !m\.alreadyMeasuring && !m\.pageMeasuring/);
  });

  it("the loader computes per-move stageability from the shared route map", () => {
    expect(movesDataSrc).toMatch(/stageRouteForActionType\(e\.action_type, e\.target_element_key \?\? null\)/);
    expect(movesDataSrc).toMatch(/getStagingAvailability\(tenantId\)\.catch\(\(\) => STAGING_OFF\)/);
  });
});

describe("item 15 - server actions are thin and operator-gated", () => {
  it("the move action gates on operator mode before delegating", () => {
    const move = actionsSrc.indexOf("stageMoveInWixAction");
    expect(move).toBeGreaterThan(-1);
    const gates = actionsSrc.match(/if \(!\(await isOperatorModeServer\(\)\)\) return NOT_ALLOWED;/g) ?? [];
    expect(gates.length).toBe(1);
    expect(actionsSrc).toMatch(/stageChangeForRecord\(/);
  });

  it("the actions never import push internals directly (single entry point)", () => {
    expect(actionsSrc).not.toMatch(/push-service|executePush|connectors\/wix/);
  });
});

describe("item 15 - dash guard (no em/en/figure/bar dash anywhere)", () => {
  const files: Array<[string, string]> = [
    ["stage-change.ts", stageChangeSrc],
    ["stage-route.ts", stageRouteSrc],
    ["stage-in-wix-actions.ts", actionsSrc],
    ["today-moves-card.tsx", moveCardSrc],
  ];
  for (const [name, src] of files) {
    it(`${name} is dash-clean`, () => {
      expect(src, `${name} contains a banned dash`).not.toMatch(BANNED_DASH);
    });
  }
});
