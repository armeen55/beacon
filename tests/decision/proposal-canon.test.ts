/** CANONICAL PROPOSAL PERSISTENCE (V1 Truth Convergence Phase 5): one current row per hypothesis (account, case, page, action family), a re-draft supersedes with a pointer and a version, an identical draft writes nothing, a dismissed change is not resurrected under the same evidence, history stays readable and is never revived, and a write that lands nothing is a failure. Fixtures only: the fake Postgres below enforces the primary key and the partial unique index. */
import { describe, it, expect, beforeEach, vi } from "vitest";
const db = vi.hoisted(() => {
  const state = { rows: [] as Row[], legacy: [] as Row[], missing: false, rpcMissing: false, breakWrite: false, rpcCalls: 0, raceForeign: "", race: null as null | (() => void) };
  const client: Record<string, unknown> = {
    rpc(name: string, args: { p_tenant_id: string; p_predecessor_id: string; p_row: Row }) { state.rpcCalls += 1;
      const run = (): { data: string | null; error: { message: string; code?: string } | null } => {
        if (name !== "supersede_change_proposal") return { data: null, error: { message: `unknown function ${name}` } };
        if (state.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.supersede_change_proposal" } };
        if (state.rows.some((r) => r.id === (args.p_row as Row).id && r.tenant_id !== args.p_tenant_id)) return { data: "failed", error: null };
        const pred = state.rows.find((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_predecessor_id);
        if (!pred) return { data: "failed", error: null };
        if (pred.terminal_disposition != null || !["ready", "needs_review"].includes(String(pred.status))) return { data: "blocked", error: null };
        if (state.breakWrite) return { data: "failed", error: null }; // the transaction rolls back: neither write lands
        const row = args.p_row;
        const clash = state.rows.some((r) => r.id !== row.id && r.id !== pred.id && r.terminal_disposition == null
          && ["tenant_id", "case_id", "page_key", "action_family", "mutation_key"].every((c) => r[c] === row[c]));
        if (clash) return { data: "failed", error: null };
        if (state.raceForeign) state.rows.push({ id: row.id, tenant_id: state.raceForeign, status: "ready", created_at: "2026-07-01T00:00:00.000Z" });
        const at = state.rows.findIndex((r) => r.id === row.id);
        if (at >= 0 && state.rows[at]!.tenant_id !== args.p_tenant_id) return { data: "failed", error: null };
        Object.assign(pred, { terminal_disposition: "superseded", superseded_by: row.id, updated_at: row.updated_at });
        if (at >= 0) state.rows[at] = { ...state.rows[at], ...row }; else state.rows.push({ created_at: "2026-07-01T00:00:00.000Z", ...row });
        return { data: "saved", error: null };};
      return Promise.resolve(run());
    }, };
  return { state, client }; });
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
/** What the store SAID, so a distinct failure can be pinned as distinct rather than as one more "failed". */
const said = vi.hoisted(() => ({ errors: [] as string[] }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: (msg: string) => { said.errors.push(msg); } } }));
import { dismissChangeProposal, loadChangeProposal, loadChangeProposals, answerReviewedProposal, saveChangeProposal,
  transitionProposalToImplemented } from "@/domains/decision/proposal-store";
import { confirmedVersion } from "@/domains/decision/completeness"; import { REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof";
import { reconcileImplementedWithoutShipment } from "@/domains/decision/implemented-repair"; import { validateProposal } from "@/domains/decision/validate-proposal";
import { componentIdOf, deserializeChangeProposal, serializeChangeProposal, type ChangeBundle, type ChangeProposal } from "@/domains/decision/contracts";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
Object.assign(db.client, supabaseFake({
  rows: (t) => (t === "change_proposals" ? db.state.rows : db.state.legacy),
  error: (t) => (t === "change_proposals" && db.state.missing ? { code: "PGRST205", message: "table not found in schema cache" } : null),
  landsNothing: () => db.state.breakWrite, insertDefaults: () => ({ created_at: "2026-07-01T00:00:00.000Z" }),
  onSelect: () => { const r = db.state.race; db.state.race = null; r?.(); },
  clash: (row, rows) => (rows.some((r) => r.id !== row.id && r.terminal_disposition == null
    && ["tenant_id", "case_id", "page_key", "action_family"].every((c) => r[c] === row[c]))
    ? { message: "duplicate key value violates unique constraint ux_change_proposals_current" } : null),}));
const T = "acct-a", PAGE = "/nowruz-guide";
const bundle = (kind: ChangeBundle["components"][number]["kind"], after = "Nowruz Traditions and the Haft-Seen Table"): ChangeBundle => ({
  objective: "Say what the searcher asked for in the line Google shows.", metric: "clicks on this page for this search",
  scope: { queries: ["nowruz traditions"], prompts: [] },
  components: [{ kind, label: "Page title", before: "Nowruz", after, evidenceKeys: ["k1"], risk: "safe" }],
  receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks for nowruz traditions.", observedAt: "2026-07-25T00:00:00.000Z" }], missing: [], freshestObservedAt: "2026-07-25T00:00:00.000Z" },
  alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "I will read clicks for this search after 14 days.",});
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${T}::${PAGE}::existing_edit::title`, tenantId: T, kind: "existing_edit", pagePath: PAGE,
  pageUrl: `https://www.fixture-outdoors.example${PAGE}`, pageLabel: "Nowruz guide", primaryQuery: "nowruz traditions",
  opportunityType: "Capture clicks", changeFamily: "title", status: "ready",
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  whyItMatters: "The line Google shows misses the words people search for.", estimatedEffortMinutes: 1,
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "nowruz traditions", hints: [], evidenceRefCount: 1 },
  impactScore: 300, upsidePerMonth: null, basis: "basis_today::d6", publish: "manual", createdAt: "2026-07-30T00:00:00.000Z", ...over,});
