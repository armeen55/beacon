import { describe, it, expect, beforeEach, vi } from "vitest";
const db = vi.hoisted(() => {
  const state = { rows: [] as Row[], legacy: [] as Row[], shipments: [] as Array<{ tenant_id: string; id: string; proposal_id: string; proposal_version: string; implemented_at: string }>, captures: {} as Record<string, string>, captureRows: {} as Record<string, Row>, missing: false, rpcMissing: false, breakWrite: false, rpcCalls: 0, raceForeign: "", race: null as null | (() => void), raceOnSelect: null as number | null, selectCount: 0 };
  const client: Record<string, unknown> = {
    rpc(name: string, args: Record<string, unknown>) { state.rpcCalls += 1;
      const run = (): { data: string | null; error: { message: string; code?: string } | null } => {
        if (name === "transition_change_proposal_implemented") {
          const at = state.rows.findIndex((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_proposal_id);
          const held = state.rows[at], shipped = state.shipments.some((s) => s.tenant_id === args.p_tenant_id
            && s.id === args.p_shipment_id && s.proposal_id === args.p_proposal_id && s.proposal_version === args.p_shipment_version);
          state.race?.(); state.race = null;
          const current = state.rows[at];
          if (!held || !current || !shipped || current.proposal_version !== args.p_expected_version
            || current.status !== args.p_expected_status || (current.terminal_disposition ?? null) !== (args.p_expected_disposition ?? null)
            || current.terminal_disposition != null
            || JSON.stringify(current.payload) !== JSON.stringify(args.p_expected_payload)) return { data: shipped ? "blocked" : "shipment_mismatch", error: null };
          state.rows[at] = { ...current, status: "implemented_pending_verification", payload: args.p_payload,
            terminal_disposition: null, superseded_by: null, withdrawn_reason: null };
          return { data: "implemented", error: null };
        }
        if (name === "retire_change_proposal") {
          const at = state.rows.findIndex((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_id);
          const held = state.rows[at];
          if (!held || held.proposal_version !== args.p_expected_version || held.status !== args.p_expected_status
            || held.terminal_disposition != null || held.status === "implemented_pending_verification") return { data: false as unknown as string, error: null };
          state.rows[at] = { ...held, terminal_disposition: args.p_disposition, superseded_by: args.p_superseded_by, withdrawn_reason: args.p_reason };
          return { data: true as unknown as string, error: null };
        }
        if (name === "answer_change_proposal_review" || name === "answer_change_proposal_review_guarded") {
          const at = state.rows.findIndex((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_id);
          state.race?.(); state.race = null; const held = state.rows[at]; if (name.endsWith("guarded") && (args.p_expected_captures as Array<{ page_id: string; latest_capture_id: string; states: Row[] }>).some((c) => state.captures[c.page_id] !== c.latest_capture_id || c.states.some(s => s.page_id !== c.page_id || state.captureRows[String(s.id)] && JSON.stringify(state.captureRows[String(s.id)]) !== JSON.stringify(s)) || c.states.length > 0 && !c.states.some(s => s.id === c.latest_capture_id))) return { data: "page_changed", error: null };
          if (!held || held.proposal_version !== args.p_expected_version || held.status !== "needs_review"
            || held.terminal_disposition != null || JSON.stringify(held.payload) !== JSON.stringify(args.p_expected_payload)) return { data: "blocked", error: null };
          state.rows[at] = { ...held, status: args.p_status, payload: args.p_payload, proposal_version: Number(held.proposal_version) + 1,
            queue_lane: args.p_status === "ready" ? null : held.queue_lane, queue_rank: args.p_status === "ready" ? null : held.queue_rank };
          return { data: "answered", error: null };
        }
        if (name === "repair_implemented_change_proposal") {
          const at = state.rows.findIndex((r) => r.tenant_id === args.p_tenant_id && r.id === args.p_id), held = state.rows[at];
          if (!held || held.proposal_version !== args.p_expected_version || held.status !== "implemented_pending_verification"
            || held.terminal_disposition != null || JSON.stringify(held.payload) !== JSON.stringify(args.p_expected_payload)) return { data: "blocked", error: null };
          if (args.p_action === "settle") { Object.assign(held, { terminal_disposition: "settled", withdrawn_reason: args.p_reason }); return { data: "settled", error: null }; }
          Object.assign(held, { status: "needs_review", payload: args.p_payload, proposal_version: Number(held.proposal_version) + 1, queue_lane: null, queue_rank: null });
          return { data: "reopened", error: null };
        }
        if (name === "save_change_proposal_proof_cas") {
          const row = args.p_row as Row, at = state.rows.findIndex((r) => r.tenant_id === args.p_tenant_id && r.id === row.id), held = state.rows[at];
          state.race?.(); state.race = null;
          if (!held || held.proposal_version !== args.p_expected_version || held.status !== args.p_expected_status
            || held.terminal_disposition != null || JSON.stringify(held.payload) !== JSON.stringify(args.p_expected_payload)) return { data: "blocked", error: null };
          state.rows[at] = { ...held, ...row }; return { data: "saved", error: null };
        }
        if (name === "save_change_proposal_cas") {
          const row = args.p_row as Row, at = state.rows.findIndex((r) => r.id === row.id);
          if (state.breakWrite) return { data: "blocked", error: null };
          if (args.p_expect_absent) {
            if (at >= 0) return { data: "blocked", error: null };
            state.rows.push({ created_at: "2026-07-01T00:00:00.000Z", ...row });
            return { data: "saved", error: null };
          }
          const held = at >= 0 ? state.rows[at]! : null;
          if (!held || held.tenant_id !== args.p_tenant_id || held.mutation_key !== row.mutation_key
            || held.proposal_version !== args.p_expected_version || held.status !== args.p_expected_status
            || (held.terminal_disposition ?? null) !== (args.p_expected_disposition ?? null)) return { data: "blocked", error: null };
          state.rows[at] = { ...held, ...row };
          return { data: "saved", error: null };
        }
        if (name !== "supersede_change_proposal") return { data: null, error: { message: `unknown function ${name}` } };
        if (state.rpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.supersede_change_proposal" } };
        if (state.rows.some((r) => r.id === (args.p_row as Row).id && r.tenant_id !== args.p_tenant_id)) return { data: "failed", error: null };
        const expected = args.p_predecessors as Array<{ id: string; proposal_version: number; status: string }>;
        const preds = expected.map((x) => state.rows.find((r) => r.tenant_id === args.p_tenant_id && r.id === x.id));
        if (preds.some((p) => !p)) return { data: "failed", error: null };
        if (preds.some((p, i) => p!.terminal_disposition != null || !["ready", "needs_review"].includes(String(p!.status)) || p!.proposal_version !== expected[i]!.proposal_version || p!.status !== expected[i]!.status)) return { data: "blocked", error: null };
        if (state.breakWrite) return { data: "failed", error: null }; // the transaction rolls back: neither write lands
        const row = args.p_row as Row;
        const predecessorIds = new Set(expected.map((x) => x.id));
        const clash = state.rows.some((r) => r.id !== row.id && !predecessorIds.has(String(r.id)) && r.terminal_disposition == null
          && ["tenant_id", "case_id", "page_key", "action_family", "mutation_key"].every((c) => r[c] === row[c]));
        if (clash) return { data: "failed", error: null };
        if (state.raceForeign) state.rows.push({ id: row.id, tenant_id: state.raceForeign, status: "ready", created_at: "2026-07-01T00:00:00.000Z" });
        const at = state.rows.findIndex((r) => r.id === row.id);
        if (at >= 0 && state.rows[at]!.tenant_id !== args.p_tenant_id) return { data: "failed", error: null };
        for (const pred of preds) Object.assign(pred!, { terminal_disposition: "superseded", superseded_by: row.id, updated_at: row.updated_at });
        if (at >= 0) return { data: "seat_taken", error: null }; else state.rows.push({ created_at: "2026-07-01T00:00:00.000Z", ...row });
        return { data: "saved", error: null };};
      return Promise.resolve(run());
    }, };
  return { state, client }; });
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
const said = vi.hoisted(() => ({ errors: [] as string[] }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: (msg: string, detail?: unknown) => { said.errors.push(msg); if (detail) said.errors.push(JSON.stringify(detail)); } } }));
import { dismissChangeProposal, loadChangeProposal, loadChangeProposals, answerReviewedProposal, preflightReviewedProposal, saveChangeProposal, transitionProposalToImplemented, withdrawChangeProposal } from "@/domains/decision/proposal-store";
import { confirmedVersion, openHold } from "@/domains/decision/completeness"; import { REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof";
import { COPY_RULES } from "@/domains/decision/copy-sanitize"; import { nextObligation } from "@/domains/decision/obligation";
import { reconcileImplementedWithoutShipment } from "@/domains/decision/implemented-repair"; import { validateProposal } from "@/domains/decision/validate-proposal";
import { componentIdOf, sameComponentId, deserializeChangeProposal, serializeChangeProposal, type ChangeBundle, type ChangeProposal } from "@/domains/decision/contracts"; import { supabaseFake, type Row } from "../helpers/supabase-fake";
Object.assign(db.client, supabaseFake({
  rows: (t) => (t === "change_proposals" ? db.state.rows : db.state.legacy),
  error: (t) => (t === "change_proposals" && db.state.missing ? { code: "PGRST205", message: "table not found in schema cache" } : null),
  landsNothing: () => db.state.breakWrite, insertDefaults: () => ({ created_at: "2026-07-01T00:00:00.000Z" }),
  onSelect: () => { db.state.selectCount += 1; if (db.state.raceOnSelect != null && db.state.selectCount !== db.state.raceOnSelect) return; const r = db.state.race; db.state.race = null; r?.(); },
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
const deep = (over: Partial<ChangeProposal> = {}) => proposal({ id: `${T}::${PAGE}::existing_edit::title-family`, bundle: bundle("title"), diagnosisCause: "ctr_snippet", modeledOn: "the stored results page for this search", ...over });
const current = () => db.state.rows.filter((r) => r.terminal_disposition == null);
const seedLegacy = (p: ChangeProposal) => db.state.legacy.push({ tenant_id: p.tenantId, rec_id: p.id, kind: "change_proposal", content: serializeChangeProposal(p), created_at: p.createdAt });
beforeEach(() => { db.state.rows = []; db.state.legacy = []; db.state.shipments = []; db.state.captures = {}; db.state.captureRows = {}; db.state.missing = false; db.state.rpcMissing = false; db.state.breakWrite = false; db.state.rpcCalls = 0; db.state.raceForeign = ""; db.state.race = null; db.state.raceOnSelect = null; db.state.selectCount = 0; });
it("reloads the exact qualified page-copy and fact sentences bound to a reader task", async () => {
  const { assignmentOf } = await import("@/domains/decision/assignment");
  const own = "The page says the Haft-Seen table has seven symbolic items.", checked = "Haft-Seen is a Nowruz table with seven symbolic items. https://reference.example/haft-seen says the seven items are symbolic.";
  const assignment = assignmentOf({ targetUrl: `https://www.fixture-outdoors.example${PAGE}`, title: "Nowruz", h1: "Nowruz", metaDescription: null, bodyText: own, headings: ["Nowruz"], evidence: { "page-copy-7": own, "fact-1": checked }, checkedSentences: ["Haft-Seen is a Nowruz table with seven symbolic items."], trackedQuestion: "What belongs on the Haft-Seen table?", ownedPaths: [], bannedTerms: [], demand: { preserve: [], vocabulary: [] }, gap: { kind: "missing_answer", propositions: ["Explain the symbolic items and their role in Nowruz."] }, informationNeed: { question: "What belongs on the Haft-Seen table?", requiredAtomKeys: ["own-table", "sourced-role"], polarity: "supports", voice: "publisher", deliveryMode: "headed" }, answerAtoms: [{ key: "own-table", evidenceId: "page-copy-7", polarity: "supports", voice: "publisher" }, { key: "sourced-role", evidenceId: "fact-1", polarity: "supports", voice: "publisher" }] }, null, "answer_block");
  expect(assignment?.facts).toEqual([{ id: "page-copy-7", says: own }, { id: "fact-1", says: checked }]);
  expect(assignment).not.toBeNull();
  const p = proposal({ id: `${T}::${PAGE}::existing_edit::section`, status: "needs_review", researchOnly: true, changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Write the supported answer." }, assignment: assignment! });
  expect(await saveChangeProposal(p)).toBe("saved");
  const reloaded = await loadChangeProposal(T, p.id);
  expect(reloaded?.assignment?.facts).toEqual(assignment?.facts);
  expect(reloaded?.assignment?.facts?.every((fact) => fact.says.length > 0)).toBe(true);
});
it("does not create an assignment when a required atom lost its evidence text", async () => {
  const { assignmentOf } = await import("@/domains/decision/assignment");
  const packet: import("@/domains/decision/drafted-copy").SourcePacket = { targetUrl: `https://www.fixture-outdoors.example${PAGE}`, title: "Nowruz", h1: "Nowruz", metaDescription: null, bodyText: "", headings: ["Nowruz"], evidence: {}, trackedQuestion: "What is Haft-Seen?", ownedPaths: [], bannedTerms: [], demand: { preserve: [], vocabulary: [] }, gap: { kind: "missing_answer", propositions: ["Define Haft-Seen."] }, informationNeed: { question: "What is Haft-Seen?", requiredAtomKeys: ["definition"], polarity: "supports", voice: "publisher", deliveryMode: "headed" }, answerAtoms: [{ key: "definition", evidenceId: "page-copy-1", polarity: "supports", voice: "publisher" }] };
  expect(assignmentOf(packet, null, "answer_block")).toBeNull();
});
const seedShipment = (id: string, proposalId: string, version = "sv-1") => db.state.shipments.push({ tenant_id: T, id, proposal_id: proposalId, proposal_version: version, implemented_at: "2026-09-19T00:00:00.000Z" });
const PROMOTE = { kind: "promote" as const, at: "2026-08-15T00:00:00.000Z" };
it("the proof save changes only the exact source version it read", async () => { const first = proposal({ status: "needs_review" });
  expect(await saveChangeProposal(first)).toBe("saved"); const source = (await loadChangeProposal(T, first.id))!;
  expect(await saveChangeProposal({ ...source, confidence: "high" }, undefined, undefined, source)).toBe("saved");
  expect(await saveChangeProposal({ ...source, confidence: "low" }, undefined, undefined, source)).toBe("blocked"); });
describe("rows written after the lifecycle contract", () => {
  const row = (id: string, word: string): Row => ({
    tenant_id: T, id, proposal_version: 1, status: word, terminal_disposition: null, superseded_by: null,
    basis: "basis_today::d6", case_id: "", page_key: id, action_family: "title-family",
    payload: JSON.parse(JSON.stringify({ v: 1, proposal: { ...proposal({ id, pagePath: id }), status: word } })),
    updated_at: "2026-07-30T00:00:00.000Z" });
  it("22: the queue is the canonical table alone, and a pre-canonical row is history rather than current work", async () => {
    db.state.rows.push(row("/a", "ready"), row("/b", "implemented_pending_verification")); seedLegacy(proposal({ id: "/legacy-only", pagePath: "/legacy-only" }));
    const queue = await loadChangeProposals(T); expect([[...queue.keys()].sort(), queue.get("/b")!.status]).toEqual([["/a", "/b"], "implemented_pending_verification"]); expect([(await loadChangeProposal(T, "/legacy-only"))?.id, await loadChangeProposal(T, "/legacy-only", { canonicalOnly: true })]).toEqual(["/legacy-only", null]); }); });
describe("canonical proposal persistence", () => {
  it.each(["atomic", "accepted", "pending"])("banks %s publication copy without authorizing a partial deliverable and retains it over its reminted brief", async (mode) => { const { COPY_RULES } = await import("@/domains/decision/copy-sanitize"), { assignmentOf } = await import("@/domains/decision/assignment"), { reviewFinishedCopy } = await import("@/domains/decision/drafted-copy"); const units = [{ kind: "heading" as const, level: 2 as const, text: "What is Haft-Seen?" }, { kind: "paragraph" as const, text: "Haft-Seen is the Nowruz table arranged with seven symbolic items." }], target = { mode: "under_heading" as const, anchorKind: "heading" as const, anchor: "Nowruz" }, p = proposal({ status: "needs_review", researchOnly: false, changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: COPY_RULES.bodyCopy(units), units, target, where: COPY_RULES.where(target) }, claims: [{ text: units[1]!.text, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: units[1]!.text }] }); const editor = { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false, notes: "The qualified Haft-Seen answer belongs under Nowruz." }, atom = "haft-seen-definition", piece = { slot: 0, heading: null, before: null, after: units.map(u => u.kind === "paragraph" ? u.text : "## " + u.text).join("\n\n"), units, target, claims: p.claims!, supportFacts: p.supportFacts!, review: mode === "accepted" ? [{ i: 0, by: ["fact-1"], entailed: true }] : [], assignment: assignmentOf({ targetUrl: p.pageUrl!, title: "Nowruz", h1: "Nowruz", metaDescription: null, bodyText: "Nowruz begins spring.", headings: ["Nowruz"], evidence: { "fact-1": units[1]!.text }, checkedSentences: [units[1]!.text], trackedQuestion: "What is Haft-Seen?", ownedPaths: [], bannedTerms: [], demand: { preserve: [], vocabulary: [] }, gap: { kind: "missing_answer", propositions: [units[1]!.text] }, informationNeed: { question: "What is Haft-Seen?", requiredAtomKeys: [atom], polarity: "supports", voice: "publisher", deliveryMode: "headed" }, answerAtoms: [{ key: atom, evidenceId: "fact-1", polarity: "supports", voice: "publisher" }] }, null, "answer_block")!, draftNotes: ["The source describes the symbolic table, not every family's practice."] }; if (mode !== "atomic") Object.assign(p, { researchOnly: true, draftNotes: piece.draftNotes, newPageDraft: { brief: { kind: "body_meta", identity: "a".repeat(64), owed: [1] }, pieces: [{ ...piece, ...(mode === "accepted" ? { editor, reviewOf: COPY_RULES.pieceKey(piece) } : {}) }] } }); expect(await saveChangeProposal(p), said.errors.join(" ")).toBe("saved"); const held = (await loadChangeProposal(T, p.id))!; expect([held.recommendedChange, held.claims, held.supportFacts, held.semanticReview, held.status, held.obligation, held.newPageDraft, held.draftNotes]).toEqual([p.recommendedChange, p.claims, p.supportFacts, undefined, "needs_review", mode === "accepted" ? { kind: "sections", owed: 1 } : { kind: "review" }, p.newPageDraft, p.draftNotes]); const version = db.state.rows[0]!.proposal_version; expect(await saveChangeProposal(structuredClone(held))).toBe("unchanged"); expect(db.state.rows[0]!.proposal_version).toBe(version); expect(await saveChangeProposal({ ...p, researchOnly: true, newPageDraft: undefined, draftNotes: undefined, claims: undefined, supportFacts: undefined, recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Write the answer about Haft-Seen." } })).toBe("unchanged"); const kept = (await loadChangeProposal(T, p.id))!; expect([kept.recommendedChange, kept.newPageDraft, kept.draftNotes, kept.obligation, db.state.rows[0]!.proposal_version]).toEqual([held.recommendedChange, held.newPageDraft, held.draftNotes, held.obligation, version]); if (mode === "atomic") { const { nextObligation } = await import("@/domains/decision/obligation"), native = (await reviewFinishedCopy(p, { tenantId: T, now: new Date(p.createdAt), judge: async d => ({ pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: false, improvesPage: true, wouldHandToCustomer: true, notes: "This exact answer cannot be implemented at the supplied target.", resolution: "none", claims: d.claims.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) }) })).row!; expect(native.faults!.length).toBeGreaterThan(0); const refused = { ...native, copyStamp: "capture-v1", previousCopy: { after: p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after : "", retiredBecause: native.faults![0]!, at: new Date().toISOString(), attempts: 4 } }; /* settled today: a settlement older than seven days is ordinary work again (operator HARD rule, 2026-09-10) */ expect(await saveChangeProposal(refused)).toBe("saved"); const persisted = (await loadChangeProposal(T, p.id))!; expect([persisted.obligation?.kind, persisted.previousCopy, nextObligation(persisted)?.kind]).toEqual(["terminal", refused.previousCopy, "terminal"]); const relocatedTarget = { ...target, anchor: "Haft-Seen table" }, relocated = (await reviewFinishedCopy({ ...p, recommendedChange: { ...p.recommendedChange, target: relocatedTarget, where: COPY_RULES.where(relocatedTarget) } as ChangeProposal["recommendedChange"] }, { tenantId: T, now: new Date(p.createdAt), judge: async d => ({ pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "These same supported words now belong at the changed exact target.", resolution: "none", claims: d.claims.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) }) })).row!; expect(await saveChangeProposal(relocated)).toBe("saved"); const scoped = (await loadChangeProposal(T, p.id))!; expect([scoped.recommendedChange, scoped.previousCopy?.after, scoped.previousCopy?.attempts, nextObligation(scoped)], "a fresh native review at a changed target must not inherit the exhausted refusal for the old target").toEqual([relocated.recommendedChange, refused.previousCopy.after, 0, null]); const reminted = { ...p, researchOnly: true, copyStamp: "capture-v2", recommendedChange: { kind: "existing_edit" as const, field: "answer_block" as const, before: null, after: "Write the answer about Haft-Seen.", target, where: COPY_RULES.where(target) } }; expect(await saveChangeProposal(reminted)).toBe("saved"); const reopened = (await loadChangeProposal(T, p.id))!; expect([reopened.copyStamp, reopened.previousCopy?.attempts, reopened.previousCopy?.after, nextObligation(reopened)?.kind]).toEqual(["capture-v2", 0, refused.previousCopy.after, "draft"]); } });
  it("retains rewrite bank predecessor, target, preservation and gain identities through the real store", async () => { const { COPY_RULES } = await import("@/domains/decision/copy-sanitize"); const units = [{ kind: "paragraph" as const, text: "Wolves live across suitable habitats." }], target = { mode: "whole_body" as const, anchorKind: null, anchor: null }, before = "The original page describes wolf habitats.", component = { kind: "full_rewrite" as const, label: "Rebuild the habitat page", before, after: COPY_RULES.bodyCopy(units), units, target, where: COPY_RULES.where(target), evidenceKeys: ["k1"], risk: "review" as const, preserves: { keeps: [] as string[], losses: [{ what: before, why: "Original material remains unresolved; no removal is authorized." }] } }, piece = { slot: 1, heading: "Wolf habitats", before, after: component.after, units, target, claims: [{ text: component.after, supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: component.after, sources: [{ url: "https://own.com/wolf-habitats", kind: "owner" }] }], review: [{ i: 0, by: ["page-copy-1"], entailed: true }], gain: { adds: "A clear habitat explanation.", by: ["page-copy-1"], pageWhole: true, bodyHash: "original-body", targetHash: "original-section" }, preservation: [{ text: before, disposition: "kept" as const, why: "Supported material remains.", by: ["page-copy-1"] }] }, p = deep({ status: "needs_review", researchOnly: true, changeFamily: "full_rewrite", preservationNotes: component.preserves, preservation: piece.preservation, recommendedChange: { kind: "existing_edit", field: "section", before, after: component.after, units, target, where: component.where }, bundle: { ...bundle("full_rewrite"), components: [component] }, newPageDraft: { brief: { kind: "full_rewrite", identity: "a".repeat(64), headings: [piece.heading], owed: [0] }, pieces: [{ ...piece, reviewOf: COPY_RULES.pieceKey(piece) }] } }); expect(await saveChangeProposal(p)).toBe("saved"); const stored = (await loadChangeProposal(T, p.id))!; expect([stored.newPageDraft, stored.preservationNotes, stored.preservation]).toEqual([p.newPageDraft, p.preservationNotes, p.preservation]); expect([stored.newPageDraft!.pieces[0]!.editor, stored.status, stored.obligation]).toEqual([undefined, "needs_review", { kind: "review" }]); const version = db.state.rows[0]!.proposal_version; expect(await saveChangeProposal(structuredClone(stored))).toBe("unchanged"); expect(db.state.rows[0]!.proposal_version).toBe(version); const brief = { ...stored, newPageDraft: undefined, preservationNotes: undefined, preservation: undefined, recommendedChange: { ...stored.recommendedChange, after: "Write the complete habitat explanation.", units: undefined } as ChangeProposal["recommendedChange"], bundle: { ...stored.bundle!, components: [{ ...component, after: "Write the complete habitat explanation.", units: undefined, preserves: undefined }] } }; expect(await saveChangeProposal(brief)).toBe("unchanged"); const banked = (await loadChangeProposal(T, p.id))!; expect([banked.newPageDraft, banked.bundle, banked.preservationNotes, banked.preservation, banked.obligation]).toEqual([stored.newPageDraft, stored.bundle, stored.preservationNotes, stored.preservation, stored.obligation]); const changed = { ...stored, bundle: { ...stored.bundle!, components: [{ ...component, preserves: { ...component.preserves, losses: [{ what: before, why: "The unresolved passage now needs a different editorial decision." }] } }] } }; expect(copyKey(changed)).not.toBe(copyKey(stored)); expect(confirmedVersion(changed)).not.toBe(confirmedVersion(stored)); expect(await saveChangeProposal(changed)).toBe("saved"); const loaded = (await loadChangeProposal(T, p.id))!; expect([loaded.bundle!.components[0]!.preserves, loaded.newPageDraft, loaded.preservation]).toEqual([changed.bundle.components[0]!.preserves, stored.newPageDraft, stored.preservation]); expect(await saveChangeProposal(structuredClone(loaded))).toBe("unchanged"); const disposition = { ...loaded, preservation: loaded.preservation!.map(record => ({ ...record, why: "The complete retained habitat passage was checked against its source." })) }; expect(await saveChangeProposal(disposition)).toBe("saved"); const final = (await loadChangeProposal(T, p.id))!; expect([final.preservation, final.preservationNotes, final.newPageDraft]).toEqual([disposition.preservation, stored.preservationNotes, stored.newPageDraft]); expect(final.preservation!.some(record => record.disposition === "removed")).toBe(false); expect(await saveChangeProposal(structuredClone(final))).toBe("unchanged"); });
  it("retains only current component review candidates through both store merge paths and resumes the affected work only", async () => { const { COPY_RULES } = await import("@/domains/decision/copy-sanitize"), { reviewFinishedCopy } = await import("@/domains/decision/drafted-copy"), { preferFinished } = await import("@/domains/decision/completeness"), { unreviewed } = await import("@/domains/decision/proof"); const parts = [PAGE, "/wolf-habitat"].map((page, i) => { const target = { mode: "under_heading" as const, anchorKind: "heading" as const, anchor: i ? "Where do wolves live?" : "What is the Persian wolf?" }, units = [{ kind: "paragraph" as const, text: i ? "Wolves live in suitable habitats across Iran." : "The Persian wolf lives across Iran." }]; return { kind: "section" as const, page, label: target.anchor, before: null, after: COPY_RULES.bodyCopy(units), units, target, where: COPY_RULES.where(target), evidenceKeys: [i ? "fact-2" : "fact-1"], risk: "safe" as const }; }), facts = parts.map((p, i) => ({ id: i ? "fact-2" : "fact-1", fact: p.after })); const base = proposal({ id: T + "::" + PAGE + "::existing_edit::section", status: "needs_review", researchOnly: false, changeFamily: "section", primaryQuery: "wolf range", recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Wolf habitat and range across Iran." }, supportFacts: facts, claims: parts.map((p, i) => ({ text: p.after, supportedBy: [facts[i]!.id], of: componentIdOf(p, i) })), bundle: { objective: "Explain wolf range and habitat.", metric: "clicks", measurementPlan: "Compare 28 days.", scope: { queries: ["wolf range"], prompts: [] }, receipt: { items: facts.map(f => ({ key: f.id, kind: "page_extract", fact: f.fact, observedAt: null })), missing: [], freshestObservedAt: null }, components: parts, alternatives: [], risks: [], confidenceReasons: [] } }); const allowance = { left: 0 }, judge = vi.fn<NonNullable<Parameters<typeof reviewFinishedCopy>[1]["judge"]>>(async d => allowance.left-- < 1 ? null : ({ pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "The exact grounded component belongs here.", resolution: "none", claims: d.claims.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) })), opts = { tenantId: T, now: new Date("2026-09-13T00:00:00Z"), judge, attempts: allowance }, first = (allowance.left = 1, (await reviewFinishedCopy(base, opts)).row!); /* the seam spends the allowance it is handed, as the real reviewer's gateway does, so one attempt reads one part */ expect(first.semanticReview!.parts).toHaveLength(1); expect(await saveChangeProposal(first)).toBe("saved"); const saved = (await loadChangeProposal(T, base.id))!; const units = [{ kind: "paragraph" as const, text: "Suitable habitats across Iran support wolves." }], nextParts = parts.map((p, i) => i ? { ...p, units, after: COPY_RULES.bodyCopy(units) } : p), changed = { ...saved, semanticReview: undefined, bundle: { ...saved.bundle!, components: nextParts }, claims: saved.claims!.map((c, i) => ({ ...c, text: nextParts[i]!.after, of: componentIdOf(nextParts[i]!, i) })) }; expect(await saveChangeProposal(changed)).toBe("saved"); const changedSaved = (await loadChangeProposal(T, base.id))!; expect([changedSaved.bundle!.components, changedSaved.semanticReview!.parts!.length, changedSaved.semanticReview!.of !== copyKey(changedSaved), unreviewed(changedSaved) != null]).toEqual([nextParts, 1, true, true]); judge.mockClear(); const resumed = (allowance.left = 1, (await reviewFinishedCopy(changedSaved, opts)).row!); expect([judge.mock.calls.map(([d]) => d.targetUrl), resumed.bundle!.components, unreviewed(resumed)]).toEqual([[new URL(parts[1]!.page, base.pageUrl!).toString()], nextParts, null]); expect(await saveChangeProposal(resumed)).toBe("saved"); const whole = (await loadChangeProposal(T, base.id))!, sourceOnly = { ...whole, semanticReview: undefined, supportFacts: whole.supportFacts!.map((f, i) => i ? f : { ...f, fact: "Across Iran lives the Persian wolf." }) }; expect(await saveChangeProposal(sourceOnly)).toBe("saved"); const sourceSaved = (await loadChangeProposal(T, base.id))!; expect([sourceSaved.supportFacts, sourceSaved.semanticReview!.parts!.length, sourceSaved.semanticReview!.of !== copyKey(sourceSaved), unreviewed(sourceSaved) != null]).toEqual([sourceOnly.supportFacts, 1, true, true]); judge.mockClear(); const sourceResumed = (allowance.left = 1, (await reviewFinishedCopy(sourceSaved, opts)).row!); expect([judge.mock.calls.map(([d]) => d.targetUrl), unreviewed(sourceResumed)]).toEqual([[new URL(parts[0]!.page, base.pageUrl!).toString()], null]); expect(await saveChangeProposal(sourceResumed)).toBe("saved"); const standing = (await loadChangeProposal(T, base.id))!, version = db.state.rows[0]!.proposal_version; expect(standing.semanticReview!.parts).toHaveLength(2); expect(await saveChangeProposal({ ...standing, semanticReview: undefined })).toBe("unchanged"); expect(db.state.rows[0]!.proposal_version).toBe(version); const duplicate = { ...standing, semanticReview: { ...standing.semanticReview!, parts: [...standing.semanticReview!.parts!, standing.semanticReview!.parts![0]!] } }, filtered = preferFinished({ ...standing, semanticReview: undefined }, duplicate, true), foreign = preferFinished({ ...standing, semanticReview: undefined }, { ...standing, tenantId: "other-tenant" }, true); expect([filtered.semanticReview!.parts!.length, foreign.semanticReview]).toEqual([1, undefined]); const negative = { ...standing, semanticReview: { ...standing.semanticReview!, editor: { ...standing.semanticReview!.editor!, implementableNow: false } } }; expect(await saveChangeProposal(negative)).toBe("saved"); expect((await loadChangeProposal(T, base.id))!.semanticReview!.editor!.implementableNow).toBe(false); });
  it("keeps ONE current row per hypothesis: a re-draft supersedes its predecessor, points at it, and carries the next version", async () => {
    expect([await saveChangeProposal(proposal()), await saveChangeProposal(deep())]).toEqual(["saved", "saved"]); // the deep form of the same page and the same family
    expect([db.state.rows.length, current().map((r) => [r.id, r.proposal_version, r.action_family])]).toEqual([2, [[`${T}::${PAGE}::existing_edit::title-family`, 2, "title-family"]]]);
    const retired = db.state.rows.find((r) => r.id === `${T}::${PAGE}::existing_edit::title`)!; expect([retired.terminal_disposition, retired.superseded_by]).toEqual(["superseded", `${T}::${PAGE}::existing_edit::title-family`]);
    expect(await loadChangeProposal(T, retired.id as string)).toBeNull(); expect([...(await loadChangeProposals(T)).keys()]).toEqual([`${T}::${PAGE}::existing_edit::title-family`]); });
  it("never revives superseded or settled history while its successor or result still exists", async () => {
    const first = proposal(), successor = deep();
    expect([await saveChangeProposal(first), await saveChangeProposal(successor), await saveChangeProposal(first)]).toEqual(["saved", "saved", "refused"]);
    const old = db.state.rows.find((r) => r.id === first.id)!;
    expect([old.terminal_disposition, old.superseded_by]).toEqual(["superseded", successor.id]);
    Object.assign(old, { terminal_disposition: "settled", superseded_by: null });
    expect(await saveChangeProposal(first)).toBe("refused");
  });
  it("a stale producer cannot withdraw a row the operator already moved into measurement", async () => {
    const p = proposal(); await saveChangeProposal(p);
    Object.assign(db.state.rows[0]!, { status: "implemented_pending_verification",
      payload: JSON.parse(serializeChangeProposal({ ...p, status: "implemented_pending_verification" })) });
    expect([await withdrawChangeProposal(p, "stale sweep"), db.state.rows[0]!.terminal_disposition,
      db.state.rows[0]!.status]).toEqual(["blocked", null, "implemented_pending_verification"]);
  });
  it("cannot overwrite a newer same-ID draft while retiring old copy, but can record a new refused draft", async () => { const old = proposal(); expect(await saveChangeProposal(old)).toBe("saved"); const newer = proposal({ recommendedChange: { kind: "existing_edit", field: "title", before: "Persian Holidays", after: "Persian Holidays and Nowruz Customs" } }); expect(await saveChangeProposal(newer)).toBe("saved"); const before = JSON.stringify(db.state.rows[0]); expect(await withdrawChangeProposal(old, "old evidence")).toBe("blocked"); expect(JSON.stringify(db.state.rows[0])).toBe(before);
    db.state.rows = []; const fresh = proposal(); expect(await withdrawChangeProposal(fresh, "refused before publishing")).toBe("retired"); expect(db.state.rows[0]?.terminal_disposition).toBe("withdrawn"); });
  it("does not overwrite a draft inserted after retirement observed an absent seat", async () => { const stale = proposal(), newer = proposal({ recommendedChange: { kind: "existing_edit", field: "title", before: "Persian Holidays", after: "Persian Holidays and Nowruz Customs" } }); db.state.raceOnSelect = 2; db.state.race = () => { db.state.rows.push({ ...JSON.parse(JSON.stringify({ id: newer.id, tenant_id: T, proposal_version: 1, status: newer.status, terminal_disposition: null, superseded_by: null, basis: newer.basis, mutation_key: "title", payload: JSON.parse(serializeChangeProposal(newer)) })) }); }; expect(await withdrawChangeProposal(stale, "old evidence")).toBe("blocked"); expect(db.state.rows).toHaveLength(1); expect(db.state.rows[0]?.terminal_disposition).toBeNull(); expect(deserializeChangeProposal(JSON.stringify(db.state.rows[0]?.payload))?.recommendedChange).toEqual(newer.recommendedChange); });
  it("bumps one live mutation in place, keeps a retired seat permanent, and never rebinds its id", async () => {
    expect(await saveChangeProposal(proposal())).toBe("saved");
    expect(await saveChangeProposal(proposal())).toBe("unchanged"); // same material content, same timestamp, no write
    expect(await saveChangeProposal({ ...proposal(), createdAt: "2026-07-31T09:00:00.000Z" })).toBe("unchanged"); // a moved clock is not new thinking
    expect([db.state.rows.length, db.state.rows[0]!.proposal_version]).toEqual([1, 1]); expect(await saveChangeProposal(proposal({ status: "needs_review" }))).toBe("saved");
    expect(db.state.rows).toHaveLength(1); // still one row: the same id is the same hypothesis
    expect([db.state.rows[0]!.proposal_version, db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition]).toEqual([2, "needs_review", null]);
    const rebound = proposal({ bundle: bundle("section_rewrite") }); expect(await saveChangeProposal(rebound)).toBe("blocked"); expect([db.state.rows.length, db.state.rows[0]!.action_family, db.state.rows[0]!.proposal_version]).toEqual([1, "title-family", 2]);
    Object.assign(db.state.rows[0]!, { terminal_disposition: "withdrawn", withdrawn_reason: "swept: no longer emitted" }); const revised = proposal({ status: "needs_review", basis: "basis_next::d6", recommendedChange: { ...proposal().recommendedChange, after: "A materially revised title under new evidence" } as ChangeProposal["recommendedChange"] }); expect(await saveChangeProposal(revised)).toBe("saved"); expect([db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.proposal_version, db.state.rows.length, await saveChangeProposal(rebound)]).toEqual(["withdrawn", 2, 2, "blocked"]); db.state.rows = []; const brief = proposal({ id: `${T}::${PAGE}::existing_edit::missing_answer`, status: "needs_review", changeFamily: "section", primaryQuery: "persian holidays", researchOnly: true, research: { missing: "Answer the question.", next: "Write it." }, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." } }); expect(await saveChangeProposal(brief)).toBe("saved"); db.state.rows[0]!.mutation_key = `${PAGE}::body::holidays persian`; const placed = { ...brief, researchOnly: false, research: undefined, recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: "Old passage", after: "Persian holidays include Nowruz and seasonal observances.", where: "Under Holidays" } }; expect([await saveChangeProposal(placed), db.state.rows[0]!.mutation_key]).toEqual(["saved", `${PAGE}::body::holidays persian`]); db.state.rows = []; const scoped = { ...brief, mutationScope: "topic" as const }; expect(await saveChangeProposal(scoped)).toBe("saved"); expect(await saveChangeProposal({ ...placed, mutationScope: "point" })).toBe("blocked"); });
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
  it("does not resurrect unchanged declined copy even under a new evidence basis", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // the operator put it away
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused"); expect([db.state.rows[0]!.terminal_disposition, (await loadChangeProposals(T)).size]).toEqual(["dismissed", 0]);
    expect(await saveChangeProposal(proposal({ basis: "basis_tomorrow::d6" }))).toBe("refused"); expect([db.state.rows[0]!.terminal_disposition, db.state.rows[0]!.proposal_version]).toEqual(["dismissed", 1]); });
  it("reads dismissed copy past 200 rows without confusing research siblings or other history with a refusal", async () => {
    const p = proposal(); await saveChangeProposal(p); const seed = { ...db.state.rows[0]! }; db.state.rows = [];
    for (let i = 0; i < 205; i++) db.state.rows.push({ ...seed, id: `${T}::${PAGE}::existing_edit::old-${i}`, terminal_disposition: "dismissed", payload: JSON.parse(serializeChangeProposal(proposal({ bundle: bundle("title", `An unrelated finished title number ${i}`) }))) });
    expect(await saveChangeProposal(p)).toBe("saved");
    Object.assign(db.state.rows.at(-1)!, { id: `${T}::${PAGE}::existing_edit::zz-declined`, terminal_disposition: "dismissed" });
    expect(await saveChangeProposal(proposal({ basis: "moved" }))).toBe("refused");
    db.state.rows = Array.from({ length: 205 }, (_, i) => ({ ...seed, id: `history-${i}`, terminal_disposition: "superseded" }));
    expect(await saveChangeProposal(p)).toBe("refused");
    db.state.rows = [];
    const brief = proposal({ researchOnly: true, primaryQuery: "first query", bundle: undefined, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Write the answer.", where: "After first heading" } });
    expect(await saveChangeProposal(brief)).toBe("saved"); await dismissChangeProposal(T, brief.id);
    const sibling = { ...brief, id: `${T}::${PAGE}::existing_edit::sibling`, primaryQuery: "second query" } as ChangeProposal;
    expect(await saveChangeProposal(sibling)).toBe("saved"); expect(await saveChangeProposal(brief)).toBe("refused");
  });
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
    seedShipment("shp_seed", proposal().id); expect(await transitionProposalToImplemented(T, proposal().id, "shp_seed", "sv-1", confirmedVersion((await loadChangeProposal(T, proposal().id))!))).toBe(true); // done is reachable only through the transaction
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
  it("keeps the retired atomic row and gives materially new evidence a new seat", async () => {
    await saveChangeProposal(proposal());
    Object.assign(db.state.rows[0]!, { terminal_disposition: "withdrawn" });
    expect(await saveChangeProposal(proposal({ confidence: "high" }))).toBe("refused"); // same evidence, same edit: still history
    expect(await saveChangeProposal(proposal({ evidence: { query: "nowruz traditions", hints: ["the results page now shows a table"], evidenceRefCount: 4 } }))).toBe("saved");
    expect([db.state.rows[0]!.terminal_disposition, db.state.rows.length, current().length]).toEqual(["withdrawn", 2, 1]); });
  it("asks EVERY dismissal, not whichever row came back first: a redraft under a basis this hypothesis was dismissed under is refused", async () => {
    await saveChangeProposal(proposal({ basis: "basis_a" }));
    Object.assign(db.state.rows[0]!, { terminal_disposition: "dismissed" }); // put away under basis_a
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("saved"); // a new reading, so it may try again
    Object.assign(db.state.rows[1]!, { terminal_disposition: "dismissed" }); // put away under basis_b too
    expect(await saveChangeProposal(deep({ basis: "basis_b" }))).toBe("refused"); expect(await saveChangeProposal(deep({ basis: "basis_c" }))).toBe("refused"); });
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
  it("saves publication structure, binds approvals to it, and rejects contradictory saved text", async () => {
    const b = bundle("anchor_text");
    b.components[0] = { ...b.components[0]!, anchorAfter: "Read the Haft-Seen guide", redirectTo: "https://own.com/haft-seen" };
    const units = [{ kind: "heading" as const, level: 2, text: "Setting the table" }], after = "## Setting the table", target = { mode: "opening" as const, anchorKind: null, anchor: null }, where = "At the start of the main content, immediately after the page headline and before its existing opening.";
    b.components.push({ kind: "section", label: "Setting the table", before: null, after, units, target, where, evidenceKeys: ["k1"], risk: "safe" });
    const p = deep({ bundle: b, recommendedChange: { kind: "existing_edit", field: "section", before: null, after, units, target, where } });
    expect(await saveChangeProposal(p)).toBe("saved"); const back = await loadChangeProposal(T, p.id);
    expect([back?.recommendedChange, back?.bundle?.components]).toEqual([p.recommendedChange, b.components]);
    const changed = structuredClone(p); changed.bundle!.components[1]!.units = [{ kind: "paragraph", text: after }];
    expect(copyKey(changed)).not.toBe(copyKey(p)); expect(componentIdOf(changed.bundle!.components[1]!, 1)).not.toBe(componentIdOf(b.components[1]!, 1)); const version = db.state.rows[0]!.proposal_version; expect(await saveChangeProposal(changed)).toBe("saved"); expect(db.state.rows[0]!.proposal_version).toBe(Number(version) + 1);
    expect((await loadChangeProposal(T, p.id))?.bundle?.components[1]!.units).toEqual(changed.bundle!.components[1]!.units); const changedVersion = db.state.rows[0]!.proposal_version; expect(await saveChangeProposal(structuredClone(changed))).toBe("unchanged"); expect(db.state.rows[0]!.proposal_version).toBe(changedVersion);
    const moved = structuredClone(p); moved.bundle!.components[1]!.target = { mode: "under_heading", anchorKind: "heading", anchor: "Elsewhere" }; expect(copyKey(moved)).not.toBe(copyKey(p)); expect(sameComponentId("1:section", "1:section", [b.components[1]!, moved.bundle!.components[1]!])).toBe(false); expect(deserializeChangeProposal(serializeChangeProposal(moved))).toBeNull(); changed.bundle!.components[1]!.after = "Different text"; expect(deserializeChangeProposal(serializeChangeProposal(changed))).toBeNull(); }); });
describe("done is only ever reached with a record behind it", () => {
  const DONE_ID = `${T}::${PAGE}::existing_edit::title`, SENTENCE = "A change marked done on August 12 lost its record; mark it done again when you confirm it is live.";
  const seed = (over: Partial<ChangeProposal> = {}) => { const p = proposal(over);
    db.state.rows.push({ tenant_id: T, id: DONE_ID, proposal_version: 1, status: p.status, terminal_disposition: null, superseded_by: null, basis: p.basis ?? null,
      case_id: "", page_key: PAGE, action_family: "title-family", queue_lane: "rel::ready", queue_rank: 3,
      payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: "2026-08-12T04:50:00.000Z" });
    return db.state.rows[0]!; };
  const done = (over: Partial<ChangeProposal> = {}) => seed({ status: "implemented_pending_verification", ...over });
  const storedNow = (row: Record<string, unknown>) => deserializeChangeProposal(JSON.stringify(row.payload));
  const version = () => confirmedVersion(storedNow(db.state.rows[0]!)!);
  it("refuses the flip with no record named, and lands it with one", async () => {
    const row = seed();
    expect([await transitionProposalToImplemented(T, DONE_ID, "  ", "  ", version()), row.status]).toEqual([false, "ready"]); // nothing moved, so the change is still theirs to do
    seedShipment("rec-1", DONE_ID); expect([await transitionProposalToImplemented(T, DONE_ID, "rec-1", "sv-1", version()), db.state.rows[0]!.status]).toEqual([true, "implemented_pending_verification"]); });
  it("refuses a real shipment belonging to another proposal or applied-copy version", async () => {
    seed(); seedShipment("rec-other", `${DONE_ID}-other`, "sv-other");
    expect([await transitionProposalToImplemented(T, DONE_ID, "rec-other", "sv-other", version()), db.state.rows[0]!.status]).toEqual([false, "ready"]);
    db.state.shipments[0]!.proposal_id = DONE_ID;
    expect([await transitionProposalToImplemented(T, DONE_ID, "rec-other", "sv-wrong", version()), db.state.rows[0]!.status]).toEqual([false, "ready"]); });
  it("never clears a terminal withdrawal or dismissal, even for a matching shipment", async () => {
    Object.assign(seed(), { terminal_disposition: "withdrawn", withdrawn_reason: "evidence moved" });
    seedShipment("rec-1", DONE_ID); expect([await transitionProposalToImplemented(T, DONE_ID, "rec-1", "sv-1", version()), db.state.rows[0]!.status, db.state.rows[0]!.terminal_disposition]).toEqual([false, "ready", "withdrawn"]);
    Object.assign(seed(), { terminal_disposition: "dismissed" });
    seedShipment("rec-2", DONE_ID); expect([await transitionProposalToImplemented(T, DONE_ID, "rec-2", "sv-1", version()), db.state.rows[0]!.terminal_disposition]).toEqual([false, "dismissed"]); });
  it("does not overwrite a newer proposal version that lands after the operator read the card", async () => {
    const before = seed(), expected = version();
    db.state.race = () => { const at = db.state.rows.indexOf(before); db.state.rows[at] = { ...before, proposal_version: 2,
      status: "needs_review", payload: JSON.parse(serializeChangeProposal({ ...proposal(), status: "needs_review",
        recommendedChange: { ...proposal().recommendedChange, after: "A newer rewrite" } } as ChangeProposal)) }; };
    seedShipment("rec-1", DONE_ID); expect(await transitionProposalToImplemented(T, DONE_ID, "rec-1", "sv-1", expected)).toBe(false);
    expect([db.state.rows[0]!.proposal_version, db.state.rows[0]!.status,
      (deserializeChangeProposal(JSON.stringify(db.state.rows[0]!.payload))!.recommendedChange as { after: string }).after])
      .toEqual([2, "needs_review", "A newer rewrite"]);
  });
  it("refuses a redraft saved after the old Shipment but before the transition reads the proposal", async () => { const old = seed(), expected = version(); seedShipment("rec-1", DONE_ID);
    db.state.rows[0] = { ...old, proposal_version: 2, payload: JSON.parse(serializeChangeProposal(proposal({ recommendedChange: { ...proposal().recommendedChange, after: "A newer saved title" } } as ChangeProposal))) }; expect([await transitionProposalToImplemented(T, DONE_ID, "rec-1", "sv-1", expected), db.state.rows[0]!.status, db.state.shipments.length]).toEqual([false, "ready", 1]); });
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
describe("the operator's yes lands on the exact version they read, or on nothing at all", () => {
  const mover = () => deep({ status: "needs_review", riskLevel: "high", diagnosisCause: "cannibalization",
    evidence: { query: "nowruz traditions", hints: ["Visitors already call this the Haft-Seen Table guide."], evidenceRefCount: 1 },
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
    expect(await saveChangeProposal(held)).toBe("saved");
    db.state.race = rewriting(held);
    expect(await saveChangeProposal({ ...held, status: "ready", confirmedVersion: confirmedVersion(held) })).toBe("blocked");
    expect(landed(held)).toEqual(["needs_review", 9, REWRITE]); // ordinary producer saves now use the same compare-and-set discipline
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
describe("a badly classified row cannot be waved through", () => {
  it("refuses promotion on a defect the stored limitation says nothing about, and no longer on a lever that misses the diagnosed cause", async () => {
    const held = deep({ status: "needs_review", diagnosisCause: "weak_opening",
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Nowruz", after: "Everything you need to know about Nowruz traditions this year." },
      limitations: ["Written from the account's current search data."], bundle: undefined });
    await saveChangeProposal(held);
    expect(await answerReviewedProposal(T, held.id, confirmedVersion(held), held.basis ?? null, PROMOTE))
      .toEqual({ status: "refused", refusal: "this copy carries no record of what it stands on, so it is held rather than promoted" });
    expect([openHold(held).defects.some((d) => d.includes("works on something other than")), openHold(held).advisories.map((a) => a.kind)], "REPLACES the unsettled-cause refusal: the lever mismatch is a caveat the operator judges").toEqual([false, ["role_uncertain"]]);
    expect(current().find((r) => r.id === held.id)!.status).toBe("needs_review"); }); });
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
describe("promotion asks the canon's own quality status, not just its verdict", () => {
  const held = (after: string) => { const copy = "Nowruz traditions mark the Persian new year at the spring equinox, with families arranging seven symbolic items on the Haft-Seen table.", b = bundle("section", copy); b.components[0] = { ...b.components[0]!, before: null }; const row = deep({ status: "needs_review", diagnosisCause: "incomplete_coverage", bundle: b, recommendedChange: { kind: "existing_edit", field: "meta", before: "Nowruz", after }, claims: [{ text: copy, supportedBy: ["fact-1"], of: componentIdOf(b.components[0]!, 0) }], supportFacts: [{ id: "fact-1", fact: copy }] });
    return { ...row, semanticReview: { editor: { pageFit: true, resolvesDiagnosis: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "Exact grounded task." }, of: copyKey(row), version: REVIEW_CONTRACT, claims: [{ i: 0, by: ["fact-1"], entailed: true }] } }; };
  it.each([["a specific fact with no cited source (missing_source)", "The official record of Nowruz traditions spans centuries."], ["a fresh count nobody confirmed yet (useful_but_needs_review)", "Nowruz customs span 150+ regional variations."]] as const)("banks a refused atomic review on %s so it is corrected instead of purchased again", async (_label, after) => { const reviewed = held(after), stored = { ...reviewed, semanticReview: undefined, faults: [COPY_RULES.reviewHolds.contract], limitations: [COPY_RULES.reviewHolds.contract], obligation: { kind: "review" as const } }; await saveChangeProposal(stored); const result = await answerReviewedProposal(T, reviewed.id, confirmedVersion(stored), reviewed.basis ?? null, PROMOTE, reviewed), banked = await loadChangeProposal(T, reviewed.id); expect([result.status, banked?.semanticReview?.version, banked?.obligation?.kind, nextObligation(banked!)?.kind]).toEqual(["refused", REVIEW_CONTRACT, "redraft", "redraft"]); });
  it("never treats any bundle as an atomic whole-page rereview", async () => { const reader = await import("@/domains/evidence/pages/owned-context"), { canonicalUrlKey } = await import("@/domains/evidence/snapshot"), p = proposal({ status: "needs_review", bundle: bundle("schema"), informationGain: { adds: "A technical update.", by: ["k1"], pageWhole: true, bodyHash: "old" }, faults: [COPY_RULES.pageState.whole], limitations: [COPY_RULES.pageState.whole] }), loaded = vi.spyOn(reader, "loadOwnedPageBodies").mockImplementation(async (_tenant, urls) => new Map(urls.map(url => [canonicalUrlKey(url), { url, pageId: "page-1", latestCaptureId: "capture-1", title: "Nowruz", h1: "Nowruz", metaDescription: null, headings: [], passages: ["Nowruz traditions begin in spring."], vocabulary: "Nowruz traditions begin in spring.", completeness: "complete", version: "current", contentHash: "current", fetchedAt: PROMOTE.at }])) as never); try { const out = await preflightReviewedProposal(T, p, p.basis ?? null, new Date(PROMOTE.at)); expect(out.reviewRefresh).toBe(false); } finally { loaded.mockRestore(); } });
  it("refuses a paraphrased section only when one complete current page unit answers its diagnosed proposition", async () => { const reader = await import("@/domains/evidence/pages/owned-context"), { canonicalUrlKey } = await import("@/domains/evidence/snapshot"), { EDITOR_SHARED } = await import("@/domains/decision/drafted-copy"), page = "Shabe Yalda, also known as Yalda Night, is an ancient winter-solstice celebration observed by Iranian families.", candidate = proposal({ status: "needs_review", id: `${T}::/shabe-yalda::existing_edit::missing_answer`, pagePath: "/shabe-yalda", pageUrl: "https://fixture.example/shabe-yalda", primaryQuery: "shab e yalda", changeFamily: "section", researchOnly: false, diagnosisCause: "incomplete_coverage", causeFinding: { cause: "incomplete_coverage", action: "opening_answer", evidenceKeys: ["gsc"], competingExplanations: [], notConsidered: [], explanation: "The page was believed not to answer the search.", falsifier: "If the page answers it, no section is owed." } as never, recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "Yalda Night is a longstanding Iranian celebration of the winter solstice, traditionally spent with family.", where: "After the opening paragraph" }, assignment: { page: "https://fixture.example/shabe-yalda", standard: "missing_answer", treatment: "section", gapKind: "missing_answer", propositions: ["shab e yalda (103 searches in 90 days)"], diagnosedGap: "shab e yalda", mustLeadWith: "what Shabe Yalda is", opening: "open with the answer", format: "a headed answer", intent: ["shab e yalda"], supportingFacts: [], pageContext: [page], forbidden: [], rivals: [], briefing: [], mayReuse: "the page's own definition", mustPreserve: "the existing page", mustNotRepeat: "the existing definition", placement: "additive", completionTest: "a reader knows what Shabe Yalda is" }, claims: [{ text: "Yalda Night is an Iranian winter-solstice celebration.", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: page }], informationGain: { adds: "A direct definition.", by: ["page-copy-1"], pageWhole: true, bodyHash: "current" }, operatorSteps: ["Paste the section after the opening paragraph."], faults: [COPY_RULES.reviewHolds.acceptance], limitations: [COPY_RULES.reviewHolds.acceptance], obligation: { kind: "review" } }), state = { complete: true }, loaded = vi.spyOn(reader, "loadOwnedPageBodies").mockImplementation(async (_tenant, urls) => new Map(urls.map(url => [canonicalUrlKey(url), { url, pageId: "page-1", captureId: "capture-1", latestCaptureId: "capture-1", title: state.complete ? "Shabe Yalda" : "Shab", h1: state.complete ? "Shabe Yalda" : "Festival", metaDescription: null, headings: [state.complete ? "Yalda Night traditions" : "e yalda"], passages: [state.complete ? page : "Families gather in winter."], vocabulary: page, completeness: "complete", version: "current", contentHash: "current", fetchedAt: PROMOTE.at }])) as never); try { expect((await preflightReviewedProposal(T, candidate, candidate.basis ?? null, new Date(PROMOTE.at))).reason).toBe(EDITOR_SHARED.NO_CHANGE_SAYS); state.complete = false; expect((await preflightReviewedProposal(T, candidate, candidate.basis ?? null, new Date(PROMOTE.at))).reason).not.toBe(EDITOR_SHARED.NO_CHANGE_SAYS); } finally { loaded.mockRestore(); } });
  it("keeps canonical URL aliases in separate guarded capture identities while refusing unsupported claims", async () => { const reader = await import("@/domains/evidence/pages/owned-context"), { canonicalUrlKey } = await import("@/domains/evidence/snapshot"), { reviewFinishedCopy } = await import("@/domains/decision/drafted-copy"), page = "Iran's national animal is the Asiatic cheetah. The Asiatic cheetah lives in Iran's desert habitats.", live = { page, complete: true, capture: "capture-1" }, candidate = proposal({ status: "needs_review", pagePath: "/iran-animals/asiatic-cheetah", pageUrl: "https://fixture.example/iran-animals/asiatic-cheetah", primaryQuery: "iran national animal", recommendedChange: { kind: "existing_edit", field: "title", before: "Meet the Asiatic Cheetah | Iran Animals", after: "Asiatic Cheetah: Iran's National Animal" }, claims: [{ text: page, supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: page }] }), clean = { ...candidate, primaryQuery: "asiatic cheetah habitat", recommendedChange: { ...candidate.recommendedChange, after: "Asiatic Cheetah Habitat in Iran" }, informationGain: { adds: "Names the habitat focus.", by: ["page-copy-1"], pageWhole: true, bodyHash: "stale-page" }, faults: [COPY_RULES.reviewHolds.acceptance, COPY_RULES.pageState.whole], limitations: [COPY_RULES.reviewHolds.acceptance, COPY_RULES.pageState.whole] }, loaded = vi.spyOn(reader, "loadOwnedPageBodies").mockImplementation(async (_tenant, urls) => new Map(urls.map((url) => [canonicalUrlKey(url), { url, pageId: "page-1", captureId: live.capture, latestCaptureId: live.capture, captureStates: [{ page_id: "page-1", id: "capture-0", fetched_at: PROMOTE.at, body_text: "Earlier current-page capture" }, { page_id: "sm-172", id: "alias-1", fetched_at: "2026-06-11T00:00:00.000Z", body_text: "Historical alias content" }, { page_id: "page-1", id: live.capture, fetched_at: PROMOTE.at, body_text: live.page }], title: "Meet the Asiatic Cheetah | Iran Animals", h1: "Asiatic Cheetah", metaDescription: null, headings: [], passages: [live.page], vocabulary: live.page, completeness: live.complete ? "complete" : "partial", version: "current", contentHash: "current-source", fetchedAt: PROMOTE.at }])) as never); try { db.state.captures["page-1"] = live.capture; db.state.captures["sm-172"] = "alias-1"; expect(await saveChangeProposal(clean)).toBe("saved"); const full = await preflightReviewedProposal(T, clean, clean.basis ?? null, new Date(PROMOTE.at)); expect(full.captures.map(c => [c.page_id, c.latest_capture_id, c.states.map(s => s.id)])).toEqual([["page-1", "capture-1", ["capture-0", "capture-1"]], ["sm-172", "alias-1", ["alias-1"]]]); db.state.captureRows = Object.fromEntries(full.captures.flatMap(c => c.states.map(s => [String(s.id), structuredClone(s)]))); live.complete = false; const partial = await preflightReviewedProposal(T, clean, clean.basis ?? null, new Date(PROMOTE.at)); live.complete = true; const reviewed = (await reviewFinishedCopy(clean, { tenantId: T, now: new Date(PROMOTE.at), judge: async d => ({ pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false, notes: "The title accurately exposes the page's habitat focus.", resolution: "none", claims: d.claims.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) }) })).row!; live.page += " A new current-page sentence landed after review."; const raced = await answerReviewedProposal(T, clean.id, confirmedVersion(clean), clean.basis ?? null, PROMOTE, reviewed), held = await loadChangeProposal(T, clean.id); live.page = page; db.state.captures["sm-172"] = "alias-2"; const aliasRaced = await answerReviewedProposal(T, clean.id, confirmedVersion(clean), clean.basis ?? null, PROMOTE, reviewed); expect([aliasRaced.status, db.state.rows[0]!.status, db.state.rows[0]!.proposal_version]).toEqual(["refused", "needs_review", 1]); db.state.captures["sm-172"] = "alias-1"; db.state.captureRows["alias-1"]!.body_text = "Content changed without a new capture ID"; const stateRaced = await answerReviewedProposal(T, clean.id, confirmedVersion(clean), clean.basis ?? null, PROMOTE, reviewed); expect([stateRaced.status, db.state.rows[0]!.proposal_version]).toEqual(["refused", 1]); db.state.captureRows["alias-1"]!.body_text = "Historical alias content"; db.state.race = () => { db.state.captures["page-1"] = "capture-2"; }; const dbRaced = await answerReviewedProposal(T, clean.id, confirmedVersion(clean), clean.basis ?? null, PROMOTE, reviewed), afterDbRace = structuredClone(db.state.rows[0]); live.capture = "capture-2"; db.state.captureRows["capture-2"] = { ...db.state.captureRows["capture-1"], id: live.capture }; const promoted = await answerReviewedProposal(T, clean.id, confirmedVersion(clean), clean.basis ?? null, PROMOTE, reviewed), stored = await loadChangeProposal(T, clean.id); expect([(await preflightReviewedProposal(T, candidate, candidate.basis ?? null, new Date(PROMOTE.at))).reason, full.reason, full.reviewRefresh, partial.reason, reviewed.informationGain?.bodyHash === "stale-page", raced.status, held?.semanticReview, dbRaced.status, afterDbRace.proposal_version, promoted.status, stored?.status, stored?.informationGain?.bodyHash === "stale-page", stored?.faults ?? []]).toEqual(["This change states a fact with no source behind it. It is held until a source is added.", null, true, COPY_RULES.pageState.capture, false, "refused", undefined, "refused", 1, "promoted", "ready", false, []]); } finally { loaded.mockRestore(); } });
  it("still promotes the sound row and clears only the review debt its current acceptance answered", async () => { const initial = held("Nowruz Traditions"), peerUrl = new URL("/secondary-traditions", initial.pageUrl!).href, peer = { ...initial.bundle!.components[0]!, page: peerUrl, after: "Nowruz traditions include a Haft-Seen table whose seven symbolic items have Persian names beginning with the letter seen, arranged for the spring equinox celebration." }, base = { ...initial, bundle: { ...initial.bundle!, components: [...initial.bundle!.components, peer] }, claims: [...initial.claims!, { text: peer.after, supportedBy: ["fact-2"], of: componentIdOf(peer, 1) }], supportFacts: [...initial.supportFacts!, { id: "fact-2", fact: peer.after }] }, row = { ...base, faults: [COPY_RULES.reviewHolds.contract], limitations: [COPY_RULES.reviewHolds.contract], semanticReview: { ...initial.semanticReview, of: copyKey(base), version: REVIEW_CONTRACT, claims: base.claims.map((c, i) => ({ i, by: [...c.supportedBy], entailed: true })) } }, availability = { peer: false }, reader = await import("@/domains/evidence/pages/owned-context"), { canonicalUrlKey } = await import("@/domains/evidence/snapshot"), loaded = vi.spyOn(reader, "loadOwnedPageBodies").mockImplementation(async (tenant, urls) => { expect(tenant).toBe(T); return new Map(urls.filter(url => availability.peer || url !== peerUrl).map(url => [canonicalUrlKey(url), { url, title: "Nowruz", h1: "Nowruz", metaDescription: "Nowruz", headings: ["Traditions"], passages: ["Nowruz begins spring."], vocabulary: "Nowruz begins spring.", completeness: "complete", version: "current", contentHash: "current-source", fetchedAt: PROMOTE.at }])) as never; }); try { await saveChangeProposal(row); const priorVersion = db.state.rows.find(r => r.id === row.id)!.proposal_version, missing = await answerReviewedProposal(T, row.id, confirmedVersion(row), row.basis ?? null, PROMOTE); expect([missing.status, missing.refusal?.startsWith(peerUrl), db.state.rows.find(r => r.id === row.id)!.status, db.state.rows.find(r => r.id === row.id)!.proposal_version]).toEqual(["refused", true, "needs_review", priorVersion]); availability.peer = true; const result = await answerReviewedProposal(T, row.id, confirmedVersion(row), row.basis ?? null, PROMOTE), stored = deserializeChangeProposal(JSON.stringify(db.state.rows.find((r) => r.id === row.id)!.payload))!; expect([result, stored.faults, stored.limitations, loaded.mock.calls.map(([, urls]) => urls)]).toEqual([{ status: "promoted" }, [], [], [[row.pageUrl, peerUrl], [row.pageUrl, peerUrl]]]); } finally { loaded.mockRestore(); } }); });
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
  const sibling = (a: (typeof ACCOUNTS)[number]) => validateProposal(proposal({ id: `${a.t}::/p::existing_edit::missing_answer`, tenantId: a.t, changeFamily: "section", primaryQuery: a.q, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: a.wrong }, claims: [{ text: a.wrong, supportedBy: ["fact-2"] }, { text: a.quiet, supportedBy: ["fact-1"] }],
    supportFacts: [{ id: "fact-1", fact: `${a.q}: ${a.aside}`, sources: [{ url: "https://reference.example/x", kind: "encyclopedia" }] }, { id: "fact-2", fact: `${a.q}: ${a.read}`, sources: [{ url: "https://reference.example/y", kind: "publisher" }] }] }),
    { pageBodyText: a.page, evidenceText: `${a.page} ${a.read} ${a.aside}`, now: new Date("2026-09-05T07:01:00.000Z") });
  it.each(ACCOUNTS)("refuses a figure the asserting claim's own reading does not carry, however plainly a sibling claim's reading carries it, on $t", (a) => {
    const said = sibling(a);
    expect([said.qualityStatus, said.reasons.some((r) => r.includes(`("${a.theirs}")`))],
      "the support that answers for an assertion is the support that assertion cites, so a second claim's admitted reading never licenses a year the first claim's reading never states").toEqual(["missing_source", true]); });
});
describe("a bundle that touches both competing pages treats the split", () => {
  it("is not withheld for using a title field on each page", async () => {
    const { withholdReason } = await import("@/domains/decision/authorization");
    const row = (pages: string[]) => ({ changeFamily: "title-family", causeFinding: { cause: "cannibalization" }, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "x" }, bundle: { components: pages.map((page) => ({ kind: "title", page, after: "x", evidenceKeys: [], label: "t", before: null, risk: "safe" })) } });
    expect([withholdReason(row(["/iran-flags/iran-islamic-republic-flag-history", "/iran-flags"]) as never, "cannibalization"), (withholdReason(row(["/iran-flags"]) as never, "cannibalization") ?? "").includes("does not treat it")]).toEqual([null, true]); }); }); // and one page is still one page
describe("structured data answers to its own gate", () => {
  it("keeps question-answer association through linked identity and leaves uncertain capture as evidence debt", async () => {
    const { SCHEMA } = await import("@/domains/evidence/pages/schema-validator"), { nextObligation } = await import("@/domains/decision/obligation");
    const markup = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "FAQPage", "@id": "#faq", mainEntity: { "@id": "#q" }, identifier: "retain" }, { "@type": "Question", "@id": "#q", name: "When do seals rest?", acceptedAnswer: { "@id": "#a" } }, { "@type": "Answer", "@id": "#a", text: "Seals rest at low tide.", identifier: "retain-answer" }, { "@type": "WebPage", "@id": "#page", name: "Seals", identifier: "retain-page" }] });
    const capture = { url: proposal().pageUrl!, version: "current" as const, contentHash: "h", fetchedAt: "2026-09-13T00:00:00Z", completeness: "partial" as const, faqs: [{ question: "When do seals rest?", answer: "Seals rest at high tide.", source: "html_details" as const, answerComplete: true }, { question: "When do seals forage?", answer: "Seals rest at low tide.", source: "html_section" as const, answerComplete: true }] };
    const p = proposal({ recommendedChange: { kind: "existing_edit", field: "schema", before: null, after: markup } });
    const judge = (pageCapture: unknown, after = markup) => validateProposal({ ...p, recommendedChange: { ...p.recommendedChange, after } as ChangeProposal["recommendedChange"] }, { now: new Date("2026-09-13T00:00:00Z"), pageBodyText: capture.faqs.map((pair) => `${pair.question} ${pair.answer}`).join(" "), pageCapture } as never);
    const wrong = judge(capture), repaired = wrong.schemaReplacement!, graph = SCHEMA.read(repaired);
    expect([wrong.verdict, SCHEMA.pairs(graph), judge(capture, repaired).verdict]).toEqual(["rejected", [{ question: "When do seals rest?", answer: "Seals rest at high tide." }], "ready"]);
    expect(graph.nodes.map((node) => [node["@id"], node.identifier])).toEqual([["#faq", "retain"], ["#q", undefined], ["#a", "retain-answer"], ["#page", "retain-page"]]);
    const mixed = JSON.parse(markup); mixed["@graph"][0].mainEntity = [{ "@id": "#q" }, { "@type": "Question", name: "Missing question?", acceptedAnswer: { "@type": "Answer", text: "Unheld answer." } }];
    const incomplete = judge(capture, JSON.stringify(mixed));
    expect([incomplete.verdict, incomplete.need?.query, incomplete.schemaReplacement]).toEqual(["rejected", "Missing question?", undefined]);
    for (const held of [null, { ...capture, version: "stale_known_good" }, { ...capture, fetchedAt: "2026-08-01T00:00:00Z" }, { ...capture, contentHash: null }, { ...capture, url: "https://other.example/" }, { ...capture, faqs: capture.faqs.map((pair) => ({ ...pair, answerComplete: false })) }, { ...capture, faqs: capture.faqs.map((pair) => ({ ...pair, source: "jsonld" })) }]) {
      const waiting = judge(held), owed = { ...p, status: "needs_review" as const, obligation: { kind: "evidence" as const, need: waiting.need! } };
      expect([waiting.verdict, waiting.schemaReplacement, nextObligation(owed)]).toEqual(["needs_review", undefined, owed.obligation]);
    }
    expect(SCHEMA.rewriteFaq(markup, [...capture.faqs, { ...capture.faqs[0]!, answer: "An ambiguous second answer." }])).toBeNull();
  });
  const FAQ = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What are Persian numerals?", acceptedAnswer: { "@type": "Answer", text: "Persian numerals are the symbols Iranians use to write numbers." } }] });
  const COPY = "What are Persian numerals? Persian numerals are the symbols Iranians use to write numbers. The table below gives every digit.", SOLD = "Structured data makes a result eligible for a richer display, it never guarantees one.";
  const row = (after: string, over: Partial<ChangeProposal> = {}) => proposal({ recommendedChange: { kind: "existing_edit", field: "schema", before: null, after, where: "Add this block to the page head." }, ...over });
  const judge = async (p: ChangeProposal, opts: Record<string, unknown> = {}) => (await import("@/domains/decision/validate-proposal")).validateProposal(p, { now: new Date("2026-09-13T12:00:00Z"), pageBodyText: COPY, pageCapture: { url: p.pageUrl!, version: "current", contentHash: "h", fetchedAt: "2026-09-13T00:00:00Z", faqs: [{ question: "What are Persian numerals?", answer: "Persian numerals are the symbols Iranians use to write numbers.", source: "html_section", answerComplete: true }] }, ...opts });
  it("repairs the pasted FAQ action metadata without changing its answers or buying a draft", async () => {
    const { SCHEMA } = await import("@/domains/evidence/pages/schema-validator"), { convertSectionToSchema } = await import("@/domains/decision/validate-proposal");
    const after = JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What are Persian numerals?","acceptedAnswer":{"@type":"Answer","text":"Persian numerals are the symbols Iranians use to write numbers in everyday life. They look slightly different from the English digits 0-9 but work the same way. For example, Persian ۱ equals 1 in English, and ۲ equals 2. These Persian numerals are used in books, signs, money, and all formal writing in Iran."}},{"@type":"Question","name":"What is the difference between Persian and Arabic numbers?","acceptedAnswer":{"@type":"Answer","text":"Persian and Eastern Arabic numerals are both derived from the Hindu-Arabic system, but the Persian set used in Iran has different symbols for digits four, five and six (۴, ۵, ۶) compared to Eastern Arabic (٤, ٥, ٦). Even though Persian script is right-to-left, numerals themselves are written left-to-right."}}]});
    const pairs = SCHEMA.pairs(SCHEMA.read(after)), original = row(after, { whyItMatters: "Marking them up is how those answers become eligible to be shown directly and quoted as a source.", operatorSteps: ["Paste the copy below onto the page as a new answer paragraph."], faults: ["the evaluator's exact objection: diagnosis unresolved"] });
    const pageCapture = { url: original.pageUrl!, version: "current", contentHash: "fixture-only", fetchedAt: "2026-09-13T00:00:00Z", faqs: pairs.map((pair) => ({ ...pair, source: "html_section", answerComplete: true })) };
    const moved = convertSectionToSchema(original)!;
    expect([(await judge(original, { pageCapture })).verdict, (await judge(moved, { pageCapture })).verdict, moved.recommendedChange]).toEqual(["rejected", "ready", { ...original.recommendedChange, where: "In this page's own custom code, in the page head. This is JSON-LD, not visible page text." }]);
    expect([moved.whyItMatters.includes("eligible"), moved.whyItMatters.startsWith("2 questions and their answers from this page"), moved.operatorSteps?.some((step) => step.includes("new answer paragraph")), moved.faults, convertSectionToSchema(moved)]).toEqual([false, true, false, original.faults, null]);
    expect([openHold(moved).defects.length > 0, (await judge(moved, { pageCapture: null })).need?.reasonCode]).toEqual([true, "schema_visible_pair_unconfirmed"]);
    const wrapped = { ...original, faults: [], recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: '<script type="application/ld+json">'+after+'</script>' } }, converted = convertSectionToSchema(wrapped)!;
    expect(converted.recommendedChange.kind === "existing_edit" && converted.recommendedChange.field).toBe("schema");
    const eligible = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Who can enter?", acceptedAnswer: { "@type": "Answer", text: "Members are eligible to enter." } } }), factual = row(eligible, { claims: [{ text: "Members are eligible to enter.", supportedBy: ["page-copy-1"] }] });
    expect((await judge(factual, { pageCapture: { ...pageCapture, faqs: [{ question: "Who can enter?", answer: "Members are eligible to enter.", source: "html_section", answerComplete: true }] } })).verdict).toBe("ready");
    const wrongBefore = { ...moved, recommendedChange: { ...moved.recommendedChange, before: "A visible answer paragraph." } as ChangeProposal["recommendedChange"] };
    expect([(await judge(wrongBefore, { pageCapture })).verdict, convertSectionToSchema(wrongBefore), convertSectionToSchema(row(JSON.stringify({ "@context": "https://schema.org", "@graph": [JSON.parse(after), { "@type": "Article", headline: "Keep this article action" }] })))]).toEqual(["rejected", null, null]);
  });
  it("passes a block the page really carries, and refuses one it does not, a second block of a type the page has, JSON that does not parse, and a rich result Google stopped granting", async () => {
    const { convertSectionToSchema } = await import("@/domains/decision/validate-proposal"); const ok = await judge(row(FAQ));
    expect([(await judge(row(FAQ, { supportFacts: [{ id: "fact-1", fact: COPY }] }), { pageBodyText: "A guide to writing numbers.", pageCapture: null })).verdict, (await judge(row(FAQ, { supportFacts: [{ id: "fact-1", fact: FAQ }] }))).verdict, (await judge(row(FAQ.replace('"mainEntity":[', '"mainEntity":').replace('}]', '}')))).verdict], "research cannot establish publication or invent duplicates; actually published answers pass in array and single-node form").toEqual(["needs_review", "ready", "ready"]);
    const [absent, dupe, broken, thin, sold] = await Promise.all([judge(row(FAQ.replace("write numbers.", "write numbers in every shop in Tehran."))), judge(row(FAQ), { pageSchemaTypes: ["FAQPage"] }), judge(row('{"@type":"FAQPage"')), Promise.all([JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage" }), JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [null] }), FAQ.replace('"Question"', '"Person"'), FAQ.replace('"Answer"', '"Person"')].map((block) => judge(row(block)))), judge(row(FAQ, { limitations: [SOLD] }))]);
    expect([ok.verdict, ok.limitations.some((l) => l.includes("does not change how Google displays the page"))], "the questions and answers are on the page, and the row owes the one true sentence about what FAQ markup buys").toEqual(["ready", true]);
    expect([absent, dupe, broken, ...thin, sold].map((v) => v.verdict), "unpublished words, duplicate types, malformed JSON, absent/null/wrongly typed questions or answers, and retired FAQ rich-result promises never become Ready").toEqual(["rejected", "rejected", "rejected", ...thin.map(() => "rejected"), "rejected"]);
    expect([absent.reasons.some((r) => r.includes("wrong answer")), dupe.reasons.some((r) => r.includes("already carries a FAQPage block")), broken.reasons.some((r) => r.includes("not valid JSON")), thin.every((v, i) => v.reasons.some((r) => r.includes(["no mainEntity", "Question with a name", "Question with a name", "type Answer"][i]!))), sold.reasons.some((r) => r.includes("richer search listing")), [ok, absent, dupe, broken, ...thin, sold].every((v) => v.reasons.every((r) => !/[–—]/.test(r)))], "each refusal names its own reason, and a warning written for a crawler's log never reaches the operator wearing a dash Beacon does not write").toEqual([true, true, true, true, true, true]);
    const stored = proposal({ recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `<script type="application/ld+json">${FAQ}</script>` }, limitations: [SOLD] }), moved = convertSectionToSchema(stored)!;
    expect([(await judge(stored)).verdict, moved.recommendedChange.kind === "existing_edit" ? [moved.recommendedChange.field, moved.recommendedChange.after.startsWith("{")] : null, moved.limitations, (await judge(moved)).verdict, convertSectionToSchema(moved)], "the same block is refused as prose, converts at no cost into the typed treatment with its wrapper off and the withdrawn promise replaced, then passes, and converts exactly once").toEqual(["rejected", ["schema", true], ok.limitations, "ready", null]); }); });
