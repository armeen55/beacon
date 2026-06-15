/**
 * a11y #421 (2026-06-14) — sidebar alert-count badge accessible label.
 *
 * The red/amber nav count badge (BADGE_STYLES: status-danger / status-warning)
 * conveyed urgency by COLOR + a bare number with no label — a screen reader
 * would announce a stray "3". This pins the additive fix: the badge span must
 * carry an aria-label that spells out the meaning ("3 need attention").
 *
 * Source-text assertion (matches the repo's existing client-component test
 * pattern, e.g. today-v2-visibility-group-client.test.tsx) — the badge only
 * renders inside the full shell context (usePathname + useShell), so we pin
 * the additive attribute at the source level rather than mounting the whole
 * shell.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SIDEBAR_SRC = readFileSync(
  resolve(__dirname, "app-sidebar.tsx"),
  "utf8",
);

describe("AppSidebar — #421 alert-badge accessible label", () => {
  it("gives the count badge an aria-label spelling out the meaning (not color+number alone)", () => {
    // The badge value is `badge`; the label must interpolate it.
    expect(SIDEBAR_SRC).toMatch(
      /aria-label=\{`\$\{badge\} need attention`\}/,
    );
  });

  it("still renders the visible count for sighted users", () => {
    // The numeric child is preserved alongside the new aria-label.
    const badgeBlock =
      SIDEBAR_SRC.split('aria-label={`${badge} need attention`}')[1] ?? "";
    expect(badgeBlock).toMatch(/\{badge\}/);
  });
});