/** The deep form of the same hypothesis: a different id, the same page, the same family. */
const deep = (over: Partial<ChangeProposal> = {}) => proposal({ id: `${T}::${PAGE}::existing_edit::title-family`, bundle: bundle("title"), diagnosisCause: "ctr_snippet", modeledOn: "the stored results page for this search", ...over });
const current = () => db.state.rows.filter((r) => r.terminal_disposition == null);
const seedLegacy = (p: ChangeProposal) => db.state.legacy.push({ tenant_id: p.tenantId, rec_id: p.id, kind: "change_proposal", content: serializeChangeProposal(p), created_at: p.createdAt });
beforeEach(() => { db.state.rows = []; db.state.legacy = []; db.state.missing = false; db.state.rpcMissing = false; db.state.breakWrite = false; db.state.rpcCalls = 0; db.state.raceForeign = ""; db.state.race = null; });
/** POST-CONTRACT HISTORY (packet acceptance 22). The contract migration moved every row onto the three lifecycle words and the bridge decoder is deleted with it: the same reads answer identically without one, and no historical proposal disappears. */
const PROMOTE = { kind: "promote" as const, at: "2026-08-15T00:00:00.000Z" };
describe("rows written after the lifecycle contract", () => {
  const row = (id: string, word: string): Row => ({
    tenant_id: T, id, proposal_version: 1, status: word, terminal_disposition: null, superseded_by: null,
    basis: "basis_today::d6", case_id: "", page_key: id, action_family: "title-family",
    payload: JSON.parse(JSON.stringify({ v: 1, proposal: { ...proposal({ id, pagePath: id }), status: word } })),
    updated_at: "2026-07-30T00:00:00.000Z" });
  it("22: the queue is the canonical table alone, and a pre-canonical row is history rather than current work", async () => {
    db.state.rows.push(row("/a", "ready"), row("/b", "implemented_pending_verification")); seedLegacy(proposal({ id: "/legacy-only", pagePath: "/legacy-only" }));
    const queue = await loadChangeProposals(T); expect([[...queue.keys()].sort(), queue.get("/b")!.status]).toEqual([["/a", "/b"], "implemented_pending_verification"]); }); });
