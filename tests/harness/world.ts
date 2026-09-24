/** In-memory account, clock and scripted transport around real production phases/stores. Fixtures replace account identity; scripted model approvals do not prove live copy quality. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportingDay } from "@/lib/reporting-day";
export type Row = Record<string, unknown>;
export const T = "acct-fixture";
export const SITE = "example-site.test";
const FIX = join(process.cwd(), "tests", "fixtures", "harness");
export const fixture = <V>(name: string): V => JSON.parse(readFileSync(join(FIX, name), "utf8")) as V;
export type FixtureSerp = { query: string; status: string; source: string; cacheKey?: string; observedAt?: string; organic?: unknown[] };
export type FixtureWinner = { url: string; domain: string; appearances?: { query?: string }[]; extract?: { mainText?: string | null; truncated?: boolean | null } | null; readOutcome?: { state?: string; retryAfter?: string } | null };
/** Start at wall time because production deadlines use it; advance explicitly between simulated drives. */
export const clock = { ms: Date.now() };
export const now = (): Date => new Date(clock.ms);
export const advance = (ms: number): number => (clock.ms += ms);
export const today = (): string => reportingDay(clock.ms);
/** Scripted transport attempts and reservations, not real provider spending. */
export const meter = { requests: [] as { kind: "search" | "reasoning" | "page"; url: string; at: number }[], paidUsd: 0, reserved: [] as number[], /** Every answer served from the store without a request, by the endpoint it belongs to. */ hits: [] as string[], /** The status this script answered each search request with. */ answered: [] as string[] };
export const requestsOf = (kind: "search" | "reasoning" | "page"): number => meter.requests.filter((r) => r.kind === kind).length;
export const tables = new Map<string, Row[]>();
export const table = (name: string): Row[] => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
/** Spend is account-wide in production, but every receipt keeps its platform. Tests asking whether DataForSEO charged must never accidentally count an OpenAI editor call. */
export const spentOn = (platform: string): number => table("spend_reservations")
  .filter((r) => r.platform === platform && !["released", "failed"].includes(String(r.state)))
  .reduce((sum, r) => sum + Number(r.state === "reconciled" ? r.actual_usd ?? r.estimated_usd ?? 0 : r.estimated_usd ?? 0), 0);
