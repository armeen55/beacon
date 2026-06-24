import { describe, it, expect } from "vitest";
import {
  getBacklinkProvider,
  NoopBacklinkProvider,
  DataForSeoBacklinkProvider,
  computeLinkGaps,
  type BacklinkProfile,
} from "@/domains/link-authority/backlink-provider";

function profile(target: string, refs: [string, number][]): BacklinkProfile {
  return {
    target,
    referringDomains: refs.map(([domain, backlinks]) => ({ domain, rating: null, backlinks })),
    totalBacklinks: refs.reduce((s, [, n]) => s + n, 0),
    domainRating: null,
    source: "none",
    fetchedAt: null,
  };
}

describe("backlink-provider (L9, off by default)", () => {
  it("defaults to no-op unless flag + creds set; no paid call", async () => {
    expect(getBacklinkProvider({} as NodeJS.ProcessEnv).name).toBe("noop");
    const onlyFlag = getBacklinkProvider({ BEACON_BACKLINK_PROVIDER: "dataforseo" } as unknown as NodeJS.ProcessEnv);
    expect(onlyFlag.name).toBe("noop");
    const full = new DataForSeoBacklinkProvider({
      BEACON_BACKLINK_PROVIDER: "dataforseo",
      DATAFORSEO_LOGIN: "x",
      DATAFORSEO_PASSWORD: "y",
    } as unknown as NodeJS.ProcessEnv);
    expect(full.isConfigured()).toBe(true);
    expect(await full.getProfile("iranopedia.com")).toBeNull(); // gated, no live call
    expect(await new NoopBacklinkProvider().getProfile("x")).toBeNull();
  });

  it("computeLinkGaps: domains linking to competitors but not you, ranked by breadth", () => {
    const owned = profile("iranopedia.com", [["alreadylinks.com", 2]]);
    const comps = [
      profile("theknot.com", [["weddingblog.com", 5], ["alreadylinks.com", 1], ["pressmag.com", 2]]),
      profile("surfiran.com", [["weddingblog.com", 3], ["traveldir.com", 1]]),
    ];
    const gaps = computeLinkGaps(owned, comps);
    const domains = gaps.map((g) => g.domain);
    expect(domains).not.toContain("alreadylinks.com"); // you already have it
    expect(gaps[0]!.domain).toBe("weddingblog.com"); // links to 2 competitors → ranked first
    expect(gaps[0]!.linksToCompetitors).toBe(2);
    expect(domains).toEqual(expect.arrayContaining(["pressmag.com", "traveldir.com"]));
  });

  it("handles a null owned profile (you have no backlinks yet)", () => {
    const gaps = computeLinkGaps(null, [profile("c.com", [["x.com", 1]])]);
    expect(gaps.map((g) => g.domain)).toContain("x.com");
  });
});
