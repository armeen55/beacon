/**
 * stale-fact-trigger tests (BEACON_500 R13b / N25 + N27, 2026-07-03): the
 * exact pinned stale sentence (old, never wrong), the sitewide sweep
 * (grouped by page, ranked by traffic), the cap, the SHARED cap-3 slot where
 * conflicts outrank stale checks, byte-identical-when-empty, and the no-dash
 * hard rule. stale_fact::watch has no promotion-eligibility entry, so it can
 * never auto-push.
 */
import { describe, expect, it } from "vitest";

import {
  claimTriggerSlot,
  findStaleFactFindings,
  staleFactCandidates,
  staleFactSentence,
  MAX_STALE_FACT_CANDIDATES,
} from "./stale-fact-trigger";
import type { ClaimRecord } from "./claim-graph";

const NOW = "2026-07-03T00:00:00.000Z";

const rec = (over: Partial<ClaimRecord> & { id: string }): ClaimRecord => ({
  tenant_id: "tenant-x",
  claimText: "The population of Iran reached 85 million in 2023.",
  subject: ["population", "iran", "reached", "million"],
  subjectKey: "iran|million|population|reached::date",
  value: { kind: "date", raw: "2023", normalized: "2023" },
  sources: [],
  firstSeenAt: "2025-11-05T00:00:00.000Z",
  lastConfirmedAt: "2025-11-05T00:00:00.000Z", // 8 months before NOW
  affectedPages: ["https://site.com/iran-population"],
  volatilityClass: "fast",
  status: "stale_check_due",
  ...over,
});

const stalePage = (n: number, traffic0urls = "https://site.com/stale-"): ClaimRecord =>
  rec({
    id: `cl-stale-${n}`,
    subjectKey: `stale${n}::date`,
    affectedPages: [`${traffic0urls}${n}`],
  });

/** Two records on the same subject, materially different dates, two pages -
 *  exactly what findClaimConflicts flags. */
const conflictPair = (n: number): ClaimRecord[] => [
  rec({
    id: `cl-a${n}`,
    claimText: "Persepolis was built in 515 BC.",
    subject: ["persepolis", "built"],
    subjectKey: `built|persepoli${n}::date`,
    value: { kind: "date", raw: "515 BC", normalized: "515 bc" },
    affectedPages: [`https://site.com/conflict-a${n}`],
    status: "conflicting",
  }),
  rec({
    id: `cl-b${n}`,
    claimText: "Persepolis was built in 518 BC.",
    subject: ["persepolis", "built"],
    subjectKey: `built|persepoli${n}::date`,
    value: { kind: "date", raw: "518 BC", normalized: "518 bc" },
    affectedPages: [`https://site.com/conflict-b${n}`],
    status: "conflicting",
  }),
];

describe("staleFactSentence (pinned, law 2: old, never wrong)", () => {
  it("emits the exact pinned population sentence", () => {
    const [finding] = findStaleFactFindings([rec({ id: "cl-pop" })]);
    expect(staleFactSentence(finding!, NOW)).toBe(
      "Your /iran-population page cites a 2023 population figure I last confirmed 8 months ago. Numbers like this age; worth a fresh check.",
    );
  });

  it("never asserts the fact is wrong, only that it is old", () => {
    const [finding] = findStaleFactFindings([rec({ id: "cl-pop" })]);
    const sentence = staleFactSentence(finding!, NOW).toLowerCase();
    for (const banned of ["wrong", "incorrect", "false", "outdated", "error"]) {
      expect(sentence).not.toContain(banned);
    }
    expect(sentence).toContain("worth a fresh check");
  });

  it("labels a year-free date claim as a date, not a figure", () => {
    const [finding] = findStaleFactFindings([
      rec({
        id: "cl-bc",
        claimText: "Persepolis was built in 515 BC.",
        subject: ["persepolis", "built"],
        subjectKey: "built|persepoli::date",
        value: { kind: "date", raw: "515 BC", normalized: "515 bc" },
        affectedPages: ["https://site.com/persepolis"],
      }),
    ]);
    expect(staleFactSentence(finding!, NOW)).toBe(
      "Your /persepolis page cites a persepolis date I last confirmed 8 months ago. Dates like this age; worth a fresh check.",
    );
  });
});