describe("canonical proposal persistence", () => {
  it("keeps ONE current row per hypothesis: a re-draft supersedes its predecessor, points at it, and carries the next version", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(deep())).toBe("saved"); // the deep form of the same page and the same family
    expect([db.state.rows.length, current().map((r) => [r.id, r.proposal_version, r.action_family])]).toEqual([2, [[`${T}::${PAGE}::existing_edit::title-family`, 2, "title-family"]]]);
    const retired = db.state.rows.find((r) => r.id === `${T}::${PAGE}::existing_edit::title`)!; expect([retired.terminal_disposition, retired.superseded_by]).toEqual(["superseded", `${T}::${PAGE}::existing_edit::title-family`]);
    expect(await loadChangeProposal(T, retired.id as string)).toBeNull(); expect([...(await loadChangeProposals(T)).keys()]).toEqual([`${T}::${PAGE}::existing_edit::title-family`]); });
  it("bumps the version in place when the same id says something new, and writes NOTHING when it says the same thing", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(proposal())).toBe("unchanged"); // same material content, same timestamp, no write
    expect(await saveChangeProposal({ ...proposal(), createdAt: "2026-07-31T09:00:00.000Z" })).toBe("unchanged"); // a moved clock is not new thinking
    expect([db.state.rows.length, db.state.rows[0]!.proposal_version]).toEqual([1, 1]); expect(await saveChangeProposal(proposal({ status: "needs_review" }))).toBe("saved");
    expect(db.state.rows).toHaveLength(1); // still one row: the same id is the same hypothesis
    expect([db.state.rows[0]!.proposal_version, db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition]).toEqual([2, "needs_review", null]);
    expect(await saveChangeProposal(proposal({ bundle: bundle("section_rewrite") }))).toBe("saved"); expect([db.state.rows.length, db.state.rows[0]!.action_family, db.state.rows[0]!.proposal_version]).toEqual([1, "section-family", 3]); });
  it("lands the reasoning on the stored row exactly once: the cause is material, and a re-save carrying the same one writes nothing", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved"); // filed before the ladder ever named a cause
    const reasoned = proposal({ diagnosisCause: "ctr_snippet", causeFinding: { cause: "ctr_snippet", action: "title", evidenceKeys: ["gsc"],
      competingExplanations: [{ cause: "cannibalization", reason: "only one page of yours comes up for that search" }],
      falsifier: "If Google starts displaying this page with the wording the pages beating it share, this is not the explanation.",
      explanation: "The line Google shows misses the words people search for.", notConsidered: [] } });
    expect(await saveChangeProposal(reasoned)).toBe("saved"); // ONE update, so the operator can actually open the investigation
    expect([db.state.rows.length, db.state.rows[0]!.proposal_version, (db.state.rows[0]!.decision_receipt as { cause: string }).cause]).toEqual([1, 2, "ctr_snippet"]);
    expect(await saveChangeProposal(reasoned)).toBe("unchanged"); // and once only: every pass after it re-derives the same reasoning
    expect(db.state.rows[0]!.proposal_version).toBe(2); });
  it("holds two current rows when one page carries two different action families", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved"); // title-family
    const body = deep({ id: `${T}::${PAGE}::existing_edit::section-family`, bundle: bundle("section_rewrite") }); // the id the producer mints for it: the family is IN the id, so two families coexist
    expect(await saveChangeProposal(body)).toBe("saved"); // section-family: a different hypothesis about the same page
    expect([current().map((r) => r.action_family).sort(), current().every((r) => r.proposal_version === 1), (await loadChangeProposals(T)).size]).toEqual([["section-family", "title-family"], true, 2]);});
  it("does not resurrect a dismissed change under the same evidence, and lets a new basis try again", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // the operator put it away
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused"); expect([db.state.rows[0]!.terminal_disposition, (await loadChangeProposals(T)).size]).toEqual(["dismissed", 0]);
    expect(await saveChangeProposal(proposal({ basis: "basis_tomorrow::d6" }))).toBe("saved"); expect([db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.proposal_version]).toEqual([null, 2]); });
  it("the operator's own put-this-aside writes the dismissal, and refuses to retire a change already being measured", async () => {
    await saveChangeProposal(proposal());
    expect(await dismissChangeProposal(T, proposal().id)).toBe(true); // it stops being the current answer immediately
    expect([db.state.rows[0]!.terminal_disposition, (await loadChangeProposals(T)).size]).toEqual(["dismissed", 0]);
    expect(await dismissChangeProposal(T, proposal().id)).toBe(false); // already put away, nothing to write
    Object.assign(db.state.rows[0]!, { terminal_disposition: null, status: "implemented_pending_verification" });
    expect([await dismissChangeProposal(T, proposal().id), db.state.rows[0]!.terminal_disposition, await dismissChangeProposal(T, "an-id-nobody-holds")]).toEqual([false, null, false]);});
  it("refuses a crafted successor id that lives under another account, and nothing moves", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    db.state.rows.push({ id: "acct-b::/other::existing_edit::title", tenant_id: "acct-b", case_id: "", page_key: "/other",
      action_family: "title-family", proposal_version: 1, basis: "b1", status: "ready", terminal_disposition: null,
      superseded_by: null, payload: JSON.parse(serializeChangeProposal(proposal({ id: "acct-b::/other::existing_edit::title", tenantId: "acct-b", pagePath: "/other" }))), created_at: "2026-07-01T00:00:00.000Z" });
    const crafted = proposal({ id: "acct-b::/other::existing_edit::title", basis: "b2",
      bundle: bundle("title", "A Different Title Entirely") });
    expect(await saveChangeProposal(crafted)).toBe("failed"); const b = db.state.rows.find((r) => r.tenant_id === "acct-b")!;
    expect([b.status, b.terminal_disposition, b.proposal_version]).toEqual(["ready", null, 1]); // untouched
    const a = db.state.rows.find((r) => r.tenant_id === T)!;
    expect(a.terminal_disposition).toBeNull(); // the predecessor keeps its place
  });
  it("serves the canonical table alone: a pre-cutover row is history, an unreadable table is an empty queue, and no account sees another's work", async () => {
    seedLegacy(proposal({ id: `${T}::/older-page::existing_edit::title`, pagePath: "/older-page" })); seedLegacy(proposal({ tenantId: "acct-b", id: "acct-b::/theirs::existing_edit::title" }));
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([]); await saveChangeProposal(proposal()); await saveChangeProposal(deep()); // the deep row retires the title row the legacy store still holds a copy of
    expect([[...(await loadChangeProposals(T)).keys()], [...(await loadChangeProposals("acct-b")).keys()]]).toEqual([[deep().id], []]);
    db.state.missing = true; expect((await loadChangeProposals(T)).size).toBe(0); expect(await saveChangeProposal(proposal({ status: "implemented_pending_verification" }))).toBe("failed"); });
  it("keeps the finished row when a stale pass writes its own brief over it, and hands back the row that stands", async () => {
    const finished = proposal({ claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "f" }], copyStamp: "T|H|D|O", workKey: "w1" });
    expect(await saveChangeProposal(finished)).toBe("saved"); let stands: ChangeProposal | null = null; const stale = proposal({ status: "needs_review", researchOnly: true, copyStamp: "T|H|D|O", workKey: "w1", recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "The exact title is not written yet." } });
    expect(await saveChangeProposal(stale, undefined, (r) => { stands = r; })).toBe("unchanged"); // the store merged, so nothing was written over the finished words
    expect([stands!.status, (stands!.recommendedChange as { after: string }).after]).toEqual(["ready", "Nowruz Traditions and the Haft-Seen Table"]);
    db.state.rows[0]!.status = "implemented_pending_verification"; const before = JSON.stringify(db.state.rows); // AND A CHANGE THE OPERATOR ALREADY MARKED DONE IS NOT REWRITTEN INTO A DRAFT: the measurement guard only ever inspected OTHER rows
    expect(await saveChangeProposal(proposal({ status: "needs_review" }))).toBe("blocked"); expect(JSON.stringify(db.state.rows)).toBe(before); });
  /** ONE OBJECTION STANDS ON A ROW ONCE (live, 2026-09-05). A refusal reaches a row twice, raw from the gate that composed it and again wrapped by the door that says which read it failed; the writer's guard is an exact-match test, so the two forms never match each other and the Pahlavi answer carries the same objection twice in `faults` and twice in `limitations`. Folded at the one door every producer's row passes through, on the composer's own shape and nothing wider. */
  it.each(["acct-a", "acct-b"])("writes one objection once however many doors phrased it, and leaves a short line that merely reads like part of a longer one alone, on %s", async (acct) => {
    db.state.rows = []; const raw = "it opens with the search words as a label and a colon", wrapped = `it did not pass the re-read of a stored change against the rules that stand today: ${raw}`;
    const near = "Relies on one factual claim only", longer = `${near} and the page never states which one`;
    const id = `${acct}::${PAGE}::existing_edit::title`;
    expect(await saveChangeProposal(proposal({ id, tenantId: acct, status: "needs_review", faults: [wrapped, raw], limitations: [wrapped, raw, near, longer] })), "the row is written").toBe("saved");
    const on = deserializeChangeProposal(JSON.stringify(db.state.rows[0]!.payload))!;
    expect([on.faults, on.limitations], "the composed sentence stands and the bare one it already contains does not, in both fields, and a line another merely starts with is untouched").toEqual([[wrapped], [wrapped, near, longer]]);
    expect(await saveChangeProposal(proposal({ id, tenantId: acct, status: "needs_review", faults: [wrapped], limitations: [wrapped, near, longer] })), "and the folded row is byte-stable: a pass writing what already stands writes nothing").toBe("unchanged"); });
  it("proves the handover row belongs to this account BEFORE it writes, and names a missing supersession function for what it is", async () => {
    db.state.rows.push({ id: "held", tenant_id: "", site: "fixture-outdoors.example", case_id: "", page_key: PAGE,
      action_family: "title-family", status: "ready", terminal_disposition: null, proposal_version: 1,
      payload: JSON.parse(serializeChangeProposal(proposal({ id: "held" }))) as unknown });
    expect(await saveChangeProposal(proposal({ tenantId: "" }))).toBe("failed"); expect(db.state.rpcCalls).toBe(0);
    expect(db.state.rows[0]!.terminal_disposition).toBeNull(); // nothing moved
    db.state.rows = [];
    expect(await saveChangeProposal(proposal())).toBe("saved");
    db.state.rpcMissing = true;
    said.errors = [];
    expect(await saveChangeProposal(deep())).toBe("failed");
    expect(said.errors.join(" ")).toContain("the supersession function is not installed"); // named, not one more silent "failed"
    expect(db.state.rows).toHaveLength(1);                                   // the successor never landed
    expect(db.state.rows[0]!.terminal_disposition).toBeNull();               // and the predecessor is still current
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); });
  it("never retires a change the operator already acted on: a newer draft for that hypothesis is refused and the applied row keeps its place", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await transitionProposalToImplemented(T, proposal().id, "shp_seed")).toBe(true); // done is reachable only through the transaction
    expect(await saveChangeProposal(deep())).toBe("blocked"); // the same page, the same family, a fresh idea
    expect(await saveChangeProposal(proposal({ status: "needs_review", confidence: "low", limitations: ["a rule added today refuses this"] })), "and a save on the row's OWN id never walks a shipped change back to a draft").toBe("blocked");
    expect(db.state.rows).toHaveLength(1);
    expect([db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.superseded_by])
      .toEqual(["implemented_pending_verification", null, null]); // the change being measured is still the current answer
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); // the queue is exactly what it was
    Object.assign(db.state.rows[0]!, { status: "needs_review", terminal_disposition: "withdrawn", basis: "basis_today::d6",
      payload: JSON.parse(JSON.stringify({ v: 1, proposal: deep() })) });
    expect(await saveChangeProposal(deep())).toBe("refused");
    const moved = deep(); moved.bundle!.receipt.items[0]!.observedAt = "2026-08-04T00:00:00.000Z"; expect(await saveChangeProposal(moved)).toBe("saved");
    Object.assign(db.state.rows[0]!, { status: "needs_review", terminal_disposition: "withdrawn", payload: JSON.parse(JSON.stringify({ v: 1, proposal: moved })) });
    const two = (b: typeof moved) => { const i = b.bundle!.receipt.items[0]!; b.bundle!.receipt.items = [i, { ...i, key: "k2", fact: "Two rivals now answer it with a table." }]; return b; };
    const twoWay = two(deep()); twoWay.bundle!.receipt.items[0]!.observedAt = "2026-08-04T00:00:00.000Z";
    Object.assign(db.state.rows[0]!, { payload: JSON.parse(JSON.stringify({ v: 1, proposal: twoWay })) });
    const shuffled = two(deep()); shuffled.bundle!.receipt.items[0]!.observedAt = "2026-08-04T00:00:00.000Z"; shuffled.bundle!.receipt.items.reverse(); expect(await saveChangeProposal(shuffled)).toBe("refused"); });
  /** AN ATOMIC CHANGE CARRIES NO RECEIPT, so hashing the receipt hashed the empty list for every one of them: they matched each other unconditionally and stayed shut forever on an unchanged basis. What such a change stands on is the frozen evidence summary and the exact edit it argues for. */
  it("reopens an atomic change whose own evidence moved, and keeps the refusal while it has not", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "withdrawn" });
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused"); // same evidence, same edit: still history
    expect(await saveChangeProposal(proposal({ evidence: { query: "nowruz traditions", hints: ["the results page now shows a table"], evidenceRefCount: 4 } }))).toBe("saved"); });
  it("asks EVERY dismissal, not whichever row came back first: a redraft under a basis this hypothesis was dismissed under is refused", async () => {
    await saveChangeProposal(proposal({ basis: "basis_a" }));
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // put away under basis_a
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("saved"); // a new reading, so it may try again
    Object.assign(db.state.rows[1]!, { terminal_disposition: "dismissed" }); // put away under basis_b too
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("refused"); expect(await saveChangeProposal(deep({ basis: "basis_c" }))).toBe("saved"); });
  it("repairs a handover whose successor never landed: the predecessor reads as current again until a real successor exists", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "superseded", superseded_by: deep().id }); // The crash the in-process rollback cannot cover: the predecessor stepped aside, the insert never landed.
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([proposal().id]); // the hypothesis is not stranded
    await saveChangeProposal(deep()); // the successor lands for real
    expect([...(await loadChangeProposals(T)).keys()]).toEqual([deep().id]); }); // and the repair stops applying
  it("reads the queue, not the archive: hundreds of retired versions never crowd out the current work, and none of them comes back through the old store", async () => {
    const canonRow = (id: string, over: Row = {}): Row => ({ id, tenant_id: T, site: "", case_id: "", page_key: id, action_family: "title-family",
      proposal_version: 1, basis: "basis_today::d6", status: "ready", terminal_disposition: null, superseded_by: null,
      payload: JSON.parse(serializeChangeProposal(proposal({ id }))), updated_at: "2026-07-31T09:00:00.000Z", ...over });
    const live = [0, 1, 2, 3, 4].map((i) => `${T}::/live-${i}::existing_edit::title`);
    for (const id of live) db.state.rows.push(canonRow(id, { updated_at: "2026-07-30T09:00:00.000Z" })); // the oldest-touched rows of all
    for (let i = 0; i < 600; i += 1) { const id = `${T}::/old-${i}::existing_edit::title`;
      db.state.rows.push(canonRow(id, { terminal_disposition: "superseded", superseded_by: live[i % 5]! })); }
    seedLegacy(proposal({ id: `${T}::/old-7::existing_edit::title` })); // the old store still holds a copy of a retired row
    expect([...(await loadChangeProposals(T)).keys()].sort()).toEqual([...live].sort()); }); // five current rows, and not one resurrection
  it.each([["a write that landed no row", () => { db.state.breakWrite = true; }], // A HANDOVER THAT DID NOT LAND IS A FAILURE, whether the write simply landed no row or a successor id raced in under another account after the guard read. Either way the predecessor keeps its place and its queue.
    ["a successor id racing in under another account", () => { db.state.raceForeign = "acct-b"; }],
  ] as const)("%s is a FAILURE, and the predecessor keeps its place", async (_name, arrange) => {
    await saveChangeProposal(proposal());
    arrange();
    expect(await saveChangeProposal(deep())).toBe("failed");
    expect(current().filter((r) => r.tenant_id === T).map((r) => [r.id, r.terminal_disposition, r.superseded_by])) .toEqual([[proposal().id, null, null]]);
    expect((await loadChangeProposals(T)).size).toBe(1); // one proposal, still current, still this account's
  });
  it("anchorAfter and redirectTo survive the persistence round trip", () => { // PIN: the schema keeps every word a check reads later. A renamed link is verified on anchorAfter and a forward on redirectTo; a schema that strips either sends the check out wordless and it grades nothing.
    const b = bundle("anchor_text");
    b.components[0] = { ...b.components[0]!, anchorAfter: "Read the Haft-Seen guide", redirectTo: "https://own.com/haft-seen" };
    const back = deserializeChangeProposal(serializeChangeProposal(deep({ bundle: b })));
    expect(back?.bundle?.components.map((c) => [c.anchorAfter, c.redirectTo]))
      .toEqual([["Read the Haft-Seen guide", "https://own.com/haft-seen"]]); }); });