/** PostgREST JSON-path projection, including aliases and text extraction. */
function jsonPath(row: Row, path: string): unknown {
  const [head, ...rest] = path.split(/->>?/);
  let v: unknown = row[head!.trim()];
  for (const seg of rest) { if (v == null || typeof v !== "object") return null; v = (v as Row)[seg.trim()]; }
  return v ?? null;
}
function project(row: Row, cols: string): Row {
  const want = cols.trim();
  if (!want || want === "*") return { ...row };
  const out: Row = {};
  for (const raw of want.split(",")) {
    const part = raw.trim(); if (!part) continue;
    const at = part.indexOf(":");
    if (at > 0) { out[part.slice(0, at).trim()] = jsonPath(row, part.slice(at + 1)); continue; }
    if (part in row) out[part] = row[part];
  }
  return out;
}
/** Shared fake PostgREST state: writes from one production step are visible to the next. */
export function client(): Record<string, unknown> {
  const from = (name: string) => {
    const tests: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "upsert" | "insert" | "delete" = "select";
    let patch: Row = {}, sent: Row[] = [], cols = "", first = 0, max = Number.MAX_SAFE_INTEGER, counting = false, head = false;
    const orders: [string, boolean][] = [];
    const rows = () => table(name);
    const where = (t: (r: Row) => boolean) => { tests.push(t); return q; };
    const cmp = (a: Row, b: Row, c: string) => (typeof a[c] === "number" && typeof b[c] === "number" ? (a[c] as number) - (b[c] as number) : String(a[c] ?? "").localeCompare(String(b[c] ?? "")));
    const run = (): { data: unknown; error: { message: string; code?: string } | null; count?: number } => {
      const hit = rows().filter((r) => tests.every((t) => t(r)));
      if (op === "update") { for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => project(r, cols)), error: null }; }
      if (op === "delete") { for (const r of hit) rows().splice(rows().indexOf(r), 1); return { data: hit, error: null }; }
      if (op === "select") {
        if (orders.length) hit.sort((a, b) => { for (const [c, asc] of orders) { const d = cmp(a, b, c); if (d !== 0) return asc ? d : -d; } return 0; });
        const page = hit.slice(first, first + max).map((r) => project(r, cols));
        return counting ? { data: head ? null : page, count: hit.length, error: null } : { data: page, error: null };
      }
      for (const row of sent) {
        const at = op === "upsert" ? rows().findIndex((r) => sameRow(name, r, row)) : -1;
        if (at >= 0) rows()[at] = { ...rows()[at], ...row }; else rows().push({ ...row });
      }
      return { data: sent.map((r) => project(r, cols || "*")), error: null };
    };
    const q: Record<string, unknown> = {
      select: (c?: string, x?: { count?: string; head?: boolean }) => { cols = c ?? ""; counting = x?.count != null; head = x?.head === true; return q; },
      insert: (r: Row | Row[]) => { op = "insert"; sent = Array.isArray(r) ? r : [r]; return q; },
      update: (p: Row) => { op = "update"; patch = p; return q; },
      upsert: (r: Row | Row[]) => { op = "upsert"; sent = Array.isArray(r) ? r : [r]; return q; },
      delete: () => { op = "delete"; return q; },
      order: (c: string, x?: { ascending?: boolean }) => { orders.push([c, x?.ascending !== false]); return q; },
      limit: (n: number) => { max = n; return q; },
      range: (a: number, z: number) => { first = a; max = z - a + 1; return q; },
      eq: (c: string, v: unknown) => where((r) => (r[c] ?? null) === v),
      neq: (c: string, v: unknown) => where((r) => (r[c] ?? null) !== v),
      is: (c: string, v: unknown) => where((r) => (r[c] ?? null) === v),
      not: (c: string, kind: string, v: unknown) => where((r) => (kind === "is" && v === null ? (r[c] ?? null) !== null : (r[c] ?? null) !== v)),
      in: (c: string, vs: readonly unknown[]) => where((r) => vs.includes(r[c])),
      contains: () => q,
      like: (c: string, v: string) => where((r) => typeof r[c] === "string" && new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "s").test(r[c] as string)),
      gte: (c: string, v: unknown) => where((r) => r[c] != null && String(r[c]) >= String(v)),
      lte: (c: string, v: unknown) => where((r) => r[c] != null && String(r[c]) <= String(v)),
      lt: (c: string, v: unknown) => where((r) => r[c] != null && String(r[c]) < String(v)),
      gt: (c: string, v: unknown) => where((r) => r[c] != null && String(r[c]) > String(v)),
      or: () => q,
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  };
  return { from, rpc: (fn: string, args: Record<string, unknown>) => rpcCall(fn, args) };
}
/** The identity an upsert lands on, per table: the same unique index the migration declares. */
function sameRow(name: string, stored: Row, sent: Row): boolean {
  if (name === "evidence_cache") return stored.cache_key === sent.cache_key;
  if (name === "research_state") return stored.tenant_id === sent.tenant_id && stored.basis_tag === sent.basis_tag;
  if (name === "page_snapshots") return stored.tenant_id === sent.tenant_id && stored.url === sent.url;
  if (name === "page_source_facts") return stored.tenant_id === sent.tenant_id && stored.page_key === sent.page_key && stored.statement_key === sent.statement_key;
  return stored.id === sent.id;
}
/** EVERY RPC THE DRIVE REACHES, and the ones it does not are named loudly rather than answered with a quiet null. */
const rpcSeen: string[] = [];
/** Every line the runtime logged this arm, so a branch that answers only in a log can still be asserted. */
export const logs: string[] = [];
/** An RPC answers as a chainable PostgREST builder, because the heavy aggregate reads page and time-bound their own statements. */
function rpcCall(fn: string, args: Record<string, unknown>): Record<string, unknown> {
  rpcSeen.push(fn);
  let first = 0, max = Number.MAX_SAFE_INTEGER;
  const answer = (): { data: unknown; error: { message: string; code?: string } | null } => {
    if (fn === "claim_evidence_fetch") return { data: [claimEvidence(args)], error: null };
    if (fn === "reserve_spend") {
      const amount = Number(args.p_estimated_usd ?? 0), rows = table("spend_reservations");
      const prior = rows.find((r) => r.platform === args.p_platform && r.logical_key === args.p_logical_key
        && ["reserved", "transmitted", "ambiguous"].includes(String(r.state)));
      if (prior) return { data: [{ outcome: "resumed", attempt_id: prior.attempt_id, attempt_ordinal: prior.attempt_ordinal,
        reservation_state: prior.state, reporting_day: today(), estimated_usd: prior.estimated_usd,
        accounted_usd: prior.accounted_usd ?? null, provider_task_id: prior.provider_task_id ?? null,
        accounting_basis: prior.accounting_basis ?? null, result_payload: prior.result_payload ?? null }], error: null };
      if (meter.paidUsd + amount > money.cap) return { data: [{ outcome: "refused_daily", attempt_id: null,
        reporting_day: today(), estimated_usd: amount }], error: null };
      const ordinal = rows.filter((r) => r.logical_key === args.p_logical_key && r.reporting_day === today()).length + 1;
      const row = { attempt_id: `spend-${rows.length + 1}`, tenant_id: args.p_tenant_id, reporting_day: today(),
        platform: args.p_platform, purpose: args.p_purpose, logical_key: args.p_logical_key,
        request_fingerprint: args.p_request_fingerprint, proposal_work_key: args.p_proposal_work_key ?? null,
        research_run_id: args.p_research_run_id ?? null, research_run_owner: args.p_research_run_owner ?? null,
        attempt_ordinal: ordinal, state: "reserved", estimated_usd: amount, accounted_usd: null,
        accounting_basis: null, result_payload: null, provider_task_id: null };
      rows.push(row); meter.paidUsd += amount; meter.reserved.push(amount);
      return { data: [{ outcome: "reserved", attempt_id: row.attempt_id, attempt_ordinal: ordinal,
        reservation_state: "reserved", reporting_day: today(), estimated_usd: amount, accounted_usd: null,
        provider_task_id: null, accounting_basis: null, result_payload: null }], error: null };
    }
    if (["claim_spend_transmission", "mark_spend_ambiguous", "release_spend", "reconcile_spend"].includes(fn)) {
      const row = table("spend_reservations").find((r) => r.attempt_id === args.p_attempt_id);
      if (!row) return { data: fn === "claim_spend_transmission" ? "unavailable" : false, error: null };
      if (fn === "claim_spend_transmission") { if (row.state !== "reserved") return { data: "already_started", error: null }; row.state = "transmitted"; return { data: "claimed", error: null }; }
      if (fn === "mark_spend_ambiguous") { row.state = "ambiguous"; row.provider_task_id = args.p_provider_task_id ?? row.provider_task_id; row.result_payload = args.p_result_payload ?? null; return { data: true, error: null }; }
      if (fn === "release_spend") { meter.paidUsd -= Number(row.estimated_usd); row.state = "released"; return { data: true, error: null }; }
      meter.paidUsd += Number(args.p_accounted_usd) - Number(row.estimated_usd); row.state = "reconciled";
      row.accounted_usd = args.p_accounted_usd; row.accounting_basis = args.p_accounting_basis ?? "provider_reported";
      row.provider_task_id = args.p_provider_task_id ?? null; row.result_payload = args.p_result_payload ?? null;
      return { data: true, error: null };
    }
    if (fn === "patch_research_run_progress") return { data: null, error: null };
    if (fn === "supersede_change_proposal") {
      const row = args.p_row as Row, rows = table("change_proposals");
      const expected = args.p_predecessors as Array<{ id: string }>;
      for (const x of expected) { const before = rows.find((r) => r.id === x.id && r.tenant_id === args.p_tenant_id); if (before) Object.assign(before, { terminal_disposition: "superseded", superseded_by: row.id }); }
      const at = rows.findIndex((r) => r.id === row.id);
      if (at >= 0) rows[at] = { ...rows[at], ...row }; else rows.push({ ...row });
      return { data: "saved", error: null };
    }
    if (fn === "save_change_proposal_cas") {
      const row = args.p_row as Row, rows = table("change_proposals");
      const at = rows.findIndex((r) => r.id === row.id && r.tenant_id === args.p_tenant_id);
      if (at >= 0) rows[at] = { ...rows[at], ...row }; else rows.push({ created_at: now().toISOString(), ...row });
      return { data: "saved", error: null };
    }
    if (fn === "refresh_change_proposal_ranking_receipt") {
      const row = table("change_proposals").find((r) => r.id === args.p_id && r.tenant_id === args.p_tenant_id);
      if (row) row.ranking_receipt = args.p_ranking_receipt ?? null;
      return { data: row != null, error: null };
    }
    if (fn === "retire_change_proposal") {
      const row = table("change_proposals").find((r) => r.id === args.p_id && r.tenant_id === args.p_tenant_id);
      if (row) Object.assign(row, { terminal_disposition: args.p_disposition, superseded_by: args.p_superseded_by ?? null,
        withdrawn_reason: args.p_reason ?? null });
      return { data: row != null, error: null };
    }
    if (fn === "record_change_implementation") {
      const row = table("change_proposals").find((r) => r.id === args.p_proposal_id && r.tenant_id === args.p_tenant_id);
      const ship = args.p_shipment as Row, expected = args.p_expected_payload as Row;
      const parts = ((row?.payload as { proposal?: { bundle?: { components?: Row[] } } })?.proposal?.bundle?.components ?? []);
      const applied = ship.components_applied as Array<{ id?: string; before?: string; after?: string }>;
      const ids = args.p_component_ids as string[];
      const change = (expected.proposal as Row)?.recommendedChange as Row | undefined;
      const covered = new Set(applied.map((c) => c.id)); // Strict fixture: only current-press pieces count; SQL also checks validated prior rows.
      const matches = parts.length ? applied.every((part) => { const i = ids.indexOf(part.id ?? "");
        return i >= 0 && part.after === parts[i]?.after && (part.before ?? null) === (parts[i]?.before ?? null); })
        : applied.length === 1 && applied[0]?.id == null && applied[0]?.after === change?.after
          && (applied[0]?.before ?? null) === (change?.before ?? null);
      if (!row || row.status !== "ready" || row.terminal_disposition != null || row.proposal_version !== args.p_expected_row_version
        || JSON.stringify(row.payload) !== JSON.stringify(expected) || ship.tenant_id !== args.p_tenant_id || ship.proposal_id !== args.p_proposal_id
        || !Array.isArray(applied) || !Array.isArray(ids) || parts.length !== ids.length || !matches
        || parts.length === 0 && args.p_complete !== true
        || args.p_complete === true && parts.some((_, i) => !covered.has(ids[i])))
        return { data: "stale", error: null };
      const held = table("shipped_change_proof").some((r) => r.tenant_id === ship.tenant_id && r.id === ship.id);
      if (!held) table("shipped_change_proof").push({ ...ship });
      if (args.p_complete === true) { row.status = "implemented_pending_verification";
        row.payload = { ...expected, proposal: { ...(expected.proposal as Row), status: row.status } }; }
      return { data: held ? "already" : "inserted", error: null };
    }
    if (fn === "publish_customer_release") return { data: true, error: null };
    const rows = tables.has(fn) ? table(fn) : null;
    if (rows) return { data: rows.slice(first, first + max), error: null };
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {
    abortSignal: () => q, order: () => q,
    range: (a: number, z: number) => { first = a; max = z - a + 1; return q; },
    limit: (n: number) => { max = n; return q; },
    then: (resolve: (v: unknown) => void) => resolve(answer()),
  };
  return q;
}
/** The one ceiling the harness enforces, so "the spending cap refused this call" is a branch a test can ask for rather than wait for. */
export const money = { cap: 5 };
/** claim_evidence_fetch, modelled on its migration: a fresh ready row is served as `ready` at $0, a live pending claim answers `pending`, anything else
 *  hands the caller the claim and a row to write into. THE CACHE HIT AND THE PAID REQUEST ARE DECIDED HERE, which is why the meter can be trusted. */
function claimEvidence(args: Record<string, unknown>): Row {
  const key = String(args.p_cache_key);
  const rows = table("evidence_cache");
  const row = rows.find((r) => r.cache_key === key);
  const nowIso = new Date(clock.ms).toISOString();
  if (row && row.status === "ready" && String(row.expires_at ?? "") > nowIso) { meter.hits.push(String(row.endpoint ?? "")); return { outcome: "ready", payload: row.payload, provider_task_id: row.provider_task_id ?? null, model_served: row.model_served ?? null, ready_at: row.ready_at ?? null, cost_usd: Number(row.cost_usd ?? 0), fetch_generation: Number(row.fetch_generation ?? 1) }; }
  if (row && row.status === "pending" && String(row.claim_expires_at ?? "") > nowIso) return { outcome: "pending", payload: null, provider_task_id: row.provider_task_id ?? null, model_served: null, ready_at: null, cost_usd: 0, fetch_generation: Number(row.fetch_generation ?? 1) };
  const generation = row?.status === "ready" ? Number(row.fetch_generation ?? 1) + 1 : Number(row?.fetch_generation ?? 1);
  const claimed: Row = { ...(row ?? {}), cache_key: key, endpoint: String(args.p_endpoint ?? ""), status: "pending", fetch_generation: generation, claim_expires_at: new Date(clock.ms + Number(args.p_claim_seconds ?? 120) * 1000).toISOString(), expires_at: new Date(clock.ms + 7 * 86_400_000).toISOString() };
  if (row) Object.assign(row, claimed); else rows.push(claimed);
  return { outcome: "claimed", payload: null, provider_task_id: (claimed.provider_task_id as string) ?? null, model_served: null, ready_at: null, cost_usd: 0, fetch_generation: generation };
}

/** THE SCRIPTED TRANSPORT. One function stands in for global fetch, so the search provider, the reasoning gateway and a winner page are all answered from
 *  a script and nothing can leave the process. An address no script answers THROWS, which is how a test proves a drive asked for something nobody planned. */
export type Script = {
  search?: (path: string, payload: unknown) => { status?: number; body: unknown };
  reasoning?: (body: unknown) => { status?: number; body: unknown };
  page?: (url: string) => { status?: number; html: string; contentType?: string } | null;
  /** HOW LONG EACH PROVIDER TAKES TO ANSWER, in milliseconds per transport kind. Waited for REAL inside fetch and added to the shared clock in the same breath, so
   *  the steps that read the wall clock (the walk's own stop, its measured preparation) and the steps that read the injected now (the drive's deadline, the lease,
   *  every box) both see the provider take that long. Absent or zero is an instant answer, so a case that says nothing about time is unchanged. */
  latency?: { search?: number; reasoning?: number; page?: number };
};
export const script: Script = {};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** One provider's answer taking its scripted time: the clock moves first, so a step asking the time mid-call reads the call as already spent, then the wait is real. */
const took = async (kind: "search" | "reasoning" | "page"): Promise<void> => { const ms = script.latency?.[kind] ?? 0; if (ms > 0) { clock.ms += ms; await sleep(ms); } };

export function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : (input as Request).url);
    const at = clock.ms;
    if (url.includes("api.dataforseo.com")) {
      meter.requests.push({ kind: "search", url, at }); await took("search");
      let answer: { status?: number; body: unknown } | undefined;
      try { answer = script.search?.(url.split("/v3/")[1] ?? url, init?.body ? JSON.parse(String(init.body)) : null); }
      catch (e) { throw new Error(`[harness] the search script threw for ${url}: ${e instanceof Error ? e.message : String(e)}`); }
      if (!answer) throw new Error(`[harness] no search script answers ${url}`);
      meter.answered.push(`${answer.status ?? 200} ${url.split("/v3/")[1] ?? url}`);
      return reply(answer.status ?? 200, answer.body);
    }
    if (url.includes("api.openai.com")) {
      meter.requests.push({ kind: "reasoning", url, at }); await took("reasoning");
      const answer = script.reasoning?.(init?.body ? JSON.parse(String(init.body)) : null);
      if (!answer) throw new Error(`[harness] no reasoning script answers ${url}`);
      return reply(answer.status ?? 200, answer.body);
    }
    meter.requests.push({ kind: "page", url, at }); await took("page");
    const answer = script.page?.(url);
    if (!answer) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(answer.html, { status: answer.status ?? 200, headers: { "content-type": answer.contentType ?? "text/html; charset=utf-8" } });
  }) as typeof fetch;
}

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** THE RESEARCH-RUN REPOSITORY, modelling the RPC guards the migration declares: one open run per account, a live foreign lease refuses, advance/renew/finish
 *  need a live lease. It is the seam production already exposes (setResearchRunRepoForTests), so the executor above it is untouched. */
