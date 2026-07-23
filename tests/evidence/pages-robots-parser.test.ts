import { describe, it, expect } from "vitest";
import {
  parseRobotsText,
  evaluateRulesForPath,
  evaluateAiBotAccess,
  evaluateGooglebotAccess,
  findBlockedOwnedUrls,
  AI_CRAWLERS,
} from "@/domains/pages/robots-parser";

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

// ─────────────────────────────────────────────────────────────────────
// Phase A.3 Step 3a — evaluateGooglebotAccess
// ─────────────────────────────────────────────────────────────────────

describe("evaluateGooglebotAccess", () => {
  it("returns default-allow when robots.txt has no directives (404 fetch)", () => {
    const r = parseRobotsText("", "x", 404);
    const v = evaluateGooglebotAccess(r, "/services/kitchens");
    expect(v.allowed).toBe(true);
    expect(v.matchedRule).toBeNull();
  });

  it("returns default-allow when robots.txt has only a wildcard block with empty Disallow", () => {
    const r = parseRobotsText("User-agent: *\nDisallow:", "x", 200);
    const v = evaluateGooglebotAccess(r, "/locations/palo-alto");
    expect(v.allowed).toBe(true);
  });

  it("blocks Googlebot when an explicit Googlebot block disallows the path", () => {
    const text = [
      "User-agent: Googlebot",
      "Disallow: /private/",
      "",
      "User-agent: *",
      "Disallow:",
    ].join("\n");
    const r = parseRobotsText(text, "x", 200);
    const v = evaluateGooglebotAccess(r, "/private/report");
    expect(v.allowed).toBe(false);
    expect(v.matchedRule?.kind).toBe("disallow");
  });

  it("allows Googlebot on a non-blocked path even when other paths are disallowed", () => {
    const text = [
      "User-agent: Googlebot",
      "Disallow: /private/",
    ].join("\n");
    const r = parseRobotsText(text, "x", 200);
    const v = evaluateGooglebotAccess(r, "/services/kitchens");
    expect(v.allowed).toBe(true);
  });

  it("honors longest-prefix Allow override inside the Googlebot block", () => {
    // Disallow /private/ but explicitly Allow /private/public/ — the
    // Allow rule is longer and should win.
    const text = [
      "User-agent: Googlebot",
      "Disallow: /private/",
      "Allow: /private/public/",
    ].join("\n");
    const r = parseRobotsText(text, "x", 200);
    expect(
      evaluateGooglebotAccess(r, "/private/secret").allowed,
    ).toBe(false);
    expect(
      evaluateGooglebotAccess(r, "/private/public/page").allowed,
    ).toBe(true);
  });

  it("falls back to the * block when no Googlebot-specific block exists", () => {
    const text = [
      "User-agent: *",
      "Disallow: /admin/",
    ].join("\n");
    const r = parseRobotsText(text, "x", 200);
    expect(
      evaluateGooglebotAccess(r, "/admin/dashboard").allowed,
    ).toBe(false);
    expect(
      evaluateGooglebotAccess(r, "/services/kitchens").allowed,
    ).toBe(true);
  });

  it("prefers the explicit Googlebot block over the * fallback", () => {
    // The * block disallows /admin/. The Googlebot-specific block
    // does NOT disallow it — and the specific block wins.
    const text = [
      "User-agent: *",
      "Disallow: /admin/",
      "",
      "User-agent: Googlebot",
      "Disallow:",
    ].join("\n");
    const r = parseRobotsText(text, "x", 200);
    const v = evaluateGooglebotAccess(r, "/admin/dashboard");
    expect(v.allowed).toBe(true);
  });

  it("matches the User-agent case-insensitively (lowercase + mixed-case)", () => {
    for (const agent of ["googlebot", "GoogleBot"]) {
      const r = parseRobotsText([`User-agent: ${agent}`, "Disallow: /private/"].join("\n"), "x", 200);
      expect(evaluateGooglebotAccess(r, "/private/report").allowed).toBe(false);
    }
  });

  it("Googlebot and AI-crawler evaluation are independent (each sees its own block, or the * rule)", () => {
    // Googlebot-only block: AI bots fall through to default allow, Googlebot is blocked.
    const gbOnly = parseRobotsText(["User-agent: Googlebot", "Disallow: /private/"].join("\n"), "x", 200);
    const aiUnblocked = evaluateAiBotAccess(gbOnly, "/private/report");
    expect(aiUnblocked.anyDisallowed).toBe(false);
    for (const crawler of AI_CRAWLERS) expect(aiUnblocked.perCrawler[crawler].allowed).toBe(true);
    expect(evaluateGooglebotAccess(gbOnly, "/private/report").allowed).toBe(false);

    // * block disallows /admin/, Googlebot carves an exception for itself; AI bots still see the * rule.
    const withStar = parseRobotsText(["User-agent: *", "Disallow: /admin/", "", "User-agent: Googlebot", "Disallow:"].join("\n"), "x", 200);
    expect(evaluateGooglebotAccess(withStar, "/admin/dashboard").allowed).toBe(true);
    expect(evaluateAiBotAccess(withStar, "/admin/dashboard").anyDisallowed).toBe(true);
  });
});
