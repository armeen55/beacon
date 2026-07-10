import { describe, it, expect } from "vitest";
import {
  classifyControl,
  classifyControls,
  summarizeContamination,
  promoteFromFrozenPool,
  buildContaminationNotes,
  swapSentence,
  cautionSentence,
  computePoolHealth,
  lastCleanDonorHoldSentence,
  medianBandRead,
  templateFamilyOf,
  MIN_SCANS_FOR_CONTENT_JUDGMENT,
  MIN_MEDIAN_BAND_PAGES,
  type ContaminationWindow,
  type ControlContaminationResult,
  type LedgerShipRecord,
  type SnapshotPoint,
} from "./control-contamination";

/**
 * control-contamination.test.ts (BEACON_500 N13) - the classifier matrix:
 * treated-by-us, content-changed-inside-window, sparse-coverage unknown, and
 * clean. Plus the substitution picker and the plain-language receipt builder.
 */

const WINDOW: ContaminationWindow = { start: "2026-06-01", end: "2026-06-29" };

describe("classifyControl - treated_by_us", () => {
  it("flags a control that we ourselves shipped inside the window", () => {
    const ledger: LedgerShipRecord[] = [{ path: "/animals/fox", shippedAt: "2026-06-10T00:00:00Z" }];
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger,
      snapshots: [],
    });
    expect(result.status).toBe("treated_by_us");
    expect(result.treatedAt).toBe("2026-06-10");
    expect(result.reason).toContain("2026-06-10");
  });

  it("does not flag a ship that happened BEFORE the window opened", () => {
    const ledger: LedgerShipRecord[] = [{ path: "/animals/fox", shippedAt: "2026-05-01T00:00:00Z" }];
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger,
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "a" },
        { fetchedAt: "2026-06-20", contentHash: "a" },
      ],
    });
    expect(result.status).toBe("clean");
  });

  it("does not flag a ship that happens AFTER the window closes", () => {
    const ledger: LedgerShipRecord[] = [{ path: "/animals/fox", shippedAt: "2026-07-15T00:00:00Z" }];
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger,
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "a" },
        { fetchedAt: "2026-06-20", contentHash: "a" },
      ],
    });
    expect(result.status).toBe("clean");
  });

  it("only flags the exact path, not a different page", () => {
    const ledger: LedgerShipRecord[] = [{ path: "/animals/wolf", shippedAt: "2026-06-10T00:00:00Z" }];
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger,
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "a" },
        { fetchedAt: "2026-06-20", contentHash: "a" },
      ],
    });
    expect(result.status).toBe("clean");
  });
});

describe("classifyControl - content_changed", () => {
  it("flags a hash change between two in-window scans", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "aaa" },
        { fetchedAt: "2026-06-18", contentHash: "bbb" },
      ],
    });
    expect(result.status).toBe("content_changed");
    expect(result.changedBetweenScans).toEqual({ before: "2026-06-05", after: "2026-06-18" });
  });

  it("reports the FIRST differing pair, not the last", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [
        { fetchedAt: "2026-06-02", contentHash: "aaa" },
        { fetchedAt: "2026-06-10", contentHash: "bbb" },
        { fetchedAt: "2026-06-20", contentHash: "ccc" },
      ],
    });
    expect(result.status).toBe("content_changed");
    expect(result.changedBetweenScans).toEqual({ before: "2026-06-02", after: "2026-06-10" });
  });

  it("ignores scans OUTSIDE the window when detecting a change", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [
        { fetchedAt: "2026-05-01", contentHash: "outside-old" },
        { fetchedAt: "2026-06-05", contentHash: "same" },
        { fetchedAt: "2026-06-20", contentHash: "same" },
        { fetchedAt: "2026-07-15", contentHash: "outside-new" },
      ],
    });
    expect(result.status).toBe("clean");
  });
});

