import { describe, it, expect } from "vitest";
import {
  parseRobotsText,
  evaluateRulesForPath,
  evaluateAiBotAccess,
  findBlockedOwnedUrls,
  AI_CRAWLERS,
} from "./robots-parser";

describe("parseRobotsText", () => {
  it("parses an empty file as zero directives", () => {
    const r = parseRobotsText("", "https://x.com/robots.txt", 404);
    expect(r.directives).toEqual([]);
    expect(r.sitemaps).toEqual([]);
  });

  it("parses a permissive wildcard block", () => {
    const text = `User-agent: *\nDisallow:`;
    const r = parseRobotsText(text, "https://x.com/robots.txt", 200);
    expect(r.directives).toHaveLength(1);
    expect(r.directives[0].userAgent).toBe("*");
    // "Disallow:" with empty value becomes allow / per REP.
    expect(r.directives[0].rules[0].kind).toBe("allow");
    expect(r.directives[0].rules[0].pattern).toBe("/");
  });

  it("parses multiple directive blocks separated by User-agent", () => {
    const text = `
User-agent: *
Disallow: /admin/

User-agent: GPTBot
Disallow: /
`;
    const r = parseRobotsText(text, "https://x.com/robots.txt", 200);
    expect(r.directives).toHaveLength(2);
    const gpt = r.directives.find((d) => d.userAgent === "GPTBot");
    expect(gpt).toBeDefined();
    expect(gpt!.rules[0]).toEqual({ kind: "disallow", pattern: "/" });
  });

  it("groups consecutive User-agent lines that share the same rules", () => {
    const text = `
User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /private/
`;
    const r = parseRobotsText(text, "https://x.com/robots.txt", 200);
    expect(r.directives).toHaveLength(2);
    const agents = r.directives.map((d) => d.userAgent).sort();
    expect(agents).toEqual(["ClaudeBot", "GPTBot"]);
  });

  it("collects Sitemap: lines", () => {
    const text = `
Sitemap: https://x.com/sitemap.xml
Sitemap: https://x.com/news.xml
`;
    const r = parseRobotsText(text, "https://x.com/robots.txt", 200);
    expect(r.sitemaps).toEqual([
      "https://x.com/sitemap.xml",
      "https://x.com/news.xml",
    ]);
  });

  it("strips comments and blank lines", () => {
    const text = `
# comment line
User-agent: *  # inline comment
Disallow: /x  # another
`;
    const r = parseRobotsText(text, "https://x.com/robots.txt", 200);
    expect(r.directives[0].rules).toEqual([{ kind: "disallow", pattern: "/x" }]);
  });
});

describe("evaluateRulesForPath (longest-prefix-match)", () => {
  it("returns allowed=true with no match when no rules apply", () => {
    const r = evaluateRulesForPath([{ kind: "disallow", pattern: "/admin" }], "/about");
    expect(r.allowed).toBe(true);
    expect(r.matchedRule).toBeNull();
  });

  it("returns the longest matching rule wins", () => {
    const rules = [
      { kind: "disallow" as const, pattern: "/admin/" },
      { kind: "allow" as const, pattern: "/admin/public/" },
    ];
    expect(evaluateRulesForPath(rules, "/admin/public/doc").allowed).toBe(true);
    expect(evaluateRulesForPath(rules, "/admin/secret").allowed).toBe(false);
  });

  it("on tie, Allow beats Disallow (Google parser behavior)", () => {
    const rules = [
      { kind: "disallow" as const, pattern: "/x" },
      { kind: "allow" as const, pattern: "/x" },
    ];
    expect(evaluateRulesForPath(rules, "/x").allowed).toBe(true);
  });

  it("supports * wildcard", () => {
    const rules = [{ kind: "disallow" as const, pattern: "/*.json" }];
    expect(evaluateRulesForPath(rules, "/api/foo.json").allowed).toBe(false);
    expect(evaluateRulesForPath(rules, "/api/foo.html").allowed).toBe(true);
  });

  it("supports $ end-anchor", () => {
    const rules = [{ kind: "disallow" as const, pattern: "/foo$" }];
    expect(evaluateRulesForPath(rules, "/foo").allowed).toBe(false);
    expect(evaluateRulesForPath(rules, "/foo/bar").allowed).toBe(true);
  });
});

describe("evaluateAiBotAccess", () => {
  it("all AI crawlers allowed when robots.txt is fully permissive", () => {
    const r = parseRobotsText("User-agent: *\nDisallow:", "x", 200);
    const v = evaluateAiBotAccess(r, "/locations/palo-alto");
    expect(v.anyDisallowed).toBe(false);
    expect(v.blockedCrawlers).toEqual([]);
    for (const bot of AI_CRAWLERS) {
      expect(v.perCrawler[bot].allowed).toBe(true);
    }
  });

  it("detects GPTBot-specific block overriding wildcard allow", () => {
    const text = `
User-agent: *
Disallow:

User-agent: GPTBot
Disallow: /
`;
    const r = parseRobotsText(text, "x", 200);
    const v = evaluateAiBotAccess(r, "/locations/palo-alto");
    expect(v.anyDisallowed).toBe(true);
    expect(v.blockedCrawlers).toContain("GPTBot");
    expect(v.perCrawler.GPTBot.allowed).toBe(false);
    // Other bots fall back to wildcard → allowed
    expect(v.perCrawler.PerplexityBot.allowed).toBe(true);
    expect(v.perCrawler.ClaudeBot.allowed).toBe(true);
  });

  it("detects path-specific block — /admin blocks all bots, /locations still allowed", () => {
    const text = `User-agent: *\nDisallow: /admin/`;
    const r = parseRobotsText(text, "x", 200);
    expect(
      evaluateAiBotAccess(r, "/locations/palo-alto").anyDisallowed,
    ).toBe(false);
    expect(evaluateAiBotAccess(r, "/admin/reports").anyDisallowed).toBe(true);
  });

  it("treats missing robots.txt (404) as fully permissive", () => {
    const r = parseRobotsText("", "x", 404);
    const v = evaluateAiBotAccess(r, "/services/kitchens");
    expect(v.anyDisallowed).toBe(false);
  });
});

describe("findBlockedOwnedUrls", () => {
  it("returns only paths with at least one AI bot disallowed", () => {
    const text = `
User-agent: *
Disallow:

User-agent: GPTBot
Disallow: /private/
`;
    const r = parseRobotsText(text, "x", 200);
    const blocked = findBlockedOwnedUrls(r, [
      "/locations/atherton",
      "/private/hidden",
      "https://ritz.com/private/legal",
      "/about",
    ]);
    expect(blocked).toHaveLength(2);
    expect(blocked.map((b) => b.path)).toEqual(
      expect.arrayContaining(["/private/hidden", "/private/legal"]),
    );
    for (const v of blocked) {
      expect(v.blockedCrawlers).toContain("GPTBot");
    }
  });

  it("returns empty array when every path is allowed by every bot", () => {
    const r = parseRobotsText("User-agent: *\nDisallow:", "x", 200);
    const blocked = findBlockedOwnedUrls(r, ["/a", "/b", "/c"]);
    expect(blocked).toEqual([]);
  });
});
