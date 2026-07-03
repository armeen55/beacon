/**
 * fact-propagation tests (BEACON_500 R13b / N26, 2026-07-03): a shipped
 * correction finds every OTHER page still carrying the old value (excluding
 * the corrected page), emits ONE bundled plan per correction with the pinned
 * sentence, prepares the same one-line fix per carrier, emits once only
 * (propagationPlannedAt), stays byte-identical when nothing was corrected,
 * and never carries an em or en dash.
 */
import { describe, expect, it } from "vitest";

import {
  buildFactPropagationPlan,
  findFactCorrections,
  prepareCarrierFix,
  propagationCarriers,
  propagationKindWord,
  propagationSummary,
} from "./fact-propagation";
import { findClaimSentence, type ClaimRecord } from "./claim-graph";

const NOW = "2026-07-03T00:00:00.000Z";

const oldRecord = (over?: Partial<ClaimRecord>): ClaimRecord => ({
  tenant_id: "tenant-x",
  id: "cl-old",
  claimText: "Persepolis was built in 515 BC.",
  subject: ["persepolis", "built"],
  subjectKey: "built|persepoli::date",
  value: { kind: "date", raw: "515 BC", normalized: "515 bc" },
  sources: [],
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastConfirmedAt: "2026-01-01T00:00:00.000Z",
  affectedPages: [
    "https://site.com/persepolis",
    "https://site.com/iran-history",
    "https://site.com/achaemenid-empire",
    "https://site.com/timeline",
  ],
  volatilityClass: "fast",
  status: "consistent",
  ...over,
});

const registered = (over?: Partial<ClaimRecord>): ClaimRecord => ({
  ...oldRecord(),
  id: "cl-new",
  claimText: "Persepolis was built in 518 BC.",
  value: { kind: "date", raw: "518 BC", normalized: "518 bc" },
  affectedPages: ["https://site.com/persepolis"],
  ...over,
});

describe("findFactCorrections", () => {
  it("finds the correction when a shipped claim materially differs on the same subject", () => {
    const corrections = findFactCorrections({ existing: [oldRecord()], registered: [registered()] });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.oldRecord.id).toBe("cl-old");
    expect(corrections[0]!.newValue.raw).toBe("518 BC");
  });

  it("emits once only: a record with propagationPlannedAt set never plans again", () => {
    const planned = oldRecord({ propagationPlannedAt: "2026-06-01T00:00:00.000Z" });
    expect(findFactCorrections({ existing: [planned], registered: [registered()] })).toEqual([]);
  });

  it("is byte-identical empty when the shipped value matches (no correction happened)", () => {
    const same = registered({ value: { kind: "date", raw: "515 BC", normalized: "515 bc" } });
    expect(findFactCorrections({ existing: [oldRecord()], registered: [same] })).toEqual([]);
    expect(findFactCorrections({ existing: [], registered: [registered()] })).toEqual([]);
  });

  it("one correction per old record even when several shipped claims hit it", () => {
    const corrections = findFactCorrections({
      existing: [oldRecord()],
      registered: [registered(), registered({ id: "cl-new-2" })],
    });
    expect(corrections).toHaveLength(1);
  });
});

describe("propagationCarriers (every OTHER affected page)", () => {
  it("excludes the corrected page and keeps the rest in order", () => {
    const carriers = propagationCarriers(oldRecord(), "https://site.com/persepolis");
    expect(carriers.map((c) => c.pagePath)).toEqual([
      "/iran-history",
      "/achaemenid-empire",
      "/timeline",
    ]);
  });

  it("is empty when the corrected page was the only carrier", () => {
    const solo = oldRecord({ affectedPages: ["https://site.com/persepolis"] });
    expect(propagationCarriers(solo, "https://site.com/persepolis")).toEqual([]);
  });
});

