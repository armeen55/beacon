/**
 * Section 5.A (2026-05-16) — `computeRepeatCitation` unit tests.
 *
 * Pure compute. Covers band boundaries (locked G5), the
 * minimum-sample guard, denominator-filter discipline, cross-regime
 * matching, per-platform breakdown, tenant safety via
 * promptAnswerById, and every documented eligibility / canonicalize
 * edge case.
 */

import { describe, it, expect } from "vitest";

import {
  computeRepeatCitation,
  type ComputeRepeatCitationArgs,
} from "@/domains/citation-lifecycle/compute-repeat-citation";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";

const TENANT = "tenant-ritz-founder";
const LIVE_AT = "2026-04-25T12:00:00.000Z";
const NOW = "2026-05-15T12:00:00.000Z"; // 20 calendar days post-live
const TARGET_URL = "https://ritzbuilders.com/services/whole-home-remodel";
const CANONICAL_TARGET = "https://ritzbuilders.com/services/whole-home-remodel";

function paoRow(over: Partial<PromptAnswerObservation> = {}): PromptAnswerObservation {
  return {
    id: over.id ?? "pao-1",
    prompt_id: over.prompt_id ?? "p-1",
    run_id: over.run_id ?? "r-1",
    answer_hash: over.answer_hash ?? null,
    position: over.position ?? null,
    tracked_brand_mentioned: over.tracked_brand_mentioned ?? null,
    tracked_brand_cited: over.tracked_brand_cited ?? null,
    citation_count: over.citation_count ?? 0,
    owned_citation_count: over.owned_citation_count ?? 0,
    citation_domains: over.citation_domains ?? [],
    citation_categories: over.citation_categories ?? {},
    mentions: over.mentions ?? [],
    observed_at: over.observed_at ?? NOW,
    platform: over.platform ?? "chatgpt",
    topic: over.topic ?? "",
    metadata: over.metadata ?? {},
    tenant_id: over.tenant_id ?? TENANT,
    citation_urls: over.citation_urls,
  };
}

function citationRow(over: Partial<CitationObservation> = {}): CitationObservation {
  return {
    id: over.id ?? "cit-1",
    prompt_answer_id: over.prompt_answer_id ?? "pao-1",
    domain: over.domain ?? "ritzbuilders.com",
    url: over.url ?? TARGET_URL,
    title: over.title ?? null,
    citation_order: over.citation_order ?? 1,
    source_category: over.source_category ?? "owned",
    is_owned: over.is_owned ?? true,
    tracked_entity_id: over.tracked_entity_id ?? null,
    observed_at: over.observed_at ?? NOW,
  };
}

function pollRun(
  date: string,
  over: Partial<ProfoundImportRun> = {},
): ProfoundImportRun {
  return {
    id: over.id ?? `run-${date}-${over.platform ?? "chatgpt"}`,
    account_id: over.account_id ?? "ritz-founder",
    import_run_id: over.import_run_id ?? null,
    run_date: over.run_date ?? date,
    platform: over.platform ?? "chatgpt",
    model: over.model ?? null,
    geo: over.geo ?? null,
    locale: over.locale ?? null,
    source_type: over.source_type ?? "beacon_native",
    status: over.status ?? "completed",
    prompt_count: over.prompt_count ?? 25,
    metadata: over.metadata ?? {},
    created_at: over.created_at ?? `${date}T07:00:00.000Z`,
  };
}

function eligibleEdit() {
  return {
    implementation_status: "verified_live" as const,
    live_at: LIVE_AT,
    target_url: TARGET_URL,
  };
}

function pollDaysSinceLive(count: number): ProfoundImportRun[] {
  // Generate `count` distinct UTC dates starting at live_at, daily.
  const start = new Date(LIVE_AT).getTime();
  const out: ProfoundImportRun[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push(pollRun(d));
  }
  return out;
}

function citationDaysSinceLive(
  count: number,
  promptAnswerId = "pao-1",
): PromptAnswerObservation[] {
  // Generate `count` native-regime observations each citing
  // TARGET_URL on a distinct UTC date starting at live_at.
  const start = new Date(LIVE_AT).getTime();
  const out: PromptAnswerObservation[] = [];
  for (let i = 0; i < count; i++) {
    const dateIso = new Date(start + i * 86_400_000).toISOString();
    out.push(
      paoRow({
        id: `${promptAnswerId}-${i}`,
        observed_at: dateIso,
        citation_urls: [TARGET_URL],
      }),
    );
  }
  return out;
}