export type RunRow = {
  id: string; tenant_id: string; cycle_key: string; status: "running" | "paused" | "completed"; current_phase: string;
  phase_cursor: Record<string, unknown> | null; progress: Record<string, unknown>; spend_usd: number;
  last_error: { phase: string; message: string; at: string } | null; lease_owner: string | null; lease_expires_at: string | null;
  started_at: string; updated_at: string; completed_at: string | null;
};
export const runs: RunRow[] = [];

/** Seed the account's one open run: the phase it resumes at, and the plan that decides which phases this pass may run at all. */
export function seedRun(over: Partial<RunRow> = {}): RunRow {
  const iso = new Date(clock.ms).toISOString();
  const row: RunRow = { id: `run-${runs.length + 1}`, tenant_id: T, cycle_key: `${T}:${today()}`, status: "paused", current_phase: "keyword_discovery", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null, lease_owner: null, lease_expires_at: null, started_at: iso, updated_at: iso, completed_at: null, ...over };
  runs.push(row); return row;
}

/** THE INTERRUPTION: one repository write that throws instead of landing, which is what a lost lease or an instance killed mid-write looks like from the row. `op` names
 *  the write, `phase` the phase it is about (an advance's target phase, a renewal's cursor phase; absent means any), `after` how many matching writes land first. It
 *  fires once and clears itself, so the row keeps exactly what the writes before it landed and the next drive can be asked to resume from that. */
