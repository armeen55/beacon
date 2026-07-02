import { describe, it, expect } from "vitest";
import { dedupeFactoryCandidates } from "./dedupe-candidates";
import type { PageCandidate } from "./entity-attribute-factory";
import type { FactoryBatchRecord } from "./batch-store";

function candidate(overrides: Partial<PageCandidate> = {}): PageCandidate {
  return {
    slug: "nowruz-meaning",
    title: "Nowruz Meaning",
    entity: "nowruz",
    attribute: "meaning",
    intent: "definitional",
    relevance: 1,
    needsDemandValidation: true,
    why: "test",
    ...overrides,
  };
}

describe("dedupeFactoryCandidates", () => {
  it("passes through a candidate with no conflicts", () => {
    const out = dedupeFactoryCandidates([candidate()], [], []);
    expect(out).toHaveLength(1);
  });

  it("drops a candidate whose slug already appears in a prior week's batch (any status)", () => {
    const prior: FactoryBatchRecord = {
      tenant_id: "t1",
      weekOf: "2026-06-22",
      items: [
        {
          slug: "nowruz-meaning",
          title: "Nowruz Meaning",
          entity: "nowruz",
          attribute: "meaning",
          matchedKeyword: null,
          searchVolume: null,
          demandSource: "graph_demand",
          why: "x",
          status: "skipped",
          targetUrl: null,
          costUsd: 0,
          updatedAt: new Date().toISOString(),
        },
      ],
      queuedForKeywordBatch: [],
      totalCostUsd: 0,
      generatedAt: new Date().toISOString(),
    };
    const out = dedupeFactoryCandidates([candidate()], [], [prior]);
    expect(out).toHaveLength(0);
  });

  it("drops a candidate already tracked as an open demand-graph Move", () => {
    const out = dedupeFactoryCandidates(
      [candidate({ entity: "nowruz", title: "Nowruz Meaning" })],
      [{ label: "Nowruz Meaning Explained", gap: "create_page" }],
      [],
    );
    expect(out).toHaveLength(0);
  });

  it("keeps a candidate whose entity is unrelated to any tracked Move", () => {
    const out = dedupeFactoryCandidates(
      [candidate({ entity: "mehregan", title: "Mehregan History", slug: "mehregan-history" })],
      [{ label: "Nowruz Persian New Year", gap: "create_page" }],
      [],
    );
    expect(out).toHaveLength(1);
  });

  it("keeps a candidate from a DIFFERENT week's slug even if similarly named", () => {
    const prior: FactoryBatchRecord = {
      tenant_id: "t1",
      weekOf: "2026-06-15",
      items: [],
      queuedForKeywordBatch: [{ slug: "other-slug", title: "Other" }],
      totalCostUsd: 0,
      generatedAt: new Date().toISOString(),
    };
    const out = dedupeFactoryCandidates([candidate()], [], [prior]);
    expect(out).toHaveLength(1);
  });
});
