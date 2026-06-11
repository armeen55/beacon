/**
 * Route tests for /api/cron/poll-watchdog.
 *
 * Verifies the auth contract, the read-only Supabase query, the
 * decision-then-dispatch flow, and the "no double-spend" property
 * (the route does NOT call any paid API and dispatches at most once
 * per invocation).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

// Hoisted mutable state so each test can shape the mocked Supabase
// response + fetch behavior independently.
const supabaseState = vi.hoisted(() => ({
  rows: [] as Array<{ run_type: string; scope_label: string | null; status: string; tenant_id?: string }>,
  // Night-shift (2026-06-11): the watchdog now also reads active tenants
  // for the scan/generation chain checks. Default: one tenant, fully
  // covered by the default rows fixtures via coverChain().
  tenants: [{ id: "tenant-ritz-founder" }] as Array<{ id: string }>,
  errorMessage: null as string | null,
  throws: false,
}));

const fetchState = vi.hoisted(() => ({
  responseStatus: 204 as number,
  responseBody: "",
  throws: false as boolean,
  callLog: [] as Array<{ url: string; method?: string; body?: string; authPrefix?: string }>,
}));

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        gte: (_col: string, _val: string) => ({
          order: async (_orderCol: string, _opts: unknown) => {
            if (supabaseState.throws) {
              throw new Error("simulated supabase failure");
            }
            return {
              data: supabaseState.rows,
              error: supabaseState.errorMessage
                ? { message: supabaseState.errorMessage }
                : null,
            };
          },
        }),
        eq: async (_col: string, _val: string) => {
          if (table === "tenants") {
            return { data: supabaseState.tenants, error: null };
          }
          return { data: [], error: null };
        },
      }),
    }),
  }),
}));

// Stub global fetch so the route's GitHub-API call doesn't escape the
// test sandbox. Captures the request payload for assertions.
const originalFetch = global.fetch;
function installFetchStub() {
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const auth = init?.headers
      ? (init.headers as Record<string, string>)["Authorization"] ??
        (init.headers as Record<string, string>)["authorization"]
      : undefined;
    fetchState.callLog.push({
      url: u,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      authPrefix: typeof auth === "string" ? auth.slice(0, 8) : undefined,
    });
    if (fetchState.throws) {
      throw new Error("simulated fetch failure");
    }
    // Node's Response constructor rejects status 204 (and 205, 304) with
    // a non-null body — those statuses are defined as "no content".
    // Use null body for null-body statuses so the stub mirrors real
    // GitHub-API behavior on success (workflow_dispatch returns 204 with
    // an empty body).
    const noBodyStatuses = new Set([204, 205, 304]);
    const body = noBodyStatuses.has(fetchState.responseStatus)
      ? null
      : fetchState.responseBody;
    return new Response(body, {
      status: fetchState.responseStatus,
    }) as Response;
  }) as typeof fetch;
}
function uninstallFetchStub() {
  global.fetch = originalFetch;
}

// ─────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────

function makeRequest(
  init: { authorization?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (init.authorization !== undefined) {
    headers["authorization"] = init.authorization;
  }
  return new NextRequest(
    new URL("/api/cron/poll-watchdog", "https://beacon-bice.vercel.app"),
    { method: "GET", headers },
  );
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  supabaseState.rows = [];
  supabaseState.tenants = [{ id: "tenant-ritz-founder" }];
  supabaseState.errorMessage = null;
  supabaseState.throws = false;
  fetchState.responseStatus = 204;
  fetchState.responseBody = "";
  fetchState.throws = false;
  fetchState.callLog = [];
  installFetchStub();
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role";
  process.env.BEACON_GH_WORKFLOW_DISPATCH_PAT = "stub-pat";
  delete process.env.BEACON_GH_REPO_OWNER;
  delete process.env.BEACON_GH_REPO_NAME;
  delete process.env.BEACON_GH_WORKFLOW_FILE;
  delete process.env.BEACON_GH_WORKFLOW_REF;
});

afterEach(() => {
  uninstallFetchStub();
  for (const k of Object.keys(process.env)) delete process.env[k];
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (typeof v === "string") process.env[k] = v;
  }
});

/** Night-shift (2026-06-11): cover rows for the scan + generation chain
 *  checks so poll-focused scenarios keep their original semantics. */
function chainCover(tenantId = "tenant-ritz-founder") {
  return [
    { run_type: "website_crawl", scope_label: "scan", status: "completed", tenant_id: tenantId },
    { run_type: "generation", scope_label: "gen", status: "completed", tenant_id: tenantId },
  ];
}

async function callRoute(req: NextRequest) {
  // Re-import per test so the route picks up the env values set in beforeEach.
  vi.resetModules();
  const mod = await import("@/app/api/cron/poll-watchdog/route");
  return mod.GET(req);
}

// ─────────────────────────────────────────────────────────────────────
// Auth contract
// ─────────────────────────────────────────────────────────────────────

