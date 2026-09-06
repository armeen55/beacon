/** THE HARNESS WORLD: one in-memory account, one clock the caller advances, one scripted transport. It exists so the whole research-to-content sequence
 *  runs inside ONE test cycle instead of one half-hour scheduler tick per step, and so a failure branch is discovered beside the branch it competes with.
 *  Nothing here is a second runtime: every phase body, store and gate under test is the REAL one, reached through the seams production already exposes
 *  (setResearchRunRepoForTests, setAccountRepositoryForTests, the Supabase admin client, and the global fetch every provider transport resolves to).
 *  The account is `acct-fixture` on `example-site.test`; the rows, results pages and winners are captured production inputs with the account's identity
 *  replaced (tests/fixtures/harness). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Row = Record<string, unknown>;
export const T = "acct-fixture";
export const SITE = "example-site.test";

const FIX = join(process.cwd(), "tests", "fixtures", "harness");
export const fixture = <V>(name: string): V => JSON.parse(readFileSync(join(FIX, name), "utf8")) as V;

/** ONE reading of one search as the funnel banks it. */
export type FixtureSerp = { query: string; status: string; source: string; cacheKey?: string; observedAt?: string; organic?: unknown[] };
/** ONE winning page as the funnel banks it: an extract carrying words is a reading, an extract with none is a row banked before the reading existed. */
export type FixtureWinner = { url: string; domain: string; appearances?: { query?: string }[]; extract?: { mainText?: string | null; truncated?: boolean | null } | null; readOutcome?: { state?: string; retryAfter?: string } | null };

/** THE CLOCK THE DRIVES SHARE. Every step reads it, so advancing it here is what "a later drive" means. It starts at the process's own now because several
 *  steps bound themselves on the wall clock directly, and a drive whose `now` sat hours behind that reads its own time box as already spent. */
export const clock = { ms: Date.now() };
export const now = (): Date => new Date(clock.ms);
export const advance = (ms: number): number => (clock.ms += ms);

/** WHAT LEFT THIS PROCESS AND WHAT IT COST. `requests` is every scripted transport call in order; `paidUsd` is what the money path actually reserved,
 *  so a cache hit and a real request are told apart by the meter and by the attempt, never by a claim. */
export const meter = { requests: [] as { kind: "search" | "reasoning" | "page"; url: string; at: number }[], paidUsd: 0, reserved: [] as number[], /** Every answer served from the store without a request, by the endpoint it belongs to. */ hits: [] as string[], /** The status this script answered each search request with. */ answered: [] as string[] };
export const requestsOf = (kind: "search" | "reasoning" | "page"): number => meter.requests.filter((r) => r.kind === kind).length;

/** The tables the real steps read and write. A table nobody seeds answers as an honest empty one. */
export const tables = new Map<string, Row[]>();
export const table = (name: string): Row[] => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };

/** PURE. PostgREST's json-path projection, which several readers here depend on: `alias:state->a->b` and `alias:state->>a`. Returning the column instead
 *  of the path is how a fake tells a reader "nothing on file" for a row that holds plenty. */
function jsonPath(row: Row, path: string): unknown {
  const [head, ...rest] = path.split(/->>?/);
  let v: unknown = row[head!.trim()];
  for (const seg of rest) { if (v == null || typeof v !== "object") return null; v = (v as Row)[seg.trim()]; }
  return v ?? null;
}

/** The projection one SELECT asked for, applied. `*` and an empty list hand back the whole row. */
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

