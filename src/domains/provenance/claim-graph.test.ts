/**
 * claim-graph tests (BEACON_500 R13 / N3, 2026-07-03).
 *
 * Extractor fixtures (numbers/dates/definitions, token floors), conflict
 * detection (materially-different rule: numbers > 5 percent or dates differ,
 * never punctuation), reliability rules, cap ordering (highest-traffic pages
 * first), volatility defaults, shipped-draft registration, the pinned
 * surface lines, and byte-identical-when-empty at the evidence seam.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildClaimGraph,
  claimEvidenceForDraft,
  extractClaimsFromText,
  findClaimConflicts,
  makeSource,
  mergeRegisteredRecords,
  registrationRecordsForDraft,
  reliabilityForSource,
  subjectLabelFor,
  valuesMateriallyDiffer,
  volatilityFor,
  formatClaimSourceLine,
  MAX_CLAIMS_PER_TENANT,
  type ClaimRecord,
  type ClaimValue,
  type PageTextInput,
} from "./claim-graph";

const NOW = "2026-07-03T00:00:00.000Z";

const page = (over: Partial<PageTextInput> & { url: string; text: string }): PageTextInput => ({
  traffic: 0,
  observedAt: "2026-03-15T00:00:00.000Z",
  ...over,
});

function graphOf(pages: PageTextInput[], extra?: Partial<Parameters<typeof buildClaimGraph>[0]>): ClaimRecord[] {
  return buildClaimGraph({ tenantId: "tenant-x", pages, nowIso: NOW, ...extra });
}

describe("extractClaimsFromText", () => {
  it("extracts a date claim (BC year) with its distinguishing tokens", () => {
    const claims = extractClaimsFromText("Persepolis was built in 515 BC.");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.value).toEqual({ kind: "date", raw: "515 BC", normalized: "515 bc" });
    expect(claims[0]!.subject).toEqual(["persepolis", "built"]);
    // Key tokens are plural-folded so "column"/"columns" phrasings group;
    // "persepolis" folds to "persepoli" in the KEY only (never displayed).
    expect(claims[0]!.subjectKey).toBe("built|persepoli::date");
  });

  it("extracts a modern year as a date claim", () => {
    const claims = extractClaimsFromText("The Nowruz festival begins in 2026 across Iran.");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.value.kind).toBe("date");
    expect(claims[0]!.value.raw).toBe("2026");
  });

  it("extracts a number claim (counts) when no date is present", () => {
    const claims = extractClaimsFromText("The Persian cat weighs 12 pounds on average.");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.value.kind).toBe("number");
    expect(claims[0]!.value.raw).toBe("12");
    expect(claims[0]!.subject).toContain("persian");
    expect(claims[0]!.subject).toContain("cat");
  });

  it("extracts an is-a definition as a name claim", () => {
    const claims = extractClaimsFromText("The Asiatic cheetah is a critically endangered subspecies.");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.value.kind).toBe("name");
    expect(claims[0]!.value.raw).toBe("critically endangered subspecies");
    expect(claims[0]!.subject).toEqual(["asiatic", "cheetah"]);
  });

  it("enforces the distinguishing-token floor: a sentence with fewer than 2 topic tokens never registers", () => {
    expect(extractClaimsFromText("It was built in 515 BC.")).toHaveLength(0);
  });

  it("ignores sentences with no number, date, or definition", () => {
    expect(extractClaimsFromText("Persian tea culture spans many beautiful regions of the country.")).toHaveLength(0);
  });

  it("caps claims per page", () => {
    const text = Array.from({ length: 40 }, (_, i) => `The ancient fortress tower number ${i + 10} stands ${i + 20} meters over the valley floor.`).join(" ");
    expect(extractClaimsFromText(text, { maxClaims: 5 })).toHaveLength(5);
  });
});

describe("valuesMateriallyDiffer (never punctuation)", () => {
  const num = (raw: string): ClaimValue => ({ kind: "number", raw, normalized: raw.replace(/,/g, "").toLowerCase() });
  const date = (raw: string): ClaimValue => ({ kind: "date", raw, normalized: raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() });

  it("dates that differ conflict", () => {
    expect(valuesMateriallyDiffer(date("515 BC"), date("518 BC"))).toBe(true);
    expect(valuesMateriallyDiffer(date("1971"), date("1979"))).toBe(true);
  });

  it("identical dates with different punctuation or case never conflict", () => {
    expect(valuesMateriallyDiffer(date("515 BC"), date("515 bc."))).toBe(false);
  });

  it("numbers more than 5 percent apart conflict", () => {
    expect(valuesMateriallyDiffer(num("72"), num("79"))).toBe(true);
  });

  it("numbers within 5 percent never conflict", () => {
    expect(valuesMateriallyDiffer(num("100"), num("104"))).toBe(false);
  });

  it("thousands separators are formatting, never a conflict", () => {
    expect(valuesMateriallyDiffer(num("1,000"), num("1000"))).toBe(false);
  });

  it("definitions never conflict deterministically", () => {
    const a: ClaimValue = { kind: "name", raw: "large desert cat", normalized: "large desert cat" };
    const b: ClaimValue = { kind: "name", raw: "big sandy feline", normalized: "big sandy feline" };
    expect(valuesMateriallyDiffer(a, b)).toBe(false);
  });
});

describe("reliability rules", () => {
  it("operator input is high", () => {
    expect(reliabilityForSource("operator", "https://site.com/page", NOW)).toBe("high");
  });
  it("dated authoritative domains are high", () => {
    expect(reliabilityForSource("teardown", "britannica.com", NOW)).toBe("high");
    expect(reliabilityForSource("teardown", "https://en.wikipedia.org/wiki/Persepolis", NOW)).toBe("high");
    expect(reliabilityForSource("teardown", "nps.gov", NOW)).toBe("high");
  });
  it("competitor pages are medium", () => {
    expect(reliabilityForSource("teardown", "rivalblog.com", NOW)).toBe("medium");
  });
  it("the tenant's own stored page is medium (a page can be stale)", () => {
    expect(reliabilityForSource("page_extract", "https://site.com/page", NOW)).toBe("medium");
  });
  it("undated is low no matter who said it", () => {
    expect(reliabilityForSource("operator", "https://site.com/page", null)).toBe("low");
    expect(reliabilityForSource("teardown", "britannica.com", null)).toBe("low");
  });
});

describe("volatility defaults (the N27 seed)", () => {
  it("years and dates are fast", () => {
    expect(volatilityFor({ kind: "date", raw: "2026", normalized: "2026" })).toBe("fast");
  });
  it("populations and counts are slow", () => {
    expect(volatilityFor({ kind: "number", raw: "1200", normalized: "1200" })).toBe("slow");
  });
  it("definitions are static", () => {
    expect(volatilityFor({ kind: "name", raw: "a subspecies", normalized: "a subspecies" })).toBe("static");
  });
});

describe("buildClaimGraph", () => {
  const persepolisPages = [
    page({
      url: "https://site.com/persepolis",
      traffic: 100,
      text: "Persepolis was built in 515 BC. The complex sits on a great stone terrace.",
      observedAt: "2026-03-10T00:00:00.000Z",
    }),
    page({
      url: "https://site.com/iran-history",
      traffic: 50,
      text: "Persepolis was built in 518 BC.",
      observedAt: "2026-05-01T00:00:00.000Z",
    }),
  ];

  it("registers claims with page_extract sources and computes affected pages", () => {
    const records = graphOf(persepolisPages);
    const a = records.find((r) => r.value.raw === "515 BC")!;
    expect(a.sources[0]).toMatchObject({ kind: "page_extract", ref: "https://site.com/persepolis", reliability: "medium" });
    expect(a.affectedPages).toEqual(["https://site.com/persepolis"]);
    expect(a.firstSeenAt).toBe(NOW);
    expect(a.lastConfirmedAt).toBe("2026-03-10T00:00:00.000Z");
  });

  it("marks materially disagreeing claims on the same subject as conflicting", () => {
    const records = graphOf(persepolisPages);
    expect(records.find((r) => r.value.raw === "515 BC")!.status).toBe("conflicting");
    expect(records.find((r) => r.value.raw === "518 BC")!.status).toBe("conflicting");
  });

  it("a single dated own-page source stays unverified; a second source makes it consistent", () => {
    const solo = graphOf([page({ url: "https://site.com/tower", traffic: 5, text: "The Milad Tower stands 435 meters over Tehran." })]);
    expect(solo[0]!.status).toBe("unverified");

    const confirmed = graphOf(
      [page({ url: "https://site.com/tower", traffic: 5, text: "The Milad Tower stands 435 meters over Tehran." })],
      {
        teardowns: [
          { domain: "britannica.com", url: "https://britannica.com/milad", observedAt: "2026-06-12T00:00:00.000Z", texts: ["The Milad Tower stands 435 meters over Tehran."] },
        ],
      },
    );
    expect(confirmed[0]!.status).toBe("consistent");
    expect(confirmed[0]!.sources.some((s) => s.kind === "teardown" && s.reliability === "high")).toBe(true);
  });

  it("a materially different teardown value registers so the disagreement is visible", () => {
    const records = graphOf(
      [page({ url: "https://site.com/tower", traffic: 5, text: "The Milad Tower stands 435 meters over Tehran." })],
      {
        teardowns: [
          { domain: "rivalblog.com", url: "https://rivalblog.com/milad", observedAt: "2026-06-12T00:00:00.000Z", texts: ["The Milad Tower stands 500 meters over Tehran."] },
        ],
      },
    );
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.status === "conflicting")).toBe(true);
  });

  it("caps the graph with highest-traffic pages first", () => {
    const lowTraffic = page({
      url: "https://site.com/low",
      traffic: 1,
      text: "The quiet village bazaar dates from 1820 in the north.",
    });
    const highTraffic = page({
      url: "https://site.com/high",
      traffic: 9999,
      text: "The grand palace gate was finished in 1873 by royal builders.",
    });
    const records = graphOf([lowTraffic, highTraffic], { maxClaims: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]!.sources[0]!.ref).toBe("https://site.com/high");
  });

  it("keeps firstSeenAt stable and preserves operator sources across rebuilds", () => {
    const first = graphOf(persepolisPages);
    const a = first.find((r) => r.value.raw === "515 BC")!;
    const withOperator: ClaimRecord = {
      ...a,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      sources: [...a.sources, makeSource("operator", "https://site.com/persepolis", "2026-06-20T00:00:00.000Z")],
    };
    const rebuilt = graphOf(persepolisPages, { priorRecords: [withOperator] });
    const again = rebuilt.find((r) => r.id === a.id)!;
    expect(again.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(again.sources.some((s) => s.kind === "operator")).toBe(true);
  });

  it("a prior operator-backed claim survives even when its page falls out of the traffic window", () => {
    const registered = registrationRecordsForDraft({
      tenantId: "tenant-x",
      targetUrl: "https://site.com/gone",
      draftText: "The caravanserai courtyard was restored in 1998 by local masons.",
      nowIso: "2026-06-01T00:00:00.000Z",
    });
    const rebuilt = graphOf(persepolisPages, { priorRecords: registered });
    expect(rebuilt.some((r) => r.id === registered[0]!.id)).toBe(true);
  });

  it("never exceeds MAX_CLAIMS_PER_TENANT", () => {
    expect(MAX_CLAIMS_PER_TENANT).toBe(500);
  });
});

describe("findClaimConflicts + subject labels", () => {
  it("finds the owned-page conflict and derives the pinned subject label", () => {
    const records = graphOf([
      page({ url: "https://site.com/persepolis", traffic: 100, text: "Persepolis was built in 515 BC." }),
      page({ url: "https://site.com/iran-history", traffic: 50, text: "Persepolis was built in 518 BC." }),
    ]);
    const conflicts = findClaimConflicts(records);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.subjectLabel).toBe("the year Persepolis was built");
    expect(conflicts[0]!.a).toMatchObject({ value: "515 BC", pagePath: "/persepolis" });
    expect(conflicts[0]!.b).toMatchObject({ value: "518 BC", pagePath: "/iran-history" });
  });

  it("never fires when the same page carries both values (needs two pages)", () => {
    const records = graphOf([
      page({ url: "https://site.com/one", traffic: 10, text: "Persepolis was built in 515 BC. Persepolis was built in 518 BC." }),
    ]);
    expect(findClaimConflicts(records)).toHaveLength(0);
  });

  it("number labels fall back to the quoted-token form", () => {
    const label = subjectLabelFor({
      claimText: "Persepolis had 72 columns in the great hall.",
      subject: ["persepolis", "columns", "great", "hall"],
      value: { kind: "number", raw: "72", normalized: "72" },
    });
    expect(label).toBe('the number for "Persepolis columns great hall"');
  });
});

describe("shipped-draft registration", () => {
  it("registers the draft's claims with a high-reliability operator source", () => {
    const records = registrationRecordsForDraft({
      tenantId: "tenant-x",
      targetUrl: "https://site.com/persepolis",
      draftText: "Persepolis was built in 515 BC.",
      nowIso: NOW,
    });
    expect(records).toHaveLength(1);
    expect(records[0]!.sources).toEqual([
      { kind: "operator", ref: "https://site.com/persepolis", observedAt: NOW, reliability: "high" },
    ]);
    expect(records[0]!.affectedPages).toEqual(["https://site.com/persepolis"]);
  });

  it("attaches a dated correction_evidence source when an N8 correction names the value", () => {
    const records = registrationRecordsForDraft({
      tenantId: "tenant-x",
      targetUrl: "https://site.com/persepolis",
      draftText: "Persepolis was built in 515 BC.",
      corrections: [
        {
          source: "Search Console",
          date: "2026-06-01",
          message: 'This draft updates a number to "515" based on Search Console, 2026-06-01.',
        },
      ],
      nowIso: NOW,
    });
    const src = records[0]!.sources.find((s) => s.kind === "correction_evidence");
    expect(src).toMatchObject({ ref: "Search Console", observedAt: "2026-06-01", reliability: "high" });
  });

  it("merging registered records into existing rows unions sources and keeps firstSeenAt", () => {
    const existing = registrationRecordsForDraft({
      tenantId: "tenant-x",
      targetUrl: "https://site.com/persepolis",
      draftText: "Persepolis was built in 515 BC.",
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    const fresh = registrationRecordsForDraft({
      tenantId: "tenant-x",
      targetUrl: "https://site.com/persepolis",
      draftText: "Persepolis was built in 515 BC.",
      nowIso: NOW,
    });
    const merged = mergeRegisteredRecords(existing, fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged[0]!.sources).toHaveLength(1); // same source, newest observation kept
    expect(merged[0]!.sources[0]!.observedAt).toBe(NOW);
  });
});

describe("surface lines (pinned)", () => {
  it('renders "From your /iran-flags page, confirmed Mar 2026."', () => {
    const line = formatClaimSourceLine(
      makeSource("page_extract", "https://site.com/iran-flags", "2026-03-15T00:00:00.000Z"),
      NOW,
    );
    expect(line).toBe("From your /iran-flags page, confirmed Mar 2026.");
  });

  it('renders "From britannica.com, seen 3 weeks ago."', () => {
    const line = formatClaimSourceLine(
      makeSource("teardown", "britannica.com", "2026-06-12T00:00:00.000Z"),
      NOW,
    );
    expect(line).toBe("From britannica.com, seen 3 weeks ago.");
  });

  it("renders an operator line with the month", () => {
    const line = formatClaimSourceLine(
      makeSource("operator", "https://site.com/persepolis", "2026-06-20T00:00:00.000Z"),
      NOW,
    );
    expect(line).toBe("From a change you approved, Jun 2026.");
  });
});

describe("claimEvidenceForDraft (the evidence seam)", () => {
  const records = graphOf([
    page({
      url: "https://site.com/iran-flags",
      traffic: 100,
      text: "The Iranian flag was adopted in 1980 after the revolution. The lion emblem lasted centuries.",
      observedAt: "2026-03-15T00:00:00.000Z",
    }),
  ]);

  it("is byte-identical empty on an empty graph", () => {
    expect(claimEvidenceForDraft([], { pageUrl: "https://site.com/iran-flags", draftText: "anything", nowIso: NOW })).toEqual([]);
  });

  it("returns one line per matching claim with the pinned source phrasing", () => {
    const lines = claimEvidenceForDraft(records, {
      pageUrl: "https://site.com/iran-flags",
      draftText: "The Iranian flag was adopted in 1980.",
      nowIso: NOW,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.sourceLine).toBe("From your /iran-flags page, confirmed Mar 2026.");
  });

  it("caps at 3 lines", () => {
    const many = graphOf([
      page({
        url: "https://site.com/dense",
        traffic: 10,
        text: [
          "The fortress wall runs 2500 meters around the old city.",
          "The bazaar holds 380 shops under one continuous roof.",
          "The bridge carries 33 arches across the river span.",
          "The garden covers 112 hectares of terraced ground.",
        ].join(" "),
      }),
    ]);
    const lines = claimEvidenceForDraft(many, { pageUrl: "https://site.com/dense", draftText: null, nowIso: NOW });
    expect(lines).toHaveLength(3);
  });

  it("excludes conflicting claims (they belong to the conflict trigger, not the source lines)", () => {
    const conflicted = graphOf([
      page({ url: "https://site.com/persepolis", traffic: 100, text: "Persepolis was built in 515 BC." }),
      page({ url: "https://site.com/iran-history", traffic: 50, text: "Persepolis was built in 518 BC." }),
    ]);
    const lines = claimEvidenceForDraft(conflicted, {
      pageUrl: "https://site.com/persepolis",
      draftText: "Persepolis was built in 515 BC.",
      nowIso: NOW,
    });
    expect(lines).toEqual([]);
  });
});

describe("no em or en dashes anywhere in the provenance module (hard rule)", () => {
  for (const name of ["claim-graph.ts", "claim-graph-loader.ts", "claim-conflict-trigger.ts"]) {
    it(`${name} contains no em or en dashes`, () => {
      const src = readFileSync(resolve(__dirname, name), "utf8");
      expect(src).not.toMatch(/[–—]/);
    });
  }
});
