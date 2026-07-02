import { describe, it, expect } from "vitest";
import { citationLossAlert, type CitationLossAlertInput } from "./citation-loss-alert";
import type { CitationLossFinding } from "@/domains/ai-visibility/citation-loss";
import type { SovDropAlert } from "@/domains/ai-visibility/sov-weekly";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const SIGNAL_AT = "2026-07-02T12:00:00Z"; // 2026-W27

function finding(overrides: Partial<CitationLossFinding> & { prompt: string; topic: string }): CitationLossFinding {
  return {
    kind: "citation_loss",
    priorCitingModels: ["ChatGPT"],
    priorCitationCount: 4,
    recentAnsweringModels: ["ChatGPT"],
    competitor: { domain: "rival.com", citingAnswerCount: 3 },
    headlineFact: { fact: "Rival leads with a fresh fact.", model: "ChatGPT" },
    ...overrides,
  };
}

function baseInput(overrides: Partial<CitationLossAlertInput> = {}): CitationLossAlertInput {
  return {
    tenantId: "tenant-iranopedia",
    findings: [],
    sovDropAlertsThisWeek: [],
    siteRootUrl: "https://iranopedia.com/",
    signalAt: SIGNAL_AT,
    ...overrides,
  };
}

describe("citationLossAlert", () => {
  it("abstains when there is no configured site-root URL", () => {
    const rows = citationLossAlert(baseInput({ siteRootUrl: null, findings: [finding({ prompt: "p", topic: "t" })] }));
    expect(rows).toEqual([]);
  });

  it("abstains when there are no findings", () => {
    expect(citationLossAlert(baseInput({ findings: [] }))).toEqual([]);
  });

  it("emits one candidate per citation loss, anchored on the site root", () => {
    const rows = citationLossAlert(
      baseInput({ findings: [finding({ prompt: "What is Chaharshanbe Suri", topic: "Chaharshanbe Suri" })] }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_url).toBe("https://iranopedia.com/");
    expect(rows[0].action_type).toBe("add_answer_block");
    expect(rows[0].trigger_signal).toBe("citation_loss_alert");
    expect(rows[0].generator_kind).toBe("deterministic");
  });

  it("ranks worst loss first (highest priorCitationCount)", () => {
    const rows = citationLossAlert(
      baseInput({
        findings: [
          finding({ prompt: "small loss", topic: "small", priorCitationCount: 2 }),
          finding({ prompt: "big loss", topic: "big", priorCitationCount: 9 }),
        ],
      }),
    );
    expect(rows.map((r) => r.topic_cluster_label)).toEqual([
      "citation_loss:big:big loss",
      "citation_loss:small:small loss",
    ]);
  });

  it("caps emissions at maxCandidates (default 3)", () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      finding({ prompt: `prompt-${i}`, topic: `topic-${i}`, priorCitationCount: i + 1 }),
    );
    const rows = citationLossAlert(baseInput({ findings }));
    expect(rows).toHaveLength(3);
  });

  it("respects a custom maxCandidates", () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      finding({ prompt: `prompt-${i}`, topic: `topic-${i}`, priorCitationCount: i + 1 }),
    );
    const rows = citationLossAlert(baseInput({ findings, maxCandidates: 1 }));
    expect(rows).toHaveLength(1);
  });

  // ── Dedupe vs sov_drop_alert ───────────────────────────────────────────
  describe("dedupe vs sov_drop_alert", () => {
    function sovAlert(overrides: Partial<SovDropAlert> = {}): SovDropAlert {
      return {
        engine: "chatgpt",
        topic: "Chaharshanbe Suri",
        weekKey: "2026-W27",
        priorWeekKey: "2026-W26",
        priorShare: 0.8,
        currentShare: 0,
        dropPoints: 80,
        promptsPolled: 5,
        droppedToZero: true,
        flippedPrompts: [],
        headline: "ChatGPT stopped mentioning you on Chaharshanbe Suri this week.",
        ...overrides,
      };
    }

    it("skips a citation loss whose topic matches an sov_drop_alert already fired THIS week", () => {
      const rows = citationLossAlert(
        baseInput({
          findings: [finding({ prompt: "What is Chaharshanbe Suri", topic: "Chaharshanbe Suri" })],
          sovDropAlertsThisWeek: [sovAlert()],
        }),
      );
      expect(rows).toEqual([]);
    });

    it("is case- and whitespace-insensitive when matching topics for dedupe", () => {
      const rows = citationLossAlert(
        baseInput({
          findings: [finding({ prompt: "p", topic: "  chaharshanbe suri  " })],
          sovDropAlertsThisWeek: [sovAlert({ topic: "Chaharshanbe Suri" })],
        }),
      );
      expect(rows).toEqual([]);
    });

    it("does NOT skip when the sov_drop_alert is for a DIFFERENT topic", () => {
      const rows = citationLossAlert(
        baseInput({
          findings: [finding({ prompt: "p", topic: "Nowruz Traditions" })],
          sovDropAlertsThisWeek: [sovAlert({ topic: "Chaharshanbe Suri" })],
        }),
      );
      expect(rows).toHaveLength(1);
    });

    it("does NOT skip when the sov_drop_alert is for the SAME topic but a DIFFERENT week", () => {
      const rows = citationLossAlert(
        baseInput({
          findings: [finding({ prompt: "p", topic: "Chaharshanbe Suri" })],
          sovDropAlertsThisWeek: [sovAlert({ weekKey: "2026-W20" })],
        }),
      );
      expect(rows).toHaveLength(1);
    });

    it("only skips the overlapping finding, not unrelated findings in the same batch", () => {
      const rows = citationLossAlert(
        baseInput({
          findings: [
            finding({ prompt: "overlap", topic: "Chaharshanbe Suri", priorCitationCount: 9 }),
            finding({ prompt: "unique", topic: "Nowruz Traditions", priorCitationCount: 1 }),
          ],
          sovDropAlertsThisWeek: [sovAlert()],
        }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].topic_cluster_label).toContain("unique");
    });
  });

  it("card copy names the engine, the prompt, the competitor, and the prior citation count", () => {
    const rows = citationLossAlert(
      baseInput({
        findings: [
          finding({
            prompt: "What is Chaharshanbe Suri",
            topic: "Chaharshanbe Suri",
            priorCitingModels: ["ChatGPT"],
            competitor: { domain: "en.wikipedia.org", citingAnswerCount: 2 },
            headlineFact: { fact: "It is Iran's fire festival.", model: "ChatGPT" },
            priorCitationCount: 6,
          }),
        ],
      }),
    );
    const copy = rows[0].customer_copy;
    expect(copy).toContain("ChatGPT");
    expect(copy).toContain("What is Chaharshanbe Suri");
    expect(copy).toContain("en.wikipedia.org");
    expect(copy).toContain("6");
    expect(hasBannedDash(copy)).toBe(false);
  });

  it("card copy handles a citation loss with no identified competitor domain", () => {
    const rows = citationLossAlert(
      baseInput({
        findings: [
          finding({
            prompt: "x",
            topic: "x",
            competitor: { domain: null, citingAnswerCount: 0 },
            headlineFact: null,
          }),
        ],
      }),
    );
    expect(rows[0].customer_copy).not.toContain("null");
    expect(hasBannedDash(rows[0].customer_copy)).toBe(false);
  });

  it("emits at medium confidence, or high when priorCitationCount is large", () => {
    const [lowLoss] = citationLossAlert(baseInput({ findings: [finding({ prompt: "p1", topic: "t1", priorCitationCount: 2 })] }));
    const [bigLoss] = citationLossAlert(baseInput({ findings: [finding({ prompt: "p2", topic: "t2", priorCitationCount: 8 })] }));
    expect(lowLoss.confidence).toBe("medium");
    expect(lowLoss.impact_estimate).toBe("medium");
    expect(bigLoss.impact_estimate).toBe("high");
  });

  it("produces stable dedupe_key and cooldown_key hashes for the same inputs", () => {
    const input = baseInput({ findings: [finding({ prompt: "p", topic: "t" })] });
    const first = citationLossAlert(input);
    const second = citationLossAlert(input);
    expect(first[0].dedupe_key).toBe(second[0].dedupe_key);
    expect(first[0].cooldown_key).toBe(second[0].cooldown_key);
  });

  it("never emits a safety flag (deterministic, directive-only action)", () => {
    const rows = citationLossAlert(baseInput({ findings: [finding({ prompt: "p", topic: "t" })] }));
    expect(rows[0].safety_flags).toEqual([]);
  });
});
