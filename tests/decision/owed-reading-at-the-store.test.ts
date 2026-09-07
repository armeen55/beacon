/** RV2 review, at the door that actually writes a row: does the obligation ladder's terminal rung survive `saveChangeProposal`, and does a half written new page survive being stored? Two synthetic accounts, unrelated subjects, through the REAL store over an in-memory Postgres. */
import { describe, it, expect, beforeEach, vi } from "vitest";
const db = vi.hoisted(() => ({ state: { rows: [] as Record<string, unknown>[] }, client: {} as Record<string, unknown> }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
import { saveChangeProposal, loadChangeProposals } from "@/domains/decision/proposal-store";
import { nextObligation } from "@/domains/decision/obligation";
import { preferFinished } from "@/domains/decision/completeness";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
Object.assign(db.client, supabaseFake({ rows: () => db.state.rows as Row[], insertDefaults: () => ({ created_at: "2026-09-01T00:00:00.000Z" }) }));
(db.client as { rpc: unknown }).rpc = async () => ({ data: "saved", error: null });

const SITES = [
  { t: "acct-reef", page: "/tide-pool-guide", q: "tide pool safety", topic: "tide pool etiquette" },
  { t: "acct-loom", page: "/blackwork-stitches", q: "blackwork stitch order", topic: "blackwork thread weights" },
] as const;

const row = (s: (typeof SITES)[number], over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${s.t}::${s.page}::existing_edit::demand_recovery`, tenantId: s.t, kind: "existing_edit", pagePath: s.page,
  pageUrl: `https://www.${s.t}.example${s.page}`, pageLabel: "Guide", primaryQuery: s.q,
  opportunityType: "Recover lost clicks", changeFamily: "section", status: "needs_review", researchOnly: true,
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." },
  whyItMatters: "This page lost clicks on a search it used to earn.", estimatedEffortMinutes: 30,
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: s.q, hints: [], evidenceRefCount: 1 },
  impactScore: 300, upsidePerMonth: null, basis: "basis_rv2::d1", publish: "manual", createdAt: "2026-09-01T00:00:00.000Z", ...over });

/** A new page half written: the brief it was planned from and one finished piece, the shape A10 banks on the row. */
const halfWritten = (s: (typeof SITES)[number]): ChangeProposal => ({
  ...row(s), id: `${s.t}::topic::new_page::${s.topic.replace(/\s+/g, "-")}`, kind: "new_page", pagePath: null, pageUrl: null,
  primaryQuery: s.topic, changeFamily: "new_page", researchOnly: true,
  recommendedChange: { kind: "new_page", proposedTitle: s.topic, metaDescription: `What to know about ${s.topic}.`, openingAnswer: `${s.topic} comes down to three things.`, outline: ["What it is", "How it works"], faqQuestions: [], schemaTypes: [] },
  research: { missing: "One section still owes a source.", next: "The owed section is written on the next pass." },
  newPageDraft: { brief: { title: s.topic, sections: ["What it is", "How it works"] },
    pieces: [{ heading: "What it is", after: `The first thing to know about ${s.topic} is that it has a settled order.`, claims: [], supportFacts: [], review: [] }] } as never });

beforeEach(() => { db.state.rows = []; });

describe("a settlement nobody read the winners for, at the door that writes it", () => {
  it.each(SITES)("$t: the ladder itself turns the stored settlement into the owed reading", (s) => {
    const settled = row(s, { winnersOnFile: "unread", obligation: { kind: "terminal", reason: "no substantive gap named" } });
    expect(nextObligation(settled)).toEqual({ kind: "evidence", need: { kind: "competitor_page", query: s.q, reasonCode: "no_winner_to_read" } });
  });

  it.each(SITES)("$t: and the store writes that owed reading onto the row rather than re-stamping the settlement", async (s) => {
    const settled = row(s, { winnersOnFile: "unread", obligation: { kind: "terminal", reason: "no substantive gap named" } });
    expect(await saveChangeProposal(settled)).toBe("saved");
    const stored = (await loadChangeProposals(s.t)).get(settled.id)!;
    expect(stored.obligation, "the row on file says which reading it is waiting on, so the runtime's buy loops can read it")
      .toEqual({ kind: "evidence", need: { kind: "competitor_page", query: s.q, reasonCode: "no_winner_to_read" } });
  });

  /** AND THE ROW WITH NOTHING ON FILE STILL OWES ITS RESULTS PAGE, THROUGH THE SAME DOOR (production 11:02:46Z, 2026-09-06): three hub rows were saved under the new work identity with `winnersOnFile` "none" and the ladder's owed results page on each, which is the shape the runtime's purchase loop then buys. The store may not hand that answer back as the settlement it replaced. */
  it.each(SITES)("$t: a row with no results page on file owes that results page, and the store writes it over the settlement", async (s) => {
    const settled = row(s, { winnersOnFile: "none", obligation: { kind: "terminal", reason: "no substantive gap named" } });
    expect(await saveChangeProposal(settled)).toBe("saved");
    const stored = (await loadChangeProposals(s.t)).get(settled.id)!;
    expect([nextObligation(settled), stored.obligation], "no results page has ever been bought for this search, so the first reading it owes is that results page, on the row the store keeps")
      .toEqual([{ kind: "evidence", need: { kind: "serp", query: s.q, reasonCode: "no_winner_to_read" } }, { kind: "evidence", need: { kind: "serp", query: s.q, reasonCode: "no_winner_to_read" } }]);
  });

  it.each(SITES)("$t: a row whose results page is already on file owes the reading of its winners, not another results page", (s) => {
    const owes = nextObligation(row(s, { winnersOnFile: "unread", obligation: { kind: "terminal", reason: "no substantive gap named" } }));
    expect(owes?.kind === "evidence" ? owes.need.kind : null, "unread means the results page was bought and nothing off it was read, and only the winner read can move that")
      .toBe("competitor_page");
  });
});