type Interruption = { op: "advance" | "renew"; phase?: string; after: number };
const planned: { next: Interruption | null } = { next: null };
export function interruptOnce(op: Interruption["op"], o: { phase?: string; after?: number } = {}): void { planned.next = { op, phase: o.phase, after: o.after ?? 0 }; }
function strike(op: Interruption["op"], phase: string | undefined): void {
  const i = planned.next; if (!i || i.op !== op || (i.phase != null && i.phase !== phase)) return;
  if (i.after > 0) { i.after -= 1; return; }
  planned.next = null; throw new Error(`[harness] the ${op} did not land: the instance lost its lease mid-write`);
}

export function runRepo(): unknown {
  const iso = () => new Date(clock.ms).toISOString();
  const live = (r: RunRow, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= clock.ms;
  const open = () => runs.find((x) => x.status === "running" || x.status === "paused");
  return {
    async claim({ tenantId, owner, leaseSeconds }: { tenantId: string; owner: string; leaseSeconds: number }) {
      const exp = new Date(clock.ms + leaseSeconds * 1000).toISOString(), o = open();
      if (o) { if (o.lease_owner != null && o.lease_owner !== owner && Date.parse(o.lease_expires_at!) >= clock.ms) return null; Object.assign(o, { lease_owner: owner, lease_expires_at: exp, status: "running", updated_at: iso() }); return { ...o }; }
      if (runs.some((x) => x.status === "completed" && reportingDay(Date.parse(x.completed_at ?? "") || 0) === today())) return null; // the runtime's own day here too, never the UTC date
      return { ...seedRun({ tenant_id: tenantId, status: "running", current_phase: "refresh_sources", lease_owner: owner, lease_expires_at: exp }) };
    },
    async claimDue() { return []; },
    async startPass({ tenantId, owner, leaseSeconds, day, progress }: { tenantId: string; owner: string; leaseSeconds: number; day: string; progress?: Record<string, unknown> }) {
      if (open()) return null;
      return { ...seedRun({ tenant_id: tenantId, cycle_key: `${tenantId}:p${runs.length + 1}:${day}`, status: "running", current_phase: "refresh_sources", lease_owner: owner, lease_expires_at: new Date(clock.ms + leaseSeconds * 1000).toISOString(), ...(progress ? { progress } : {}) }) };
    },
    async advance({ id, owner, leaseSeconds, patch }: { id: string; owner: string; leaseSeconds: number; patch: { phase: string; cursor?: Record<string, unknown> | null; progress?: Record<string, unknown> } }) {
      strike("advance", patch.phase);
      const r = runs.find((x) => x.id === id); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: new Date(clock.ms + leaseSeconds * 1000).toISOString(), updated_at: iso() }); return true;
    },
    async renew({ id, owner, leaseSeconds, cursor }: { id: string; owner: string; leaseSeconds: number; cursor: Record<string, unknown> | null }) {
      strike("renew", typeof cursor?.phase === "string" ? cursor.phase : undefined);
      const r = runs.find((x) => x.id === id); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: new Date(clock.ms + leaseSeconds * 1000).toISOString() }); return true;
    },
    async finish({ id, owner, outcome, errorInfo, spendUsd }: { id: string; owner: string; outcome: "paused" | "completed"; errorInfo?: unknown; spendUsd?: number | null }) {
      const r = runs.find((x) => x.id === id); if (!r || !live(r, owner)) return false;
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: outcome === "completed" ? null : (errorInfo as RunRow["last_error"]) ?? null, ...(typeof spendUsd === "number" ? { spend_usd: spendUsd } : {}), ...(outcome === "completed" ? { current_phase: "done", completed_at: iso() } : {}) }); return true;
    },
    async patchProgress({ tenantId, id, patch, increment }: { tenantId: string; id: string; patch: Record<string, unknown>; increment?: { key: string; day: string } }) {
      const r = runs.find((x) => x.id === id && x.tenant_id === tenantId); if (!r) return null;
      const progress = { ...(r.progress ?? {}), ...patch };
      if (increment) { const prior = progress[increment.key] as { day?: string; count?: number } | undefined;
        progress[increment.key] = { day: increment.day, count: prior?.day === increment.day ? (prior.count ?? 0) + 1 : 1 }; }
      r.progress = progress; r.updated_at = iso(); return { ...progress };
    },
    async latest() { return runs.length ? { ...runs[runs.length - 1]! } : null; },
    async sameDay({ day, limit }: { day: string; limit: number }) { return runs.filter((x) => x.cycle_key.endsWith(day)).slice(0, limit).map((x) => ({ id: x.id, progress: x.progress ?? {} })); },
  };
}

