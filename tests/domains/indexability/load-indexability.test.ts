/**
 * Phase A.3 Step 3b — read-only indexability verdict loader tests.
 *
 * Mocks the underlying stores at the module boundary (snapshot-store,
 * sitemap-reconciliation-store, robots-parser readRobotsState,
 * business-config, tenant-context, next/cache). Exercises the loader
 * across every signal-state branch + the two structural defenses
 * (global-sitemap tenant-domain filter; flat-path robots-state
 * siteDomain mismatch + stale gate).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import type {
  PageSnapshot,
  SitemapReconciliation,
} from "@/domains/pages/types";
import type { RobotsStateFile } from "@/domains/pages/robots-parser";
import { parseRobotsText } from "@/domains/pages/robots-parser";

// Stateful stubs — tests configure these via the setters below.
let _snapshots: PageSnapshot[] = [];
let _reconciliation: SitemapReconciliation | null = null;
let _robotsState: RobotsStateFile | null = null;
let _businessDomain = "example.com";
let _currentTenant = "tenant-a";

function setSnapshots(rows: PageSnapshot[]): void {
  _snapshots = rows;
}
function setReconciliation(r: SitemapReconciliation | null): void {
  _reconciliation = r;
}
function setRobotsState(s: RobotsStateFile | null): void {
  _robotsState = s;
}
function setBusinessDomain(d: string): void {
  _businessDomain = d;
}
function setCurrentTenant(id: string): void {
  _currentTenant = id;
}

// Phase A.3 (post-A.3.5 production-data fix, 2026-05-14):
// loader now reads page-snapshots via the tenant-scoped repository
// (`getRepository().forTenant(tenantId).getPageSnapshots()`) so
// production reads Supabase-backed rows. Tests mock the repository
// boundary; `_snapshots` is the same setter the prior snapshot-store
// mock used, just plumbed through forTenant.
// Phase A.3 (post-A.3.5 second-stage, 2026-05-15): tenant-scoped
// repository now exposes getRobotsState + getSitemapReconciliation
// + their paired setters in addition to getPageSnapshots. Mock
// extended; same setters (`_snapshots`, `_reconciliation`,
// `_robotsState`) used by the existing tests are now plumbed
// through forTenant.
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({
      getPageSnapshots: async () => _snapshots,
      getSitemapReconciliation: async () => _reconciliation,
      getRobotsState: async () => _robotsState,
      setRobotsState: async () => {},
      setSitemapReconciliation: async () => {},
    }),
  }),
}));

// Partially-mock robots-parser. `readRobotsState` is now async +
// tenant-scoped — the mock returns the fixture-set `_robotsState`
// directly. The pure exports stay intact for the loader's
// `evaluateAiBotAccess` / `evaluateGooglebotAccess` calls.
vi.mock("@/domains/pages/robots-parser", async () => {
  const actual = await vi.importActual<
    typeof import("@/domains/pages/robots-parser")
  >("@/domains/pages/robots-parser");
  return {
    ...actual,
    readRobotsState: async () => _robotsState,
  };
});

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({
    name: "Test Co",
    domain: _businessDomain,
    industry: "",
    phone: "",
    address: "",
    yelpBusinessId: "",
    locations: [],
    services: [],
    primaryCompetitors: [],
    keyPages: [],
    locationTerms: [],
    serviceTerms: [],
    directoryDomains: [],
    scanSettings: { preferredHour: 0, timezone: "UTC" },
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => _currentTenant,
}));

// Loader import goes AFTER mocks so vitest hoists them correctly.
import {
  STALE_ROBOTS_THRESHOLD_DAYS,
  loadIndexabilityForUrl,
} from "@/domains/indexability/load-indexability";

const TENANT = "tenant-a";
const NOW = "2026-05-14T12:00:00.000Z";
const TARGET_URL = "https://example.com/services/whole-home-remodel";

// ─────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: TARGET_URL,
    canonical_url: TARGET_URL,
    fetched_at: "2026-05-14T08:00:00.000Z",
    http_status: 200,
    title: "Whole-Home Remodel",
    meta_description: null,
    h1: "Whole-Home Remodel",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 1000,
    robots_meta: "index, follow",
    has_canonical_mismatch: false,
    content_hash: "h1",
    headings_hash: "h2",
    faq_hash: "h3",
    schema_hash: "h4",
    extraction_certainty: "confirmed",
    ...overrides,
  } as PageSnapshot;
}

function reconciliation(
  urls: string[],
  overrides: Partial<SitemapReconciliation> = {},
): SitemapReconciliation {
  return {
    canonical_pages: urls.map((u, i) => ({
      url: u,
      path: new URL(u).pathname,
      registry_page_id: `reg-${i}`,
      scan_page_id: `scan-${i}`,
    })),
    stale_pages: [],
    sitemap_url_count: urls.length,
    ...overrides,
  };
}

function robotsStateFromText(text: string, fetchedAt: string): RobotsStateFile {
  return {
    schemaVersion: 1,
    siteDomain: "example.com",
    parsed: parseRobotsText(text, "https://example.com/robots.txt", 200),
    lastFetchedAt: fetchedAt,
    lastFetchError: null,
  };
}

// `RobotsStateFile.fetchedAt` is actually carried on the parsed
// `RobotsFile` (not on the top-level state file). Build a fresh
// `RobotsFile` with the desired `fetchedAt`.
function robotsState({
  text,
  fetchedAt,
  siteDomain = "example.com",
  parsed = true,
}: {
  text: string;
  fetchedAt: string;
  siteDomain?: string;
  parsed?: boolean;
}): RobotsStateFile {
  const robots = parseRobotsText(text, "https://example.com/robots.txt", 200);
  return {
    schemaVersion: 1,
    siteDomain,
    parsed: parsed ? { ...robots, fetchedAt } : null,
    lastFetchedAt: fetchedAt,
    lastFetchError: null,
  };
}

beforeEach(() => {
  setSnapshots([]);
  setReconciliation(null);
  setRobotsState(null);
  setBusinessDomain("example.com");
  setCurrentTenant(TENANT);
});

// ─────────────────────────────────────────────────────────────────────
// Verdict resolution per branch
// ─────────────────────────────────────────────────────────────────────

describe("loadIndexabilityForUrl — happy path", () => {
  it("returns ok when every signal confirms positive", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: *\nDisallow:",
        fetchedAt: NOW,
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("ok");
  });
});

describe("loadIndexabilityForUrl — missing snapshot", () => {
  it("returns unknown when no snapshot matches the URL", async () => {
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("unknown");
    expect(out.signals.page_snapshot).toBeNull();
  });
});

describe("loadIndexabilityForUrl — bad_status_code", () => {
  it("returns bad_status_code on http 404", async () => {
    setSnapshots([snapshot({ http_status: 404 })]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("bad_status_code");
  });
});

describe("loadIndexabilityForUrl — noindex_meta", () => {
  it("returns noindex_meta when robots_meta carries noindex", async () => {
    setSnapshots([snapshot({ robots_meta: "noindex, nofollow" })]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("noindex_meta");
  });
});

describe("loadIndexabilityForUrl — canonical_elsewhere", () => {
  it("returns canonical_elsewhere when has_canonical_mismatch is true", async () => {
    setSnapshots([
      snapshot({
        has_canonical_mismatch: true,
        canonical_url: "https://example.com/other",
      }),
    ]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("canonical_elsewhere");
  });
});

describe("loadIndexabilityForUrl — blocked_by_robots_for_googlebot", () => {
  it("returns blocked_by_robots_for_googlebot when Googlebot is disallowed", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: Googlebot\nDisallow: /services/",
        fetchedAt: NOW,
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("blocked_by_robots_for_googlebot");
  });
});

describe("loadIndexabilityForUrl — blocked_by_robots_for_ai", () => {
  it("returns blocked_by_robots_for_ai when GPTBot is disallowed", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: GPTBot\nDisallow: /services/",
        fetchedAt: NOW,
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("blocked_by_robots_for_ai");
  });
});

describe("loadIndexabilityForUrl — not_in_sitemap", () => {
  it("returns not_in_sitemap when tenant has reconciliation rows but URL is absent", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation(["https://example.com/other-page"]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.composite_verdict).toBe("not_in_sitemap");
  });
});

// ─────────────────────────────────────────────────────────────────────
// URL canonicalization
// ─────────────────────────────────────────────────────────────────────

describe("loadIndexabilityForUrl — URL canonicalization", () => {
  it("trailing slash + uppercase host + query still match the snapshot", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: "HTTPS://EXAMPLE.COM/services/whole-home-remodel/?utm=foo",
      now: NOW,
    });
    expect(out.composite_verdict).toBe("ok");
  });

  it("www. prefix on input still matches a non-www snapshot URL", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: "https://www.example.com/services/whole-home-remodel",
      now: NOW,
    });
    expect(out.composite_verdict).toBe("ok");
  });

  it("malformed input URL returns unknown without throwing", async () => {
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: "mailto:foo@bar.com",
      now: NOW,
    });
    expect(out.composite_verdict).toBe("unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tenant context assertion
// ─────────────────────────────────────────────────────────────────────

describe("loadIndexabilityForUrl — tenant context", () => {
  it("throws when currentTenantId does not match opts.tenantId", async () => {
    setCurrentTenant("tenant-b");
    await expect(
      loadIndexabilityForUrl({
        tenantId: "tenant-a",
        url: TARGET_URL,
        now: NOW,
      }),
    ).rejects.toThrow(/tenant context mismatch/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Global sitemap reconciliation — tenant-domain filter defense
// ─────────────────────────────────────────────────────────────────────

describe("loadIndexabilityForUrl — global sitemap tenant-domain filter", () => {
  it("ignores reconciliation rows from another tenant's domain", async () => {
    setSnapshots([snapshot()]);
    // Reconciliation file contains rows for BOTH the tenant's domain
    // AND a foreign domain. The foreign-domain row must NOT contribute
    // to the membership decision.
    setReconciliation(
      reconciliation([
        "https://competitor.com/services/whole-home-remodel",
        // No row on example.com → tenant filter yields zero rows →
        // in_sitemap: null (cannot disambiguate "scan didn't run for
        // tenant" from "URL not in tenant sitemap").
      ]),
    );
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    // Foreign-domain rows filtered → in_sitemap: null → verdict
    // unknown (no negative signals fired; cannot claim ok without
    // confirmed sitemap evidence).
    expect(out.signals.sitemap_membership.in_sitemap).toBeNull();
    expect(out.composite_verdict).toBe("unknown");
  });

  it("matching tenant rows produce in_sitemap: true", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(
      reconciliation([
        "https://competitor.com/somewhere",
        TARGET_URL,
      ]),
    );
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.sitemap_membership.in_sitemap).toBe(true);
    expect(out.composite_verdict).toBe("ok");
  });

  it("reconciliation null → in_sitemap: null", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(null);
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.sitemap_membership.in_sitemap).toBeNull();
  });

  it("empty business config domain → in_sitemap: null (cannot filter safely)", async () => {
    setBusinessDomain("");
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.sitemap_membership.in_sitemap).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Robots-state defenses
// ─────────────────────────────────────────────────────────────────────

describe("loadIndexabilityForUrl — robots-state siteDomain mismatch", () => {
  it("sets bot flags null when robots-state.siteDomain belongs to another tenant", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: *\nDisallow:",
        fetchedAt: NOW,
        siteDomain: "another-tenant.com",
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.googlebot_allowed).toBeNull();
    expect(out.signals.robots_txt.gptbot_allowed).toBeNull();
    // No other negative signal → unknown rather than ok.
    expect(out.composite_verdict).toBe("unknown");
  });

  it("stronger verdicts still win when robots data is dropped (404 snapshot)", async () => {
    setSnapshots([snapshot({ http_status: 404 })]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: *\nDisallow:",
        fetchedAt: NOW,
        siteDomain: "another-tenant.com",
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    // bad_status_code precedence beats the unknown that robots-null
    // would have produced.
    expect(out.composite_verdict).toBe("bad_status_code");
  });
});

describe("loadIndexabilityForUrl — robots-state null branches", () => {
  it("readRobotsState() returning null → bot flags null", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(null);
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.googlebot_allowed).toBeNull();
  });

  it("state.parsed === null → bot flags null", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: *\nDisallow:",
        fetchedAt: NOW,
        parsed: false,
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.gptbot_allowed).toBeNull();
  });
});

describe("loadIndexabilityForUrl — stale-robots gate", () => {
  it("29 days old → flags preserved (fresh)", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    const fetchedAt = new Date(
      new Date(NOW).getTime() - 29 * 86_400_000,
    ).toISOString();
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.googlebot_allowed).toBe(true);
    expect(out.composite_verdict).toBe("ok");
  });

  it("exactly 30 days old → stale (flags null)", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    const fetchedAt = new Date(
      new Date(NOW).getTime() - STALE_ROBOTS_THRESHOLD_DAYS * 86_400_000,
    ).toISOString();
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.googlebot_allowed).toBeNull();
    expect(out.composite_verdict).toBe("unknown");
  });

  it("31 days old → stale (flags null)", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    const fetchedAt = new Date(
      new Date(NOW).getTime() - 31 * 86_400_000,
    ).toISOString();
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.gptbot_allowed).toBeNull();
  });

  it("invalid fetchedAt → flags null", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({
        text: "User-agent: *\nDisallow:",
        fetchedAt: "not-a-date",
      }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.robots_txt.claudebot_allowed).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Raw-signal preservation + determinism + stale boundary export
// ─────────────────────────────────────────────────────────────────────

describe("loadIndexabilityForUrl — raw signal preservation", () => {
  it("returned signals carry sitemap + robots + page_snapshot + gsc:null verbatim", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const out = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(out.signals.gsc).toBeNull();
    expect(out.signals.sitemap_membership.in_sitemap).toBe(true);
    expect(out.signals.page_snapshot?.http_status).toBe(200);
    expect(out.signals.page_snapshot?.noindex_detected).toBe(false);
    expect(out.url).toBe(TARGET_URL);
    expect(out.last_computed_at).toBe(NOW);
  });
});

describe("loadIndexabilityForUrl — determinism", () => {
  it("same input → byte-identical output across two calls", async () => {
    setSnapshots([snapshot()]);
    setReconciliation(reconciliation([TARGET_URL]));
    setRobotsState(
      robotsState({ text: "User-agent: *\nDisallow:", fetchedAt: NOW }),
    );
    const a = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    const b = await loadIndexabilityForUrl({
      tenantId: TENANT,
      url: TARGET_URL,
      now: NOW,
    });
    expect(a).toEqual(b);
  });
});

describe("loadIndexabilityForUrl — STALE_ROBOTS_THRESHOLD_DAYS export", () => {
  it("is the locked v1 value (30)", () => {
    expect(STALE_ROBOTS_THRESHOLD_DAYS).toBe(30);
  });
});
