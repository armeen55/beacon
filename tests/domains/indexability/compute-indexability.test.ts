/**
 * Phase A.3 Step 1 — pure indexability verdict computer tests.
 *
 * Pins:
 *   • Each producible verdict resolves on its canonical signal
 *     pattern (8 verdicts produced in v1; 2 reserved for GSC).
 *   • Decision precedence is locked: bad_status > noindex > canonical
 *     > googlebot-robots > ai-bot-robots > sitemap.
 *   • `noindex` parsing is case-insensitive, whitespace-tolerant,
 *     comma- and semicolon-delimited; the literal `index` directive
 *     is NEVER treated as `noindex`.
 *   • Redirect codes (301/302/307/308) classify as `bad_status_code`.
 *   • `evidence_freshness_days` is a UTC-day delta; null when
 *     `fetched_at` is missing or unparseable.
 *   • Determinism: same input → byte-identical output.
 *   • Raw signal preservation: returned `signals` carries the input
 *     verbatim + a parsed `noindex_detected` flag + `gsc: null`.
 *   • Reserved verdicts are NEVER produced by v1.
 */

import { describe, expect, it } from "vitest";

import {
  computeIndexability,
  type ComputeIndexabilityInput,
} from "@/domains/indexability/compute-indexability";
import type {
  IndexabilityPageSnapshotSignal,
  IndexabilityRobotsSignal,
  IndexabilitySitemapSignal,
} from "@/domains/indexability/types";

const NOW = "2026-05-14T12:00:00.000Z";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers — start with the "all-confirmed-ok" defaults; tests
// override the relevant fields to force a specific verdict.
// ─────────────────────────────────────────────────────────────────────

function okPageSnapshot(): Omit<
  IndexabilityPageSnapshotSignal,
  "noindex_detected"
> {
  return {
    http_status: 200,
    canonical_url: "https://example.com/page",
    has_canonical_mismatch: false,
    robots_meta: "index, follow",
    fetched_at: "2026-05-14T08:00:00.000Z",
    extraction_certainty: "confirmed",
  };
}

function okRobots(): IndexabilityRobotsSignal {
  return {
    googlebot_allowed: true,
    gptbot_allowed: true,
    perplexitybot_allowed: true,
    claudebot_allowed: true,
    google_extended_allowed: true,
  };
}

function okSitemap(): IndexabilitySitemapSignal {
  return {
    in_sitemap: true,
    sitemap_url: "https://example.com/sitemap.xml",
  };
}

