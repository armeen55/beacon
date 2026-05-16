/**
 * Section 7 C7a — operator-only /diagnostics/off-site-authority page
 * render contract.
 *
 * Pins:
 *   - Operator gate: page calls `notFound()` when
 *     `isOperatorModeServer()` returns false.
 *   - Local-service tenant: channel table renders.
 *   - Non-local-service tenant: "not classified" notice renders, no
 *     channel table.
 *   - Placeholder-config state: placeholder banner renders.
 *   - `data_sources_note` items render in the footer.
 *   - Page does NOT import `@/lib/business-config` directly (defense-
 *     in-depth — covered by architecture invariant; mirrored here as
 *     a render-time guard).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

let _operatorModeEnabled = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operatorModeEnabled,
}));

import type {
  OffSitePresenceSnapshot,
  OffSiteChannelState,
} from "@/domains/off-site-authority/types";

const NOW_ISO = "2026-05-16T12:00:00.000Z";

function baseChannels(): OffSiteChannelState[] {
  return [
    {
      channel: "gbp",
      claimed: true,
      review_count: 12,
      rating: 4.6,
      profile_url: null,
      source: "connector_api",
      last_checked_at: NOW_ISO,
      confidence: "high",
    },
    {
      channel: "yelp",
      claimed: false,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "low",
    },
    {
      channel: "houzz",
      claimed: null,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "unknown",
    },
    {
      channel: "angi",
      claimed: null,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "unknown",
    },
    {
      channel: "bbb",
      claimed: null,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "unknown",
    },
    {
      channel: "industry_directory",
      claimed: null,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "unknown",
    },
    {
      channel: "local_press",
      claimed: null,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "unknown",
    },
  ];
}

const STANDARD_NOTES = [
  "business-config: process-global today; multi-tenant routing not yet implemented for this source.",
  "connector-tokens: process-global today; multi-tenant routing not yet implemented for this source.",
  "local-reviews: request-scoped per tenant via the persistence-layer tenant-slug resolver.",
  "industry directory and local press detection: not implemented until C7g.",
];

let _snapshot: OffSitePresenceSnapshot = {
  tenant_id: "tenant-test",
  brand_name: "Ritz Builders",
  is_local_service: true,
  channels: baseChannels(),
  data_sources_note: [...STANDARD_NOTES],
  generated_at: NOW_ISO,
};

vi.mock("@/domains/off-site-authority/load-snapshot", () => ({
  loadOffSitePresenceSnapshot: async () => _snapshot,
}));

import OffSiteAuthorityDiagnosticPage from "@/app/(shell)/diagnostics/off-site-authority/page";

beforeEach(() => {
  _operatorModeEnabled = true;
  _snapshot = {
    tenant_id: "tenant-test",
    brand_name: "Ritz Builders",
    is_local_service: true,
    channels: baseChannels(),
    data_sources_note: [...STANDARD_NOTES],
    generated_at: NOW_ISO,
  };
});

async function renderPage(): Promise<string> {
  const element = await OffSiteAuthorityDiagnosticPage();
  return renderToStaticMarkup(element);
}

describe("Section 7 C7a — operator diagnostic page", () => {
  it("operator gate true → channel table renders", async () => {
    const html = await renderPage();
    expect(html).toContain('data-diag-off-site-authority-table="true"');
    expect(html).toContain("Google Business Profile");
    expect(html).toContain("Yelp");
    expect(html).toContain("Better Business Bureau");
  });

  it("operator gate false → notFound (404)", async () => {
    _operatorModeEnabled = false;
    await expect(renderPage()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("non-local-service tenant → notice renders, no channel table", async () => {
    _snapshot = {
      ..._snapshot,
      is_local_service: false,
    };
    const html = await renderPage();
    expect(html).toContain(
      'data-diag-off-site-authority-not-local-service="true"',
    );
    expect(html).not.toContain('data-diag-off-site-authority-table="true"');
  });

  it("placeholder note → placeholder banner renders", async () => {
    _snapshot = {
      ..._snapshot,
      data_sources_note: [
        ...STANDARD_NOTES,
        "business-config is the neutral placeholder (no tenant config loaded).",
      ],
    };
    const html = await renderPage();
    expect(html).toContain(
      'data-diag-off-site-authority-placeholder="true"',
    );
    expect(html).toContain("Tenant config not loaded");
  });

  it("data_sources_note items render in the footer in order", async () => {
    const html = await renderPage();
    expect(html).toContain(
      'data-diag-off-site-authority-data-sources="true"',
    );
    // Each note appears with its index attribute.
    for (let i = 0; i < STANDARD_NOTES.length; i++) {
      expect(html).toContain(
        `data-diag-off-site-authority-data-sources-note="${i}"`,
      );
      expect(html).toContain(STANDARD_NOTES[i]);
    }
  });

  it("brand name renders in the header description when present", async () => {
    const html = await renderPage();
    expect(html).toContain("Operator view — Ritz Builders");
  });

  it("brand_name = null → header description falls back to 'Operator view' only", async () => {
    _snapshot = { ..._snapshot, brand_name: null };
    const html = await renderPage();
    expect(html).toContain("Operator view");
    expect(html).not.toContain("Operator view — ");
  });

  it("Confirmed / Beacon-did-not-find / Not yet detected copy renders per claimed state", async () => {
    const html = await renderPage();
    expect(html).toContain("Confirmed");
    expect(html).toContain("Beacon did not find a confirmed profile");
    expect(html).toContain("Not yet detected");
  });
});

describe("Section 7 C7a — page source-level isolation guard", () => {
  it("page source does NOT import @/lib/business-config directly", () => {
    // Mirror of the architecture-invariant assertion at render-test
    // level so a CI failure here lands closer to the developer than
    // the source-scan invariant alone.
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const REPO_ROOT = resolve(__dirname, "..", "..", "..");
    const src = readFileSync(
      resolve(
        REPO_ROOT,
        "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
      ),
      "utf-8",
    ) as string;
    expect(src).not.toMatch(/from\s+["']@\/lib\/business-config["']/);
  });
});
