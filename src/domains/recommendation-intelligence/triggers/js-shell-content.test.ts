import { describe, expect, it } from "vitest";

import { jsShellContent, MAX_JS_SHELL_EMISSIONS } from "./js-shell-content";
import type { JsShellFinding } from "@/domains/lifecycle/js-shell";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function finding(over: Partial<JsShellFinding> = {}): JsShellFinding {
  return {
    url: "https://x.com/a",
    reason: "Your /a page's main content only appears after JavaScript runs.",
    evidence: "js_shell: test",
    ...over,
  };
}

describe("jsShellContent trigger", () => {
  it("emits nothing for an empty finding list (byte-identical)", () => {
    expect(
      jsShellContent({ tenantId: "t", findings: [], impressionsByUrl: new Map(), signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("emits a fix_page_experience card at confidence low (diagnostic-only, honest heuristic)", () => {
    const rows = jsShellContent({
      tenantId: "t",
      findings: [finding({ url: "https://x.com/app" })],
      impressionsByUrl: new Map([["https://x.com/app", 300]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("fix_page_experience");
    expect(rows[0]!.confidence).toBe("low");
    expect(rows[0]!.trigger_signal).toBe("js_shell_content");
    expect(rows[0]!.target_url).toBe("https://x.com/app");
    expect(rows[0]!.customer_copy).toContain("only appears after JavaScript runs");
  });

  it("ranks by demand and caps at MAX_JS_SHELL_EMISSIONS", () => {
    const findings: JsShellFinding[] = [];
    const impressions = new Map<string, number>();
    for (let i = 0; i < MAX_JS_SHELL_EMISSIONS + 3; i++) {
      const url = `https://x.com/p${i}`;
      findings.push(finding({ url }));
      impressions.set(url, i);
    }
    const rows = jsShellContent({ tenantId: "t", findings, impressionsByUrl: impressions, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(MAX_JS_SHELL_EMISSIONS);
    expect(rows[0]!.target_url).toBe(`https://x.com/p${MAX_JS_SHELL_EMISSIONS + 2}`);
  });
});