/** THE ONE DOOR TO "DONE", AND THE TRIPWIRE UNDER IT. A change reads done only because a Shipment was written for it first, so the flip demands that record's id and a row marked done that no record points at is a state this product cannot legitimately produce: it is never left silently done, and no record is ever invented for it. */
describe("done is only ever reached with a record behind it", () => {
  const DONE_ID = `${T}::${PAGE}::existing_edit::title`, SENTENCE = "A change marked done on August 12 lost its record; mark it done again when you confirm it is live.";
  const seed = (over: Partial<ChangeProposal> = {}) => { const p = proposal(over);
    db.state.rows.push({ tenant_id: T, id: DONE_ID, proposal_version: 1, status: p.status, terminal_disposition: null, superseded_by: null, basis: p.basis ?? null,
      case_id: "", page_key: PAGE, action_family: "title-family", queue_lane: "rel::ready", queue_rank: 3,
      payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: "2026-08-12T04:50:00.000Z" });
    return db.state.rows[0]!; };
  const done = (over: Partial<ChangeProposal> = {}) => seed({ status: "implemented_pending_verification", ...over });
  const storedNow = (row: Record<string, unknown>) => deserializeChangeProposal(JSON.stringify(row.payload));
  it("refuses the flip with no record named, and lands it with one", async () => {
    const row = seed();
    expect([await transitionProposalToImplemented(T, DONE_ID, "  "), row.status]).toEqual([false, "ready"]); // nothing moved, so the change is still theirs to do
    expect([await transitionProposalToImplemented(T, DONE_ID, "rec-1"), db.state.rows[0]!.status]).toEqual([true, "implemented_pending_verification"]); });
  it("walks a reconciliation-withdrawn row back to life through the one door, and never a dismissed one", async () => { // THE LIVE ORPHAN (Mahsa, 2026-08-29): the sweep withdrew the row after its shipment landed and the flip then failed on the retired row, leaving verification null and the card in two states; the operator's press outvotes reconciliation, and their own dismissal it never touches
    Object.assign(seed(), { terminal_disposition: "withdrawn", withdrawn_reason: "evidence moved" });
    expect([await transitionProposalToImplemented(T, DONE_ID, "rec-1"), db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition]).toEqual([true, "implemented_pending_verification", null]);
    Object.assign(seed(), { terminal_disposition: "dismissed" });
    expect([await transitionProposalToImplemented(T, DONE_ID, "rec-2"), db.state.rows[0]!.terminal_disposition]).toEqual([false, "dismissed"]); });
  it("sends a change marked done with no record back to the queue carrying the one sentence that says so", async () => {
    const row = done(); expect(await reconcileImplementedWithoutShipment(T, new Set<string>())).toEqual([SENTENCE]);
    expect([row.status, row.queue_lane, row.queue_rank]).toEqual(["needs_review", null, null]); // back in the queue, and it earns its position again
    expect([storedNow(row)?.status, storedNow(row)?.limitations[0]]).toEqual(["needs_review", SENTENCE]); });
  it("retires a done row whose reading settled, keeps its stage, and says what the reading said", async () => { // A FINISHED READING RETIRES THE ROW IT MEASURED. Eight rows sat "pending verification" forever after their readings settled: counted as in-flight, holding their pages against fresh work, waiting on nothing. The verdict stays on the ledger; this closes the queue's side, with the receipt on the row.
    const row = done(); expect(await reconcileImplementedWithoutShipment(T, new Set([DONE_ID]), 50, new Map([[DONE_ID, "won"]]))).toEqual([]);
    expect([row.status, row.terminal_disposition, row.withdrawn_reason])
      .toEqual(["implemented_pending_verification", "settled", "The reading finished and the result is on Results: this change won."]); });
  it("leaves a change the ledger really is measuring untouched, never stacks the sentence, and reverts nothing on a read that failed", async () => {
    const row = done(); expect(await reconcileImplementedWithoutShipment(T, new Set([DONE_ID]))).toEqual([]);
    expect([row.status, row.queue_rank]).toEqual(["implemented_pending_verification", 3]);
    db.state.missing = true; // a read that failed is not proof of anything
    expect([await reconcileImplementedWithoutShipment(T, new Set<string>()), row.status]).toEqual([[], "implemented_pending_verification"]);
    db.state.missing = false; db.state.rows = [];
    const stale = done({ limitations: ["A change marked done on August 1 lost its record; mark it done again when you confirm it is live."] }); await reconcileImplementedWithoutShipment(T, new Set<string>());
    expect(storedNow(stale)?.limitations).toHaveLength(1); });
  /** A STAMP IS NOT A FINISHED DELIVERABLE (live, 2026-09-05). The ship door re-asks `deliverableGaps` before it will mark anything done, and nothing ever asked it again of the rows that crossed before that door existed: two of this account's 108 done rows still carry "X has a population of NUMBER as of YEAR (SOURCE)." and are being measured as changes. The same question is now put to every row already wearing the stamp. */
  it.each(["acct-a", "acct-b"])("sends a change marked done whose copy was never finished back to the queue saying what is missing, whatever the ledger holds, on %s", async (acct) => {
    const slot = { kind: "existing_edit" as const, field: "answer_block" as const, before: null, after: "Nowruz has a population of NUMBER as of YEAR (SOURCE).", where: 'Under the h1 "Nowruz"' };
    const id = `${acct}::${PAGE}::existing_edit::title`; db.state.rows = [];
    const push = (p: ChangeProposal) => { db.state.rows.push({ tenant_id: acct, id, proposal_version: 1, status: p.status, terminal_disposition: null, superseded_by: null, basis: p.basis ?? null,
      case_id: "", page_key: PAGE, action_family: "title-family", queue_lane: "rel::ready", queue_rank: 3, payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: "2026-08-12T04:50:00.000Z" }); return db.state.rows[0]!; };
    const unfinished = push(proposal({ id, tenantId: acct, status: "implemented_pending_verification", recommendedChange: slot }));
    const said = await reconcileImplementedWithoutShipment(acct, new Set([id]), 50, new Map([[id, "won"]]));
    expect(said, "a record and a settled reading do not make an unfinished deliverable a shipment").toEqual(["A change marked done on August 12 was never finished: it describes the work instead of being it. Write the exact copy, then mark it done again."]);
    expect([unfinished.status, unfinished.terminal_disposition, unfinished.queue_rank], "it is back in the queue, live, and earns its position again").toEqual(["needs_review", null, null]);
    expect(storedNow(unfinished)?.limitations[0], "carrying the one sentence that says what is missing and what to do").toContain("was never finished");
    db.state.rows = []; const finished = push(proposal({ id, tenantId: acct, status: "implemented_pending_verification", recommendedChange: { ...slot, after: "Nowruz falls on the spring equinox, which lands on March 20 or 21 each year." } }));
    expect([await reconcileImplementedWithoutShipment(acct, new Set([id])), finished.status], "and a finished change the ledger is measuring is untouched").toEqual([[], "implemented_pending_verification"]);
    await reconcileImplementedWithoutShipment(acct, new Set([id])); await reconcileImplementedWithoutShipment(acct, new Set([id]));
    expect(storedNow(finished)?.limitations, "twice over").toHaveLength(0); });});