function baseInput(
  overrides: Partial<ComputeIndexabilityInput> = {},
): ComputeIndexabilityInput {
  return {
    url: "https://example.com/page",
    sitemap_membership: okSitemap(),
    robots_txt: okRobots(),
    page_snapshot: okPageSnapshot(),
    now: NOW,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Verdict resolution (one canonical pattern per producible verdict)
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — producible verdicts", () => {
  it("ok — all signals confirmed positive", () => {
    const out = computeIndexability(baseInput());
    expect(out.composite_verdict).toBe("ok");
  });

  it("unknown — page_snapshot is null", () => {
    const out = computeIndexability(baseInput({ page_snapshot: null }));
    expect(out.composite_verdict).toBe("unknown");
  });

  it("unknown — http_status is null", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), http_status: null },
      }),
    );
    expect(out.composite_verdict).toBe("unknown");
  });

  it("unknown — at least one signal is null (no robots evidence)", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), gptbot_allowed: null },
      }),
    );
    expect(out.composite_verdict).toBe("unknown");
  });

  it("bad_status_code — HTTP 404", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), http_status: 404 },
      }),
    );
    expect(out.composite_verdict).toBe("bad_status_code");
  });

  it("bad_status_code — HTTP 500", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), http_status: 500 },
      }),
    );
    expect(out.composite_verdict).toBe("bad_status_code");
  });

  it("noindex_meta — robots_meta contains noindex", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), robots_meta: "noindex, nofollow" },
      }),
    );
    expect(out.composite_verdict).toBe("noindex_meta");
  });

  it("canonical_elsewhere — has_canonical_mismatch true", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          has_canonical_mismatch: true,
        },
      }),
    );
    expect(out.composite_verdict).toBe("canonical_elsewhere");
  });

  it("blocked_by_robots_for_googlebot — googlebot_allowed false", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), googlebot_allowed: false },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_googlebot");
  });

  it("blocked_by_robots_for_ai — gptbot_allowed false", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), gptbot_allowed: false },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_ai");
  });

  it("blocked_by_robots_for_ai — perplexitybot_allowed false", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), perplexitybot_allowed: false },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_ai");
  });

  it("blocked_by_robots_for_ai — claudebot_allowed false", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), claudebot_allowed: false },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_ai");
  });

  it("blocked_by_robots_for_ai — google_extended_allowed false", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), google_extended_allowed: false },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_ai");
  });

  it("not_in_sitemap — in_sitemap false", () => {
    const out = computeIndexability(
      baseInput({
        sitemap_membership: {
          in_sitemap: false,
          sitemap_url: "https://example.com/sitemap.xml",
        },
      }),
    );
    expect(out.composite_verdict).toBe("not_in_sitemap");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Reserved-for-GSC verdicts — v1 MUST NOT produce these.
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — reserved GSC verdicts NEVER produced", () => {
  it("never produces not_indexed_in_gsc nor indexed_but_not_cited across a broad input matrix", () => {
    // Sweep the cross-product of representative signal shapes that
    // could conceivably look "GSC-like". If a future refactor
    // accidentally wires up a GSC-style branch in this v1 module,
    // this sweep will catch it.
    const statusCodes = [null, 200, 301, 302, 307, 308, 404, 410, 500] as const;
    const noindexValues = [null, "index", "noindex", "noindex, nofollow"] as const;
    const canonicalMismatches = [null, false, true] as const;
    const robotsValues = [null, true, false] as const;
    const inSitemapValues = [null, true, false] as const;

    for (const status of statusCodes) {
      for (const noindex of noindexValues) {
        for (const canonical of canonicalMismatches) {
          for (const googlebot of robotsValues) {
            for (const inSitemap of inSitemapValues) {
              const out = computeIndexability(
                baseInput({
                  page_snapshot:
                    status === null
                      ? null
                      : {
                          ...okPageSnapshot(),
                          http_status: status,
                          robots_meta: noindex,
                          has_canonical_mismatch: canonical,
                        },
                  robots_txt: { ...okRobots(), googlebot_allowed: googlebot },
                  sitemap_membership: {
                    ...okSitemap(),
                    in_sitemap: inSitemap,
                  },
                }),
              );
              expect(out.composite_verdict).not.toBe("not_indexed_in_gsc");
              expect(out.composite_verdict).not.toBe("indexed_but_not_cited");
            }
          }
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Precedence — locked ordering
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — decision precedence (locked v1)", () => {
  it("bad_status_code beats noindex_meta (404 + noindex → bad_status_code)", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          http_status: 404,
          robots_meta: "noindex",
        },
      }),
    );
    expect(out.composite_verdict).toBe("bad_status_code");
  });

  it("noindex_meta beats canonical_elsewhere", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          robots_meta: "noindex",
          has_canonical_mismatch: true,
        },
      }),
    );
    expect(out.composite_verdict).toBe("noindex_meta");
  });

  it("canonical_elsewhere beats blocked_by_robots_for_googlebot", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          has_canonical_mismatch: true,
        },
        robots_txt: { ...okRobots(), googlebot_allowed: false },
      }),
    );
    expect(out.composite_verdict).toBe("canonical_elsewhere");
  });

  it("blocked_by_robots_for_googlebot beats blocked_by_robots_for_ai", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: {
          ...okRobots(),
          googlebot_allowed: false,
          gptbot_allowed: false,
        },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_googlebot");
  });

  it("blocked_by_robots_for_ai beats not_in_sitemap", () => {
    const out = computeIndexability(
      baseInput({
        robots_txt: { ...okRobots(), gptbot_allowed: false },
        sitemap_membership: {
          in_sitemap: false,
          sitemap_url: "https://example.com/sitemap.xml",
        },
      }),
    );
    expect(out.composite_verdict).toBe("blocked_by_robots_for_ai");
  });
});

