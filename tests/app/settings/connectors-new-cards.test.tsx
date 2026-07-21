/**
 * Connect-cards slice (2026-06-12) — Clarity self-serve card on
 * /settings/connectors (the END-STATE contract: every data source connects
 * HERE). The Profound card was removed on 2026-07-20 (full account disconnect);
 * this now covers the remaining self-serve key card.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/connectors",
}));

import { ConnectorsClient } from "@/app/(shell)/settings/connectors/connectors-client";
import type { ConnectorInfo } from "@/lib/connector-store";

const off: ConnectorInfo = {
  status: "disconnected",
  connected_at: null,
  expires_at: null,
  last_synced_at: null,
};
const on: ConnectorInfo = { ...off, status: "connected", connected_at: "2026-06-12T00:00:00Z" };

function render(over: Partial<Record<"clarity", ConnectorInfo>> = {}) {
  return renderToStaticMarkup(
    <ConnectorsClient
      google={off}
      googleSelectedLocation={null}
      ga4={off}
      wix={off}
      clarity={over.clarity ?? off}
      gscStaleCopy={null}
      ga4StaleCopy={null}
    />,
  );
}

describe("connectors — self-serve cards", () => {
  it("renders the Clarity card with its key input when disconnected", () => {
    const html = render();
    expect(html).toContain('data-connector-card="clarity"');
    expect(html).toContain("Connect Clarity");
  });

  it("never renders a Profound connector card", () => {
    const html = render({ clarity: on });
    expect(html).not.toContain('data-connector-card="profound"');
    expect(html).not.toContain("Profound");
  });

  it("shows connected state + Disconnect, hides the key form", () => {
    const html = render({ clarity: on });
    expect(html).not.toContain("Connect Clarity");
    const disconnects = html.match(/>Disconnect</g) ?? [];
    expect(disconnects.length).toBeGreaterThanOrEqual(1);
  });
});
