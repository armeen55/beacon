import { describe, it, expect } from "vitest";
import { getCuratedSourceDomains } from "./tenant-source-allowlist";

describe("getCuratedSourceDomains (G7)", () => {
  it("returns Iranopedia's curated allowlist (the pilot's + standing references)", () => {
    const list = getCuratedSourceDomains("tenant-iranopedia");
    expect(list).toBeDefined();
    for (const d of ["wikipedia.org", "britannica.com", "unesco.org", "iranicaonline.org"]) {
      expect(list).toContain(d);
    }
  });

  it("returns undefined for any non-curated tenant (empty-allowlist behavior unchanged)", () => {
    expect(getCuratedSourceDomains("tenant-other")).toBeUndefined();
    expect(getCuratedSourceDomains("tenant-ritz-founder")).toBeUndefined();
    expect(getCuratedSourceDomains("")).toBeUndefined();
  });

  it("returns a fresh copy each call (a caller can never mutate the shared constant)", () => {
    const a = getCuratedSourceDomains("tenant-iranopedia")!;
    a.push("attacker.example");
    const b = getCuratedSourceDomains("tenant-iranopedia")!;
    expect(b).not.toContain("attacker.example");
  });
});
