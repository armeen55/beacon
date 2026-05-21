/**
 * Slice 4.5.D.α₁c (2026-05-20) — server-action tests for
 * `promoteEligibleCandidatesAction`. Three independent gates
 * + writer call + sync_warning truncation + writer-throw + tenant-
 * resolution failure. `redirect` + `notFound` mocked as typed-
 * error throws so the test can capture the redirect URL / 404.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

class TestRedirectError extends Error {
  constructor(public url: string) { super(`NEXT_REDIRECT ${url}`); }
}
class TestNotFoundError extends Error {
  constructor() { super("NEXT_NOT_FOUND"); }
}

// Hoisted mock state — vi.hoisted lets vi.mock factories close over
// mutable handles. Mock<TFunc> pins the call signature.

const mockState = vi.hoisted(() => ({
  operatorMode: false,
  liveWriteEnabled: false,
  tenantId: "tenant-x" as string,
  tenantThrows: false,
  promoteSpy: undefined as
    | undefined
    | Mock<
        (args: { tenantId: string; dryRun?: boolean }) => Promise<{
          dryRun: boolean;
          candidate_count: number;
          eligible_count: number;
          promoted_count: number;
          skipped_count: number;
          mapped_rows: Array<{ id: string }>;
          sync_warning: string | null;
        }>
      >,
  revalidateSpy: undefined as undefined | Mock<(path: string) => void>,
  logWarnSpy: undefined as undefined | Mock<(...args: unknown[]) => void>,
  promoteResult: {
    dryRun: false,
    candidate_count: 0,
    eligible_count: 0,
    promoted_count: 0,
    skipped_count: 0,
    mapped_rows: [] as Array<{ id: string }>,
    sync_warning: null as string | null,
  },
  promoteThrows: false,
  promoteThrowMessage: "boom",
}));
mockState.promoteSpy = vi.fn();
mockState.revalidateSpy = vi.fn();
mockState.logWarnSpy = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new TestRedirectError(url);
  },
  notFound: () => {
    throw new TestNotFoundError();
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    mockState.revalidateSpy!(path);
  },
}));

vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => mockState.operatorMode,
}));

vi.mock("@/lib/promotion-live-write", () => ({
  isPromotionLiveWriteEnabled: () => mockState.liveWriteEnabled,
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => {
    if (mockState.tenantThrows) throw new Error("no tenant");
    return mockState.tenantId;
  },
}));

vi.mock("@/domains/recommendation-intelligence/promotion-writer", () => ({
  promoteEligibleCandidates: async (args: {
    tenantId: string;
    dryRun?: boolean;
  }) => {
    mockState.promoteSpy!(args);
    if (mockState.promoteThrows) throw new Error(mockState.promoteThrowMessage);
    return mockState.promoteResult;
  },
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockState.logWarnSpy!(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the action AFTER mocks are registered

import { promoteEligibleCandidatesAction } from "@/app/(shell)/diagnostics/recommendation-triggers/actions";

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function captureRedirect(
  call: () => Promise<unknown>,
): Promise<string> {
  try {
    await call();
  } catch (err) {
    if (err instanceof TestRedirectError) return err.url;
    throw err;
  }
  throw new Error("expected redirect did not happen");
}

async function captureNotFound(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (err) {
    if (err instanceof TestNotFoundError) return;
    throw err;
  }
  throw new Error("expected notFound did not happen");
}

beforeEach(() => {
  mockState.operatorMode = false;
  mockState.liveWriteEnabled = false;
  mockState.tenantId = "tenant-x";
  mockState.tenantThrows = false;
  mockState.promoteResult = {
    dryRun: false,
    candidate_count: 0,
    eligible_count: 0,
    promoted_count: 0,
    skipped_count: 0,
    mapped_rows: [],
    sync_warning: null,
  };
  mockState.promoteThrows = false;
  mockState.promoteThrowMessage = "boom";
  mockState.promoteSpy!.mockClear();
  mockState.revalidateSpy!.mockClear();
  mockState.logWarnSpy!.mockClear();
  // Each test needing the operator-off path stubs NODE_ENV via
  // vi.stubEnv; reset stubs between tests so positive cases start clean.
  vi.unstubAllEnvs();
});

function enableAllGates() {
  mockState.operatorMode = true;
  mockState.liveWriteEnabled = true;
}

// Gate 1 — operator mode

describe("promoteEligibleCandidatesAction — operator gate", () => {
  it("operator OFF + NODE_ENV != 'test' → notFound() and writer NOT called", async () => {
    mockState.operatorMode = false;
    vi.stubEnv("NODE_ENV", "production");
    await captureNotFound(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    expect(mockState.promoteSpy!).not.toHaveBeenCalled();
    expect(mockState.revalidateSpy!).not.toHaveBeenCalled();
  });
});

// Gate 2 — env flag

describe("promoteEligibleCandidatesAction — env-flag gate (strict casing)", () => {
  // Strict `=== "true"` is pinned at the helper level + invariant;
  // the action respects the helper's verdict. Test drives the helper
  // to false to confirm action blocks + log.warn fires.
  it("env flag OFF → blocked + writer NOT called + log.warn fired", async () => {
    mockState.operatorMode = true;
    mockState.liveWriteEnabled = false;
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    expect(url).toContain("action_result=blocked_live_write_disabled");
    expect(mockState.promoteSpy!).not.toHaveBeenCalled();
    expect(mockState.revalidateSpy!).not.toHaveBeenCalled();
    expect(mockState.logWarnSpy!).toHaveBeenCalled();
  });
});

// Gate 3 — confirmation phrase (strict uppercase exact-match)

describe("promoteEligibleCandidatesAction — confirmation gate", () => {
  const cases: Array<Record<string, string>> = [
    {},
    { confirmation: "promote" },
    { confirmation: "Promote" },
  ];
  it.each(cases)("non-PROMOTE confirmation → blocked", async (fields) => {
    enableAllGates();
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData(fields)),
    );
    expect(url).toContain("action_result=blocked_confirmation_missing");
    expect(mockState.promoteSpy!).not.toHaveBeenCalled();
  });
});

// Tenant resolution failure

describe("promoteEligibleCandidatesAction — tenant resolve failure", () => {
  it("all gates pass but tenant resolve throws → blocked_no_tenant", async () => {
    enableAllGates();
    mockState.tenantThrows = true;
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    expect(url).toContain("action_result=blocked_no_tenant");
    expect(mockState.promoteSpy!).not.toHaveBeenCalled();
    expect(mockState.logWarnSpy!).toHaveBeenCalled();
  });
});

// Happy path — all three gates pass → writer called with dryRun:false

function fiveMappedRows(): Array<{ id: string }> {
  return Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}` }));
}

describe("promoteEligibleCandidatesAction — success", () => {
  it("operator ON + env ON + 'PROMOTE' → writer called with { tenantId, dryRun: false }; redirect with promoted result; revalidatePath called", async () => {
    enableAllGates();
    mockState.promoteResult = {
      dryRun: false,
      candidate_count: 10,
      eligible_count: 5,
      promoted_count: 5,
      skipped_count: 0,
      mapped_rows: fiveMappedRows(),
      sync_warning: null,
    };
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    expect(mockState.promoteSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.promoteSpy!.mock.calls[0]![0]).toEqual({
      tenantId: "tenant-x",
      dryRun: false,
    });
    expect(mockState.revalidateSpy!).toHaveBeenCalledTimes(1);
    expect(mockState.revalidateSpy!.mock.calls[0]![0]).toBe(
      "/diagnostics/recommendation-triggers",
    );
    expect(url).toContain("action_result=promoted");
    expect(url).toContain("promoted_count=5");
    expect(url).toContain("skipped_count=0");
    expect(url).toContain("mapped_row_count=5");
    expect(url).not.toContain("sync_warning");
  });

  it("success result with skipped + sync_warning encodes both into URL (sync_warning truncated to 200 chars)", async () => {
    enableAllGates();
    mockState.promoteResult = {
      dryRun: false,
      candidate_count: 12,
      eligible_count: 7,
      promoted_count: 5,
      skipped_count: 2,
      mapped_rows: fiveMappedRows(),
      sync_warning: "x".repeat(500),
    };
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    expect(url).toContain("promoted_count=5");
    expect(url).toContain("skipped_count=2");
    expect(url).toContain("mapped_row_count=5");
    expect(url).toContain("sync_warning=");
    const params = new URL(`http://x${url.slice(url.indexOf("?"))}`).searchParams;
    const decoded = params.get("sync_warning");
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBeLessThanOrEqual(200);
    expect(decoded!.startsWith("x")).toBe(true);
  });
});

// Writer throw — local persistence fail-loud

describe("promoteEligibleCandidatesAction — writer throws", () => {
  it("writer throws → redirect with action_result=error&msg=...; revalidatePath NOT called", async () => {
    enableAllGates();
    mockState.promoteThrows = true;
    mockState.promoteThrowMessage = "local persistence failed";
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    expect(url).toContain("action_result=error");
    expect(url).toContain("msg=");
    expect(mockState.revalidateSpy!).not.toHaveBeenCalled();
    expect(mockState.logWarnSpy!).toHaveBeenCalled();
    const params = new URL(`http://x${url.slice(url.indexOf("?"))}`).searchParams;
    expect(params.get("msg")).toBe("local persistence failed");
  });

  it("writer throws with very long message → msg truncated to 200 chars in URL", async () => {
    enableAllGates();
    mockState.promoteThrows = true;
    mockState.promoteThrowMessage = "y".repeat(500);
    const url = await captureRedirect(() =>
      promoteEligibleCandidatesAction(makeFormData({ confirmation: "PROMOTE" })),
    );
    const params = new URL(`http://x${url.slice(url.indexOf("?"))}`).searchParams;
    const msg = params.get("msg")!;
    expect(msg.length).toBeLessThanOrEqual(200);
    expect(msg.startsWith("y")).toBe(true);
    expect(mockState.revalidateSpy!).not.toHaveBeenCalled();
  });
});