describe("classifyControl - unknown (sparse coverage)", () => {
  it("is unknown with zero in-window scans", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [],
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("0 scans");
  });

  it("is unknown with exactly one in-window scan (below the floor)", () => {
    expect(MIN_SCANS_FOR_CONTENT_JUDGMENT).toBe(2);
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [{ fetchedAt: "2026-06-10", contentHash: "aaa" }],
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("1 scan");
  });

  it("never assumes clean on sparse coverage even if the one scan looks stable", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [],
      snapshots: [{ fetchedAt: "2026-06-10", contentHash: "aaa" }],
    });
    expect(result.status).not.toBe("clean");
  });
});

describe("classifyControl - clean", () => {
  it("is clean with 2+ in-window scans and no hash change, no ledger hit", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [{ path: "/other-page", shippedAt: "2026-06-10T00:00:00Z" }],
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "same" },
        { fetchedAt: "2026-06-20", contentHash: "same" },
      ],
    });
    expect(result.status).toBe("clean");
    expect(result.reason).toBe("");
  });
});

describe("classifyControl - precedence", () => {
  it("treated_by_us wins over a detectable content change", () => {
    const result = classifyControl({
      controlPath: "/animals/fox",
      window: WINDOW,
      ledger: [{ path: "/animals/fox", shippedAt: "2026-06-10T00:00:00Z" }],
      snapshots: [
        { fetchedAt: "2026-06-05", contentHash: "aaa" },
        { fetchedAt: "2026-06-20", contentHash: "bbb" },
      ],
    });
    expect(result.status).toBe("treated_by_us");
  });
});

describe("classifyControls (batch)", () => {
  it("preserves controlPaths order and classifies each independently", () => {
    const results = classifyControls({
      controlPaths: ["/a", "/b", "/c"],
      window: WINDOW,
      ledger: [{ path: "/b", shippedAt: "2026-06-10T00:00:00Z" }],
      snapshotsByPath: new Map<string, SnapshotPoint[]>([
        ["/a", [{ fetchedAt: "2026-06-05", contentHash: "x" }, { fetchedAt: "2026-06-20", contentHash: "x" }]],
        ["/c", []],
      ]),
    });
    expect(results.map((r) => r.path)).toEqual(["/a", "/b", "/c"]);
    expect(results[0]!.status).toBe("clean");
    expect(results[1]!.status).toBe("treated_by_us");
    expect(results[2]!.status).toBe("unknown");
  });
});

describe("summarizeContamination", () => {
  it("is not contaminated when every control is clean", () => {
    const v = summarizeContamination([
      { path: "/a", status: "clean", reason: "" },
      { path: "/b", status: "clean", reason: "" },
    ]);
    expect(v.hasContamination).toBe(false);
    expect(v.contaminated).toEqual([]);
  });

  it("collects every non-clean control, including unknown", () => {
    const v = summarizeContamination([
      { path: "/a", status: "clean", reason: "" },
      { path: "/b", status: "unknown", reason: "sparse" },
      { path: "/c", status: "treated_by_us", reason: "treated", treatedAt: "2026-06-10" },
    ]);
    expect(v.hasContamination).toBe(true);
    expect(v.contaminated.map((c) => c.path)).toEqual(["/b", "/c"]);
  });
});

