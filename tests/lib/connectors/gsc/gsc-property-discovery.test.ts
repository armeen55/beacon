/**
 * 2026-06-13 — GSC property auto-discovery (URL-prefix vs sc-domain).
 *
 * The sync used to derive `sc-domain:<domain>` and 403 when the account's
 * verified property was a URL-prefix (https://www.x.com/) — Iranopedia's real
 * property — pulling 0 rows nightly. These pin the picker + the sites.list
 * parse so the sync auto-selects the shape the token actually owns.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  pickGscPropertyForDomain,
  gscListSites,
  type GscSiteEntry,
} from "@/lib/connectors/gsc/search-analytics";

const owner = (siteUrl: string): GscSiteEntry => ({ siteUrl, permissionLevel: "siteOwner" });

describe("pickGscPropertyForDomain", () => {
  it("picks the URL-prefix property when that's what the account owns (Iranopedia)", () => {
    const sites = [owner("https://www.iranopedia.com/")];
    expect(pickGscPropertyForDomain(sites, "iranopedia.com")).toBe("https://www.iranopedia.com/");
    // tenant domain may carry protocol/www/trailing slash — still matches.
    expect(pickGscPropertyForDomain(sites, "https://www.iranopedia.com/")).toBe("https://www.iranopedia.com/");
  });

  it("prefers a domain property (broadest) when both shapes exist", () => {
    const sites = [owner("https://www.x.com/"), owner("sc-domain:x.com")];
    expect(pickGscPropertyForDomain(sites, "x.com")).toBe("sc-domain:x.com");
  });

  it("prefers the www URL-prefix over a non-www one", () => {
    const sites = [owner("https://x.com/"), owner("https://www.x.com/")];
    expect(pickGscPropertyForDomain(sites, "x.com")).toBe("https://www.x.com/");
  });

  it("skips unverified properties (can't read Search Analytics)", () => {
    const sites: GscSiteEntry[] = [{ siteUrl: "https://www.x.com/", permissionLevel: "siteUnverifiedUser" }];
    expect(pickGscPropertyForDomain(sites, "x.com")).toBeNull();
  });

  it("returns null when no verified property matches the domain", () => {
    expect(pickGscPropertyForDomain([owner("https://other.com/")], "x.com")).toBeNull();
    expect(pickGscPropertyForDomain([], "x.com")).toBeNull();
    expect(pickGscPropertyForDomain([owner("https://www.x.com/")], "")).toBeNull();
  });
});

describe("gscListSites", () => {
  const okFetch = (entries: unknown) =>
    (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ siteEntry: entries }),
    })) as unknown as typeof fetch;

  it("parses verified site entries", async () => {
    const sites = await gscListSites("tok", {
      fetchImpl: okFetch([
        { siteUrl: "https://www.iranopedia.com/", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:other.com", permissionLevel: "siteFullUser" },
        { permissionLevel: "siteOwner" }, // no siteUrl — dropped
      ]),
    });
    expect(sites).toEqual([
      { siteUrl: "https://www.iranopedia.com/", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:other.com", permissionLevel: "siteFullUser" },
    ]);
  });

  it("fail-soft to [] on non-2xx", async () => {
    const f = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await gscListSites("tok", { fetchImpl: f })).toEqual([]);
  });

  it("fail-soft to [] on network throw", async () => {
    const f = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await gscListSites("tok", { fetchImpl: f })).toEqual([]);
  });
});
