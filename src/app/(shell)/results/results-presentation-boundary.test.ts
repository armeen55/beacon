import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
const cards = readFileSync(resolve(__dirname, "results-ledger-card.tsx"), "utf8");

describe("Results server/presentation boundary", () => {
  it("keeps the route focused on orchestration and delegates ledger cards", () => {
    expect(page).toContain('from "./results-ledger-card"');
    expect(page).toContain("<LedgerRowGroup");
    expect(page.split("\n").length).toBeLessThan(1_200);
  });

  it("keeps the card renderer synchronous and free of persistence or request context", () => {
    expect(cards).toContain("export function LedgerRowGroup");
    expect(cards).not.toMatch(/getRepository|currentTenantId|from "next\/server"/);
    expect(cards).not.toMatch(/async function|await /);
  });

  it("keeps compound edits attributed to the package instead of an individual lever", () => {
    expect(cards).toContain("Measured as one {compound.changeCount}-change package");
    expect(cards).toContain("This page-level result belongs to the combination");
    expect(cards).toContain("Beacon will not credit either edit alone");
  });
});
