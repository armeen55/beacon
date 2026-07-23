import "server-only";

/**
 * dataforseo/types — the ONE canonical result vocabulary for every DataForSEO
 * call. Every endpoint caller (SERP, keyword volume, and any future endpoint)
 * flows through `dataForSeoRequest` and receives one of these five states. No
 * throw ever escapes into a render path: a failure is a typed `error`, a
 * missing key is `not_configured`, a held call is `capped`, and the default
 * dry-run echoes the exact request it WOULD have sent.
 */

/** The env shape the boundary reads. Names only; values never logged. */
export type DataForSeoEnv = {
  login?: string;
  password?: string;
  /** Pre-encoded base64(login:password) — the dashboard "Base64 Format" string.
   *  When present it is used verbatim, bypassing login/password assembly. */
  authB64?: string;
  provider?: string;
  dryRun?: string;
  monthlyCapUsd?: string;
};

/** The exact request the boundary would send. Echoed on `dry_run` (never the
 *  Authorization header — the secret is never surfaced). */
export type DataForSeoRequestShape = {
  endpoint: string;
  method: "POST";
  location: number;
  language: string;
  payload: unknown;
};

/** Provenance stamped on every `ok` result and carried into the caller's record. */
export type DataForSeoProvenance = {
  provider: "dataforseo";
  /** Endpoint path (full URL) the observation came from. */
  endpoint: string;
  /** Short non-secret summary of the query/payload (e.g. the query text or
   *  "42 keywords"). Never the full body, never a secret. */
  payloadSummary: string;
  location: number;
  language: string;
  /** ISO timestamp of the observation. */
  timestamp: string;
  /** Actual cost the provider reported for this call (falls back to the
   *  conservative estimate when the response omits a cost field). */
  costUsd: number;
  /** Deterministic per-logical-task key (endpoint + payload + tenant + day). */
  idempotencyKey: string;
};

/** The five canonical states. A caller pattern-matches on `state`. */
export type DataForSeoResult =
  | { state: "not_configured"; idempotencyKey: string; detail: string }
  | {
      state: "dry_run";
      request: DataForSeoRequestShape;
      estCostUsd: number;
      idempotencyKey: string;
      detail: string;
    }
  | { state: "capped"; idempotencyKey: string; detail: string }
  | {
      state: "ok";
      body: unknown;
      costUsd: number;
      provenance: DataForSeoProvenance;
      idempotencyKey: string;
      detail: string;
    }
  | { state: "error"; status: number | null; message: string; idempotencyKey: string; detail: string };

/** One logical DataForSEO task. `tenantId` is REQUIRED so spend is always
 *  attributed and the idempotency key is always tenant-scoped. */
export type DataForSeoRequestArgs = {
  tenantId: string;
  endpoint: string;
  /** The JSON body (DataForSEO takes an array of task objects). */
  payload: unknown;
  /** Conservative projected cost, used for the fail-closed cap check BEFORE any
   *  network call. The ledger later records the ACTUAL cost from the response. */
  estCostUsd: number;
  location: number;
  language: string;
  payloadSummary: string;
  /** Optional transport tally label ("serp" | "keywords" | ...) for perf-log. */
  perfDetail?: string;
  now?: Date;
};

/** Injectable I/O so a test never spends and never touches Supabase. */
export type DataForSeoClientDeps = {
  env: NodeJS.ProcessEnv;
  /** Month-to-date spend for the shared DataForSEO platform, or null on a read
   *  failure (fail-closed on the paid path). */
  spentThisMonthUsd: (tenantId: string, now: Date) => Promise<number | null>;
  /** Record the ACTUAL cost of a completed call, attributed to the account. */
  recordSpend: (tenantId: string, costUsd: number) => Promise<void>;
  fetchImpl: typeof fetch;
  /** Outer global cross-lane ceiling, consulted BEFORE the per-platform cap. */
  globalBreaker: (
    env: NodeJS.ProcessEnv,
    now: Date,
    projectedCostUsd: number,
  ) => Promise<{ tripped: boolean; reason?: string }>;
};
