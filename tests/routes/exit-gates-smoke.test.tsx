import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { _resetExitGatesStoreForTests } from "@/lib/exit-gates-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/exit-gates",
}));

describe("Exit gates settings route smoke", () => {
  beforeEach(async () => {
    await _resetExitGatesStoreForTests();
  });

  afterEach(async () => {
    await _resetExitGatesStoreForTests();
  });

  it("renders sign-off page with both gates and actions", async () => {
    const { default: ExitGatesPage } = await import("@/app/(shell)/settings/exit-gates/page");
    const tree = await ExitGatesPage();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("Internal sign-off");
    expect(html).toContain("does not affect underlying metrics");
    expect(html).toContain("freshness states");
    expect(html).toContain("Daily Ritual");
    expect(html).toContain("Replication");
    expect(html).toContain("Local layer (Track 1.4)");
    expect(html).toContain("Review checklist");
    expect(html).toContain("Per-source timestamps are understandable");
    expect(html).toContain("Mark in review");
    expect(html).toContain("Mark passed");
    expect(html).toContain("Mark failed");
    expect(html).toContain("Save note");
    expect(html).toContain('data-testid="exit-gate-card-daily_ritual"');
    expect(html).toContain('data-testid="exit-gate-card-replication"');
    expect(html).toContain('data-testid="exit-gate-card-local_layer"');
    expect(html).toContain('data-testid="exit-gate-checklist-local_layer"');
  });
});