describe("promoteFromFrozenPool", () => {
  it("promotes the FIRST eligible donor in the pool's original order, not already in use", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"], // /a is already a clean control on this ship
      treatedPath: "/treated",
      frozenPool: [
        { url: "/a", verdict: "kept" }, // already a control, must be skipped
        { url: "/treated", verdict: "kept" }, // is the treated page, must be skipped
        { url: "/d", verdict: "kept" }, // first eligible
        { url: "/e", verdict: "kept" },
      ],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: "/d" }]);
  });

  it("never chooses a later donor over the next-in-line one - no re-ranking", () => {
    // /d and /e are BOTH "kept" - nothing here signals /e is preferable, so the
    // pool's own original order must win, not some outcome-aware re-scoring.
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: [
        { url: "/d", verdict: "kept" },
        { url: "/e", verdict: "kept" },
      ],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: "/d" }]);
  });

  it("never re-uses one donor for two contaminated controls", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }, { path: "/c" }],
      allControlPaths: ["/a", "/b", "/c"],
      treatedPath: "/treated",
      frozenPool: [
        { url: "/d", verdict: "kept" },
        { url: "/e", verdict: "kept" },
      ],
    });
    expect(out).toEqual([
      { originalPath: "/b", substitutePath: "/d" },
      { originalPath: "/c", substitutePath: "/e" },
    ]);
  });

  it("returns null substitutePath when the pool is exhausted", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }, { path: "/c" }],
      allControlPaths: ["/a", "/b", "/c"],
      treatedPath: "/treated",
      frozenPool: [{ url: "/d", verdict: "kept" }],
    });
    expect(out).toEqual([
      { originalPath: "/b", substitutePath: "/d" },
      { originalPath: "/c", substitutePath: null },
    ]);
  });

  it("skips a donor the matcher itself excluded at ship time", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: [
        { url: "/d", verdict: "excluded" },
        { url: "/e", verdict: "kept" },
      ],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: "/e" }]);
  });

  it("never picks a control already on the ship as its own substitute", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: [
        { url: "/b", verdict: "kept" },
        { url: "/d", verdict: "kept" },
      ],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: "/d" }]);
  });

  it("returns null substitutePath for every contaminated control when the pool is null (older row)", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: null,
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: null }]);
  });

  it("returns null substitutePath for every contaminated control when the pool is empty", () => {
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/b" }],
      allControlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      frozenPool: [],
    });
    expect(out).toEqual([{ originalPath: "/b", substitutePath: null }]);
  });
});

describe("buildContaminationNotes", () => {
  it("is empty when nothing is contaminated", () => {
    const notes = buildContaminationNotes({ results: [], contaminated: [], hasContamination: false });
    expect(notes).toEqual([]);
  });

  it("names the swap plus the swap-receipt sentence when a substitute was found", () => {
    const verdict = summarizeContamination([
      { path: "/b", status: "content_changed", reason: "This comparison page's content changed between 2026-06-05 and 2026-06-18, inside this measurement window." },
    ]);
    const notes = buildContaminationNotes(verdict, [{ originalPath: "/b", substitutePath: "/d" }]);
    expect(notes.some((n) => n.includes("/d"))).toBe(true);
    expect(notes).toContain(swapSentence());
    expect(notes).not.toContain(cautionSentence());
  });

  it("gives the caution line when no substitute was found", () => {
    const verdict = summarizeContamination([
      { path: "/b", status: "unknown", reason: "sparse coverage" },
    ]);
    const notes = buildContaminationNotes(verdict, [{ originalPath: "/b", substitutePath: null }]);
    expect(notes).toContain(cautionSentence());
    expect(notes).not.toContain(swapSentence());
  });

  it("mixes both sentences when one control was swapped and another was not", () => {
    const verdict = summarizeContamination([
      { path: "/b", status: "content_changed", reason: "changed" },
      { path: "/c", status: "treated_by_us", reason: "treated" },
    ]);
    const notes = buildContaminationNotes(verdict, [
      { originalPath: "/b", substitutePath: "/d" },
      { originalPath: "/c", substitutePath: null },
    ]);
    expect(notes).toContain(swapSentence());
    expect(notes).toContain(cautionSentence());
  });

  it("never contains an em or en dash", () => {
    const verdict = summarizeContamination([
      { path: "/b", status: "content_changed", reason: "This comparison page's content changed between 2026-06-05 and 2026-06-18, inside this measurement window." },
      { path: "/c", status: "treated_by_us", reason: "I shipped a change to this comparison page myself on 2026-06-10, inside this measurement window.", treatedAt: "2026-06-10" },
    ]);
    const notes = buildContaminationNotes(verdict, [
      { originalPath: "/b", substitutePath: "/d" },
      { originalPath: "/c", substitutePath: null },
    ]);
    for (const n of notes) {
      expect(n).not.toMatch(/[–—]/);
    }
  });
});

// ---------------------------------------------------------------------------
// N16 (R5, 2026-07-03) - sustainable control pool
// ---------------------------------------------------------------------------

const cleanResult = (path: string): ControlContaminationResult => ({ path, status: "clean", reason: "" });
const dirtyResult = (path: string): ControlContaminationResult => ({
  path,
  status: "treated_by_us",
  reason: `I shipped a change to this comparison page myself on 2026-06-10, inside this measurement window.`,
  treatedAt: "2026-06-10",
});
const unknownResult = (path: string): ControlContaminationResult => ({
  path,
  status: "unknown",
  reason: "I only have 1 scan of this comparison page inside the measurement window, not enough to know if it changed.",
});