/** Confirmed business-profile fixture required by research admission. */
const confirmed = <V>(value: V) => ({ value, origin: "operator_confirmed", confidence: null, sourceUrls: [] });
const profileRow = (): Row => ({ id: T, data: {
  accountId: T, schemaVersion: 2, updatedAt: "2026-01-01T00:00:00.000Z",
  name: confirmed("Fixture Account"), businessType: confirmed("content_publisher"), siteArchetype: confirmed("content_site"),
  offerings: confirmed(["reference guides"]), audiences: confirmed(["readers looking things up"]), customerProblems: confirmed(["readers cannot find a direct answer"]),
  geographicScope: confirmed([]), differentiators: confirmed([]), trustClaims: confirmed([]), importantPages: confirmed([]),
  topicsToOwn: confirmed(["names", "notable people"]), topicsToExclude: confirmed([]),
  constraints: confirmed({ factual: [], legal: [], brand: [], editorial: [], bannedTerms: [], firstMention: null }),
  trustedSourceDomains: confirmed([]), competitors: confirmed([]),
} });

/** The research document as one basis row: the searches on file and the winners banked under them, straight off the capture. */
export function seedResearchState(basis: string, over: Partial<Record<"serps" | "winningPages" | "cases", unknown>> = {}): Row {
  const serps = (over.serps ?? fixture<FixtureSerp[]>("serps.json")) as FixtureSerp[];
  const winners = (over.winningPages ?? fixture<FixtureWinner[]>("winners.json")) as FixtureWinner[];
  const row: Row = { tenant_id: T, basis_tag: basis, schema_version: 3, row_version: 1, state: {
    schemaVersion: 3, tenantId: T, basisTag: basis,
    discovery: { seeds: [], retained: [], rejected: [], counts: { raw: 0, normalized: 0, retained: 0, rejected: 0 }, caseCompetitors: [] },
    prompts: { pairs: [], intendedPairs: 0 },
    serps: { queries: serps, analyzed: serps.length },
    winningPages: winners, pageComparisons: [], cases: (over.cases ?? []) as unknown[], ownedReads: [],
    ledger: { spentUsd: 0, cacheHits: 0 }, cycle: { runId: null, cycleKey: null, spentUsd: 0, cacheHits: 0 },
    updatedAt: new Date(clock.ms).toISOString(),
  } };
  table("research_state").push(row);
  return row;
}

