/**
 * BEACON 500 item 55 (2026-07-02) — card pins for the New Pages "Draft the full
 * page" button + collapsible full-draft view, plus the hard no-em/en-dash guard
 * over every file this item touches. Follows the repo's source-pin convention
 * (today-v2-visibility-group-client.test.tsx): pin the wiring by pattern, not by
 * a full RTL render.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CARD_SRC = readFileSync(resolve(__dirname, "today-newpages-card.tsx"), "utf8");
const DATA_SRC = readFileSync(resolve(__dirname, "today-newpages-data.ts"), "utf8");
const ACTIONS_SRC = readFileSync(resolve(__dirname, "today-newpages-draft-actions.ts"), "utf8");
const WALKER_SRC = readFileSync(
  resolve(__dirname, "../../domains/llm/draft-full-page.ts"),
  "utf8",
);

describe("NewPageCard — Draft the full page button", () => {
  it("renders the button with a spend estimate in the label", () => {
    expect(CARD_SRC).toContain("Draft the full page (~$0.02-0.05)");
  });

  it("only offers the button when a copyable prepared brief exists (never on a rejected brief)", () => {
    expect(CARD_SRC).toMatch(
      /o\.preparedBrief && \(o\.briefQuality\?\.status === "ready" \|\| o\.briefQuality\?\.status === "useful_but_needs_review" \|\| !o\.briefQuality\)/,
    );
  });

  it("calls draftFullPageAction with the brief + grounding (whatWins, fanouts, evidence)", () => {
    expect(CARD_SRC).toContain("draftFullPageAction({");
    expect(CARD_SRC).toContain("competitorWhatWins: o.whatWins ?? null");
    expect(CARD_SRC).toContain("fanoutQuestions: o.aeoReceipt?.fanoutQueries ?? []");
    expect(CARD_SRC).toMatch(/evidenceFacts: \[o\.gapEvidence, o\.wikiGapEvidence\]/);
  });

  it("shows a real-spend receipt after drafting (cost + saved state)", () => {
    expect(CARD_SRC).toMatch(/Spent \$\{fullPageReceipt\.costUsd\.toFixed\(3\)\}/);
    expect(CARD_SRC).toContain('" · saved"');
  });

  it("renders a collapsible full-draft view with a copy button", () => {
    expect(CARD_SRC).toMatch(/setFullPageOpen\(\(v\) => !v\)/);
    expect(CARD_SRC).toContain("Copy full page");
    expect(CARD_SRC).toMatch(/writeText\(fullPage\.markdown\)/);
  });

  it("shows the per-section sources and the sources appendix in the expanded view", () => {
    expect(CARD_SRC).toMatch(/s\.sources\.map\(\(src\) => src\.detail\)\.join\("; "\)/);
    expect(CARD_SRC).toContain("Sources appendix");
    expect(CARD_SRC).toMatch(/fullPage\.sourcesAppendix\.map/);
  });

  it("owns honest fallback states for off / budget / error", () => {
    expect(CARD_SRC).toMatch(/fullPageStatus === "off"/);
    expect(CARD_SRC).toMatch(/fullPageStatus === "budget"/);
    expect(CARD_SRC).toMatch(/fullPageStatus === "error"/);
  });

  it("hydrates a previously-persisted draft from the loader (survives reload)", () => {
    expect(CARD_SRC).toMatch(/useState<AssembledDraftPage \| null>\(o\.fullPageDraft\)/);
    expect(DATA_SRC).toContain("full_page_draft");
    expect(DATA_SRC).toContain("reassembleFromPersisted(");
  });
});

describe("draftFullPageAction — operator + persistence wiring", () => {
  it("is operator-gated server-side", () => {
    expect(ACTIONS_SRC).toMatch(/if \(!\(await isOperatorModeServer\(\)\)\) return \{ ok: false, reason: "Operator only\." \}/);
  });

  it("persists via move_drafts kind full_page_draft", () => {
    expect(ACTIONS_SRC).toContain('saveMoveDraft(tenantId, recId, "full_page_draft", content)');
  });

  it("refuses to draft without an outline (honest, never a blank walk)", () => {
    expect(ACTIONS_SRC).toContain("This brief has no outline yet");
  });
});

describe("hard rule — no em/en dashes in generated copy paths", () => {
  const BANNED = /[–—]/; // en dash, em dash

  it("walker strips dashes at assembly (uses the canonical stripBannedDashes)", () => {
    expect(WALKER_SRC).toContain("stripBannedDashes");
    expect(WALKER_SRC).toMatch(/markdown: stripDashes\(/);
  });

  it("no em/en dash in any operator-facing string literal of the new card UI", () => {
    // Comments may quote the old style; check only string/JSX-literal-bearing lines
    // that this item ADDED (full-page block markers).
    const added = CARD_SRC.split("\n").filter((l) => /fullPage|Draft the full page|Sources appendix|Copy full page/.test(l));
    for (const line of added) {
      expect(BANNED.test(line), `banned dash in: ${line.trim()}`).toBe(false);
    }
  });

  it("no em/en dash anywhere in the new action + walker modules", () => {
    // The walker file allows the em dash ONLY inside comments (repo-wide comment
    // style predates the copy rule); every string literal must be clean. Simplest
    // robust check: no banned dash on any line containing a template/string quote
    // that is not a pure comment line.
    for (const [name, src] of [
      ["today-newpages-draft-actions.ts", ACTIONS_SRC],
      ["draft-full-page.ts", WALKER_SRC],
    ] as const) {
      const offending = src
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // ignore comment-only lines
        .filter((l) => BANNED.test(l));
      expect(offending, `${name} has a banned dash outside comments: ${offending[0] ?? ""}`).toEqual([]);
    }
  });
});
