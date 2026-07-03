import { describe, expect, it } from "vitest";

import { entityInterlink } from "./entity-interlink";
import type { InterlinkCandidate } from "@/domains/linkgraph/entity-interlink";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function candidate(over: Partial<InterlinkCandidate> = {}): InterlinkCandidate {
  return {
    sourceUrl: "https://x.com/nowruz",
    destinationUrl: "https://x.com/chaharshanbe-suri",
    topicLabel: "Chaharshanbe Suri",
    matchedTokens: ["chaharshanbe", "suri"],
    suggestedAnchor: "Chaharshanbe Suri",
    ...over,
  };
}

describe("entityInterlink", () => {
  it("emits add_internal_link targeting the SOURCE page", () => {
    const rows = entityInterlink({ tenantId: "t", candidates: [candidate()], signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("add_internal_link");
    expect(rows[0]!.trigger_signal).toBe("entity_interlink");
    expect(rows[0]!.target_url).toBe("https://x.com/nowruz"); // the edited page
    expect(rows[0]!.confidence).toBe("medium");
  });

  it("names the topic and destination path in customer_copy, no lab words / dashes", () => {
    const rows = entityInterlink({ tenantId: "t", candidates: [candidate()], signalAt: SIGNAL_AT });
    expect(rows[0]!.customer_copy).toContain("Chaharshanbe Suri");
    expect(rows[0]!.customer_copy).toContain("/chaharshanbe-suri");
    expect(rows[0]!.customer_copy).toContain("you already have a page for it");
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("entity");
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("owner page");
    expect(rows[0]!.customer_copy).not.toMatch(/[—–]/);
  });

  it("distinct dedupe rows for two links FROM the same source TO different destinations", () => {
    const rows = entityInterlink({
      tenantId: "t",
      candidates: [
        candidate({ destinationUrl: "https://x.com/haft-sin", topicLabel: "Haft Sin" }),
        candidate({ destinationUrl: "https://x.com/yalda", topicLabel: "Yalda" }),
      ],
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dedupe_key).not.toBe(rows[1]!.dedupe_key);
    // Same source -> same cooldown_key (so the loader dedupes at source grain).
    expect(rows[0]!.cooldown_key).toBe(rows[1]!.cooldown_key);
  });

  it("ranks fuller mentions first and caps emissions", () => {
    const rows = entityInterlink({
      tenantId: "t",
      candidates: [
        candidate({ destinationUrl: "https://x.com/a", matchedTokens: ["one"] }),
        candidate({ destinationUrl: "https://x.com/b", matchedTokens: ["one", "two", "three"] }),
      ],
      signalAt: SIGNAL_AT,
      maxEmissions: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.topic_cluster_label).toBe("https://x.com/b");
  });

  it("BYTE-IDENTICAL EMPTY: no candidates yields []", () => {
    expect(entityInterlink({ tenantId: "t", candidates: [], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("is deterministic", () => {
    const args = { tenantId: "t", candidates: [candidate()], signalAt: SIGNAL_AT };
    expect(JSON.stringify(entityInterlink(args))).toBe(JSON.stringify(entityInterlink(args)));
  });
});