/** The in-memory Postgres the real stores run over: filters, ordering, paging, insert, update, upsert, delete, plus `maybeSingle` and the json-path
 *  projection above. It is deliberately one engine over `tables`, so a write one step makes is the row the next step reads. */
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
    if (fn === "reserve_provider_spend") {
      const amount = Number(args.p_amount ?? 0);
      if (meter.paidUsd + amount > money.cap) return { data: false, error: null };
      meter.paidUsd = Math.round((meter.paidUsd + amount) * 1e6) / 1e6; meter.reserved.push(amount); return { data: true, error: null };
    }
    if (fn === "adjust_provider_spend") { meter.paidUsd = Math.round((meter.paidUsd + Number(args.p_delta ?? 0)) * 1e6) / 1e6; return { data: true, error: null }; }
    if (fn === "patch_research_run_progress") return { data: null, error: null };
    if (fn === "supersede_change_proposal") {
      const row = args.p_row as Row, rows = table("change_proposals");
      const before = rows.find((r) => r.id === args.p_predecessor_id && r.tenant_id === args.p_tenant_id);
      if (before) Object.assign(before, { terminal_disposition: "superseded", superseded_by: row.id });
      const at = rows.findIndex((r) => r.id === row.id);
      if (at >= 0) rows[at] = { ...rows[at], ...row }; else rows.push({ ...row });
      return { data: "saved", error: null };
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
  if (row && row.status === "ready" && String(row.expires_at ?? "") > nowIso) { meter.hits.push(String(row.endpoint ?? "")); return { outcome: "ready", payload: row.payload, provider_task_id: row.provider_task_id ?? null, model_served: row.model_served ?? null, ready_at: row.ready_at ?? null, cost_usd: Number(row.cost_usd ?? 0) }; }
  if (row && row.status === "pending" && String(row.claim_expires_at ?? "") > nowIso) return { outcome: "pending", payload: null, provider_task_id: row.provider_task_id ?? null, model_served: null, ready_at: null, cost_usd: 0 };
  const claimed: Row = { ...(row ?? {}), cache_key: key, endpoint: String(args.p_endpoint ?? ""), status: "pending", claim_expires_at: new Date(clock.ms + Number(args.p_claim_seconds ?? 120) * 1000).toISOString(), expires_at: new Date(clock.ms + 7 * 86_400_000).toISOString() };
  if (row) Object.assign(row, claimed); else rows.push(claimed);
  return { outcome: "claimed", payload: null, provider_task_id: (claimed.provider_task_id as string) ?? null, model_served: null, ready_at: null, cost_usd: 0 };
}

/** THE SCRIPTED TRANSPORT. One function stands in for global fetch, so the search provider, the reasoning gateway and a winner page are all answered from
 *  a script and nothing can leave the process. An address no script answers THROWS, which is how a test proves a drive asked for something nobody planned. */
export type Script = {
  search?: (path: string, payload: unknown) => { status?: number; body: unknown };
  reasoning?: (body: unknown) => { status?: number; body: unknown };
  page?: (url: string) => { status?: number; html: string; contentType?: string } | null;
};
export const script: Script = {};

export function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : (input as Request).url);
    const at = clock.ms;
    if (url.includes("api.dataforseo.com")) {
      meter.requests.push({ kind: "search", url, at });
      let answer: { status?: number; body: unknown } | undefined;
      try { answer = script.search?.(url.split("/v3/")[1] ?? url, init?.body ? JSON.parse(String(init.body)) : null); }
      catch (e) { throw new Error(`[harness] the search script threw for ${url}: ${e instanceof Error ? e.message : String(e)}`); }
      if (!answer) throw new Error(`[harness] no search script answers ${url}`);
      meter.answered.push(`${answer.status ?? 200} ${url.split("/v3/")[1] ?? url}`);
      return reply(answer.status ?? 200, answer.body);
    }
    if (url.includes("api.openai.com")) {
      meter.requests.push({ kind: "reasoning", url, at });
      const answer = script.reasoning?.(init?.body ? JSON.parse(String(init.body)) : null);
      if (!answer) throw new Error(`[harness] no reasoning script answers ${url}`);
      return reply(answer.status ?? 200, answer.body);
    }
    meter.requests.push({ kind: "page", url, at });
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
  const row: RunRow = { id: `run-${runs.length + 1}`, tenant_id: T, cycle_key: `${T}:${iso.slice(0, 10)}`, status: "paused", current_phase: "keyword_discovery", phase_cursor: null, progress: {}, spend_usd: 0, last_error: null, lease_owner: null, lease_expires_at: null, started_at: iso, updated_at: iso, completed_at: null, ...over };
  runs.push(row); return row;
}