describe("prepareCarrierFix (the same one-line fix)", () => {
  const pageText =
    "The terrace covers the hillside. Persepolis was built in 515 BC. Visitors arrive from Shiraz.";

  it("swaps the old value inside the exact stored sentence", () => {
    const sentence = findClaimSentence(pageText, oldRecord());
    const fix = prepareCarrierFix({
      pageUrl: "https://site.com/iran-history",
      pagePath: "/iran-history",
      sentence,
      oldValueRaw: "515 BC",
      newValueRaw: "518 BC",
    });
    expect(fix.currentLine).toBe("Persepolis was built in 515 BC.");
    expect(fix.proposedLine).toBe("Persepolis was built in 518 BC.");
    expect(fix.instruction).toBe(
      'On /iran-history, replace "Persepolis was built in 515 BC." with "Persepolis was built in 518 BC.".',
    );
  });

  it("falls back to a plain swap instruction when the stored sentence is gone", () => {
    const fix = prepareCarrierFix({
      pageUrl: "https://site.com/timeline",
      pagePath: "/timeline",
      sentence: null,
      oldValueRaw: "515 BC",
      newValueRaw: "518 BC",
    });
    expect(fix.currentLine).toBeNull();
    expect(fix.proposedLine).toBeNull();
    expect(fix.instruction).toBe("Open /timeline and swap 515 BC for 518 BC.");
  });
});

describe("propagation plan (pinned bundled sentence)", () => {
  const plan = buildFactPropagationPlan({
    tenantId: "tenant-x",
    correction: { oldRecord: oldRecord(), newValue: registered().value },
    correctedPageUrl: "https://site.com/persepolis",
    carriers: propagationCarriers(oldRecord(), "https://site.com/persepolis").map((c) =>
      prepareCarrierFix({ ...c, sentence: null, oldValueRaw: "515 BC", newValueRaw: "518 BC" }),
    ),
    nowIso: NOW,
  });

  it("emits the exact pinned bundled sentence", () => {
    expect(plan.summary).toBe(
      "You fixed the year Persepolis was built on /persepolis. The old year still appears on 3 other pages: /iran-history, /achaemenid-empire, /timeline. I prepared the same one-line fix for each.",
    );
  });

  it("uses the singular form for one carrier", () => {
    expect(
      propagationSummary({
        subjectLabel: "the year Persepolis was built",
        correctedPagePath: "/persepolis",
        kindWord: "year",
        carrierPaths: ["/iran-history"],
      }),
    ).toBe(
      "You fixed the year Persepolis was built on /persepolis. The old year still appears on 1 other page: /iran-history. I prepared the same one-line fix for it.",
    );
  });

  it("carries the correction identity and a stable id", () => {
    expect(plan.claimId).toBe("cl-old");
    expect(plan.oldValue).toBe("515 BC");
    expect(plan.newValue).toBe("518 BC");
    expect(plan.correctedPagePath).toBe("/persepolis");
    expect(plan.plannedAt).toBe(NOW);
    expect(plan.id).toMatch(/^prop-/);
    const again = buildFactPropagationPlan({
      tenantId: "tenant-x",
      correction: { oldRecord: oldRecord(), newValue: registered().value },
      correctedPageUrl: "https://site.com/persepolis",
      carriers: [],
      nowIso: "2026-08-01T00:00:00.000Z",
    });
    expect(again.id).toBe(plan.id); // same claim + same new value = same plan
  });

  it("picks the plain kind word by value shape", () => {
    expect(propagationKindWord({ kind: "date", raw: "515 BC", normalized: "515 bc" })).toBe("year");
    expect(propagationKindWord({ kind: "date", raw: "March 20", normalized: "march 20" })).toBe("date");
    expect(propagationKindWord({ kind: "number", raw: "1,200", normalized: "1200" })).toBe("number");
  });

  it("never emits an em or en dash anywhere on the plan", () => {
    const everything = [plan.summary, ...plan.carriers.map((c) => c.instruction)].join(" ");
    expect(everything).not.toMatch(/[–—]/);
  });
});