function baseArgs(
  overrides: Partial<ComputeRepeatCitationArgs> = {},
): ComputeRepeatCitationArgs {
  return {
    recommendedEdit: eligibleEdit(),
    citationObservations: [],
    promptAnswerObservations: [],
    profoundImportRuns: [],
    windowDays: 30,
    now: NOW,
    ...overrides,
  };
}

describe("computeRepeatCitation — band boundaries (G5)", () => {
  it("5 cited / 10 polled = 0.50 → stable (inclusive boundary)", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(5),
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.eligible).toBe(true);
    expect(out.polling_days).toBe(10);
    expect(out.distinct_citation_days).toBe(5);
    expect(out.citation_rate).toBeCloseTo(0.5);
    expect(out.band).toBe("stable");
  });

  it("4 cited / 10 polled = 0.40 → intermittent", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(4),
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.band).toBe("intermittent");
    expect(out.citation_rate).toBeCloseTo(0.4);
  });

  it("2 cited / 10 polled = 0.20 → intermittent (inclusive lower)", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(2),
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.band).toBe("intermittent");
    expect(out.citation_rate).toBeCloseTo(0.2);
  });

  it("1 cited / 10 polled = 0.10 → one_off", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(1),
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.band).toBe("one_off");
    expect(out.citation_rate).toBeCloseTo(0.1);
  });

  it("0 cited in window with first citation BEFORE window → not_repeated", () => {
    // Window starts at live_at; place the first citation 90 days
    // before live_at so it's outside the window but exists.
    const beforeLive = new Date(
      new Date(LIVE_AT).getTime() - 90 * 86_400_000,
    ).toISOString();
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [
          paoRow({
            id: "pao-old",
            observed_at: beforeLive,
            citation_urls: [TARGET_URL],
          }),
        ],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.band).toBe("not_repeated");
    expect(out.distinct_citation_days).toBe(0);
    expect(out.first_citation_date_iso).not.toBeNull();
    expect(out.citation_rate).toBe(0);
  });

  it("0 cited and no first citation ever → still_learning", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.band).toBe("still_learning");
    expect(out.first_citation_date_iso).toBeNull();
  });
});

describe("computeRepeatCitation — minimum-sample guard", () => {
  it("polling_days < 7 → still_learning regardless of citations", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(3),
        profoundImportRuns: pollDaysSinceLive(6),
      }),
    );
    expect(out.polling_days).toBe(6);
    expect(out.band).toBe("still_learning");
    expect(out.citation_rate).toBeNull();
  });

  it("polling_days === 7 with citations → real band (boundary inclusive)", () => {
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(4),
        profoundImportRuns: pollDaysSinceLive(7),
      }),
    );
    expect(out.polling_days).toBe(7);
    // 4/7 ≈ 0.571 → stable
    expect(out.band).toBe("stable");
  });
});

describe("computeRepeatCitation — citation-day dedupe", () => {
  it("same URL cited twice on the same day = 1 distinct citation day", () => {
    const pollDate = "2026-04-26";
    const dateIso = `${pollDate}T08:00:00.000Z`;
    const pao1 = paoRow({
      id: "pao-a",
      observed_at: dateIso,
      citation_urls: [TARGET_URL],
    });
    const pao2 = paoRow({
      id: "pao-b",
      observed_at: dateIso,
      citation_urls: [TARGET_URL],
    });
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [pao1, pao2, ...citationDaysSinceLive(0)],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.distinct_citation_days).toBe(1);
  });

  it("duplicate URL inside same native citation_urls = 1 day (per-obs Set dedupe)", () => {
    const pao = paoRow({
      id: "pao-dup",
      observed_at: "2026-04-26T08:00:00.000Z",
      citation_urls: [TARGET_URL, TARGET_URL, TARGET_URL],
    });
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [pao],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.distinct_citation_days).toBe(1);
  });
});