describe("/api/cron/poll-watchdog — auth contract", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await callRoute(makeRequest({ authorization: "Bearer x" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("CRON_SECRET");
    expect(fetchState.callLog.length).toBe(0); // never reached dispatch
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await callRoute(makeRequest());
    expect(res.status).toBe(401);
    expect(fetchState.callLog.length).toBe(0);
  });

  it("returns 401 with wrong bearer token", async () => {
    const res = await callRoute(
      makeRequest({ authorization: "Bearer wrong-secret" }),
    );
    expect(res.status).toBe(401);
    expect(fetchState.callLog.length).toBe(0);
  });

  it("returns 401 when bearer prefix is missing", async () => {
    const res = await callRoute(
      makeRequest({ authorization: "test-secret" }),
    );
    expect(res.status).toBe(401);
    expect(fetchState.callLog.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Idempotency — already-ran path
// ─────────────────────────────────────────────────────────────────────

describe("/api/cron/poll-watchdog — already-ran-today (no dispatch)", () => {
  it("whole chain covered → 200 skipped, no dispatch fetch call", async () => {
    supabaseState.rows = [
      {
        run_type: "citation_sample_import",
        scope_label: "Native chatgpt poll · 100/100",
        status: "completed",
      },
      {
        run_type: "citation_sample_import",
        scope_label: "Native perplexity poll · 100/100",
        status: "completed",
      },
      ...chainCover(),
    ];
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped_already_ran_today");
    expect([...body.poll.coveredPlatforms].sort()).toEqual(["chatgpt", "perplexity"]);
    expect(fetchState.callLog.length).toBe(0);
  });

  it("running rows cover (no double-dispatch while a poll is mid-flight)", async () => {
    supabaseState.rows = [
      {
        run_type: "citation_sample_import",
        scope_label: "Native chatgpt poll · in flight",
        status: "running",
      },
      {
        run_type: "citation_sample_import",
        scope_label: "Native perplexity poll · in flight",
        status: "running",
      },
      ...chainCover(),
    ];
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(200);
    expect(fetchState.callLog.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Dispatch path
// ─────────────────────────────────────────────────────────────────────

describe("/api/cron/poll-watchdog — dispatch path", () => {
  it("no rows today → dispatches the FULL chain (scan + generation + poll)", async () => {
    supabaseState.rows = [];
    fetchState.responseStatus = 204;
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("dispatched");
    expect([...body.poll.missingPlatforms].sort()).toEqual(["chatgpt", "perplexity"]);
    expect(body.scan.missingTenants).toEqual(["tenant-ritz-founder"]);
    expect(body.generation.missingTenants).toEqual(["tenant-ritz-founder"]);
    const urls = fetchState.callLog.map((c) => c.url);
    expect(urls).toHaveLength(3);
    expect(urls.some((u) => u.includes("daily-scan.yml"))).toBe(true);
    expect(urls.some((u) => u.includes("nightly-generation.yml"))).toBe(true);
    expect(urls.some((u) => u.includes("daily-native-poll.yml"))).toBe(true);
    expect(fetchState.callLog[0]!.method).toBe("POST");
    expect(fetchState.callLog[0]!.body).toBe('{"ref":"main"}');
    expect(fetchState.callLog[0]!.authPrefix).toBe("Bearer s"); // "Bearer stub-pat"
  });

  it("only chatgpt missing → dispatches ONLY the poll workflow once", async () => {
    supabaseState.rows = [
      {
        run_type: "citation_sample_import",
        scope_label: "Native perplexity poll · 100/100",
        status: "completed",
      },
      ...chainCover(),
    ];
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("dispatched");
    expect(body.poll.missingPlatforms).toEqual(["chatgpt"]);
    expect(fetchState.callLog.length).toBe(1);
    expect(fetchState.callLog[0]!.url).toContain("daily-native-poll.yml");
  });

  it("env overrides flow through (BEACON_GH_REPO_OWNER, …_NAME, …_WORKFLOW_FILE, …_WORKFLOW_REF)", async () => {
    process.env.BEACON_GH_REPO_OWNER = "alt-owner";
    process.env.BEACON_GH_REPO_NAME = "alt-repo";
    process.env.BEACON_GH_WORKFLOW_FILE = "alt-workflow.yml";
    process.env.BEACON_GH_WORKFLOW_REF = "release";
    supabaseState.rows = [...chainCover()]; // only the poll is missing
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(200);
    expect(fetchState.callLog[0]!.url).toBe(
      "https://api.github.com/repos/alt-owner/alt-repo/actions/workflows/alt-workflow.yml/dispatches",
    );
    expect(fetchState.callLog[0]!.body).toBe('{"ref":"release"}');
  });

  it("missing BEACON_GH_WORKFLOW_DISPATCH_PAT → 503 with hint, no dispatch fetch", async () => {
    delete process.env.BEACON_GH_WORKFLOW_DISPATCH_PAT;
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("skipped_pat_not_configured");
    expect(body.hint).toContain("BEACON_GH_WORKFLOW_DISPATCH_PAT");
    expect(fetchState.callLog.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Failure modes
// ─────────────────────────────────────────────────────────────────────

describe("/api/cron/poll-watchdog — failure modes", () => {
  it("Supabase select error → 502 with detail; no dispatch", async () => {
    supabaseState.errorMessage = "permission denied for table observation_runs";
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("supabase select failed");
    expect(fetchState.callLog.length).toBe(0);
  });

  it("Supabase fetch throws → 502 with detail; no dispatch", async () => {
    supabaseState.throws = true;
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(502);
    expect(fetchState.callLog.length).toBe(0);
  });

  it("GitHub dispatch returns non-204 → 502 with dispatch_failed status", async () => {
    fetchState.responseStatus = 422;
    fetchState.responseBody = '{"message":"Workflow does not have workflow_dispatch trigger"}';
    supabaseState.rows = [...chainCover()]; // only the poll is missing
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe("dispatch_failed");
    expect(body.dispatches.poll.httpStatus).toBe(422);
    expect(body.dispatches.poll.error).toContain("workflow_dispatch trigger");
    expect(fetchState.callLog.length).toBe(1); // dispatch was attempted once
  });

  it("GitHub dispatch throws (network error) → 502 with dispatch_failed", async () => {
    fetchState.throws = true;
    supabaseState.rows = [...chainCover()]; // only the poll is missing
    const res = await callRoute(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe("dispatch_failed");
    expect(body.dispatches.poll.httpStatus).toBe(0);
    expect(body.dispatches.poll.error).toContain("simulated fetch failure");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Anti-double-spend invariants
// ─────────────────────────────────────────────────────────────────────

describe("/api/cron/poll-watchdog — no double-spend property", () => {
  it("on the skip path, no fetch to api.github.com is made", async () => {
    supabaseState.rows = [
      {
        run_type: "citation_sample_import",
        scope_label: "Native chatgpt poll · 100/100",
        status: "completed",
      },
      {
        run_type: "citation_sample_import",
        scope_label: "Native perplexity poll · 100/100",
        status: "completed",
      },
      ...chainCover(),
    ];
    await callRoute(makeRequest({ authorization: "Bearer test-secret" }));
    const ghCalls = fetchState.callLog.filter((c) =>
      c.url.startsWith("https://api.github.com"),
    );
    expect(ghCalls).toEqual([]);
  });

  it("each missing workflow is dispatched AT MOST ONCE per invocation", async () => {
    supabaseState.rows = [...chainCover()]; // only the poll is missing
    await callRoute(makeRequest({ authorization: "Bearer test-secret" }));
    expect(fetchState.callLog.length).toBe(1);
  });

  // Night-shift (2026-06-11): the chain checks themselves.
  it("scan missing only → dispatches daily-scan.yml only", async () => {
    supabaseState.rows = [
      { run_type: "citation_sample_import", scope_label: "Native chatgpt poll · x", status: "completed" },
      { run_type: "citation_sample_import", scope_label: "Native perplexity poll · x", status: "completed" },
      { run_type: "generation", scope_label: "gen", status: "completed", tenant_id: "tenant-ritz-founder" },
    ];
    const res = await callRoute(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(fetchState.callLog).toHaveLength(1);
    expect(fetchState.callLog[0]!.url).toContain("daily-scan.yml");
  });

  it("a FAILED scan row does not cover — the watchdog retries it", async () => {
    supabaseState.rows = [
      { run_type: "citation_sample_import", scope_label: "Native chatgpt poll · x", status: "completed" },
      { run_type: "citation_sample_import", scope_label: "Native perplexity poll · x", status: "completed" },
      { run_type: "website_crawl", scope_label: "scan", status: "failed", tenant_id: "tenant-ritz-founder" },
      { run_type: "generation", scope_label: "gen", status: "completed", tenant_id: "tenant-ritz-founder" },
    ];
    const res = await callRoute(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(fetchState.callLog).toHaveLength(1);
    expect(fetchState.callLog[0]!.url).toContain("daily-scan.yml");
  });

  it("a second active tenant without coverage triggers the chain dispatch", async () => {
    supabaseState.tenants = [{ id: "tenant-ritz-founder" }, { id: "tenant-iranopedia" }];
    supabaseState.rows = [
      { run_type: "citation_sample_import", scope_label: "Native chatgpt poll · x", status: "completed" },
      { run_type: "citation_sample_import", scope_label: "Native perplexity poll · x", status: "completed" },
      ...chainCover("tenant-ritz-founder"), // iranopedia uncovered
    ];
    const res = await callRoute(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.scan.missingTenants).toEqual(["tenant-iranopedia"]);
    expect(body.generation.missingTenants).toEqual(["tenant-iranopedia"]);
    expect(fetchState.callLog).toHaveLength(2);
  });

  it("the route never imports or invokes paid AI providers (runNativePoll, openai, perplexity)", async () => {
    // Source-text invariant: confirm the route does not depend on the
    // poll execution path. Pin both negative paths so a future refactor
    // can't smuggle paid-API calls into the watchdog.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../src/app/api/cron/poll-watchdog/route.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/runNativePoll/);
    expect(src).not.toMatch(/from\s+["']openai["']/);
    expect(src).not.toMatch(/from\s+["']@anthropic/);
    expect(src).not.toMatch(/api\.perplexity\.ai/);
  });
});
