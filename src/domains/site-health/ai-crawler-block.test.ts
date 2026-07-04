import { describe, expect, it } from "vitest";

import { detectAiCrawlerBlock } from "./ai-crawler-block";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

/** Build an indexability record whose robots signals we control. Anything not
 *  overridden defaults to `true` (allowed) so the "all clear" case is the base. */
function idx(
  robots: Partial<OwnedUrlIndexability["signals"]["robots_txt"]>,
): Pick<OwnedUrlIndexability, "signals"> {
  return {
    signals: {
      sitemap_membership: { in_sitemap: true, sitemap_url: null },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
        ...robots,
      },
      page_snapshot: null,
      gsc: null,
    },
  };
}

describe("detectAiCrawlerBlock", () => {
  it("returns null when every crawler is allowed (empty-safe)", () => {
    expect(detectAiCrawlerBlock(idx({}))).toBeNull();
  });

  it("returns null when signals are unknown (allowed === null, not false)", () => {
    expect(
      detectAiCrawlerBlock(
        idx({
          gptbot_allowed: null,
          claudebot_allowed: null,
          perplexitybot_allowed: null,
          google_extended_allowed: null,
          googlebot_allowed: null,
        }),
      ),
    ).toBeNull();
  });

  it("names exactly which AI assistants are blocked (GPTBot + ClaudeBot)", () => {
    const fact = detectAiCrawlerBlock(
      idx({ gptbot_allowed: false, claudebot_allowed: false }),
    );
    expect(fact).not.toBeNull();
    expect(fact!.aiBlockedCount).toBe(2);
    expect(fact!.googleBlocked).toBe(false);
    expect(fact!.blocked.map((b) => b.bot)).toEqual(["GPTBot", "ClaudeBot"]);
    // The plainly-named bots appear in the customer sentence.
    expect(fact!.headline).toContain("GPTBot");
    expect(fact!.headline).toContain("ClaudeBot");
    expect(fact!.headline).toContain("AI assistants not to read it");
    expect(fact!.headline).toContain("can never recommend you");
    expect(fact!.headline).toContain("Unblock them.");
  });

  it("uses singular verb when exactly one AI assistant is blocked", () => {
    const fact = detectAiCrawlerBlock(idx({ perplexitybot_allowed: false }));
    expect(fact!.headline).toContain("Perplexity (PerplexityBot) is blocked");
  });

  it("names Google's crawler when googlebot is blocked (Google-only case)", () => {
    const fact = detectAiCrawlerBlock(idx({ googlebot_allowed: false }));
    expect(fact!.googleBlocked).toBe(true);
    expect(fact!.aiBlockedCount).toBe(0);
    expect(fact!.headline).toContain("Google's crawler (Googlebot)");
    expect(fact!.headline).toContain("Google's crawler not to read it");
  });

  it("names both AI assistants and Google when all are blocked", () => {
    const fact = detectAiCrawlerBlock(
      idx({
        gptbot_allowed: false,
        claudebot_allowed: false,
        perplexitybot_allowed: false,
        google_extended_allowed: false,
        googlebot_allowed: false,
      }),
    );
    expect(fact!.aiBlockedCount).toBe(4);
    expect(fact!.googleBlocked).toBe(true);
    expect(fact!.blocked).toHaveLength(5);
    expect(fact!.headline).toContain("both AI assistants and Google's crawler");
    expect(fact!.headline).toContain("Googlebot");
  });

  it("carries an operator-evidence trace with the raw booleans", () => {
    const fact = detectAiCrawlerBlock(idx({ gptbot_allowed: false }));
    expect(fact!.operatorEvidence).toContain("gptbot_allowed=false");
    expect(fact!.operatorEvidence).toContain("blocked=GPTBot");
  });

  it("emits no em or en dashes in the customer sentence", () => {
    const fact = detectAiCrawlerBlock(
      idx({ gptbot_allowed: false, googlebot_allowed: false }),
    );
    expect(fact!.headline).not.toMatch(/[–—]/);
  });
});
