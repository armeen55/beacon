import { describe, it, expect } from "vitest";

import {
  buildDiagnosticPullPlan,
  runCappedSemrushDiagnosticPull,
  SEMRUSH_DIAGNOSTIC_UNIT_CAP,
} from "./capped-diagnostic-pull";
import { fetchSemrushUnitBalance } from "./account-units";
import { fetchUrlOrganicKeywords } from "./url-organic";
import { fetchPhraseRelated, fetchPhraseQuestions } from "./phrase-expansions";

const TOKEN = { api_key: "k", database: "us" };

/** fetchImpl that routes countapiunits → a balance, everything else → csv. */
function fakeSemrush(opts: { balance?: string; csv?: string }): typeof fetch {
  return (async (input: string) => {
    const u = String(input);
    if (u.includes("countapiunits")) {
      return new Response(opts.balance ?? "100000", { status: 200 });
    }
    return new Response(opts.csv ?? "", { status: 200 });
  }) as unknown as typeof fetch;
}

describe("SEMrush capped diagnostic pull — plan + estimate", () => {
  it("composes the right steps and sums units with default tight limits", () => {
    const plan = buildDiagnosticPullPlan({
      domain: "example.com",
      pages: [
        { url: "https://example.com/a", topQuery: "alpha" },
        { url: "https://example.com/b", topQuery: "beta" },
      ],
    });
    // 1 domain_organic + 2 url_organic + (2 related + 2 questions) + domain_ranks + competitors
    expect(plan.steps.length).toBe(9);
    // 150*10 + 2*(25*10) + 2*(10*40) + 2*(10*40) + 1*10 + 10*10
    // 1500 + 500 + 800 + 800 + 10 + 100
    expect(plan.estTotalUnits).toBe(3710);
    expect(plan.estTotalUnits).toBeLessThan(SEMRUSH_DIAGNOSTIC_UNIT_CAP);
  });

  it("skips phrase steps for pages with no top query", () => {
    const plan = buildDiagnosticPullPlan({
      domain: "example.com",
      pages: [{ url: "https://example.com/a", topQuery: null }],
    });
    expect(plan.steps.some((s) => s.endpoint.startsWith("phrase_"))).toBe(false);
    // domain_organic + 1 url_organic + domain_ranks + competitors = 4
    expect(plan.steps.length).toBe(4);
  });
});

describe("SEMrush capped diagnostic pull — hard guardrails (no spend on abort)", () => {
  const pages = [{ url: "https://example.com/a", topQuery: "alpha" }];

  it("ABORTS when the estimate exceeds the 20,000-unit cap", async () => {
    const r = await runCappedSemrushDiagnosticPull(
      { tenantId: "t", domain: "example.com", pages, domainOrganicLimit: 2500, now: new Date(0) },
      { token: TOKEN, fetchImpl: fakeSemrush({ balance: "999999" }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("over_cap");
      expect(r.plan!.estTotalUnits).toBeGreaterThan(SEMRUSH_DIAGNOSTIC_UNIT_CAP);
      expect(r.balanceBefore).toBe(999999);
    }
  });

  it("ABORTS when the balance can't cover the estimate", async () => {
    const r = await runCappedSemrushDiagnosticPull(
      { tenantId: "t", domain: "example.com", pages, now: new Date(0) },
      { token: TOKEN, fetchImpl: fakeSemrush({ balance: "500" }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("insufficient_units");
      expect(r.balanceBefore).toBe(500);
    }
  });

  it("ABORTS when the balance check itself fails (never blind-spends)", async () => {
    const r = await runCappedSemrushDiagnosticPull(
      { tenantId: "t", domain: "example.com", pages, now: new Date(0) },
      { token: TOKEN, fetchImpl: fakeSemrush({ balance: "ERROR 50 :: nothing" }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("balance_check_failed");
  });

  it("ABORTS with no_domain when no domain can be resolved", async () => {
    const r = await runCappedSemrushDiagnosticPull(
      { tenantId: "t", domain: "", pages, now: new Date(0) },
      { token: TOKEN, fetchImpl: fakeSemrush({ balance: "100000" }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_domain");
  });
});

describe("SEMrush unit balance", () => {
  it("parses a bare integer balance", async () => {
    const r = await fetchSemrushUnitBalance(
      { tenantId: "t" },
      { token: TOKEN, fetchImpl: (async () => new Response("123456")) as unknown as typeof fetch },
    );
    expect(r).toEqual({ ok: true, units: 123456 });
  });
  it("fails soft on a non-numeric body", async () => {
    const r = await fetchSemrushUnitBalance(
      { tenantId: "t" },
      { token: TOKEN, fetchImpl: (async () => new Response("nope")) as unknown as typeof fetch },
    );
    expect(r.ok).toBe(false);
  });
  it("fails soft on no key", async () => {
    const r = await fetchSemrushUnitBalance({ tenantId: "t" }, { token: null });
    expect(r).toEqual({ ok: false, reason: "no_key" });
  });
});

describe("SEMrush new report fetchers parse CSV", () => {
  it("url_organic maps keyword/position/volume/cpc/kd/intent to the page url", async () => {
    const csv =
      "Keyword;Position;Search Volume;CPC;Keyword Difficulty;Intent\n" +
      "alpha;3;1200;0.50;42;informational\n" +
      "beta;7;300;1.10;55;commercial\n";
    const rows = await fetchUrlOrganicKeywords(
      { tenantId: "t", url: "https://example.com/a" },
      { token: TOKEN, fetchImpl: (async () => new Response(csv)) as unknown as typeof fetch },
    );
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(2);
    expect(rows![0]).toMatchObject({ keyword: "alpha", position: 3, volume: 1200, cpc: 0.5, difficulty: 42, url: "https://example.com/a" });
  });

  it("phrase_related + phrase_questions parse volume/cpc/intent", async () => {
    const csv = "Keyword;Search Volume;CPC;Keyword Difficulty;Intent\nalpha tips;800;0.3;40;informational\n";
    const fetchImpl = (async () => new Response(csv)) as unknown as typeof fetch;
    const related = await fetchPhraseRelated({ tenantId: "t", phrase: "alpha" }, { token: TOKEN, fetchImpl });
    const questions = await fetchPhraseQuestions({ tenantId: "t", phrase: "alpha" }, { token: TOKEN, fetchImpl });
    expect(related![0]).toMatchObject({ keyword: "alpha tips", volume: 800, cpc: 0.3, intent: "informational" });
    expect(questions![0]!.keyword).toBe("alpha tips");
  });

  it("phrase fetchers return null for an empty phrase (no blind call)", async () => {
    const r = await fetchPhraseRelated({ tenantId: "t", phrase: "  " }, { token: TOKEN });
    expect(r).toBeNull();
  });
});
