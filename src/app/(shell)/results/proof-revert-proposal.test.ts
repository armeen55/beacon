import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Item 11 (2026-07-02) - source pins for the "Put the old version back"
 * proposal on the Results page. Revised 2026-07-09 per the operator product
 * spec E-36: "NEVER auto-revert; ask first". The surface wiring is plain JSX
 * + server compute, so these pins assert the load-bearing structure directly:
 *
 *   - the page derives eligibility from the SHARED revert policy (decideRevert
 *     + resolveRevertSource + the autopilot config), operator-gated,
 *   - the row renders the one-click restore button + the reason sentence,
 *     and never claims an automatic push is coming,
 *   - a restored row is badged instead of re-offered (idempotent surface),
 *   - the client button calls the operator-gated server action, and the
 *     action ships ONLY through the revert executor (executePush path).
 *
 * If any of these pins break, the proposal surface silently regressed.
 */

const read = (file: string): string =>
  (file === "page.tsx" ? [file, "results-ledger-card.tsx"] : [file])
    .map((name) => readFileSync(resolve(__dirname, name), "utf8"))
    .join("\n");

describe("proof revert proposal - source pins (item 11)", () => {
  it("page.tsx derives eligibility from the shared revert policy, operator-gated", () => {
    const src = read("page.tsx");
    expect(src).toContain('from "@/domains/autopilot/revert-policy"');
    expect(src).toContain('from "@/domains/autopilot/run-revert"');
    expect(src).toContain("decideRevert(");
    expect(src).toContain("resolveRevertSource(");
    expect(src).toContain("getAutopilotConfig()");
    expect(src).toContain("snapshotAvailable: source != null");
    // Operator-only compute (the action re-gates server side regardless).
    expect(src).toMatch(/if \(isOperator\) \{[\s\S]*?negativeRows/);
    // Only negative readings with a closed window get the (bounded) lookup.
    // Review fix 1 (2026-07-11): the revert OFFER is a protective brake, so its
    // direction reads the RAW stored verdict (directionOf), never the
    // calibration-aware presentation - the quarantine removes unearned trust in
    // wins, it must never remove caution on a possible loss.
    expect(src).toContain('directionOf(l.verdict) === "negative"');
    expect(src).toContain("direction: directionOf(rec.verdict)");
    expect(src).toContain("(p.basisDay ?? 0) >= 7");
  });

  it("page.tsx renders the restore button and the reason sentence, never an auto-push forewarning", () => {
    const src = read("page.tsx");
    expect(src).toContain("<RestoreOldVersionButton recordId={rec.id} />");
    expect(src).toContain("{revert.reason}");
    // E-36 confirmation-required pin: no branch may claim Beacon will push a
    // revert on its own. If this text reappears, the auto-execute path is
    // back and this test must fail.
    expect(src).not.toContain('"auto_revert"');
    expect(src).not.toContain("I will put the old version back tonight");
  });

  it("page.tsx badges an already-restored row instead of re-offering (idempotent surface)", () => {
    const src = read("page.tsx");
    expect(src).toContain("hasRevertNote(l)");
    expect(src).toContain("The old version is back on this page.");
    // The restored badge branch comes BEFORE the proposal branch.
    expect(src.indexOf("The old version is back on this page.")).toBeLessThan(
      src.indexOf("<RestoreOldVersionButton"),
    );
  });

  it("the client button calls the operator-gated server action", () => {
    const src = read("proof-ledger-client.tsx");
    expect(src).toContain("export function RestoreOldVersionButton");
    expect(src).toContain("restoreOldVersionAction({ id: recordId })");
    expect(src).toContain("Put the old version back");
  });

  it("the server action executes ONLY through the revert executor (executePush path)", () => {
    const src = read("actions.ts");
    expect(src).toContain("export async function restoreOldVersionAction");
    expect(src).toMatch(/restoreOldVersionAction[\s\S]{0,400}isOperatorModeServer\(\)/);
    expect(src).toContain("evaluateRevertDecisionForRecord");
    expect(src).toContain("runRevertForProofRecord");
    // No direct adapter or CMS write from the action itself.
    const actionBody = src.slice(src.indexOf("export async function restoreOldVersionAction"));
    const nextExport = actionBody.indexOf("export async function", 10);
    const body = nextExport > 0 ? actionBody.slice(0, nextExport) : actionBody;
    expect(body).not.toContain("wix");
    expect(body).not.toContain("executePush(");
  });
});