describe("templateFamilyOf", () => {
  it("uses the first path segment, host-stripped, lowercased", () => {
    expect(templateFamilyOf("https://site.com/Iran-Flags/one")).toBe("iran-flags");
    expect(templateFamilyOf("/cities")).toBe("cities");
    expect(templateFamilyOf("/")).toBe("root");
  });
});

describe("computePoolHealth", () => {
  it("counts still-clean serving controls and reads the plain one-liner", () => {
    const ph = computePoolHealth({
      results: [cleanResult("/a"), dirtyResult("/b"), cleanResult("/c"), dirtyResult("/d")],
      frozenPool: null,
      controlPaths: ["/a", "/b", "/c", "/d"],
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.cleanControls).toBe(2);
    expect(ph.knownDirtyControls).toBe(2);
    expect(ph.totalControls).toBe(4);
    expect(ph.sentence).toBe("2 of 4 comparison pages are still clean.");
    expect(ph.sentence).not.toMatch(/[–—]/);
  });

  it("counts an UNVERIFIED (sparse-scan) control as still clean (a missing scan is not damage)", () => {
    const ph = computePoolHealth({
      results: [unknownResult("/a"), cleanResult("/b")],
      frozenPool: null,
      controlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.cleanControls).toBe(2);
    expect(ph.lastCleanDonorPaths).toEqual([]);
  });

  it("counts the untreated frozen-pool bench as spares and says so in the line", () => {
    const ph = computePoolHealth({
      results: [cleanResult("/a"), cleanResult("/b")],
      frozenPool: [
        { url: "https://site.com/a", verdict: "kept" }, // already serving - not a spare
        { url: "https://site.com/c", verdict: "kept" }, // spare
        { url: "https://site.com/x", verdict: "excluded" }, // matcher-excluded - never a spare
        { url: "https://site.com/y", verdict: "kept" }, // treated in window - spent
      ],
      controlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      ledger: [{ path: "/y", shippedAt: "2026-06-10T00:00:00Z" }],
      window: WINDOW,
    });
    expect(ph.spareDonors).toBe(1);
    expect(ph.sentence).toBe(
      "2 of 2 comparison pages are still clean. 1 spare comparison page is ready from the list I chose before shipping.",
    );
  });

  it("names the LAST clean donor when the whole clean pool is one page", () => {
    const ph = computePoolHealth({
      results: [dirtyResult("/a"), dirtyResult("/b"), cleanResult("/c")],
      frozenPool: [],
      controlPaths: ["/a", "/b", "/c"],
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.lastCleanDonorPaths).toEqual(["/c"]);
  });

  it("does NOT flag a last clean donor while a spare is still on the bench", () => {
    const ph = computePoolHealth({
      results: [dirtyResult("/a"), cleanResult("/b")],
      frozenPool: [{ url: "https://site.com/c", verdict: "kept" }],
      controlPaths: ["/a", "/b"],
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.lastCleanDonorPaths).toEqual([]); // /b serving + /c on the bench = 2 clean donors
  });

  it("a dirty original that a bench donor REPLACED no longer counts against the line", () => {
    // /a was contaminated and replaced by /c: the effective serving set is /c + /b.
    const ph = computePoolHealth({
      results: [dirtyResult("/a"), cleanResult("/b")],
      frozenPool: [{ url: "https://site.com/c", verdict: "kept" }],
      controlPaths: ["/c", "/b"], // post-promotion effective paths
      treatedPath: "/treated",
      ledger: [],
      window: WINDOW,
    });
    expect(ph.cleanControls).toBe(2);
    expect(ph.knownDirtyControls).toBe(0);
    expect(ph.spareDonors).toBe(0); // /c moved from the bench into service
  });
});

describe("lastCleanDonorHoldSentence", () => {
  it("is plain, first person, names the measured page, and carries no dashes", () => {
    const s = lastCleanDonorHoldSentence("/iran-flags/one");
    expect(s).toBe(
      "I am holding this page because it is the last clean comparison page for a change I am still measuring on /iran-flags/one.",
    );
    expect(s).not.toMatch(/[–—]/);
  });
});

describe("medianBandRead - the weaker fallback comparison", () => {
  it(`stays silent below ${MIN_MEDIAN_BAND_PAGES} same-family pages`, () => {
    expect(medianBandRead({ treatedDelta: 5, familyDeltas: [1, 2] })).toBeNull();
  });

  it("takes the median (odd and even counts) and reads the plain sentence", () => {
    const odd = medianBandRead({ treatedDelta: 6, familyDeltas: [1, 9, 2] });
    expect(odd?.medianDelta).toBe(2);
    expect(odd?.pagesUsed).toBe(3);
    expect(odd?.sentence).toBe(
      "Every comparison page for this change was disturbed, so I checked it against the typical untouched page in its section instead: this page gained 6 clicks while the typical one of 3 gained 2 clicks over the same window. That is a weaker comparison, so I am reading this result cautiously.",
    );

    const even = medianBandRead({ treatedDelta: -4, familyDeltas: [1, 3, 5, 7] });
    expect(even?.medianDelta).toBe(4);
    expect(even?.sentence).toContain("this page lost 4 clicks while the typical one of 4 gained 4 clicks");
  });

  it("labels itself a weaker comparison and never uses a dash or lab word", () => {
    const band = medianBandRead({ treatedDelta: 0, familyDeltas: [0, 0, 0] });
    expect(band?.sentence).toContain("That is a weaker comparison");
    expect(band?.sentence).toContain("this page held steady while the typical one of 3 held steady");
    expect(band?.sentence).not.toMatch(/[–—]/);
    expect(band?.sentence.toLowerCase()).not.toMatch(/median|control|percentile|null/);
  });
});

describe("E-39 D2/D7 - contamination is tagged at the correct timestamp and NEVER rewrites history", () => {
  it("contamination begins at the OVERLAPPING edit's ship date (never a wall-clock guess)", () => {
    const window: ContaminationWindow = { start: "2026-06-01", end: "2026-06-29" };
    const overlappingEditShipDate = "2026-06-12T09:30:00.000Z";
    const ledger: LedgerShipRecord[] = [{ path: "/c", shippedAt: overlappingEditShipDate }];
    const r = classifyControl({ controlPath: "/c", window, ledger, snapshots: [] });
    expect(r.status).toBe("treated_by_us");
    expect(r.treatedAt).toBe("2026-06-12"); // exactly the overlapping edit's ship date
  });

  it("classifyControl treats its inputs as READ-ONLY - the ledger + snapshot history are never mutated", () => {
    const window: ContaminationWindow = { start: "2026-06-01", end: "2026-06-29" };
    const ledger: LedgerShipRecord[] = [{ path: "/c", shippedAt: "2026-06-12" }];
    const snapshots: SnapshotPoint[] = [
      { fetchedAt: "2026-06-03", contentHash: "h1" },
      { fetchedAt: "2026-06-20", contentHash: "h2" },
    ];
    const ledgerBefore = JSON.stringify(ledger);
    const snapsBefore = JSON.stringify(snapshots);
    classifyControl({ controlPath: "/c", window, ledger, snapshots });
    expect(JSON.stringify(ledger)).toBe(ledgerBefore); // prior assignment / history intact
    expect(JSON.stringify(snapshots)).toBe(snapsBefore);
  });

  it("promoting a clean bench donor NEVER removes the contaminated original from the record's history", () => {
    // The original control stays in allControlPaths (its historical assignment is
    // preserved); promotion only ADDS a substitute, it never deletes evidence.
    const out = promoteFromFrozenPool({
      contaminated: [{ path: "/c1" }],
      allControlPaths: ["/c1", "/c2"],
      treatedPath: "/t",
      frozenPool: [{ url: "/bench1", verdict: "kept" }],
    });
    expect(out).toEqual([{ originalPath: "/c1", substitutePath: "/bench1" }]);
    // The contaminated original is referenced by originalPath, never dropped/rewritten.
    expect(out[0].originalPath).toBe("/c1");
  });
});