/** Current and preceding page/query performance in the aggregate readers' shape. */
export function seedSearchHistory(pages: readonly { path: string; query: string; clicksNow?: number; clicksPrior?: number }[]): void {
  for (const p of pages) {
    const url = `https://${SITE}${p.path}`, now = p.clicksNow ?? 6, prior = p.clicksPrior ?? 90;
    table("gsc_page_signals_v1").push({ page: url, clicks: now, impressions: 5200, pos_weighted: 8.6 * 5200, top_queries: [{ query: p.query, clicks: now, impressions: 4400, position: 8.6 }] });
    table("gsc_page_totals_v1").push({ page: url, clicks: now, impressions: 5200, pos_weighted: 8.6 * 5200 });
    table("gsc_decay_v1").push({ page: url, clicks_now: now, impressions_now: 2400, pos_w_now: 8.6 * 2400, clicks_prior: prior, impressions_prior: 2800, pos_w_prior: 3.1 * 2800 });
  }
}

/** THE ACCOUNT'S OWN PAGES as the crawl banks them, so the writer has words of its own to write against and the diagnosis has passages to read. */
export async function seedOwnedPages(pages: readonly { path: string; title: string; h1: string; meta: string; h2: readonly string[]; body: string }[]): Promise<void> {
  const { extractPageSnapshot } = await import("@/domains/evidence/pages/extractor");
  for (const p of pages) {
    const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const paragraphs = p.body.split("\n").filter(Boolean);
    const body = paragraphs.map((line, i) => `${p.h2[i - 1] ? `<h2>${esc(p.h2[i - 1]!)}</h2>` : ""}<p>${esc(line)}</p>`).join("");
    const trailing = p.h2.slice(Math.max(0, paragraphs.length - 1)).map((h) => `<h2>${esc(h)}</h2>`).join("");
    const html = `<html><head><title>${esc(p.title)}</title><meta name="description" content="${esc(p.meta)}"></head><body><main><h1>${esc(p.h1)}</h1>${body}${trailing}</main></body></html>`;
    table("page_snapshots").push({ ...extractPageSnapshot(html, `https://${SITE}${p.path}`, p.path, T), id: `snap${p.path}`, observation_run_id: "obs-1", fetched_at: new Date(clock.ms - 86_400_000).toISOString() });
  }
}

