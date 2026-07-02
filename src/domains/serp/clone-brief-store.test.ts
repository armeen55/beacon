import { describe, it, expect } from "vitest";
import { writeCloneBriefResults, readCloneBriefResults, type StoredCloneBriefs } from "./clone-brief-store";
import type { CloneBrief } from "./clone-brief";

const brief = (url: string): CloneBrief => ({
  url,
  competitorDomain: "supplehomes.com",
  trafficWeight: 1900,
  whatWins: "FAQ schema · answer block",
  teardownStatus: "torn_down",
  demand: [{ keyword: "persian wedding sofreh", volume: 1900 }],
  coverageGaps: ["sofreh"],
  buildPointer: { label: "persian wedding sofreh", reason: "We do not have a page covering sofreh yet." },
  summary: "supplehomes.com earns an estimated 1,900 traffic-weighted points from this one page.",
});

const result = (over: Partial<StoredCloneBriefs> = {}): StoredCloneBriefs => ({
  tenant_id: "tenant-iranopedia",
  computed_at: "2026-07-02T00:00:00Z",
  briefs: [brief("https://supplehomes.com/sofreh-guide")],
  ...over,
});

function memory(initial: StoredCloneBriefs[] = []) {
  const state = { rows: initial };
  return {
    state,
    deps: {
      readRows: async () => state.rows,
      writeRows: async (rows: StoredCloneBriefs[]) => {
        state.rows = rows;
      },
    },
  };
}

const NOW = new Date("2026-07-10T00:00:00Z");

describe("clone-brief-store round-trip", () => {
  it("write then read returns the run", async () => {
    const m = memory();
    await writeCloneBriefResults(result(), m.deps);
    const r = await readCloneBriefResults("tenant-iranopedia", NOW, m.deps);
    expect(r?.briefs[0].url).toBe("https://supplehomes.com/sofreh-guide");
  });

  it("one row per tenant - a new run replaces the old, other tenants untouched", async () => {
    const m = memory([result({ tenant_id: "tenant-ritz", briefs: [brief("https://other.com/x")] })]);
    await writeCloneBriefResults(result(), m.deps);
    await writeCloneBriefResults(result({ computed_at: "2026-07-03T00:00:00Z", briefs: [brief("https://supplehomes.com/new")] }), m.deps);
    expect(m.state.rows).toHaveLength(2);
    const mine = await readCloneBriefResults("tenant-iranopedia", NOW, m.deps);
    expect(mine?.briefs[0].url).toBe("https://supplehomes.com/new");
    const theirs = await readCloneBriefResults("tenant-ritz", NOW, m.deps);
    expect(theirs?.briefs[0].url).toBe("https://other.com/x");
  });

  it("caps stored briefs at 25", async () => {
    const m = memory();
    const briefs = Array.from({ length: 40 }, (_, i) => brief(`https://supplehomes.com/p${i}`));
    await writeCloneBriefResults(result({ briefs }), m.deps);
    expect(m.state.rows[0].briefs).toHaveLength(25);
  });

  it("a run older than 30 days reads as null (honest staleness)", async () => {
    const m = memory([result({ computed_at: "2026-05-20T00:00:00Z" })]);
    expect(await readCloneBriefResults("tenant-iranopedia", NOW, m.deps)).toBeNull();
  });

  it("fail-soft: a throwing read -> null", async () => {
    const r = await readCloneBriefResults("tenant-iranopedia", NOW, {
      readRows: async () => {
        throw new Error("store down");
      },
    });
    expect(r).toBeNull();
  });
});