/** THE ANSWER IS DERIVED ON EVERY PASS FROM WHAT IS ON FILE, NEVER READ BACK OFF THE ROW (reviewer two, 2026-09-06). The reading is stamped onto the row so the runtime's buy loops can see it, which replaces the settlement it was derived from, so a re-mint that carried nothing forward left the row owing a first paid draft on a pass where nothing about its evidence had moved. It rides the re-mint, the ladder derives the same answer while nobody has read the winners, and the drive that reads them discharges it and hands the row to the writer. */
describe("the same row on the pass after, with nothing about its evidence moved", () => {
  const need = (s: (typeof SITES)[number]) => ({ kind: "evidence", need: { kind: "competitor_page", query: s.q, reasonCode: "no_winner_to_read" } });
  it.each(SITES)("$t: the owed reading survives the re-mint, and a reading that landed is not owed again", (s) => {
    const owed = row(s, { winnersOnFile: "unread", obligation: need(s) as never });
    expect([nextObligation(owed), nextObligation(preferFinished(row(s, { winnersOnFile: "unread" }), owed)), nextObligation(preferFinished(row(s, { winnersOnFile: "read" }), owed))],
      "a pass that buys nothing leaves the row owing exactly what it owed, and the drive that reads the winners retires the reading and hires the writer rather than buying it again every day").toEqual([need(s), need(s), { kind: "draft" }]);
  });
});

describe("a new page half written, at the door that stores it", () => {
  it.each(SITES)("$t: the finished pieces and the brief survive the store", async (s) => {
    const p = halfWritten(s);
    expect(await saveChangeProposal(p)).toBe("saved");
    const stored = (await loadChangeProposals(s.t)).get(p.id)!;
    expect([stored.newPageDraft?.pieces.length ?? 0, stored.newPageDraft?.brief != null], "the next pass buys neither the brief nor the piece again").toEqual([1, true]);
  });

  it.each(SITES)("$t: and a fresh mint of the same topic does not throw the finished pieces away", async (s) => {
    const p = halfWritten(s); await saveChangeProposal(p);
    const { newPageDraft: _dropped, ...mint } = p; await saveChangeProposal(mint as ChangeProposal);
    const stored = (await loadChangeProposals(s.t)).get(p.id)!;
    expect(stored.newPageDraft?.pieces.length ?? 0, "a producer that re-mints the topic holds no draft, and the words already paid for are on the row").toBe(1);
  });
});

it.each(SITES)("#129 $t: a declined draft survives a new basis, id and cosmetic formatting", async (s) => {
  const declined = row(s, { researchOnly: false, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Otters, herons and frogs.", where: "After the opening" } });
  expect(await saveChangeProposal(declined)).toBe("saved");
  const record = db.state.rows.find((r) => r.id === declined.id)!; record.terminal_disposition = "dismissed";
  const again = { ...declined, id: declined.id + "-new", basis: "new-evidence", recommendedChange: { ...declined.recommendedChange, after: "OTTERS; herons and frogs!" } } as ChangeProposal;
  expect(await saveChangeProposal(again)).toBe("refused");
  expect(await saveChangeProposal({ ...again, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Otters inhabit rivers while herons hunt in shallow wetlands.", where: "After the opening" } })).toBe("saved");
});