/** Minimal schema-shaped scripted value; `by` overrides named properties. */
/** The words a scripted answer carries where the caller named none: long enough for a minimum-length rule, plain enough to carry no claim. */
const FILLER = "This sentence stands in for words a writer would supply.";
function valueFromSchema(schema: unknown, by: Record<string, unknown> = {}, name = ""): unknown {
  const s = (schema ?? {}) as { type?: string; enum?: unknown[]; properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; minItems?: number; maxItems?: number };
  if (name && name in by) return by[name];
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if (Array.isArray(s.anyOf) && s.anyOf.length > 0) { const first = s.anyOf.find((o) => (o as { type?: string }).type !== "null") ?? s.anyOf[0]; return valueFromSchema(first, by, name); }
  const type = Array.isArray(s.type) ? (s.type as string[]).find((t) => t !== "null") : s.type;
  if (type === "object") { const out: Row = {}; for (const [k, v] of Object.entries(s.properties ?? {})) out[k] = valueFromSchema(v, by, k); return out; }
  if (type === "array") return Array.from({ length: Math.min(s.maxItems ?? 3, Math.max(3, s.minItems ?? 0)) }, (_v, i) => valueFromSchema(s.items, by, `${name}[${i}]`));
  if (type === "number" || type === "integer") return Math.max(1, Number((s as { minimum?: number }).minimum ?? 1)); /* the strict transport drops minimum too, and a zero-day measurement window is a shape no caller accepts */
  if (type === "boolean") return false;
  if (type === "null") return null;
  if ((s as { format?: string }).format === "uri" || /url$/i.test(name)) return `https://${SITE}/reference`;
  if (/(?:^|[a-z])At$/.test(name)) return new Date(clock.ms).toISOString(); /* a moment, not prose: the strict transport drops maxLength, so filler in a `retrievedAt` failed the schema the caller validates against */
  const min = (s as { minLength?: number }).minLength ?? 0, max = (s as { maxLength?: number }).maxLength ?? 200;
  return FILLER.repeat(Math.ceil(Math.max(min, 1) / FILLER.length)).slice(0, Math.max(min, Math.min(max, FILLER.length)));
}

/** Scripted gateway envelope keyed by schema name; null simulates an incomplete response. */
export function reasoningReply(byKind: Record<string, Record<string, unknown> | null>, body: unknown): { status?: number; body: unknown } {
  const req = body as { text?: { format?: { name?: unknown; schema?: unknown } } };
  const kind = String(req?.text?.format?.name ?? "");
  reasoningAsked.push({ kind, ask: JSON.stringify(body) });
  const usage = { input_tokens: 900, output_tokens: 400 };
  const words = byKind[kind];
  if (words === null) return { body: { id: "resp-1", status: "incomplete", incomplete_details: { reason: "the model stopped before it finished" }, model: "gpt-5-mini", usage, output: [] } };
  const value = valueFromSchema(req?.text?.format?.schema, words ?? {});
  return { body: { id: "resp-1", status: "completed", model: "gpt-5-mini", usage, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] } };
}
/** EVERY REASONING CALL THIS ARM MADE, in order, with the request that was sent: an arm can then ask what the writer was handed and whether the reading of those words saw the same material. */
export const reasoningAsked: { kind: string; ask: string }[] = [];