/** STEP TWO OF THE TWO-STEP HOLD IS A COMPARE-AND-SET, NEVER A READ AND A SAVE. The confirmation used to read the row, check the version on the screen against it, and then hand the promoted copy to the ordinary save path, whose own read happens afterwards: a rewrite landing in between was overwritten by the version the operator had been looking at, and that version became ready. Here is that exact interleaving, both ways round. */
describe("the operator's yes lands on the exact version they read, or on nothing at all", () => {
  const mover = () => deep({ status: "needs_review", riskLevel: "high", diagnosisCause: "cannibalization",
    evidence: { query: "nowruz traditions", hints: ["Visitors already call this the Haft-Seen Table guide."], evidenceRefCount: 1 },
    /* THE WORDS THIS CHANGE STANDS ON ARE BANKED ON THE ROW (campaign, 2026-09-05): the promotion door grounds copy on the page and this receipt, and no longer on the diagnosis hint below, which carried "Haft-Seen Table" as if something had checked it. The hint stays exactly where it was, and now grounds nothing. */
    bundle: { ...bundle("consolidation"), risks: ["The old address stops answering."],
      receipt: { ...bundle("consolidation").receipt, items: [...bundle("consolidation").receipt.items, { key: "k2", kind: "page_extract", fact: "This page's own section is headed Nowruz Traditions and the Haft-Seen Table.", observedAt: "2026-07-25T00:00:00.000Z" }] },
      components: [{ kind: "consolidation", label: "Merge the two pages", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table", evidenceKeys: ["k1"], risk: "dangerous", redirectTo: "https://www.fixture-outdoors.example/nowruz",
      where: "This page's own address", objective: "Stop two pages from splitting one search.", mechanism: "One page answers the search once instead of two competing for it.", measurementPlan: "Clicks on the surviving page are read again after 14 days." }] } });
  const REWRITE = "A rewrite nobody has read yet";
  const rewriting = (p: ChangeProposal) => () => { const at = db.state.rows.findIndex((r) => r.id === p.id);
    db.state.rows[at] = { ...db.state.rows[at]!, proposal_version: 9, payload: JSON.parse(serializeChangeProposal({ ...p, recommendedChange: { ...p.recommendedChange, after: REWRITE } } as ChangeProposal)) as Row }; };
  const landed = (p: ChangeProposal) => { const r = db.state.rows.find((x) => x.id === p.id)!;
    return [r.status, r.proposal_version, (deserializeChangeProposal(JSON.stringify(r.payload))!.recommendedChange as { after: string }).after]; };
  it("refuses a confirmation whose row was rewritten between the read that validated it and the write that lands it", async () => {
    const held = mover();
    expect(await saveChangeProposal(held)).toBe("saved"); // THE DEFECT, kept as the reason this exists: read, check, unconditional write, and the rewrite that landed underneath is gone.
    db.state.race = rewriting(held);
    await saveChangeProposal({ ...held, status: "ready", confirmedVersion: confirmedVersion(held) }); expect(landed(held)).toEqual(["ready", 2, "Nowruz Traditions and the Haft-Seen Table"]);
    db.state.rows = []; // THE SAME INTERLEAVING through the one door a confirmation walks now: nothing is written, the rewrite stands, and the change stays behind the hold.
    expect(await saveChangeProposal(held)).toBe("saved");
    db.state.race = rewriting(held);
    const raced = await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE); expect([raced.status, ...landed(held)]).toEqual(["stale", "needs_review", 9, REWRITE]);
    const ok = await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE); // AND THE UNRACED PRESS DOES LAND, once, on the version it named: the yes is written onto the row and the row is at the next version.
    expect([ok.status, ...landed(held)]).toEqual(["stale", "needs_review", 9, REWRITE]); // the row is a rewrite now, so the version they read is not this one
    db.state.rows = [];
    expect(await saveChangeProposal(held)).toBe("saved"); const yes = await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE);
    const stored = deserializeChangeProposal(JSON.stringify(db.state.rows.find((r) => r.id === held.id)!.payload))!;
    expect([yes.status, ...landed(held), stored.confirmedVersion === confirmedVersion(held)]).toEqual(["promoted", "ready", 2, "Nowruz Traditions and the Haft-Seen Table", true]);
    const after = landed(held); // A version nobody is looking at, a row already promoted out of review, and a bar that has moved are all stale, and none of them writes anything.
    expect([(await answerReviewedProposal(T, held.id, "a version nobody is looking at", held.basis ?? null, PROMOTE)).status,
      (await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE)).status,
      (await answerReviewedProposal(T, held.id, confirmedVersion(held), "basis_moved::d9", PROMOTE)).status, ...landed(held)]).toEqual(["stale", "stale", "stale", ...after]); });});
