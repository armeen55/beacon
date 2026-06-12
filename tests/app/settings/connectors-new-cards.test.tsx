/**
 * Connect-cards slice (2026-06-12) — SEMrush / Profound / Clarity
 * self-serve cards on /settings/connectors (the END-STATE contract:
 * every data source connects HERE).
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

function render(over: Partial<Record<"semrush" | "profound" | "clarity", ConnectorInfo>> = {}) {
  return renderToStaticMarkup(
    <ConnectorsClient
      google={off}
      googleSelectedLocation={null}
      ga4={off}
      yelp={off}
      wix={off}
      semrush={over.semrush ?? off}
      profound={over.profound ?? off}
      clarity={over.clarity ?? off}
      configYelpBusinessId=""
      gscStaleCopy={null}
      ga4StaleCopy={null}
    />,
  );
}

describe("connectors — new self-serve cards", () => {
  it("renders all three cards with key inputs when disconnected", () => {
    const html = render();
    expect(html).toContain('data-connector-card="semrush"');
    expect(html).toContain('data-connector-card="profound"');
    expect(html).toContain('data-connector-card="clarity"');
    expect(html).toContain("Connect Semrush");
    expect(html).toContain("Connect Profound");
    expect(html).toContain("Connect Clarity");
  });

  it("shows connected state + Disconnect, hides the key form", () => {
    const html = render({ semrush: on, profound: on, clarity: on });
    expect(html).not.toContain("Connect Semrush");
    expect(html).not.toContain("Connect Profound");
    expect(html).not.toContain("Connect Clarity");
    const disconnects = html.match(/>Disconnect</g) ?? [];
    expect(disconnects.length).toBeGreaterThanOrEqual(3);
  });
});
