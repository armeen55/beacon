import { describe, it, expect } from "vitest";
import { teardownView } from "@/domains/demand-graph/teardown-state";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

function comp(over: Partial<EvidencePacket["competitor"]>): EvidencePacket["competitor"] {
  return {
    topUrl: "https://c.com/x", domain: "c.com", fetchStatus: "ok", facts: null,
    whatWins: "", relevance: 1, looselyMatched: false, otherUrls: [], ...over,
  } as EvidencePacket["competitor"];
}

describe("teardownView — honest states (no bare —)", () => {
  it("real teardown → torn_down with the facts", () => {
    const v = teardownView(comp({ facts: {} as never, whatWins: "answer block · 3.6k words" }));
    expect(v.state).toBe("torn_down");
    expect(v.text).toContain("3.6k words");
  });
  it("loosely matched → off-topic, not a teardown", () => {
    const v = teardownView(comp({ looselyMatched: true }));
    expect(v.state).toBe("loosely_matched");
    expect(v.text.toLowerCase()).toContain("off-topic");
  });
  it("blocked_robots → blocks crawlers (will never auto-audit)", () => {
    const v = teardownView(comp({ fetchStatus: "blocked_robots" }));
    expect(v.state).toBe("blocked");
    expect(v.text.toLowerCase()).toContain("blocks crawlers");
  });
  it("http_error → page didn't load", () => {
    const v = teardownView(comp({ fetchStatus: "http_error" }));
    expect(v.state).toBe("errored");
    expect(v.text.toLowerCase()).toContain("didn't load");
  });
  it("not_audited → not analyzed yet", () => {
    const v = teardownView(comp({ fetchStatus: "not_audited" }));
    expect(v.state).toBe("not_audited");
    expect(v.text.toLowerCase()).toContain("not analyzed yet");
  });
  it("no competitor → you can own it", () => {
    expect(teardownView(null).state).toBe("none");
    expect(teardownView(comp({ domain: null })).state).toBe("none");
  });
});
