/**
 * Perf bundle 3 (2026-05-12) — observation-rollup builder shape tests.
 *
 * Pins the rollup's structural invariants: dedupe vs raw counts, brand
 * mention/citation aggregation, per-platform breakdown, sampled-date
 * set. Equivalence with the direct visibility-score path is covered
 * separately in `observation-rollup-equivalence.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import {
  buildObservationRollup,
  slugifyEntity,
} from "@/domains/today/observation-rollup";

function obs(partial: Partial<PromptAnswerObservation>): PromptAnswerObservation {
  return {
    id: partial.id ?? "obs-1",
    prompt_id: partial.prompt_id ?? "p-1",
    run_id: partial.run_id ?? "r-1",
    answer_hash: partial.answer_hash ?? null,
    position: partial.position ?? null,
    tracked_brand_mentioned: partial.tracked_brand_mentioned ?? null,
    tracked_brand_cited: partial.tracked_brand_cited ?? null,
    citation_count: partial.citation_count ?? 0,
    owned_citation_count: partial.owned_citation_count ?? 0,
    citation_domains: partial.citation_domains ?? [],
    citation_categories: partial.citation_categories ?? {},
    mentions: partial.mentions ?? [],
    observed_at: partial.observed_at ?? "2026-05-01T12:00:00Z",
    platform: partial.platform ?? "chatgpt",
    topic: partial.topic ?? "topic",
    metadata: partial.metadata ?? {},
    tenant_id: partial.tenant_id ?? "tenant-test",
  };
}

describe("buildObservationRollup — structural invariants", () => {
  it("returns empty rollup for empty input", () => {
    const r = buildObservationRollup({
      observations: [],
      brandAliases: ["Ritz Builders"],
    });
    expect(r.sampledDates).toEqual([]);
    expect(r.sampledDateSet.size).toBe(0);
    expect(r.byDate.size).toBe(0);
    expect(r.byEntityDate.size).toBe(0);
    expect(r.entityNameBySlug.size).toBe(0);
    expect(r.totalObservations).toBe(0);
    expect(r.brandAliases).toEqual(["Ritz Builders"]);
    expect(Array.from(r.brandSlugs)).toEqual(["ritz builders"]);
  });

  it("counts brand mentions via tracked_brand_mentioned flag", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", tracked_brand_mentioned: true }),
        obs({ id: "2", tracked_brand_mentioned: false }),
        obs({ id: "3", tracked_brand_mentioned: null }), // null counts as false
      ],
      brandAliases: ["Ritz Builders"],
    });
    const day = r.byDate.get("2026-05-01");
    expect(day?.total).toBe(3);
    expect(day?.brandMentioned).toBe(1);
  });

  it("counts brand mentions via mentions[] alias hit when flag absent", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", tracked_brand_mentioned: null, mentions: ["Ritz Builders"] }),
        obs({ id: "2", tracked_brand_mentioned: null, mentions: ["RITZ BUILDERS"] }),
        obs({ id: "3", tracked_brand_mentioned: null, mentions: ["Other Co"] }),
      ],
      brandAliases: ["Ritz Builders"],
    });
    const day = r.byDate.get("2026-05-01");
    expect(day?.brandMentioned).toBe(2);
  });

  it("counts brand citations + applies position weights", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", tracked_brand_cited: true, position: 1 }), // weight 1.0
        obs({ id: "2", tracked_brand_cited: true, position: 5 }), // weight 0.5
        obs({ id: "3", tracked_brand_cited: true, position: 9 }), // weight 0.25
        obs({ id: "4", tracked_brand_cited: true, position: null }), // weight 0.5
        obs({ id: "5", tracked_brand_cited: false, position: 1 }), // weight 0
      ],
      brandAliases: ["Ritz Builders"],
    });
    const day = r.byDate.get("2026-05-01");
    expect(day?.brandCited).toBe(4);
    expect(day?.brandCitationWeightSum).toBeCloseTo(1.0 + 0.5 + 0.25 + 0.5, 6);
  });

  it("competitor rawMentions sum every occurrence; dedupedMentions count 1 per obs", () => {
    // Obs 1 mentions "Acme" twice + "Beta" once.
    // Obs 2 mentions "Acme" once.
    // Expected:
    //   Acme: rawMentions=3 (2 + 1), dedupedMentions=2 (one per obs)
    //   Beta: rawMentions=1, dedupedMentions=1
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", mentions: ["Acme", "Acme", "Beta"] }),
        obs({ id: "2", mentions: ["Acme"] }),
      ],
      brandAliases: ["Ritz Builders"],
    });
    const acme = r.byEntityDate.get("acme")?.get("2026-05-01");
    const beta = r.byEntityDate.get("beta")?.get("2026-05-01");
    expect(acme?.rawMentions).toBe(3);
    expect(acme?.dedupedMentions).toBe(2);
    expect(beta?.rawMentions).toBe(1);
    expect(beta?.dedupedMentions).toBe(1);
  });

  it("excludes brand aliases from byEntityDate", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", mentions: ["Ritz Builders", "Acme"] }),
      ],
      brandAliases: ["Ritz Builders", "Ritz"],
    });
    expect(r.byEntityDate.has("ritz builders")).toBe(false);
    expect(r.byEntityDate.has("ritz")).toBe(false);
    expect(r.byEntityDate.has("acme")).toBe(true);
  });

  it("preserves first-observed display name per slug", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", observed_at: "2026-05-01T10:00:00Z", mentions: ["ACME Inc"] }),
        obs({ id: "2", observed_at: "2026-05-02T10:00:00Z", mentions: ["acme inc"] }),
      ],
      brandAliases: ["Ritz Builders"],
    });
    expect(r.entityNameBySlug.get("acme inc")).toBe("ACME Inc");
  });

  it("buckets per-platform aggregates correctly", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", platform: "chatgpt", tracked_brand_cited: true }),
        obs({ id: "2", platform: "chatgpt", tracked_brand_cited: false }),
        obs({ id: "3", platform: "perplexity", tracked_brand_cited: true }),
      ],
      brandAliases: ["Ritz Builders"],
    });
    const day = r.byDate.get("2026-05-01");
    expect(day?.total).toBe(3);
    expect(day?.perPlatform.get("chatgpt")?.obs).toBe(2);
    expect(day?.perPlatform.get("chatgpt")?.brandCited).toBe(1);
    expect(day?.perPlatform.get("perplexity")?.obs).toBe(1);
    expect(day?.perPlatform.get("perplexity")?.brandCited).toBe(1);
  });

  it("sampledDates is sorted ascending + matches sampledDateSet", () => {
    const r = buildObservationRollup({
      observations: [
        obs({ id: "1", observed_at: "2026-05-03T12:00:00Z" }),
        obs({ id: "2", observed_at: "2026-05-01T12:00:00Z" }),
        obs({ id: "3", observed_at: "2026-05-02T12:00:00Z" }),
        obs({ id: "4", observed_at: "2026-05-01T18:00:00Z" }), // duplicate date
      ],
      brandAliases: ["Ritz Builders"],
    });
    expect(r.sampledDates).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
    expect(r.sampledDateSet.size).toBe(3);
    for (const d of r.sampledDates) expect(r.sampledDateSet.has(d)).toBe(true);
  });

  it("does not mutate input observations", () => {
    const input: PromptAnswerObservation[] = [
      obs({ id: "1", mentions: ["Acme"] }),
    ];
    const frozenMentions = [...input[0].mentions];
    buildObservationRollup({
      observations: input,
      brandAliases: ["Ritz Builders"],
    });
    expect(input[0].mentions).toEqual(frozenMentions);
  });

  it("slug helper matches the visibility-score slug semantics", () => {
    // Same source-of-truth invariant we rely on for equivalence:
    //   trim + lower + collapse whitespace.
    expect(slugifyEntity("  Ritz   Builders  ")).toBe("ritz builders");
    expect(slugifyEntity("De Mattei Construction")).toBe("de mattei construction");
    expect(slugifyEntity("ALL CAPS")).toBe("all caps");
  });

  // -------------------------------------------------------------------------
  // Perf bundle 4 (2026-05-12) — additive fields used by inline loops.
  // -------------------------------------------------------------------------

  describe("latestObservedAt", () => {
    it("returns null for an empty observation array", () => {
      const r = buildObservationRollup({
        observations: [],
        brandAliases: ["Ritz Builders"],
      });
      expect(r.latestObservedAt).toBeNull();
    });

    it("returns the lexicographically-max observed_at string", () => {
      const r = buildObservationRollup({
        observations: [
          obs({ id: "1", observed_at: "2026-05-01T10:00:00Z" }),
          obs({ id: "2", observed_at: "2026-05-03T08:00:00Z" }),
          obs({ id: "3", observed_at: "2026-05-02T18:00:00Z" }),
          obs({ id: "4", observed_at: "2026-05-03T07:59:00Z" }),
        ],
        brandAliases: ["Ritz Builders"],
      });
      expect(r.latestObservedAt).toBe("2026-05-03T08:00:00Z");
    });

    it("equivalence with the today-data line-386 reduce", () => {
      // Mirror today-data's reduce shape exactly so a future drift would
      // surface here.
      const observations = [
        obs({ id: "1", observed_at: "2026-05-01T10:00:00Z" }),
        obs({ id: "2", observed_at: "2026-05-03T08:00:00Z" }),
        obs({ id: "3", observed_at: "" }), // empty string treated as falsy
        obs({ id: "4", observed_at: "2026-05-02T18:00:00Z" }),
      ];
      const fromReduce = observations.reduce<string | null>((max, o) => {
        const t = o.observed_at;
        if (!t) return max;
        return max === null || t > max ? t : max;
      }, null);

      const fromRollup = buildObservationRollup({
        observations,
        brandAliases: ["Ritz Builders"],
      }).latestObservedAt;

      expect(fromRollup).toBe(fromReduce);
    });
  });

  describe("mentionCountsByOriginalName", () => {
    it("is empty for empty input", () => {
      const r = buildObservationRollup({
        observations: [],
        brandAliases: ["Ritz Builders"],
      });
      expect(r.mentionCountsByOriginalName.size).toBe(0);
    });

    it("keeps case variants as SEPARATE keys (preserves scanner semantics)", () => {
      const r = buildObservationRollup({
        observations: [
          obs({ id: "1", mentions: ["Acme", "ACME"] }),
          obs({ id: "2", mentions: ["Acme"] }),
        ],
        brandAliases: ["Ritz Builders"],
      });
      expect(r.mentionCountsByOriginalName.get("Acme")).toBe(2);
      expect(r.mentionCountsByOriginalName.get("ACME")).toBe(1);
    });

    it("counts every occurrence (raw), not per-obs deduped", () => {
      const r = buildObservationRollup({
        observations: [
          // Acme appears 3 times in one obs.mentions[].
          obs({ id: "1", mentions: ["Acme", "Acme", "Acme"] }),
        ],
        brandAliases: ["Ritz Builders"],
      });
      expect(r.mentionCountsByOriginalName.get("Acme")).toBe(3);
    });

    it("excludes brand aliases via lowercase comparison (scanner semantics)", () => {
      const r = buildObservationRollup({
        observations: [
          obs({ id: "1", mentions: ["Ritz Builders", "ritz builders", "RITZ", "Acme"] }),
        ],
        brandAliases: ["Ritz Builders", "Ritz"],
      });
      expect(r.mentionCountsByOriginalName.has("Ritz Builders")).toBe(false);
      expect(r.mentionCountsByOriginalName.has("ritz builders")).toBe(false);
      expect(r.mentionCountsByOriginalName.has("RITZ")).toBe(false);
      expect(r.mentionCountsByOriginalName.get("Acme")).toBe(1);
    });

    it("equivalence with the today-data scanner loop (line 1085)", () => {
      const observations = [
        obs({ id: "1", mentions: ["Ritz Builders", "Acme", "Acme"] }),
        obs({ id: "2", mentions: ["Beta", "Beta", "ACME"] }),
        obs({ id: "3", mentions: ["Gamma", "ritz"] }), // "ritz" excluded
        obs({ id: "4", mentions: [] }),
      ];
      const brandAliases = ["Ritz Builders", "Ritz"];

      // OLD inline behavior — verbatim from today-data line 1085.
      const inline = new Map<string, number>();
      const brandAliasesLC = new Set(brandAliases.map((s) => s.toLowerCase()));
      for (const o of observations) {
        for (const m of o.mentions ?? []) {
          if (!brandAliasesLC.has(m.toLowerCase())) {
            inline.set(m, (inline.get(m) ?? 0) + 1);
          }
        }
      }

      const rollup = buildObservationRollup({ observations, brandAliases });

      // Same entries, same counts.
      expect(rollup.mentionCountsByOriginalName.size).toBe(inline.size);
      for (const [name, count] of inline.entries()) {
        expect(rollup.mentionCountsByOriginalName.get(name)).toBe(count);
      }

      // Same top-N after the scanner's sort/slice.
      const inlineTop = [...inline.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([name]) => name);
      const rollupTop = [...rollup.mentionCountsByOriginalName.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([name]) => name);
      expect(rollupTop).toEqual(inlineTop);
    });
  });
});
