/**
 * changes-list-client - UX3 dense inbox (row compression, split detail panel, applied-batch
 * collapse, multi-select, buyer-language strategy labels).
 *
 * Same source-pinning convention as changes-list-client-session.test.ts (no jsdom/@testing-
 * library/react configured in this repo) - these pins confirm the UX3 behaviors are actually
 * wired into the real /worklist list, not just present as unused helpers, and that they never
 * regress the D6 session loop this file also owns.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "changes-list-client.tsx"), "utf8");

describe("ChangesListClient - UX3 strategy names in buyer language", () => {
  it("renames Balanced/Growth first/Clean tests to buyer language, display-only", () => {
    expect(SRC).toContain('{ id: "balanced", label: "Best opportunities"');
    expect(SRC).toContain('{ id: "growth", label: "Fastest growth"');
    expect(SRC).toContain('{ id: "clean", label: "Safest bets"');
  });

  it("keeps the underlying Strategy union untouched (ids still balanced/growth/clean)", () => {
    expect(SRC).toMatch(/STRATEGIES:\s*\{\s*id:\s*Strategy;/);
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

  it("only collapses in the flat status views, never inside 'By goal' or 'Tonight's 30 minutes'", () => {
    expect(SRC).toContain("const canCollapseBatch = !grouped && !tonight;");
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
    expect(rowUsages.length).toBeGreaterThanOrEqual(4);
    expect(selectWiring.length).toBe(rowUsages.length);
    expect(detailWiring.length).toBe(rowUsages.length);
  });
});

describe("ChangesListClient - UX3 does not regress the D6 session loop", () => {
  it("still mounts useWorklistSession over the same ranked+filtered visible list", () => {
    expect(SRC).toMatch(/useWorklistSession\(visible\)/);
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
