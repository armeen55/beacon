import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EarlySignalPill } from "./early-signal-pill";
import {
  VERDICT_LABEL,
  type VerdictLabel,
} from "@/domains/attribution/url-verdict";

const NON_WEAK_VERDICTS: VerdictLabel[] = [
  "helping",
  "hurting",
  "nothing_yet",
  "too_early",
  "not_enough_data",
  "not_enough_native_baseline",
  "not_implemented",
];

describe("EarlySignalPill", () => {
  it("renders the operator-locked customer-safe label when verdict is weak_signal", () => {
    const html = renderToStaticMarkup(<EarlySignalPill verdict="weak_signal" />);
    expect(html).toContain(VERDICT_LABEL.weak_signal);
    expect(html).toContain("Early signs of lift");
    expect(html).toContain('data-early-signal-pill="true"');
  });

  it("renders null for every non-weak_signal verdict", () => {
    for (const v of NON_WEAK_VERDICTS) {
      const html = renderToStaticMarkup(<EarlySignalPill verdict={v} />);
      expect(html, `expected null render for verdict=${v}, got: ${html}`).toBe(
        "",
      );
    }
  });

  it("renders null when verdict is null or undefined", () => {
    expect(renderToStaticMarkup(<EarlySignalPill verdict={null} />)).toBe("");
    expect(renderToStaticMarkup(<EarlySignalPill verdict={undefined} />)).toBe(
      "",
    );
  });

  it("never claims the change is proven (no 'win', 'proven', 'validated', 'confirmed')", () => {
    const html = renderToStaticMarkup(<EarlySignalPill verdict="weak_signal" />);
    const lower = html.toLowerCase();
    // Word-boundary check on "win" — the substring "win" legitimately
    // appears inside "window" (the tooltip references the post-change
    // window). Forbid the noun/verb forms only.
    expect(lower).not.toMatch(/\bwin\b/);
    expect(lower).not.toMatch(/\bwon\b/);
    expect(lower).not.toMatch(/\bwinning\b/);
    expect(lower).not.toContain("proven");
    expect(lower).not.toContain("validated");
    expect(lower).not.toContain("confirmed");
  });

  it("uses an amber/warning tone, not success/green", () => {
    const html = renderToStaticMarkup(<EarlySignalPill verdict="weak_signal" />);
    expect(html).toContain("amber");
    expect(html).not.toContain("success");
  });

  it("compact prop tightens padding", () => {
    const compactHtml = renderToStaticMarkup(
      <EarlySignalPill verdict="weak_signal" compact />,
    );
    const fullHtml = renderToStaticMarkup(
      <EarlySignalPill verdict="weak_signal" />,
    );
    expect(compactHtml).toContain("px-1.5");
    expect(fullHtml).toContain("px-2");
  });
});