// ─────────────────────────────────────────────────────────────────────
// noindex parsing
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — noindex parsing", () => {
  const cases: Array<[string | null, "noindex_meta" | "ok"]> = [
    ["noindex", "noindex_meta"],
    ["INDEX,NOINDEX", "noindex_meta"],
    ["noindex, nofollow", "noindex_meta"],
    [" noindex ", "noindex_meta"],
    ["NoIndex", "noindex_meta"],
    ["max-snippet:-1, noindex", "noindex_meta"],
    ["noindex; nofollow", "noindex_meta"],
    ["index", "ok"],
    ["index,follow", "ok"],
    ["all", "ok"],
    [null, "ok"],
    ["", "ok"],
  ];
  for (const [meta, expected] of cases) {
    it(`robots_meta=${JSON.stringify(meta)} → ${expected}`, () => {
      const out = computeIndexability(
        baseInput({
          page_snapshot: { ...okPageSnapshot(), robots_meta: meta },
        }),
      );
      expect(out.composite_verdict).toBe(expected);
      // noindex_detected on the returned signals tracks the parse
      // outcome, not just the verdict.
      expect(out.signals.page_snapshot?.noindex_detected).toBe(
        expected === "noindex_meta",
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Redirect codes
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — redirect codes classify as bad_status_code", () => {
  for (const status of [301, 302, 307, 308]) {
    it(`HTTP ${status} → bad_status_code`, () => {
      const out = computeIndexability(
        baseInput({
          page_snapshot: { ...okPageSnapshot(), http_status: status },
        }),
      );
      expect(out.composite_verdict).toBe("bad_status_code");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// evidence_freshness_days math
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — evidence_freshness_days", () => {
  it("same UTC day → 0", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          fetched_at: "2026-05-14T01:00:00.000Z",
        },
        now: "2026-05-14T23:00:00.000Z",
      }),
    );
    expect(out.evidence_freshness_days).toBe(0);
  });

  it("1 day old → 1", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          fetched_at: "2026-05-13T08:00:00.000Z",
        },
        now: "2026-05-14T12:00:00.000Z",
      }),
    );
    expect(out.evidence_freshness_days).toBe(1);
  });

  it("7 days old → 7", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          fetched_at: "2026-05-07T08:00:00.000Z",
        },
        now: "2026-05-14T12:00:00.000Z",
      }),
    );
    expect(out.evidence_freshness_days).toBe(7);
  });

  it("missing fetched_at → null", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), fetched_at: null },
      }),
    );
    expect(out.evidence_freshness_days).toBeNull();
  });

  it("invalid fetched_at → null", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), fetched_at: "not-a-date" },
      }),
    );
    expect(out.evidence_freshness_days).toBeNull();
  });

  it("null page_snapshot → null freshness", () => {
    const out = computeIndexability(baseInput({ page_snapshot: null }));
    expect(out.evidence_freshness_days).toBeNull();
  });

  it("fetched_at in the future (clock skew) clamps to 0", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: {
          ...okPageSnapshot(),
          fetched_at: "2026-05-20T00:00:00.000Z",
        },
        now: "2026-05-14T12:00:00.000Z",
      }),
    );
    expect(out.evidence_freshness_days).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Determinism + raw-signal preservation
// ─────────────────────────────────────────────────────────────────────

describe("computeIndexability — determinism", () => {
  it("same input → byte-identical output across two calls", () => {
    const input = baseInput();
    const a = computeIndexability(input);
    const b = computeIndexability(input);
    expect(a).toEqual(b);
  });
});

describe("computeIndexability — raw signal preservation", () => {
  it("returned signals carry sitemap + robots + page_snapshot + gsc:null verbatim", () => {
    const out = computeIndexability(baseInput());
    expect(out.signals.sitemap_membership).toEqual({
      in_sitemap: true,
      sitemap_url: "https://example.com/sitemap.xml",
    });
    expect(out.signals.robots_txt).toEqual({
      googlebot_allowed: true,
      gptbot_allowed: true,
      perplexitybot_allowed: true,
      claudebot_allowed: true,
      google_extended_allowed: true,
    });
    expect(out.signals.page_snapshot).toEqual({
      http_status: 200,
      canonical_url: "https://example.com/page",
      has_canonical_mismatch: false,
      robots_meta: "index, follow",
      noindex_detected: false,
      fetched_at: "2026-05-14T08:00:00.000Z",
      extraction_certainty: "confirmed",
    });
    expect(out.signals.gsc).toBeNull();
  });

  it("noindex_detected reflects parser output (true on noindex meta)", () => {
    const out = computeIndexability(
      baseInput({
        page_snapshot: { ...okPageSnapshot(), robots_meta: "noindex" },
      }),
    );
    expect(out.signals.page_snapshot?.noindex_detected).toBe(true);
  });

  it("does not mutate caller input", () => {
    const sitemap = okSitemap();
    const robots = okRobots();
    const pageSnap = okPageSnapshot();
    const snapshotBefore = JSON.stringify({ sitemap, robots, pageSnap });
    computeIndexability({
      url: "https://example.com/page",
      sitemap_membership: sitemap,
      robots_txt: robots,
      page_snapshot: pageSnap,
      now: NOW,
    });
    const snapshotAfter = JSON.stringify({ sitemap, robots, pageSnap });
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it("url + last_computed_at echo the input", () => {
    const out = computeIndexability(
      baseInput({
        url: "https://acme.test/services/widgets",
        now: NOW,
      }),
    );
    expect(out.url).toBe("https://acme.test/services/widgets");
    expect(out.last_computed_at).toBe("2026-05-14T12:00:00.000Z");
  });
});