/** APPROVAL REFUSES ON THE FACT, NEVER ON THE SENTENCE DESCRIBING IT. A row whose lever does not treat its own diagnosed cause is refused by `unsettledCause` run directly on the promoted row, even when the stored limitation is worded to clear every phrase the display classifier (HARD_LIMITATION) looks for. */
describe("a badly classified row cannot be waved through", () => {
  it("refuses promotion on the unsettled cause even though the stored limitation reads as benign", async () => {
    const held = deep({ status: "needs_review", diagnosisCause: "weak_opening",
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Nowruz", after: "Everything you need to know about Nowruz traditions this year." },
      limitations: ["Written from the account's current search data."], bundle: undefined });
    await saveChangeProposal(held);
    expect(await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE))
      .toEqual({ status: "refused", refusal: "This change works on something other than how this page opens, which is what this page's own evidence names, so it is held for review rather than handed over as ready to paste." });
    expect(current().find((r) => r.id === held.id)!.status).toBe("needs_review"); }); });
/** PROMOTION FAILS CLOSED WHEN VALIDATION CANNOT RUN: absence of provenance is a refusal at THIS door even where the producer pass legitimately skipped it. */
describe("promotion fails closed when it cannot check its own work", () => {
  it("refuses atomic copy that carries no claim and no support fact", async () => {
    const bare = proposal({ status: "needs_review", diagnosisCause: "ctr_snippet" }); await saveChangeProposal(bare);
    const withReceipt = proposal({ status: "needs_review", diagnosisCause: "ctr_snippet", id: `${T}::/other::existing_edit::meta`, pagePath: "/other", pageUrl: "https://www.fixture-outdoors.example/other", informationGain: { adds: "a", by: ["fact-1"], pageWhole: true } }); // THE STORE VALIDATES AN AUTHORIZATION, IT NEVER ISSUES ONE: stamping the identity here signed whatever receipt it was handed, so the door's own check became unconditionally true on the way past.
    await saveChangeProposal({ ...withReceipt, status: "ready" }); // THE STORE VALIDATES A READING, IT NEVER ISSUES ONE, and it will not keep `ready` on a row whose sources were never shown to support its claims: the work is saved and kept, it is simply not offered.
    expect(current().find((r) => r.id === withReceipt.id)!.status, "no reading, no ready").toBe("needs_review");
    expect(await answerReviewedProposal(T, bare.id, confirmedVersion(bare), bare.basis ?? null, PROMOTE))
      .toEqual({ status: "refused", refusal: "this copy carries no record of what it stands on, so it is held rather than promoted" }); });
  it("refuses a bundle component whose page this door does not hold", async () => {
    const untethered = deep({ status: "needs_review", bundle: { ...bundle("title"),
      components: [{ kind: "title", label: "Page title", before: "Nowruz", after: "Nowruz Traditions", evidenceKeys: ["k1"], risk: "safe", page: PAGE }] } });
    await saveChangeProposal(untethered); const res = await answerReviewedProposal(T, untethered.id, confirmedVersion(untethered), untethered.basis ?? null, PROMOTE);
    expect(res.status).toBe("refused"); expect(res.refusal).toContain("the words this change lands on are not in hand"); }); });
