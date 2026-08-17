import { describe, expect, it, vi, beforeEach } from "vitest";

const checks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real, readFactChecks: async () => checks.rows };
});

import { factualDefectCards } from "@/domains/decision/producers/factual-defects";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";

const NOW = new Date("2026-08-17T00:00:00.000Z");
const PAGE = "https://x.example/persian-female-first-names";
const snapshot = { scope: { site: "x.example" }, ownedPages: [{ url: PAGE, search: { impressions90d: 100 } }] } as unknown as EvidenceSnapshot;

const check = (over: Record<string, unknown> = {}) => ({
  page: "/persian-female-first-names", subject: "Afsaneh", current: "Goddess, divine and strong.",
  proposed: "Legend, myth, fable in Persian.", language: "Persian", literal: "legend", usage: null,
  sources: [{ url: "https://www.behindthename.com/name/afsaneh", kind: "dictionary", says: "legend" },
    { url: "https://en.wiktionary.org/wiki/افسانه", kind: "dictionary", says: "fable" }],
  agreement: "multiple_agree", confidence: "confirmed", verdict: "page_wrong", alsoAt: [], note: "",
  checkedAt: "2026-08-17T00:00:00.000Z", ...over });

describe("a page's own statements against their sources", () => {
  beforeEach(() => { checks.rows = []; });

  it("mints the same card twice from the same banked checks, so a pass never overwrites the last one", async () => {
    checks.rows = [check()];
    const a = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    const b = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(a.cards).toHaveLength(1);
    expect(JSON.stringify(a.cards)).toBe(JSON.stringify(b.cards)); // deterministic: the store is the author
    expect(a.cards[0]!.id).toBe("t::/persian-female-first-names::existing_edit::factual_correction");
    expect(a.cards[0]!.bundle!.components[0]).toMatchObject({ kind: "factual_correction", before: "Goddess, divine and strong.", after: "Legend, myth, fable in Persian." });
  });

  it("refuses to replace published words on anything less than a confirmed, source-backed contradiction", async () => {
    checks.rows = [check({ confidence: "likely" }), check({ subject: "Ava", confidence: "disputed" }),
      check({ subject: "Sholeen", confidence: "unsupported", proposed: null }),
      check({ subject: "Negar", verdict: "page_correct" }),
      check({ subject: "Mona", sources: [{ url: "https://babynames.example/mona", kind: "babyname", says: "beautiful" }] })];
    const run = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(run.cards).toHaveLength(0); // nothing authorized is nothing minted, never a card with a guess on it
  });

  it("says what it is holding back and never claims the loss belongs to it", async () => {
    checks.rows = [check(), check({ subject: "Ava", confidence: "disputed", proposed: "Voice, sound" }),
      check({ subject: "Sholeen", confidence: "unsupported", proposed: null })];
    const card = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!;
    expect(card.diagnosisCause).toBe("factual_error");
    expect(card.impactScore).toBeNull(); // an accuracy defect claims no clicks
    expect(card.causeFinding!.notConsidered.map((x) => x.cause)).toContain("ranking_loss");
    expect(card.bundle!.risks.join(" ")).toContain("1 more entries are contested");
    expect(card.bundle!.receipt.missing.join(" ")).toContain("Sholeen");
  });

  it("mints nothing for a page this account does not own", async () => {
    checks.rows = [check({ page: "/not-mine" })];
    expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0);
  });
});
