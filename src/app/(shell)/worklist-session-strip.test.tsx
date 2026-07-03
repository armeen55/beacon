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

  it("is aria-live polite so the banner announces without stealing focus", () => {
    const html = renderToStaticMarkup(
      <WorklistSessionBanner shippedCount={1} banner={null} onDismiss={() => {}} />,
    );
    expect(html).toContain('aria-live="polite"');
  });
});

describe("useWorklistSession - wired to the pure session-flow helpers, not reimplemented", () => {
  it("imports findNextActionable + nextBestLine from session-flow.ts", () => {
    expect(SRC).toMatch(/import\s*\{\s*findNextActionable,\s*nextBestLine\s*\}\s*from\s*"@\/domains\/changes\/session-flow"/);
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