/** Scripted hub answer using packet IDs; real deterministic delivery checks still run. */
const HUB_BODY = ["Iran has produced writers, athletes and performers whose work travelled far beyond its borders.", "The poets section lists three poets with a short line on each.", "The athletes section lists wrestlers and weightlifters who won world titles.", "The actors section lists screen performers who worked at home and abroad.", "Each entry gives a name, a period and one sentence about why the person is remembered."]; /* the opening passage the writer replaces: every sentence of it survives verbatim behind the new opening, and the writer's ledger says so unit by unit, exactly as the per-unit preservation contract demands of production copy */
export const WRITER = { field: "answer_block", before: null, naturalHeading: "Who the widely known Iranians are", placementId: "", implementationMinutes: 15, preservation: HUB_BODY.map((text) => ({ text, disposition: "kept" as const })),
  rationale: "The first lines never say who the search is about, so the answer is stated before the sections that hold the names.",
  after: `Iran's widely known figures fall into three groups of people: poets, athletes and screen actors. ${HUB_BODY.join(" ")}`, // the new opening states the answer once; the page's own sentences that already carry the detail follow it unchanged
  claims: [{ text: "Poets, athletes and screen actors are the three kinds of people named.", supportedBy: ["page-heading-2", "page-heading-3", "page-heading-4"] },
    { text: "The athletes are wrestlers and weightlifters who won world titles, and the actors worked on screen at home and abroad.", supportedBy: ["page-copy-6", "page-copy-8"] }] };
/** Scripted positive per-claim rulings; these verify pipeline wiring, not model judgement. */
export const JUDGE = { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false,
  claims: [0, 1].map((i) => ({ i, by: WRITER.claims[i]!.supportedBy, entailed: true })), notes: "The first lines now name who the search is about before the sections that hold the names.", resolution: "none", preservation: HUB_BODY.map((text) => ({ text, disposition: "kept" as const, verified: true, reason: "The sentence survives verbatim behind the new opening.", after: text, by: [], to: null })) }; // one VERIFIED ruling per original unit the reviewer is shown, in the exact shape the acceptance schema fixes
/** THE SECTION FAMILY, scripted to the same contract (Stage 3, 2026-09-14): the heading every winner carries and this page lacks, one checked reading behind it under fact-1, and the page's own words under page-copy-1. The judge rules both claims exactly, contests nothing, and owes no preservation ruling because the section replaces nothing. */
export const SECTION = { subject: "Scientists", says: "Iranian scientists remembered today include the physician Avicenna and the mathematician Omar Khayyam, each of whom worked in the eleventh century.", source: "https://en.wikipedia.org/wiki/List_of_Iranians" };
export const SECTION_WRITER = { ...WRITER, naturalHeading: SECTION.subject, preservation: [], rationale: "Every winner gives scientists a section of their own and this page names none, so one is added from the checked reading.", after: `${SECTION.says} ${HUB_BODY[4]}`,
  claims: [{ text: SECTION.says, supportedBy: ["fact-1"] }, { text: HUB_BODY[4]!, supportedBy: ["page-copy-1"] }] };
export const SECTION_JUDGE = { ...JUDGE, claims: [0, 1].map((i) => ({ i, by: SECTION_WRITER.claims[i]!.supportedBy, entailed: true })), notes: "The page now names its scientists under their own heading, on the reading that carries them.", preservation: [] };
/** THE HUB PAGE AS THE CRAWL BANKS IT, with the three sections the writer's claims cite. */
export const HUB_PAGE = { path: "/famous-iranians", title: "Most Famous Iranians and Persians of All Time", h1: "Famous and Influential Iranian People",
  meta: "Explore the most famous Iranians and Persians in history.", h2: ["Famous Iranian Poets", "Famous Iranian Athletes", "Famous Iranian Actors"],
  body: HUB_BODY.join("\n") };

/** THE STALLED HUB OPPORTUNITIES exactly as the store holds them, with the account's identity replaced. `pick` selects by page. */
export function seedProposals(pick?: (row: Row) => boolean): Row[] {
  const rows = fixture<Row[]>("hub-rows.json").filter((r) => (pick ? pick(r) : true));
  for (const r of rows) table("change_proposals").push({ ...r });
  return rows;
}

/** Reset the whole world between arms: the tables, the clock, the meter and the script. */
export function reset(): void {
  tables.clear(); rpcSeen.length = 0; runs.length = 0; logs.length = 0; reasoningAsked.length = 0;
  meter.requests.length = 0; meter.paidUsd = 0; meter.reserved.length = 0; meter.hits.length = 0; meter.answered.length = 0;
  money.cap = 5; planned.next = null;
  clock.ms = Date.now();
  script.search = undefined; script.reasoning = undefined; script.page = undefined; script.latency = undefined;
  table("tenants").push({ id: T, slug: T, domain: SITE, status: "active", research_paused: false, growth_goal: "balanced", daily_budget_usd: 50, business_name: "Fixture Account", signup_date: "2026-01-01", tos_accepted_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
  table("business_config").push(profileRow());
}
