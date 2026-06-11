/**
 * 2026-06-11 (night shift) — /diagnostics/wix contract. The page's
 * docstring claimed this file existed; now it does. Pins:
 *   - publish-auth 404 gate (#126: per-tenant, via the mocked
 *     operator-mode path inside can-publish),
 *   - the #82 Revert button renders for pushed ledger rows and NOT for
 *     revert rows or failures.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-iranopedia",
}));
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async () => ({ status: "connected", last_synced_at: "2026-06-11T00:00:00Z" }),
}));
vi.mock("@/lib/connectors/wix/url-map", () => ({
  getWixCollectionConfig: async () => [],
  getWixUrlMap: async () => [],
  syncWixUrlMap: async () => ({ ok: true, collections: 0, itemsMapped: 0, errors: [], probe: { checked: 0, ok: 0, failures: [] } }),
}));

let _ledger: unknown[] = [];
vi.mock("@/domains/push/caps", () => ({
  readPushLedger: async () => _ledger,
  MAX_PUSHES_PER_DAY: 10,
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({ getRecommendedEdits: async () => [] }),
  }),
}));

import WixDiagnosticPage from "@/app/(shell)/diagnostics/wix/page";

beforeEach(() => {
  _operator = true;
  _ledger = [];
});

describe("/diagnostics/wix", () => {
  it("404s when publish auth fails (no operator mode, no session)", async () => {
    _operator = false;
    await expect(
      (async () => renderToStaticMarkup(await WixDiagnosticPage()))(),
    ).rejects.toThrow(NotFoundError);
  });

  it("renders the Revert button ONLY for pushed, non-revert ledger rows (#82)", async () => {
    _ledger = [
      {
        id: "p1", tenant_id: "tenant-iranopedia", edit_id: "edit-1",
        target_url: "https://iranopedia.com/a", adapter: "wix_cms",
        pushed_at: "2026-06-11T08:00:00Z", day: "2026-06-11",
        result: "pushed", detail: "field description",
      },
      {
        id: "p2", tenant_id: "tenant-iranopedia", edit_id: "edit-2__revert",
        target_url: "https://iranopedia.com/a", adapter: "wix_cms",
        pushed_at: "2026-06-11T08:10:00Z", day: "2026-06-11",
        result: "pushed", detail: "revert",
      },
      {
        id: "p3", tenant_id: "tenant-iranopedia", edit_id: "edit-3",
        target_url: "https://iranopedia.com/b", adapter: "wix_cms",
        pushed_at: "2026-06-11T08:20:00Z", day: "2026-06-11",
        result: "push_failed", detail: "nope",
      },
    ];
    const html = renderToStaticMarkup(await WixDiagnosticPage());
    const revertButtons = html.match(/>Revert</g) ?? [];
    expect(revertButtons).toHaveLength(1); // only the pushed non-revert row
    expect(html).toContain('value="edit-1"');
    expect(html).not.toContain('value="edit-2__revert"');
  });
});