export function runRepo(): unknown {
  const iso = () => new Date(clock.ms).toISOString();
  const live = (r: RunRow, o: string) => r.lease_owner === o && r.lease_expires_at != null && Date.parse(r.lease_expires_at) >= clock.ms;
  const open = () => runs.find((x) => x.status === "running" || x.status === "paused");
  return {
    async claim({ tenantId, owner, leaseSeconds }: { tenantId: string; owner: string; leaseSeconds: number }) {
      const exp = new Date(clock.ms + leaseSeconds * 1000).toISOString(), o = open();
      if (o) { if (o.lease_owner != null && o.lease_owner !== owner && Date.parse(o.lease_expires_at!) >= clock.ms) return null; Object.assign(o, { lease_owner: owner, lease_expires_at: exp, status: "running", updated_at: iso() }); return { ...o }; }
      if (runs.some((x) => x.status === "completed" && (x.completed_at ?? "").slice(0, 10) === iso().slice(0, 10))) return null;
      return { ...seedRun({ tenant_id: tenantId, status: "running", current_phase: "refresh_sources", lease_owner: owner, lease_expires_at: exp }) };
    },
    async claimDue() { return []; },
    async startPass({ tenantId, owner, leaseSeconds, day, progress }: { tenantId: string; owner: string; leaseSeconds: number; day: string; progress?: Record<string, unknown> }) {
      if (open()) return null;
      return { ...seedRun({ tenant_id: tenantId, cycle_key: `${tenantId}:p${runs.length + 1}:${day}`, status: "running", current_phase: "refresh_sources", lease_owner: owner, lease_expires_at: new Date(clock.ms + leaseSeconds * 1000).toISOString(), ...(progress ? { progress } : {}) }) };
    },
    async advance({ id, owner, leaseSeconds, patch }: { id: string; owner: string; leaseSeconds: number; patch: { phase: string; cursor?: Record<string, unknown> | null; progress?: Record<string, unknown> } }) {
      const r = runs.find((x) => x.id === id); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { current_phase: patch.phase, progress: patch.progress ?? r.progress, phase_cursor: patch.cursor ?? null, lease_expires_at: new Date(clock.ms + leaseSeconds * 1000).toISOString(), updated_at: iso() }); return true;
    },
    async renew({ id, owner, leaseSeconds, cursor }: { id: string; owner: string; leaseSeconds: number; cursor: Record<string, unknown> | null }) {
      const r = runs.find((x) => x.id === id); if (!r || !live(r, owner) || r.status !== "running") return false;
      Object.assign(r, { phase_cursor: cursor ?? null, lease_expires_at: new Date(clock.ms + leaseSeconds * 1000).toISOString() }); return true;
    },
    async finish({ id, owner, outcome, errorInfo, spendUsd }: { id: string; owner: string; outcome: "paused" | "completed"; errorInfo?: unknown; spendUsd?: number | null }) {
      const r = runs.find((x) => x.id === id); if (!r || !live(r, owner)) return false;
      Object.assign(r, { status: outcome, lease_owner: null, lease_expires_at: null, last_error: outcome === "completed" ? null : (errorInfo as RunRow["last_error"]) ?? null, ...(typeof spendUsd === "number" ? { spend_usd: spendUsd } : {}), ...(outcome === "completed" ? { current_phase: "done", completed_at: iso() } : {}) }); return true;
    },
    async latest() { return runs.length ? { ...runs[runs.length - 1]! } : null; },
    async sameDay({ day, limit }: { day: string; limit: number }) { return runs.filter((x) => x.cycle_key.endsWith(day)).slice(0, limit).map((x) => ({ id: x.id, progress: x.progress ?? {} })); },
  };
}

