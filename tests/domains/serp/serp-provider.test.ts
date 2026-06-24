import { describe, it, expect } from "vitest";
import {
  getSerpProvider,
  NoopSerpProvider,
  DataForSeoSerpProvider,
  rootDomain,
} from "@/domains/serp/serp-provider";

describe("serp-provider (L7, off by default)", () => {
  it("defaults to no-op when BEACON_SERP_PROVIDER is unset", async () => {
    const p = getSerpProvider({} as NodeJS.ProcessEnv);
    expect(p.name).toBe("noop");
    expect(p.isConfigured()).toBe(false);
    expect(await p.getSerp("anything")).toBeNull();
  });

  it("stays no-op when the provider is named but creds are missing (no live call)", () => {
    const p = getSerpProvider({ BEACON_SERP_PROVIDER: "dataforseo" } as unknown as NodeJS.ProcessEnv);
    expect(p.name).toBe("noop");
  });

  it("DataForSEO provider is configured only with flag + both creds", () => {
    const off = new DataForSeoSerpProvider({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" } as unknown as NodeJS.ProcessEnv);
    expect(off.isConfigured()).toBe(false); // flag not set
    const on = new DataForSeoSerpProvider({
      BEACON_SERP_PROVIDER: "dataforseo",
      DATAFORSEO_LOGIN: "x",
      DATAFORSEO_PASSWORD: "y",
    } as unknown as NodeJS.ProcessEnv);
    expect(on.isConfigured()).toBe(true);
  });

  it("getSerp returns null until the live fetch is operator-enabled (no paid call)", async () => {
    const on = new DataForSeoSerpProvider({
      BEACON_SERP_PROVIDER: "dataforseo",
      DATAFORSEO_LOGIN: "x",
      DATAFORSEO_PASSWORD: "y",
    } as unknown as NodeJS.ProcessEnv);
    expect(await on.getSerp("cities in iran")).toBeNull();
  });

  it("rootDomain strips scheme + www", () => {
    expect(rootDomain("https://www.theknot.com/x")).toBe("theknot.com");
    expect(rootDomain("surfiran.com/mag")).toBe("surfiran.com");
  });

  it("NoopSerpProvider is inert", async () => {
    const n = new NoopSerpProvider();
    expect(n.isConfigured()).toBe(false);
    expect(await n.getSerp("x")).toBeNull();
  });
});
