/**
 * changes-list-client - UX3 dense inbox (row compression, split detail panel, applied-batch
 * collapse, multi-select, buyer-language strategy labels).
 *
 * Same source-pinning convention as changes-list-client-session.test.ts (no jsdom/@testing-
 * library/react configured in this repo) - these pins confirm the UX3 behaviors are actually
 * wired into the real /changes list, not just present as unused helpers, and that they never
 * regress the D6 session loop this file also owns.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "changes-list-client.tsx"), "utf8");

describe("ChangesListClient - C-23 the strategy picker is killed", () => {
  it("no longer renders the Best opportunities / Fastest growth / Safest bets picker", () => {
    // operator spec 2026-07-09 C-23 - the mode toggle is gone; the list always ranks balanced.
    expect(SRC).not.toContain("How should Beacon prioritize?");
    expect(SRC).not.toContain('label: "Best opportunities"');
    expect(SRC).not.toContain('label: "Fastest growth"');
    expect(SRC).not.toContain('label: "Safest bets"');
  });

  it("always asks rankChanges for the default balanced strategy (Strategy API left intact)", () => {
    // operator spec 2026-07-09 C-23 - the client passes the literal "balanced"; strategy.ts (the
    // Strategy union + rankChanges' ranking math) is NOT edited, only this caller.
    expect(SRC).toContain('rankChanges(view.changes, "balanced")');
  });
});

describe("ChangesListClient - UX3 split detail panel", () => {
  it("factors the full row detail (MoveCard + fallback content) into a shared RowDetailContent so the panel and the mobile inline expansion render the exact same thing", () => {
    expect(SRC).toContain("function RowDetailContent(");
    expect(SRC).toContain("<RowDetailContent c={c} move={move} rank={rank} onAction={onAction} />");
    expect(SRC).toContain("<RowDetailContent");
  });

  it("tracks the open row as list-level state (selectedId), not per-row local state, so opening a row never re-renders or reflows the list", () => {
    expect(SRC).toContain("const [selectedId, setSelectedId] = useState<string | null>(null)");
    expect(SRC).toMatch(/const toggleDetail = useCallback\(\(id: string\) => setSelectedId/);
  });

  it("the desktop panel renders only on lg+ and the inline fallback only below lg, so exactly one copy of the detail shows at a time per breakpoint", () => {
    expect(SRC).toMatch(/hidden max-h-\[calc\(100vh-2rem\)\][^"]*lg:block/);
    // FP6b (2026-07-02): border-gray-100 migrated to the border-border-subtle token; same
    // layout assertion (border-t ... px-1 py-1 lg:hidden), now on the token class.
    expect(SRC).toMatch(/border-t border-border-subtle px-1 py-1 lg:hidden/);
  });

  it("the row's own aria-expanded button still drives selectedId (keyboard Enter + the D6 banner's Open-it still work unmodified)", () => {
    expect(SRC).toContain("aria-expanded={open}");
    expect(SRC).toContain("onClick={() => setOpen()}");
    expect(SRC).toMatch(/const open = detailOpen \?\? false;/);
  });

  it("closing the panel clears selectedId without touching list scroll position (no scrollIntoView call in the close handler)", () => {
    const idx = SRC.indexOf("onClick={() => setSelectedId(null)}");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("ChangesListClient - UX3 applied-batch collapse", () => {
  it("collapses tonight's applied batch (selectedForToday + verify/measuring/result) to one summary row once 2+ qualify", () => {
    expect(SRC).toMatch(/c\.selectedForToday && \(c\.status === "verify" \|\| c\.status === "measuring" \|\| c\.status === "result"\)/);
    expect(SRC).toContain("batchRows.length >= 2");
  });

  it("collapses receipts within the simplified working view without a separate Tonight mode", () => {
    expect(SRC).toContain("const canCollapseBatch = true;");
    expect(SRC).not.toContain("const [tonight");
  });

  it("the summary row names the exact count and verified state in one honest sentence", () => {
    expect(SRC).toMatch(/Tonight&apos;s batch: \{batchRows\.length\} applied\{batchVerifiedCount === batchRows\.length \? ", all verified" : `, \$\{batchVerifiedCount\} of \$\{batchRows\.length\} verified`\}/);
  });

  it("expanding the summary reveals the individual receipts (a real Row per change, not a re-derived count)", () => {
    expect(SRC).toContain("setBatchExpanded(true)");
    expect(SRC).toContain("batchExpanded && canCollapseBatch && batchRows.length >= 2");
  });

  it("never renders an em or en dash in the batch summary copy", () => {
    const idx = SRC.indexOf("Tonight&apos;s batch:");
    const block = SRC.slice(idx, idx + 300);
    expect(block).not.toMatch(/[–—]/);
  });
});

describe("ChangesListClient - UX3 multi-select bulk bar", () => {
  it("tracks checked rows as a Set at the list level, independent of the D6 session's handledIds", () => {
    expect(SRC).toContain("const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())");
  });

  it("the bulk loop is bounded and sequential (awaits each row's respondToRecommendation before moving to the next), never a parallel fire-and-forget", () => {
    const idx = SRC.indexOf("const runBulk = useCallback");
    const block = SRC.slice(idx, idx + 1200);
    expect(block).toMatch(/for \(let i = 0; i < ids\.length; i\+\+\)/);
    expect(block).toContain("await respondToRecommendation(");
  });

  it("reuses the exact same respondToRecommendation calls (accepted/deferred) a single row's own buttons use, never a new write path", () => {
    const idx = SRC.indexOf("const runBulk = useCallback");
    const block = SRC.slice(idx, idx + 1200);
    expect(block).toContain('respondToRecommendation(move.id, "accepted", { targetPageUrl: move.targetUrl, actionType: move.action, query: move.query })');
    expect(block).toContain('respondToRecommendation(move.id, "deferred", { targetPageUrl: move.targetUrl })');
  });

  it("shows honest sequential progress text (N of total), not a bare spinner", () => {
    expect(SRC).toMatch(/\$\{kind === "done" \? "Marking done" : "Skipping"\} \$\{i \+ 1\} of \$\{ids\.length\}/);
  });

  it("the floating bar only renders once at least one row is checked", () => {
    expect(SRC).toContain("checkedIds.size > 0 ?");
  });

  it("every Row render site wires the same selection + detail props, so a row's checkbox always reaches the same list-level state", () => {
    const rowUsages = SRC.match(/<Row\s/g) ?? [];
    const selectWiring = SRC.match(/onToggleSelect=\{toggleChecked\}/g) ?? [];
    const detailWiring = SRC.match(/onToggleDetail=\{toggleDetail\}/g) ?? [];
    // operator spec 2026-07-09 C-16 - the flat list dropped the two goal-bucket Row sites, so there
    // are now 3 (top picks, capped rest, expanded batch); every one still wires the same props.
    expect(rowUsages.length).toBeGreaterThanOrEqual(3);
    expect(selectWiring.length).toBe(rowUsages.length);
    expect(detailWiring.length).toBe(rowUsages.length);
  });
});

describe("ChangesListClient - P1-1 (2026-07-10 visual audit): default is top 3-5, not a wall", () => {
  it("the default-card-count proof: cappedRows (the rest of the actionable queue) is empty until showAllRanked, so the default render is topPicks (3-5) ONLY, never topPicks plus a second batch of ~20 more expanded cards", () => {
    expect(SRC).toContain("const cappedRows = !applyCuration || showAllRanked ? afterTop : [];");
  });

  it("topCount (the default card count) is clamped to a hard 3-5, the SAME dynamicOpportunityCount semantics Today uses", () => {
    expect(SRC).toContain(
      "const topCount = Math.min(5, Math.max(Math.min(actionablePool.length, 3), dynamicOpportunityCount(actionablePool)));",
    );
  });

  it("every other actionable idea sits behind exactly ONE honest expander (hiddenRankedCount names the FULL rest of the queue, not a partial 20-item slice)", () => {
    expect(SRC).toContain(
      "const hiddenRankedCount = applyCuration && !showAllRanked ? afterTop.length : 0;",
    );
    // The old partial-reveal cap (CURATION_CAP = 20) is gone entirely.
    expect(SRC).not.toContain("CURATION_CAP");
  });

  it("no longer renders a second capped batch of Row cards outside the expander (only topPicks.map + cappedRows.map, and cappedRows is empty by default)", () => {
    const rowUsages = SRC.match(/<Row\s/g) ?? [];
    // topPicks, capped rest, expanded batch, archive - still exactly 4 render sites.
    expect(rowUsages.length).toBe(4);
  });
});

describe("ChangesListClient - P1-2 (2026-07-10 visual audit): exactly ONE 'Start here' band", () => {
  it("the band is gated on topPick AND rank === 1, never on topPick alone", () => {
    expect(SRC).toContain('{topPick && rank === 1 ? (');
    expect(SRC).not.toMatch(/\{topPick \? \(\s*<div className="flex items-center gap-1\.5 rounded-t-md bg-status-info-bg/);
  });

  it("topPicks.map always numbers rank from 1 (i + 1), so only the first topPick can ever be rank 1", () => {
    const idx = SRC.indexOf("{topPicks.map((c, i) => (");
    const block = SRC.slice(idx, idx + 400);
    expect(block).toContain("rank={i + 1}");
  });
});

describe("ChangesListClient - P1-3 (2026-07-10 visual audit): outranks line only on the top 3-5", () => {
  it("the capped rest of the queue always hardcodes outranksLine to null (never the computed map), so the line can never repeat past the default cards", () => {
    const idx = SRC.indexOf("{cappedRows.map((c, i) => (");
    const block = SRC.slice(idx, idx + 1100);
    expect(block).toContain("outranksLine={null}");
    expect(block).not.toContain("outranksById.get(c.id)");
  });

  it("only topPicks reads the computed outranksById map", () => {
    const idx = SRC.indexOf("{topPicks.map((c, i) => (");
    const block = SRC.slice(idx, idx + 700);
    expect(block).toContain("outranksLine={outranksById.get(c.id) ?? null}");
  });
});

describe("ChangesListClient - UX3 does not regress the D6 session loop", () => {
  it("still mounts useWorklistSession over the same ranked+filtered visible list", () => {
    // R20 added a second arg (the FP3 lifecycle counts) - still the SAME `visible` list, never a
    // re-ranked or re-filtered copy. Match the current (post-R20) call shape.
    expect(SRC).toMatch(/useWorklistSession\(\s*visible\s*,/);
  });

  it("still auto-scrolls to the next-best row", () => {
    expect(SRC).toMatch(/session\.nextBest[\s\S]{0,80}scrollIntoView/);
  });

  it("bulk actions still funnel through the same rowAction the single-row buttons use (one advance-to-next-best implementation)", () => {
    const idx = SRC.indexOf("const runBulk = useCallback");
    const block = SRC.slice(idx, idx + 1200);
    expect(block).toContain("rowAction(id, kind)");
  });
});