/** THE CONFIRMED BUSINESS TRUTH the funnel refuses to research without: three operator-confirmed lists, generic and account-shaped, so the basis resolves
 *  and keyword discovery does not stop at its own door. */
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

/** THE ACCOUNT'S OWN SEARCH HISTORY, in the shape the three aggregate functions return it: what each page earns now, what it earned before, and the
 *  searches behind both. It is what makes a stalled hub row a demand-recovery opportunity rather than an idea. */
export function seedSearchHistory(pages: readonly { path: string; query: string; clicksNow?: number; clicksPrior?: number }[]): void {
  for (const p of pages) {
    const url = `https://${SITE}${p.path}`, now = p.clicksNow ?? 6, prior = p.clicksPrior ?? 90;
    table("gsc_page_signals_v1").push({ page: url, clicks: now, impressions: 5200, pos_weighted: 8.6 * 5200, top_queries: [{ query: p.query, clicks: now, impressions: 4400, position: 8.6 }] });
    table("gsc_page_totals_v1").push({ page: url, clicks: now, impressions: 5200, pos_weighted: 8.6 * 5200 });
    table("gsc_decay_v1").push({ page: url, clicks_now: now, impressions_now: 2400, pos_w_now: 8.6 * 2400, clicks_prior: prior, impressions_prior: 2800, pos_w_prior: 3.1 * 2800 });
  }
}

/** THE ACCOUNT'S OWN PAGES as the crawl banks them, so the writer has words of its own to write against and the diagnosis has passages to read. */
export function seedOwnedPages(pages: readonly { path: string; title: string; h1: string; meta: string; h2: readonly string[]; body: string }[]): void {
  for (const p of pages) table("page_snapshots").push({ id: `snap${p.path}`, page_id: p.path, observation_run_id: "obs-1", tenant_id: T, url: `https://${SITE}${p.path}`, canonical_url: null, final_url: null, http_status: 200, title: p.title, h1: p.h1, meta_description: p.meta, schema_types: [], location_terms: [], service_terms: [], internal_link_count: 0, external_link_count: 0, robots_meta: null, has_canonical_mismatch: false, headings_hash: "h", faq_hash: "f", schema_hash: "s", faq_schema_block_count: 0, structural_warnings: [], table_count: 0, schema_validation_warnings: [], h3_count: 0,
    fetched_at: new Date(clock.ms - 86_400_000).toISOString(), word_count: p.body.split(/\s+/).length, h2_list: [...p.h2], h3_list: [], faqs: [],
    body_text: p.body, body_paragraph_sample: p.body.split("\n").filter(Boolean).slice(0, 8), card_texts: [], schema_entity_names: [], internal_links: [],
    content_hash: `hash-${p.path}`, extraction_certainty: "confirmed" });
}

/** PURE. The smallest value that satisfies one strict JSON Schema, with named fields overridden. The gateway sends the schema it wants back on every request,
 *  so a scripted answer never has to hand-copy a shape that can drift: what the harness supplies is the WORDS the doors read, and the shape comes from the
 *  contract itself. `by` is keyed on property name, so "after" or "reason" can carry a real sentence wherever it appears. */
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

/** ONE REASONING ANSWER, in the envelope the canonical gateway reads. `byKind` is keyed on the schema name the request carries; a kind mapped to `null`
 *  answers `incomplete`, which is a real provider outcome and never a fabricated draft. Anything else is built from the request's OWN schema with the
 *  caller's words filled in, so the writer, the reviewer and the fact judge each get a schema-valid answer carrying the sentences the doors read. */
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
  money.cap = 5;
  clock.ms = Date.now();
  script.search = undefined; script.reasoning = undefined; script.page = undefined;
  table("tenants").push({ id: T, slug: T, domain: SITE, status: "active", research_paused: false, growth_goal: "balanced", daily_budget_usd: 50, business_name: "Fixture Account", signup_date: "2026-01-01", tos_accepted_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
  table("business_config").push(profileRow());
}