/** THE CANON'S OWN QUALITY STATUS GATES PROMOTION, NOT JUST ITS VERDICT: `needs_review` also covers real work still short of paste-ready (a claim with no source, a fresh number nobody confirmed), and that hold may not be waved through just because it is not the harsher `rejected`. */
describe("promotion asks the canon's own quality status, not just its verdict", () => {
  const held = (after: string) => { const b = bundle("section"); const row = deep({ status: "needs_review", diagnosisCause: "incomplete_coverage", bundle: b, recommendedChange: { kind: "existing_edit", field: "meta", before: "Nowruz", after }, // AND A BUNDLE THAT PUTS WORDS ON THE PAGE CARRIES ITS OWN CLAIM-TO-SOURCE AUTHORIZATION NOW, named by the piece it belongs to: without it the door holds the row for that, and this block would be asking the canon a question the authorization already answered.
    claims: [{ text: "Nowruz is the Persian new year.", supportedBy: ["fact-1"], of: componentIdOf(b.components[0]!, 0) }], supportFacts: [{ id: "fact-1", fact: "encyclopedia: Nowruz is the Persian new year." }] });
    return { ...row, semanticReview: { of: copyKey(row), version: REVIEW_CONTRACT, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } }; };
  it.each([["a specific fact with no cited source (missing_source)", "The official record of Nowruz traditions spans centuries."], ["a fresh count nobody confirmed yet (useful_but_needs_review)", "Nowruz customs span 150+ regional variations."]] as const)("refuses promotion on %s even though the verdict is only needs_review", async (_label, after) => { const row = held(after); await saveChangeProposal(row); expect((await answerReviewedProposal(T, row.id, confirmedVersion(row), row.basis ?? null, PROMOTE)).status).toBe("refused"); });
  it("still promotes the sound row: needs_review only because a human look is owed, and the quality itself is ready", async () => { const row = held("Nowruz Traditions"); await saveChangeProposal(row); expect((await answerReviewedProposal(T, row.id, confirmedVersion(row), row.basis ?? null, PROMOTE)).status).toBe("promoted"); }); });
/** ONE DEFINITION OF AUTHORITY, DECIDED AT THE CONSUMER THAT ADMITTED THE READING (live 07:01Z, /iran-flags/pahlavi-iran-flag). The first substantive body answer the ordinary paid walk ever drafted under the proportional bar was refused here for "no cited authoritative source" while its own claim cited a checked publisher sentence banked on the row, because the rule read the account's trusted-domain list and the proposal's source pack and never the row's own checked support. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
describe("a claim standing on a reading the bar admitted is a cited authoritative source", () => {
  const ACCOUNTS = [
    { t: "tenant-one", q: "harbour seal pupping season", page: "Harbour seals haul out on the sandbar every summer, and the sandbar count was taken in 1996.", read: "Pupping runs from June to August and the survey of this colony was made in 1998.",
      both: "Pupping runs from June to August, and the survey of this colony dates from 1998, while the sandbar count dates from 1996.", wrong: "Pupping runs from June to August, and the survey of this colony dates from 2011.", theirs: "2011",
      aside: "The neighbouring bay survey report appeared in 2011.", quiet: "The neighbouring bay survey was published as well." },
    { t: "tenant-two", q: "temporada de bordado a mano", page: "El bordado a mano se trabaja sobre tela tensada, y el taller abrio en 1996.", read: "La escuela de bordado se fundo en 1998 y sus registros empiezan ese ano.",
      both: "La escuela de bordado se fundo en 1998, y el taller abrio en 1996.", wrong: "La escuela de bordado se fundo en 2011, y sus registros empiezan ese ano.", theirs: "2011",
      aside: "El informe del taller vecino aparecio en 2011.", quiet: "El informe del taller vecino tambien se publico." },
  ] as const;
  const canon = (a: (typeof ACCOUNTS)[number], after: string, cites: string) => validateProposal(proposal({ id: `${a.t}::/p::existing_edit::missing_answer`, tenantId: a.t, changeFamily: "section", primaryQuery: a.q, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after }, claims: [{ text: after, supportedBy: [cites] }], supportFacts: [{ id: "fact-1", fact: `${a.q}: ${a.read}`, sources: [{ url: "https://reference.example/x", kind: "encyclopedia" }] }, { id: "page-copy-1", fact: a.page }] }),
    { pageBodyText: a.page, evidenceText: `${a.page} ${a.read} A rival page mentions a ${a.theirs} survey.`, now: new Date("2026-09-05T07:01:00.000Z") });
  it.each(ACCOUNTS)("takes the figure its own admitted reading carries, refuses the figure nothing on the row carries, and asks nothing of a banked passage no claim cites, on $t", (a) => {
    const both = canon(a, a.both, "fact-1"), wrong = canon(a, a.wrong, "fact-1"), uncited = canon(a, a.both, "page-copy-1");
    expect([both.qualityStatus, wrong.qualityStatus, wrong.reasons.some((r) => r.includes(`("${a.theirs}")`)), uncited.qualityStatus],
      "an admitted reading a claim names is the citation, the rule then fires for the one figure no admitted support carries and says which, and a passage banked on the row that no claim stands on authorizes nothing").toEqual(["ready", "missing_source", true, "missing_source"]); });
  /* AND THE READING THAT ANSWERS FOR A FIGURE IS THE ONE ITS OWN CLAIM CITES (reviewer, round five, reproduced on both accounts): matched against every admitted reading on the row joined together, a claim standing on a reading that never mentions the year was licensed to assert it because a SIBLING claim's reading happened to carry it, so a claim with no support of its own passed on another claim's. */
  const sibling = (a: (typeof ACCOUNTS)[number]) => validateProposal(proposal({ id: `${a.t}::/p::existing_edit::missing_answer`, tenantId: a.t, changeFamily: "section", primaryQuery: a.q, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: a.wrong }, claims: [{ text: a.wrong, supportedBy: ["fact-2"] }, { text: a.quiet, supportedBy: ["fact-1"] }],
    supportFacts: [{ id: "fact-1", fact: `${a.q}: ${a.aside}`, sources: [{ url: "https://reference.example/x", kind: "encyclopedia" }] }, { id: "fact-2", fact: `${a.q}: ${a.read}`, sources: [{ url: "https://reference.example/y", kind: "publisher" }] }] }),
    { pageBodyText: a.page, evidenceText: `${a.page} ${a.read} ${a.aside}`, now: new Date("2026-09-05T07:01:00.000Z") });
  it.each(ACCOUNTS)("refuses a figure the asserting claim's own reading does not carry, however plainly a sibling claim's reading carries it, on $t", (a) => {
    const said = sibling(a);
    expect([said.qualityStatus, said.reasons.some((r) => r.includes(`("${a.theirs}")`))],
      "the support that answers for an assertion is the support that assertion cites, so a second claim's admitted reading never licenses a year the first claim's reading never states").toEqual(["missing_source", true]); });
});
/** A SPLIT IS SETTLED BY THE PIECES, NOT BY THE FIELD THE FIRST ONE HAPPENS TO USE. A differentiation bundle is filed under its first component's field, so the two-page Iran flag bundle arrived as `title-family`, missed the ownership exception, and a FINISHED ready row was served from the research lane where nobody can act on it: the store said 3 ready and the customer queue showed 2. */
describe("a bundle that touches both competing pages treats the split", () => {
  it("is not withheld for using a title field on each page", async () => {
    const { withholdReason } = await import("@/domains/decision/authorization");
    const row = (pages: string[]) => ({ changeFamily: "title-family", causeFinding: { cause: "cannibalization" }, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "x" }, bundle: { components: pages.map((page) => ({ kind: "title", page, after: "x", evidenceKeys: [], label: "t", before: null, risk: "safe" })) } });
    expect([withholdReason(row(["/iran-flags/iran-islamic-republic-flag-history", "/iran-flags"]) as never, "cannibalization"), (withholdReason(row(["/iran-flags"]) as never, "cannibalization") ?? "").includes("does not treat it")]).toEqual([null, true]); }); }); // and one page is still one page
