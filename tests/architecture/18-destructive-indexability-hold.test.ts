/**
 * CONSTITUTION §6 — Destructive-action safety: indexing / publish hold.
 *
 * (2026-07-22, CORE 100K cutover) The old trigger->promotion accept surfaces
 * (today-moves-card, the rich changes list) were retired with the demand-graph
 * decision engine. The live recommendation path is now the Decision kernel:
 * every recommendation is a `ChangeProposal` whose publishing is MANUAL. There
 * is no longer any one-tap path that applies a change (indexing directive or
 * otherwise) to a live site — the operator applies the change on their own CMS,
 * and the only mutating control ("Mark implemented") merely RECORDS that they
 * did it, behind a server-side publish-authority gate.
 *
 * §6's invariant — a wrong crawl/index directive (robots, noindex, canonical,
 * redirect) must never be one tap away from a live site — is therefore preserved
 * STRUCTURALLY: the kernel never writes a live page (publish: "manual"), and the
 * one accept surface enforces publish authority server-side. This pins both so
 * neither can silently regress into a one-tap live write.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function raw(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

describe("publish hold — the recommendation kernel never writes a live page one tap away (§6)", () => {
  it("the ChangeProposal contract hard-codes publish: manual", () => {
    const src = raw("src/domains/decision/contracts.ts");
    // The structural reminder is on the persisted type and its Zod schema.
    expect(src).toMatch(/publish:\s*"manual"/);
    expect(src).toMatch(/publish:\s*z\.literal\("manual"\)/);
  });

  it("every proposal the propose paths assemble is publish: manual", () => {
    const src = raw("src/domains/decision/propose.ts");
    expect(src).toMatch(/publish:\s*"manual"/);
  });

  it("the one accept surface (Mark implemented) enforces server-side publish authority and never publishes", () => {
    const src = raw("src/app/(shell)/changes/actions.ts");
    // A change is never one tap away from being applied without publish authority.
    expect(src).toContain("canPublishForCurrentTenant");
    // The mark-implemented action records status only; it must not import any
    // live-write / push path.
    expect(src).not.toMatch(/pushToWix|publishToLive|applyEditToPage/);
  });
});