describe("findStaleFactFindings (the sitewide sweep)", () => {
  it("only sweeps stale_check_due claims and skips claims with no owned-page home", () => {
    const findings = findStaleFactFindings([
      rec({ id: "cl-1", status: "consistent" }),
      rec({ id: "cl-2", status: "conflicting" }),
      rec({ id: "cl-3", status: "stale_check_due", affectedPages: [] }),
      rec({ id: "cl-4", status: "stale_check_due" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.claim.id).toBe("cl-4");
  });

  it("groups by page (one finding per page, counting the rest)", () => {
    const findings = findStaleFactFindings([
      rec({ id: "cl-1", subjectKey: "one::date" }),
      rec({ id: "cl-2", subjectKey: "two::date" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.claim.id).toBe("cl-1");
    expect(findings[0]!.staleClaimsOnPage).toBe(2);
  });

  it("ranks pages by traffic, highest first", () => {
    const traffic = new Map([
      ["https://site.com/stale-1", 10],
      ["https://site.com/stale-2", 900],
      ["https://site.com/stale-3", 40],
    ]);
    const findings = findStaleFactFindings([stalePage(1), stalePage(2), stalePage(3)], {
      trafficFor: (url) => traffic.get(url) ?? 0,
    });
    expect(findings.map((f) => f.pagePath)).toEqual(["/stale-2", "/stale-3", "/stale-1"]);
  });

  it("is byte-identical empty when nothing is stale", () => {
    expect(findStaleFactFindings([rec({ id: "cl-1", status: "consistent" })])).toEqual([]);
    expect(findStaleFactFindings([])).toEqual([]);
  });
});

describe("staleFactCandidates (the trigger rows)", () => {
  const findings = findStaleFactFindings([stalePage(1), stalePage(2), stalePage(3), stalePage(4)]);

  it("caps at MAX_STALE_FACT_CANDIDATES (3)", () => {
    expect(MAX_STALE_FACT_CANDIDATES).toBe(3);
    expect(staleFactCandidates({ tenantId: "tenant-x", findings, nowIso: NOW, signalAt: NOW })).toHaveLength(3);
  });

  it("emits watch candidates (no promotion path, never auto-pushes) with honest evidence", () => {
    const row = staleFactCandidates({ tenantId: "tenant-x", findings, nowIso: NOW, signalAt: NOW })[0]!;
    expect(row.trigger_signal).toBe("stale_fact");
    expect(row.action_type).toBe("watch");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.target_url).toBe(findings[0]!.pageUrl);
    expect(row.confidence).toBe("medium");
    expect(row.evidence[0]!.detail).toContain("deadline_days=180");
    expect(row.operator_evidence).toContain("signal=stale_fact");
    expect(row.dedupe_key).toBeTruthy();
    expect(row.cooldown_key).toBeTruthy();
    expect(row.safety_flags).toEqual([]);
  });

  it("is byte-identical empty with no findings or no room", () => {
    expect(staleFactCandidates({ tenantId: "tenant-x", findings: [], nowIso: NOW, signalAt: NOW })).toEqual([]);
    expect(
      staleFactCandidates({ tenantId: "tenant-x", findings, nowIso: NOW, signalAt: NOW, maxCandidates: 0 }),
    ).toEqual([]);
  });

  it("never emits an em or en dash in customer copy or operator evidence", () => {
    for (const row of staleFactCandidates({ tenantId: "tenant-x", findings, nowIso: NOW, signalAt: NOW })) {
      expect(row.customer_copy).not.toMatch(/[–—]/);
      expect(row.operator_evidence).not.toMatch(/[–—]/);
    }
  });
});

describe("claimTriggerSlot (ONE shared cap-3 slot; conflicts outrank)", () => {
  it("conflicts fill first, stale checks take the remaining room", () => {
    const records = [...conflictPair(1), ...conflictPair(2), stalePage(1), stalePage(2)];
    const rows = claimTriggerSlot({ tenantId: "tenant-x", records, nowIso: NOW, signalAt: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.trigger_signal)).toEqual(["claim_conflict", "claim_conflict", "stale_fact"]);
  });

  it("three conflicts leave no room for stale checks", () => {
    const records = [...conflictPair(1), ...conflictPair(2), ...conflictPair(3), stalePage(1)];
    const rows = claimTriggerSlot({ tenantId: "tenant-x", records, nowIso: NOW, signalAt: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.trigger_signal === "claim_conflict")).toBe(true);
  });

  it("with no conflicts the stale sweep can use the whole slot", () => {
    const records = [stalePage(1), stalePage(2), stalePage(3), stalePage(4)];
    const rows = claimTriggerSlot({ tenantId: "tenant-x", records, nowIso: NOW, signalAt: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.trigger_signal === "stale_fact")).toBe(true);
  });

  it("is byte-identical empty on an empty or quiet graph", () => {
    expect(claimTriggerSlot({ tenantId: "tenant-x", records: [], nowIso: NOW, signalAt: NOW })).toEqual([]);
    expect(
      claimTriggerSlot({
        tenantId: "tenant-x",
        records: [rec({ id: "cl-fresh", status: "consistent" })],
        nowIso: NOW,
        signalAt: NOW,
      }),
    ).toEqual([]);
  });
});