/** STRUCTURED DATA IS A TREATMENT, NOT BROKEN PROSE (live, 2026-09-01). Two rows drafted JSON-LD into a section field and the canon refused them four times over on rules written for sentences: raw markup, a length band for a paste, an entity check reading JSON keys, and a link removal reading the old block's own @context. The one question that decides a schema block, whether the page really carries the words it claims, was never asked. It is asked here, and the prose rules are not. */
describe("structured data answers to its own gate", () => {
  const FAQ = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What are Persian numerals?", acceptedAnswer: { "@type": "Answer", text: "Persian numerals are the symbols Iranians use to write numbers." } }] });
  const COPY = "What are Persian numerals? Persian numerals are the symbols Iranians use to write numbers. The table below gives every digit.", SOLD = "Structured data makes a result eligible for a richer display, it never guarantees one.";
  const row = (after: string, over: Partial<ChangeProposal> = {}) => proposal({ recommendedChange: { kind: "existing_edit", field: "schema", before: null, after, where: "Add this block to the page head." }, ...over });
  const judge = async (p: ChangeProposal, opts: Record<string, unknown> = {}) => (await import("@/domains/decision/validate-proposal")).validateProposal(p, { pageBodyText: COPY, ...opts });
  it("passes a block the page really carries, and refuses one it does not, a second block of a type the page has, JSON that does not parse, and a rich result Google stopped granting", async () => {
    const { convertSectionToSchema, FAQ_SCHEMA_LIMIT } = await import("@/domains/decision/validate-proposal"); const ok = await judge(row(FAQ));
    const [absent, dupe, broken, thin, sold] = await Promise.all([judge(row(FAQ.replace("write numbers.", "write numbers in every shop in Tehran."))), judge(row(FAQ), { pageSchemaTypes: ["FAQPage"] }), judge(row('{"@type":"FAQPage"')), judge(row(JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage" }))), judge(row(FAQ, { limitations: [SOLD] }))]);
    expect([ok.verdict, ok.limitations.some((l) => l.includes("does not change how Google displays the page"))], "the questions and answers are on the page, and the row owes the one true sentence about what FAQ markup buys").toEqual(["ready", true]);
    expect([absent, dupe, broken, thin, sold].map((v) => v.verdict), "an answer the page never makes, a second block of a type the page already carries, JSON that does not parse, an FAQPage with no questions in it, and a listing Google has given only to government and health sites since 2023").toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
    expect([absent.reasons.some((r) => r.startsWith("The page does not visibly carry")), dupe.reasons.some((r) => r.includes("already carries a FAQPage block")), broken.reasons.some((r) => r.includes("not valid JSON")), thin.reasons.some((r) => r.includes("no mainEntity")), sold.reasons.some((r) => r.includes("richer search listing")), [ok, absent, dupe, broken, thin, sold].every((v) => v.reasons.every((r) => !/[–—]/.test(r)))], "each refusal names its own reason, and a warning written for a crawler's log never reaches the operator wearing a dash Beacon does not write").toEqual([true, true, true, true, true, true]);
    const stored = proposal({ recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `<script type="application/ld+json">${FAQ}</script>` }, limitations: [SOLD] }), moved = convertSectionToSchema(stored)!;
    expect([(await judge(stored)).verdict, moved.recommendedChange.kind === "existing_edit" ? [moved.recommendedChange.field, moved.recommendedChange.after.startsWith("{")] : null, moved.limitations, (await judge(moved)).verdict, convertSectionToSchema(moved)], "the same block is refused as prose, converts at no cost into the typed treatment with its wrapper off and the withdrawn promise replaced, then passes, and converts exactly once").toEqual(["rejected", ["schema", true], [FAQ_SCHEMA_LIMIT], "ready", null]); }); });