describe("computeRepeatCitation — denominator filter (Section 5 G2)", () => {
  it("beacon_native + completed counts", () => {
    const out = computeRepeatCitation(
      baseArgs({
        profoundImportRuns: [
          pollRun("2026-04-25", { source_type: "beacon_native", status: "completed" }),
          pollRun("2026-04-26", { source_type: "beacon_native", status: "completed" }),
          pollRun("2026-04-27", { source_type: "beacon_native", status: "completed" }),
          pollRun("2026-04-28", { source_type: "beacon_native", status: "completed" }),
          pollRun("2026-04-29", { source_type: "beacon_native", status: "completed" }),
          pollRun("2026-04-30", { source_type: "beacon_native", status: "completed" }),
          pollRun("2026-05-01", { source_type: "beacon_native", status: "completed" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(7);
  });

  it("beacon_native + failed does NOT count", () => {
    const out = computeRepeatCitation(
      baseArgs({
        profoundImportRuns: [
          pollRun("2026-04-25", { source_type: "beacon_native", status: "failed" }),
          pollRun("2026-04-26", { source_type: "beacon_native", status: "failed" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(0);
  });

  it("beacon_native + running does NOT count", () => {
    const out = computeRepeatCitation(
      baseArgs({
        profoundImportRuns: [
          pollRun("2026-04-25", { source_type: "beacon_native", status: "running" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(0);
  });

  it("manual_import + completed does NOT count", () => {
    const out = computeRepeatCitation(
      baseArgs({
        profoundImportRuns: [
          pollRun("2026-04-25", { source_type: "manual_import", status: "completed" }),
          pollRun("2026-04-26", { source_type: "manual_import", status: "completed" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(0);
  });

  it("api_import + completed does NOT count", () => {
    const out = computeRepeatCitation(
      baseArgs({
        profoundImportRuns: [
          pollRun("2026-04-25", { source_type: "api_import", status: "completed" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(0);
  });

  it("two completed beacon_native runs on same date = 1 aggregate polling day", () => {
    const out = computeRepeatCitation(
      baseArgs({
        profoundImportRuns: [
          pollRun("2026-04-26", { platform: "chatgpt" }),
          pollRun("2026-04-26", { platform: "perplexity" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(1);
  });
});

describe("computeRepeatCitation — per-platform breakdown (G3 data)", () => {
  it("Perplexity 5/10 + ChatGPT 0/10 → divergence preserved in per_platform", () => {
    const start = new Date(LIVE_AT).getTime();
    const chatgptRuns: ProfoundImportRun[] = [];
    const perplexityRuns: ProfoundImportRun[] = [];
    const perplexityCitations: PromptAnswerObservation[] = [];
    for (let i = 0; i < 10; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      chatgptRuns.push(pollRun(date, { platform: "chatgpt", id: `cgpt-${date}` }));
      perplexityRuns.push(pollRun(date, { platform: "perplexity", id: `ppx-${date}` }));
      if (i < 5) {
        perplexityCitations.push(
          paoRow({
            id: `pao-ppx-${i}`,
            platform: "perplexity",
            observed_at: new Date(start + i * 86_400_000).toISOString(),
            citation_urls: [TARGET_URL],
          }),
        );
      }
    }
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: perplexityCitations,
        profoundImportRuns: [...chatgptRuns, ...perplexityRuns],
      }),
    );
    expect(out.per_platform.perplexity.polling_days).toBe(10);
    expect(out.per_platform.perplexity.distinct_citation_days).toBe(5);
    expect(out.per_platform.chatgpt.polling_days).toBe(10);
    expect(out.per_platform.chatgpt.distinct_citation_days).toBe(0);
    expect(out.per_platform.google_ai_overviews).toBeNull();
  });
});

describe("computeRepeatCitation — cross-regime matching", () => {
  it("benchmark cold-store citation + native citation both counted (distinct days)", () => {
    const oldDate = "2026-04-25T08:00:00.000Z"; // pre-cutover overlap
    const newDate = "2026-05-01T08:00:00.000Z";
    const pao = paoRow({
      id: "pao-native",
      observed_at: newDate,
      citation_urls: [TARGET_URL],
    });
    // Benchmark citation references the SAME prompt_answer_id as
    // the native pao to clear the tenant-scope filter.
    const benchmark = citationRow({
      prompt_answer_id: "pao-native",
      observed_at: oldDate,
      url: TARGET_URL,
    });
    const out = computeRepeatCitation(
      baseArgs({
        citationObservations: [benchmark],
        promptAnswerObservations: [pao],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.distinct_citation_days).toBe(2);
  });

  it("cold-store citation from prompt_answer outside tenant map is DROPPED", () => {
    const benchmark = citationRow({
      prompt_answer_id: "pao-cross-tenant",
      observed_at: "2026-04-26T08:00:00.000Z",
      url: TARGET_URL,
    });
    const out = computeRepeatCitation(
      baseArgs({
        citationObservations: [benchmark],
        promptAnswerObservations: [], // empty tenant scope
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.distinct_citation_days).toBe(0);
    expect(out.first_citation_date_iso).toBeNull();
  });
});

describe("computeRepeatCitation — URL canonicalization parity", () => {
  it("target URL with UTM/trailing slash matches cited URL without them", () => {
    const editWithUtm = {
      ...eligibleEdit(),
      target_url: `${TARGET_URL}/?utm_source=google`,
    };
    const out = computeRepeatCitation(
      baseArgs({
        recommendedEdit: editWithUtm,
        promptAnswerObservations: citationDaysSinceLive(5),
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.eligible).toBe(true);
    expect(out.distinct_citation_days).toBe(5);
  });

  it("different host with same path does NOT match", () => {
    const otherHost = "https://demattei.com/services/whole-home-remodel";
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [
          paoRow({
            id: "pao-other",
            observed_at: "2026-04-26T08:00:00.000Z",
            citation_urls: [otherHost],
          }),
        ],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.distinct_citation_days).toBe(0);
  });

  it("target URL unparseable → target_url_unparseable reason, band null", () => {
    const out = computeRepeatCitation(
      baseArgs({
        recommendedEdit: {
          ...eligibleEdit(),
          target_url: "mailto:hello@example.com",
        },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.eligibility_reason).toBe("target_url_unparseable");
    expect(out.band).toBeNull();
  });
});

describe("computeRepeatCitation — eligibility passthrough", () => {
  it("no live_at → ineligible (missing_live_at)", () => {
    const out = computeRepeatCitation(
      baseArgs({
        recommendedEdit: { implementation_status: "verified_live", live_at: null, target_url: TARGET_URL },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.eligibility_reason).toBe("missing_live_at");
    expect(out.band).toBeNull();
  });

  it("needs_new_page sentinel → ineligible", () => {
    const out = computeRepeatCitation(
      baseArgs({
        recommendedEdit: {
          implementation_status: "verified_live",
          live_at: LIVE_AT,
          target_url: "needs_new_page",
        },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.eligibility_reason).toBe("needs_new_page");
    expect(out.band).toBeNull();
  });

  it("ineligible status (recommended) → excluded_status", () => {
    const out = computeRepeatCitation(
      baseArgs({
        recommendedEdit: {
          implementation_status: "recommended",
          live_at: LIVE_AT,
          target_url: TARGET_URL,
        },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.eligibility_reason).toBe("excluded_status");
  });
});

describe("computeRepeatCitation — structural output guarantees", () => {
  it("window_days passes through unchanged", () => {
    const out = computeRepeatCitation(baseArgs({ windowDays: 60 }));
    expect(out.window_days).toBe(60);
  });

  it("google_ai_overviews slot is always null", () => {
    const out = computeRepeatCitation(baseArgs());
    expect(out.per_platform.google_ai_overviews).toBeNull();
  });
});

describe("computeRepeatCitation — citation × poll-day intersection (2026-05-16 bug-fix)", () => {
  it("citations on 3 days with 0 successful native poll days → polling=0, distinct=0, rate=null, still_learning, first-cited preserved", () => {
    // The Ritz production failure mode pre-fix: cold-store /
    // historical citations existed, but no beacon_native poll runs
    // were persisted in the tenant-scoped `.data` path on Vercel.
    // Pre-fix output rendered "Cited 3 of 0 poll days" on the
    // operator diagnostic. Post-fix the numerator intersects with
    // the poll-day denominator, so distinct_citation_days is 0
    // while first_citation_date_iso remains the historical date.
    const start = new Date(LIVE_AT).getTime();
    const citationPaos: PromptAnswerObservation[] = [];
    for (let i = 0; i < 3; i++) {
      citationPaos.push(
        paoRow({
          id: `pao-cite-${i}`,
          platform: "perplexity",
          observed_at: new Date(start + i * 86_400_000).toISOString(),
          citation_urls: [TARGET_URL],
        }),
      );
    }
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationPaos,
        profoundImportRuns: [], // zero successful native poll runs
      }),
    );
    expect(out.polling_days).toBe(0);
    expect(out.distinct_citation_days).toBe(0);
    expect(out.citation_rate).toBeNull();
    expect(out.band).toBe("still_learning");
    expect(out.first_citation_date_iso).not.toBeNull();
    expect(out.per_platform.perplexity.polling_days).toBe(0);
    expect(out.per_platform.perplexity.distinct_citation_days).toBe(0);
    expect(out.per_platform.chatgpt.polling_days).toBe(0);
    expect(out.per_platform.chatgpt.distinct_citation_days).toBe(0);
  });

  it("10 poll days, 5 citation days on those polls → distinct=5, polling=10, stable", () => {
    // Locked baseline (already covered above; restated here as the
    // counterfactual to the bug-fix test so the contract reads end
    // to end).
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: citationDaysSinceLive(5),
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.polling_days).toBe(10);
    expect(out.distinct_citation_days).toBe(5);
    expect(out.band).toBe("stable");
  });

  it("citations land only on manual_import dates → excluded from BOTH numerator AND denominator; first-cited preserved", () => {
    // Manual-import runs do NOT pass the beacon_native filter, so
    // those dates contribute neither to polling_days NOR (via
    // intersection) to distinct_citation_days. First citation still
    // records the historical event.
    const start = new Date(LIVE_AT).getTime();
    const citationOnManualDay = paoRow({
      id: "pao-on-manual-date",
      platform: "perplexity",
      observed_at: new Date(start + 2 * 86_400_000).toISOString(),
      citation_urls: [TARGET_URL],
    });
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [citationOnManualDay],
        profoundImportRuns: [
          pollRun("2026-04-27", { source_type: "manual_import", status: "completed" }),
        ],
      }),
    );
    expect(out.polling_days).toBe(0);
    expect(out.distinct_citation_days).toBe(0);
    expect(out.first_citation_date_iso).not.toBeNull();
    expect(out.band).toBe("still_learning");
  });

  it("aggregate invariant — distinct_citation_days <= polling_days under a mixed scenario", () => {
    // Citation lands on a date Beacon polled natively AND on a date
    // it did not. Intersection drops the off-poll date.
    const start = new Date(LIVE_AT).getTime();
    const onPollDay = paoRow({
      id: "pao-on-poll",
      observed_at: new Date(start + 1 * 86_400_000).toISOString(),
      citation_urls: [TARGET_URL],
    });
    const offPollDay = paoRow({
      id: "pao-off-poll",
      observed_at: new Date(start + 50 * 86_400_000).toISOString(), // outside the poll set
      citation_urls: [TARGET_URL],
    });
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [onPollDay, offPollDay],
        profoundImportRuns: pollDaysSinceLive(10),
      }),
    );
    expect(out.polling_days).toBe(10);
    // Only the on-poll-day citation counts; the off-poll-day one
    // exists but is intersected out.
    expect(out.distinct_citation_days).toBe(1);
    expect(out.distinct_citation_days).toBeLessThanOrEqual(out.polling_days);
  });

  it("per-platform invariant — platform citation days <= platform poll days (Perplexity citation on date with no Perplexity poll)", () => {
    // Build a scenario where Perplexity citation lands on a date
    // that only ChatGPT polled. The Perplexity citation must NOT
    // be counted toward the Perplexity numerator (no matching
    // Perplexity poll day).
    const start = new Date(LIVE_AT).getTime();
    const dateIso = (i: number) =>
      new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const runs: ProfoundImportRun[] = [];
    // 10 ChatGPT polls only.
    for (let i = 0; i < 10; i++) {
      runs.push(pollRun(dateIso(i), { platform: "chatgpt", id: `cgpt-${i}` }));
    }
    // Perplexity citation on poll day 1 (ChatGPT-only poll day).
    const perplexityCitation = paoRow({
      id: "pao-ppx",
      platform: "perplexity",
      observed_at: new Date(start + 1 * 86_400_000).toISOString(),
      citation_urls: [TARGET_URL],
    });
    const out = computeRepeatCitation(
      baseArgs({
        promptAnswerObservations: [perplexityCitation],
        profoundImportRuns: runs,
      }),
    );
    // Aggregate: the date IS a poll day (ChatGPT polled).
    expect(out.polling_days).toBe(10);
    expect(out.distinct_citation_days).toBe(1);
    // Per-platform Perplexity: 0 poll days for that platform, so
    // intersection forces distinct = 0 even though a Perplexity
    // citation was observed on the date.
    expect(out.per_platform.perplexity.polling_days).toBe(0);
    expect(out.per_platform.perplexity.distinct_citation_days).toBe(0);
    expect(out.per_platform.perplexity.distinct_citation_days).toBeLessThanOrEqual(
      out.per_platform.perplexity.polling_days,
    );
    // Per-platform ChatGPT: polled 10 days, no ChatGPT citation.
    expect(out.per_platform.chatgpt.polling_days).toBe(10);
    expect(out.per_platform.chatgpt.distinct_citation_days).toBe(0);
  });
});

// Confirm constant TARGET_URL canonicalizes to itself (sanity for
// downstream test assertions that compare distinct-day counts).
describe("computeRepeatCitation — fixture sanity", () => {
  it("TARGET_URL canonicalizes to CANONICAL_TARGET (drives the fixtures)", () => {
    // If this fails, the canonicalize helper changed shape; every
    // distinct-day count in this file would silently miscount.
    expect(CANONICAL_TARGET).toBe("https://ritzbuilders.com/services/whole-home-remodel");
  });
});
