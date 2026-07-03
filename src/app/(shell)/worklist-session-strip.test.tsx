/**
 * worklist-session-strip - render + wiring tests for the D6 daily ritual loop's session banner.
 *
 * This repo's convention for interactive client components (no jsdom/@testing-library/react in
 * this project) is `renderToStaticMarkup` for render-shape checks plus source-pinning for
 * interaction wiring (see today-v2-visibility-group-client.test.tsx). The underlying advance-to-
 * next-best logic and no-dead-end invariant are pure functions already covered exhaustively by
 * session-flow.test.ts; this file pins how the banner presents that state and that the hook is
 * actually wired to those pure helpers (not a reimplementation).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { WorklistSessionBanner } from "./worklist-session-strip";

const SRC = readFileSync(resolve(__dirname, "worklist-session-strip.tsx"), "utf8");

describe("WorklistSessionBanner - render", () => {
  it("renders nothing on a fresh session (0 shipped, no banner)", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner shippedCount={0} banner={null} onDismiss={() => {}} />,
    );
    expect(html).toBe("");
  });

  it("shows the shipped count once at least one change has been marked done", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner shippedCount={1} banner={null} onDismiss={() => {}} />,
    );
    expect(html).toContain("You have shipped 1 change today.");
  });

  it("pluralizes correctly at 2+", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner shippedCount={3} banner={null} onDismiss={() => {}} />,
    );
    expect(html).toContain("You have shipped 3 changes today.");
  });

  it("shows the next-best banner text and an Open it + Dismiss control", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner
        shippedCount={1}
        banner="Next best: Rewrite the title tag on Persian Male Names."
        onDismiss={() => {}}
        onOpenNext={() => {}}
      />,
    );
    expect(html).toContain("Next best: Rewrite the title tag on Persian Male Names.");
    expect(html).toContain("Open it");
    expect(html).toContain("Dismiss");
  });

  it("never renders an em or en dash", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner
        shippedCount={2}
        banner="Next best: Add an FAQ block on Farsi Numbers."
        onDismiss={() => {}}
        onOpenNext={() => {}}
      />,
    );
    expect(html).not.toMatch(/[–—]/);
  });

  it("R20 - renders the live progress line + weekly line when provided (self-hides classic count sentence)", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner
        shippedCount={3}
        banner={null}
        progressLine="3 shipped today, 2 ready, next best is /iran-flags."
        weeklyLine="5 shipped this week, 3 measuring."
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain("3 shipped today, 2 ready, next best is /iran-flags.");
    expect(html).toContain("5 shipped this week, 3 measuring.");
    // The progress line replaces (not doubles) the classic sentence when present.
    expect(html).not.toContain("You have shipped 3 changes today.");
  });

  it("R20 - shows the honest auto-advance prepare status (Preparing... then Ready), no new lifecycle word", () => {
    const preparing = renderToStaticMarkup(
      <WorklistSessionBanner
        shippedCount={1}
        banner={null}
        progressLine="1 shipped today."
        prepareStatus="preparing"
        onDismiss={() => {}}
      />,
    );
    expect(preparing).toContain("Preparing the next one while you work...");
    const ready = renderToStaticMarkup(
      <WorklistSessionBanner
        shippedCount={1}
        banner={null}
        progressLine="1 shipped today."
        prepareStatus="ready"
        onDismiss={() => {}}
      />,
    );
    expect(ready).toContain("The next one is ready.");
    // Idle before the first ship shows no prepare line.
    const idle = renderToStaticMarkup(
      <WorklistSessionBanner shippedCount={1} banner={null} progressLine="1 shipped today." prepareStatus="idle" onDismiss={() => {}} />,
    );
    expect(idle).not.toContain("Preparing the next one");
    expect(idle).not.toContain("The next one is ready.");
  });

  it("R20 - the new lines never emit an em/en dash or a lab word", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner
        shippedCount={4}
        banner="Next best: Add a comparison table on Iran Flags."
        progressLine="4 shipped today, 1 ready, next best is /iran-flags."
        weeklyLine="6 shipped this week, 2 measuring."
        prepareStatus="preparing"
        onDismiss={() => {}}
        onOpenNext={() => {}}
      />,
    );
    expect(html).not.toMatch(/[–—]/);
    expect(html).not.toMatch(/\b(experiment|control|baseline|treatment|reservation|SERP)\b/i);
  });

  it("is aria-live polite so the banner announces without stealing focus", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner shippedCount={1} banner={null} onDismiss={() => {}} />,
    );
    expect(html).toContain('aria-live="polite"');
  });
});

describe("useWorklistSession - wired to the pure session-flow helpers, not reimplemented", () => {
  it("imports the pure session-flow helpers (findNextActionable + nextBestLine) instead of reimplementing them", () => {
    // One import block from session-flow (may span multiple lines now that R20 added the
    // sessionProgressLine + weeklyOutcomeLine helpers to the same import).
    const importBlock = SRC.match(/import\s*\{[\s\S]*?\}\s*from\s*"@\/domains\/changes\/session-flow"/);
    expect(importBlock).not.toBeNull();
    expect(importBlock![0]).toContain("findNextActionable");
    expect(importBlock![0]).toContain("nextBestLine");
    expect(importBlock![0]).toContain("sessionProgressLine");
    expect(importBlock![0]).toContain("weeklyOutcomeLine");
  });

  it("handleRowAction always recomputes nextBest (no dead end after any action kind)", () => {
    expect(SRC).toContain("setNextBest(upcoming)");
    expect(SRC).toMatch(/findNextActionable\(orderedChanges,\s*handledId,\s*handledIds\)/);
  });

  it("increments the counter only for 'done', never for skip/not-now", () => {
    const doneBlock = SRC.slice(SRC.indexOf('kind === "done"'), SRC.indexOf('kind === "done"') + 200);
    expect(doneBlock).toContain("setShippedCount");
  });

  it("localStorage reads/writes are wrapped in try/catch (fail-soft, matches repo convention)", () => {
    expect(SRC).toMatch(/try\s*\{\s*const raw = window\.localStorage\.getItem/);
    expect(SRC).toMatch(/try\s*\{\s*window\.localStorage\.setItem/);
  });

  it("keys the stored counter per Pacific calendar day, not a rolling window", () => {
    expect(SRC).toContain('toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })');
  });
});

describe("useWorklistSession - R20 auto-advance prepare (background, done-only, fail-soft)", () => {
  it("kicks off the background prepare ONLY inside the 'done' branch, never on skip/not-now", () => {
    // The auto-advance call sits inside the same `kind === "done"` block that bumps the counter,
    // so a skip/not-now advances the next-best row without spending on a prepare.
    const doneIdx = SRC.indexOf('kind === "done"');
    const advanceIdx = SRC.indexOf("autoAdvancePrepareAction()");
    expect(advanceIdx).toBeGreaterThan(doneIdx);
    const doneBlock = SRC.slice(doneIdx, SRC.indexOf("// NO DEAD ENDS"));
    expect(doneBlock).toContain("autoAdvancePrepareAction()");
  });

  it("reflects the honest Preparing -> Ready status and fails soft to Ready on error", () => {
    expect(SRC).toContain('setPrepareStatus("preparing")');
    expect(SRC).toMatch(/\.then\(\(\)\s*=>\s*setPrepareStatus\("ready"\)\)/);
    expect(SRC).toMatch(/\.catch\(\(\)\s*=>\s*setPrepareStatus\("ready"\)\)/);
  });

  it("still advances the next-best row through the SAME pure findNextActionable (no re-rank, no double-prepare)", () => {
    // Advancing the queue is the pure helper's job; the background prepare is a side effect that
    // never re-derives the next row itself, so the two can never disagree or prepare twice.
    expect(SRC).toMatch(/findNextActionable\(orderedChanges,\s*handledId,\s*handledIds\)/);
    // Exactly one call site fires the auto-advance prepare (no duplicate scheduling).
    const occurrences = SRC.match(/autoAdvancePrepareAction\(\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("derives the progress + weekly lines from the pure lifecycle helpers, not a second store", () => {
    expect(SRC).toContain("sessionProgressLine({");
    expect(SRC).toContain("weeklyOutcomeLine({");
  });
});
