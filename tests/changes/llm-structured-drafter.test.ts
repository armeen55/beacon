/**
 * callStructuredLLM boundary corpus (Core 100K Phase 6 trim of
 * src/domains/llm/structured-drafter.test.ts, 1,754 -> ~620 LOC).
 *
 * Every LLM-hardening rule keeps exactly its boundary cases:
 *   - provider gate (off unless openai) + budget fail-closed (never calls the LLM)
 *   - validate / retry-once / fail-closed; evidenceRefs required
 *   - numeric firewall: invented numbers rejected, citation metadata and
 *     product-authored methodology (proofPlan/operatorSteps/risks) exempt,
 *     and no laundering through either exemption
 *   - em-dash sanitize (style, not trust)
 *   - W5 P0-1 generation-time source verification: the model's own
 *     verified:true is never trusted, authority is recomputed from the
 *     FINAL host, span excerpt + content hash persist
 *   - G5 fetchBlocked (403/robots) vs dns/timeout distinction
 *   - G4 superlative grounding: rephrase retry, fail-closed, hard firewall
 *     on non-answer kinds
 *   - J-71 word-band retry never fails closed (the quality gate holds it)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

const { buildWinnerFewShotsMock, buildWinnerFewShotsWithPatternMock } = vi.hoisted(() => ({
  buildWinnerFewShotsMock: vi.fn(async (): Promise<string> => ""),
  buildWinnerFewShotsWithPatternMock: vi.fn(async (): Promise<{ fragment: string; patternHint: null }> => ({ fragment: "", patternHint: null })),
}));
vi.mock("@/domains/llm/winner-memory", () => ({
  buildWinnerFewShots: buildWinnerFewShotsMock,
  buildWinnerFewShotsWithPattern: buildWinnerFewShotsWithPatternMock,
}));

import {
  callStructuredLLM,
  draftAnswerBlockStructured,
  serializeStructuredDraft,
  deserializeStructuredDraft,
  type CompleteFn,
} from "@/domains/llm/structured-drafter";
import { validAnswer, fakeComplete } from "./_llm";

const GROUNDED = "persian wedding traditions sofreh aghd aghd jashn reception ceremony canopy";

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;

beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai"; // opt into the enabled path (vitest pins "deterministic")
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
  buildWinnerFewShotsMock.mockReset();
  buildWinnerFewShotsMock.mockResolvedValue("");
  buildWinnerFewShotsWithPatternMock.mockReset();
  buildWinnerFewShotsWithPatternMock.mockResolvedValue({ fragment: "", patternHint: null });
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  vi.clearAllMocks();
});

describe("callStructuredLLM - gate + budget", () => {
  it("returns 'off' when BEACON_LLM_PROVIDER is not openai", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("off");
  });

  it("returns 'blocked_budget' and never calls the LLM when the cap is hit (fail-closed)", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(validAnswer) }]));
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete });
    expect(r.status).toBe("blocked_budget");
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("callStructuredLLM - validate / retry / fail-closed", () => {
  it("drafts on a valid first response (no retry) and records spend once", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(false);
      expect(r.value.answer).toContain("sofreh aghd");
    }
    expect(recordSpendMock).toHaveBeenCalledTimes(1);
  });

  it("RETRIES ONCE on invalid JSON then drafts; FAILS CLOSED on invalid JSON twice", async () => {
    const retried = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: "not json at all" }, { text: JSON.stringify(validAnswer) }]) });
    expect(retried.status).toBe("drafted");
    if (retried.status === "drafted") expect(retried.retried).toBe(true);
    const failed = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: "nope" }, { text: "still nope" }]) });
    expect(failed.status).toBe("validation_failed");
    if (failed.status === "validation_failed") expect(failed.errors.some((e) => e.includes("non_json"))).toBe(true);
  });

  it("REJECTS a draft with no evidenceRefs (fails closed after retry)", async () => {
    const noEvidence = JSON.stringify({ ...validAnswer, evidenceRefs: [] });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: noEvidence }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.toLowerCase().includes("evidenceref"))).toBe(true);
  });

  it("REJECTS an invented multi-digit number not present in the grounding (firewall)", async () => {
    const invented = JSON.stringify({ ...validAnswer, answer: validAnswer.answer + " The tradition dates to exactly 1847 in every region." });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: invented }]) });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e.includes("firewall:invented_numbers"))).toBe(true);
  });

  const withCitationDate = (retrievedAt: string, extraAnswer = ""): string =>
    JSON.stringify({
      ...validAnswer,
      answer: validAnswer.answer + extraAnswer,
      sources: [
        {
          url: "https://en.wikipedia.org/wiki/Persian_wedding",
          title: "Persian wedding",
          domain: "wikipedia.org",
          retrievedAt,
          claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });

  it("the firewall scans PROSE only: a citation retrievedAt never fails a grounded draft, but a fabricated prose year still does", async () => {
    const clean = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withCitationDate("2026-07-11") }]) });
    expect(clean.status).toBe("drafted");
    const fabricated = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withCitationDate("2026", " The oldest ceremony on record dates to 1723.") }]) });
    expect(fabricated.status).toBe("validation_failed");
    if (fabricated.status === "validation_failed") expect(fabricated.errors.some((e) => e.includes("firewall:invented_numbers:1723"))).toBe(true);
  });

  it("no laundering: a prose number matching ONLY the citation date still fails (metadata is never added to the ledger)", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withCitationDate("2026-07-11", " The custom was codified on 2026-07-11 nationwide.") }]) });
    expect(r.status).toBe("validation_failed");
  });

  it("proofPlan/operatorSteps/risks are exempt (the pilot loop 6 killer), but prose is not, and no laundering between them", async () => {
    const withTargetInProofPlan = JSON.stringify({
      ...validAnswer,
      proofPlan: { ...validAnswer.proofPlan, metrics: [...validAnswer.proofPlan.metrics, "measure clicks for 28 days, target 100%"] },
    });
    const killer = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withTargetInProofPlan }]) });
    expect(killer.status).toBe("drafted");

    const launder = JSON.stringify({
      ...validAnswer,
      answer: validAnswer.answer + " Attendance figures show exactly 4821 guests on average.",
      proofPlan: { ...validAnswer.proofPlan, metrics: [...validAnswer.proofPlan.metrics, "target 4821 in the same window"] },
    });
    const laundered = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: launder }]) });
    expect(laundered.status).toBe("validation_failed");
    if (laundered.status === "validation_failed") expect(laundered.errors.some((e) => e.includes("firewall:invented_numbers:4821"))).toBe(true);

    const methodologyOnly = JSON.stringify({
      ...validAnswer,
      risks: ["watch for drift past 4821 impressions"],
      operatorSteps: ["Add this answer block directly under the H1, near the 4821 badge"],
    });
    const ok = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: methodologyOnly }]) });
    expect(ok.status).toBe("drafted");
  });

  it("SANITIZES em-dashes (style, not trust) instead of rejecting the draft", async () => {
    const withDash = JSON.stringify({ ...validAnswer, answer: validAnswer.answer.replace("them, followed", "them\u2014followed") });
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ text: withDash }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.value.answer).not.toContain("\u2014");
  });

  it("retries past a transient LLM error and then drafts", async () => {
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete: fakeComplete([{ error: "openai_500" }, { text: JSON.stringify(validAnswer) }]) });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.retried).toBe(true);
  });
});

describe("draftAnswerBlockStructured (concrete wrapper)", () => {
  it("builds the prompt + grounding and returns a validated draft", async () => {
    const r = await draftAnswerBlockStructured(
      { query: "persian wedding traditions", pageLabel: "Persian Wedding", brief: "sofreh aghd ceremony aghd jashn reception canopy", outline: ["Sofreh aghd", "The reception"], faqs: ["What is the sofreh aghd?"] },
      { complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]) },
    );
    expect(r.status).toBe("drafted");
  });
});

describe("serialize / deserialize (persistence projection + re-validation)", () => {
  it("round-trips a validated draft; RE-VALIDATES on read; rejects garbage/wrong version/unknown kind", () => {
    const content = serializeStructuredDraft("answer_block", validAnswer);
    const back = deserializeStructuredDraft(content);
    expect(back!.kind).toBe("answer_block");
    expect((back!.value as { answer: string }).answer).toContain("sofreh aghd");
    // A tampered row with no evidenceRefs is rejected (null).
    const tampered = serializeStructuredDraft("answer_block", { ...validAnswer, evidenceRefs: [] });
    expect(deserializeStructuredDraft(tampered)).toBeNull();
    expect(deserializeStructuredDraft("{not json")).toBeNull();
    expect(deserializeStructuredDraft(JSON.stringify({ v: 2, kind: "answer_block", value: validAnswer }))).toBeNull();
    expect(deserializeStructuredDraft(JSON.stringify({ v: 1, kind: "bogus", value: {} }))).toBeNull();
  });
});

describe("W5 P0-1 - generation-time source verification", () => {
  const withSource = (claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/persian-wedding",
          title: "Persian wedding",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim,
          authority: "unverified",
        },
      ],
    });

  it("marks a source verified (+excerpt +content hash) when the fetched page carries the claim's tokens", async () => {
    const sourceFetch = vi.fn(async () => ({
      ok: true,
      text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple with a mirror and fresh herbs.",
    }));
    const r = await callStructuredLLM({
      kind: "answer_block",
      system: "s",
      user: "u",
      grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch,
      now: new Date("2026-07-09T12:00:00.000Z"),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; verifiedAt?: string; authority: string; supportingExcerpt?: string; contentHash?: string }> }).sources[0]!;
      expect(s.verified).toBe(true);
      expect(s.verifiedAt).toBe("2026-07-09T12:00:00.000Z");
      expect(s.authority).toBe("authoritative");
      expect(s.supportingExcerpt).toContain("sofreh aghd");
      expect(s.contentHash).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(sourceFetch).toHaveBeenCalledTimes(1);
  });

  it("downgrades to weak + verified:false on an unreachable URL or a content mismatch", async () => {
    const unreachable = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch: vi.fn(async () => ({ ok: false, text: "" })),
    });
    expect(unreachable.status).toBe("drafted");
    if (unreachable.status === "drafted") {
      const s = (unreachable.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
    }
    const mismatch = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch: vi.fn(async () => ({ ok: true, text: "This page is about unrelated kitchen appliance reviews and shipping policies only." })),
    });
    expect(mismatch.status).toBe("drafted");
    if (mismatch.status === "drafted") {
      const s = (mismatch.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
    }
  });

  it("never fetches when a draft carries no sources; hermetic under vitest with no sourceFetch injected", async () => {
    const sourceFetch = vi.fn(async () => ({ ok: true, text: "unused" }));
    const noSources = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: JSON.stringify(validAnswer) }]),
      sourceFetch,
    });
    expect(noSources.status).toBe("drafted");
    expect(sourceFetch).not.toHaveBeenCalled();

    const noFetcher = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
    });
    expect(noFetcher.status).toBe("drafted");
    if (noFetcher.status === "drafted") {
      expect((noFetcher.value as { sources: Array<{ verified?: boolean }> }).sources[0]!.verified).toBe(false);
    }
  });

  it("resets an LLM-supplied verified:true BEFORE fetching (an unreachable source stays unverified)", async () => {
    const lyingDraft = JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/persian-wedding",
          title: "Persian wedding",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
          authority: "authoritative",
          verified: true,
        },
      ],
    });
    const r = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: lyingDraft }]),
      sourceFetch: vi.fn(async () => ({ ok: false, text: "" })),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; verifiedAt?: string; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false); // the model's true was wiped before the fetch
      expect(s.verifiedAt).toBeUndefined();
      expect(s.authority).toBe("weak");
    }
  });

  it("recomputes authority from the FINAL host: redirect to untrusted is weak; redirect to authoritative verifies + rewrites url/domain", async () => {
    const toUntrusted = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch: vi.fn(async () => ({
        ok: true,
        finalUrl: "https://random-blog.example/reposted",
        text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple.",
      })),
    });
    expect(toUntrusted.status).toBe("drafted");
    if (toUntrusted.status === "drafted") {
      const s = (toUntrusted.value as { sources: Array<{ verified?: boolean; authority: string }> }).sources[0]!;
      expect(s.verified).toBe(false);
      expect(s.authority).toBe("weak");
    }

    const proposedWeak = JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://random-blog.example/x",
          title: "x",
          domain: "random-blog.example",
          retrievedAt: "2026",
          claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
          authority: "unverified",
        },
      ],
    });
    const toAuthoritative = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: proposedWeak }]),
      sourceFetch: vi.fn(async () => ({
        ok: true,
        finalUrl: "https://www.britannica.com/topic/persian-wedding",
        text: "A Persian wedding centers on the sofreh aghd ceremonial spread laid before the couple.",
      })),
      now: new Date("2026-07-09T12:00:00.000Z"),
    });
    expect(toAuthoritative.status).toBe("drafted");
    if (toAuthoritative.status === "drafted") {
      const s = (toAuthoritative.value as { sources: Array<{ verified?: boolean; authority: string; domain: string; url: string }> }).sources[0]!;
      expect(s.verified).toBe(true);
      expect(s.authority).toBe("authoritative");
      expect(s.domain).toBe("britannica.com");
      expect(s.url).toBe("https://www.britannica.com/topic/persian-wedding");
    }
  });
});

describe("W5 P2 - answer-block word-count retry (never caches a too-thin answer)", () => {
  const THIN =
    "Persian hospitality traditionally revolves around continuously offering guests freshly brewed tea throughout their entire visit, alongside assorted confectioneries, fragrant pastries, and seasonal fruit arranged beautifully across decorative serving platters. Conversation, storytelling, and unhurried companionship characterize these gatherings, reflecting deeply rooted cultural expectations surrounding generosity, warmth, respect, and reciprocal kindness shown between welcoming hosts and their appreciative visitors.";

  it("retries once with a length instruction when the first answer is under 80 words, then ships the full answer", async () => {
    const systems: string[] = [];
    let i = 0;
    const complete: CompleteFn = async ({ system }) => {
      systems.push(system);
      return { text: [JSON.stringify({ ...validAnswer, answer: THIN }), JSON.stringify(validAnswer)][i++]! };
    };
    const r = await callStructuredLLM({ kind: "answer_block", system: "s", user: "u", grounded: GROUNDED, complete, recentOutputs: [] });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(true);
      expect((r.value as { answer: string }).answer).toBe(validAnswer.answer);
    }
    expect(systems[1]).toContain("80 to 150 words");
  });

  it("ships the thin answer as-is when the retry is still short (never fails closed; the gate holds it)", async () => {
    const r = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: JSON.stringify({ ...validAnswer, answer: THIN }) }]),
      recentOutputs: [],
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      expect(r.retried).toBe(true);
      expect((r.value as { answer: string }).answer).toBe(THIN);
    }
  });
});

describe("G5 - fetchBlocked (403/robots) vs dns/timeout distinction", () => {
  const withBritannica = (claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      sources: [
        {
          url: "https://www.britannica.com/topic/persian-wedding",
          title: "Persian wedding",
          domain: "britannica.com",
          retrievedAt: "2026",
          claim,
          authority: "unverified",
        },
      ],
    });
  const withBlog = (claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      sources: [
        { url: "https://some-blog.example/x", title: "Blog", domain: "some-blog.example", retrievedAt: "2026", claim, authority: "unverified" },
      ],
    });

  it("a 403 block on an authority-strong domain -> authoritative + verified:false + fetchBlocked:true", async () => {
    const r = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withBritannica("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch: vi.fn(async () => ({ ok: false, text: "", blocked: true })),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") {
      const s = (r.value as { sources: Array<{ verified?: boolean; authority: string; fetchBlocked?: boolean }> }).sources[0]!;
      expect(s.authority).toBe("authoritative");
      expect(s.verified).toBe(false);
      expect(s.fetchBlocked).toBe(true);
    }
  });

  it("a dns/timeout fetch stays weak with NO fetchBlocked; a 403 on a NON-authoritative domain stays weak too", async () => {
    const dns = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withBritannica("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch: vi.fn(async () => ({ ok: false, text: "" })), // no `blocked` flag
    });
    expect(dns.status).toBe("drafted");
    if (dns.status === "drafted") {
      const s = (dns.value as { sources: Array<{ authority: string; fetchBlocked?: boolean }> }).sources[0]!;
      expect(s.authority).toBe("weak");
      expect(s.fetchBlocked).toBeUndefined();
    }
    const blockedBlog = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withBlog("a Persian wedding centers on the sofreh aghd ceremonial spread") }]),
      sourceFetch: vi.fn(async () => ({ ok: false, text: "", blocked: true })),
    });
    expect(blockedBlog.status).toBe("drafted");
    if (blockedBlog.status === "drafted") {
      const s = (blockedBlog.value as { sources: Array<{ authority: string; fetchBlocked?: boolean }> }).sources[0]!;
      expect(s.authority).toBe("weak");
      expect(s.fetchBlocked).toBeUndefined();
    }
  });
});

describe("G4 - superlative grounding, rephrase retry, fail-closed", () => {
  const SUPERLATIVE_ANSWER = "Googoosh is the most famous Iranian pop singer. " + validAnswer.answer;
  const GROUNDED_ANSWER = validAnswer.answer; // no superlative

  const withSource = (answer: string, claim: string): string =>
    JSON.stringify({
      ...validAnswer,
      answer,
      sources: [
        { url: "https://www.britannica.com/biography/googoosh", title: "Googoosh", domain: "britannica.com", retrievedAt: "2026", claim, authority: "unverified" },
      ],
    });

  it("a superlative ASSERTED by a verified source drafts on the FIRST attempt", async () => {
    const r = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u",
      grounded: GROUNDED + " googoosh most famous iranian pop singer",
      complete: fakeComplete([{ text: withSource(SUPERLATIVE_ANSWER, "Googoosh is the most famous Iranian pop singer") }]),
      sourceFetch: vi.fn(async () => ({
        ok: true,
        text: "Googoosh is widely regarded as the most famous Iranian pop singer of her generation.",
      })),
    });
    expect(r.status).toBe("drafted");
    if (r.status === "drafted") expect(r.retried).toBe(false);
  });

  it("an UNGROUNDED superlative triggers ONE rephrase retry; ungrounded on BOTH attempts fails closed", async () => {
    const nonSuperlativeFetch = () =>
      vi.fn(async () => ({
        ok: true,
        text: "Persian weddings center on the sofreh aghd ceremonial spread laid before the couple.",
      }));
    const rephrased = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([
        { text: withSource(SUPERLATIVE_ANSWER, "Persian weddings center on the sofreh aghd ceremonial spread") },
        { text: withSource(GROUNDED_ANSWER, "Persian weddings center on the sofreh aghd ceremonial spread") },
      ]),
      sourceFetch: nonSuperlativeFetch(),
    });
    expect(rephrased.status).toBe("drafted");
    if (rephrased.status === "drafted") {
      expect(rephrased.retried).toBe(true);
      expect((rephrased.value as { answer: string }).answer).toBe(GROUNDED_ANSWER);
    }
    const failed = await callStructuredLLM({
      kind: "answer_block", system: "s", user: "u", grounded: GROUNDED,
      complete: fakeComplete([{ text: withSource(SUPERLATIVE_ANSWER, "Persian weddings center on the sofreh aghd ceremonial spread") }]),
      sourceFetch: nonSuperlativeFetch(),
    });
    expect(failed.status).toBe("validation_failed");
    if (failed.status === "validation_failed") expect(failed.errors.some((e) => e.startsWith("superlative_ungrounded"))).toBe(true);
  });

  it("a marketing superlative on a NON-answer kind is still a hard firewall reject", async () => {
    const atomic = {
      field: "title",
      before: "Persian Wedding Traditions",
      after: "The best Persian wedding guide",
      rationale: "clearer",
      evidenceRefs: [{ source: "gsc", detail: "the page earns impressions" }],
      confidence: "high",
      risks: [],
      operatorSteps: ["Update the title"],
      proofPlan: { metrics: ["ctr"], windowsDays: [7, 14, 28], controls: "unchanged siblings" },
    };
    const r = await callStructuredLLM({
      kind: "atomic_edit", system: "s", user: "u",
      grounded: "persian wedding traditions",
      complete: fakeComplete([{ text: JSON.stringify(atomic) }]),
    });
    expect(r.status).toBe("validation_failed");
    if (r.status === "validation_failed") expect(r.errors.some((e) => e === "firewall:superlative")).toBe(true);
  });
});
