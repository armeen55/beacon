import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { writeStore } from "@/lib/persistence/json-store";
import { _resetExitGatesStoreForTests } from "@/lib/exit-gates-store";

const mockPathname = vi.fn(() => "/settings/config");

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

describe("ExitGatesSettingsHint", () => {
  beforeEach(async () => {
    mockPathname.mockReturnValue("/settings/config");
    await _resetExitGatesStoreForTests();
  });

  afterEach(async () => {
    await _resetExitGatesStoreForTests();
  });

  it("renders nothing when all gates passed", async () => {
    await writeStore("exit-gates", [
      {
        key: "daily_ritual",
        status: "passed",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
      {
        key: "replication",
        status: "passed",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
      {
        key: "local_layer",
        status: "passed",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
    ]);
    const { ExitGatesSettingsHint } = await import(
      "@/app/(shell)/settings/exit-gates-settings-hint"
    );
    const tree = await ExitGatesSettingsHint();
    expect(tree).toBeNull();
  });

  it("renders hint when engaged and a gate is not passed", async () => {
    await writeStore("exit-gates", [
      {
        key: "daily_ritual",
        status: "in_review",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
      {
        key: "replication",
        status: "not_started",
        note: "",
        updated_at: "1970-01-01T00:00:00.000Z",
      },
      {
        key: "local_layer",
        status: "passed",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
    ]);
    const { ExitGatesSettingsHint } = await import(
      "@/app/(shell)/settings/exit-gates-settings-hint"
    );
    const tree = await ExitGatesSettingsHint();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("Readiness review");
    expect(html).toContain("Internal sign-off");
    expect(html).toContain("freshness states");
    expect(html).toContain("Daily Ritual");
    expect(html).toContain("Replication");
    expect(html).not.toContain("Local layer");
    expect(html).toContain("/settings/exit-gates");
  });

  it("renders hint on Sign-offs page when Local layer is not passed even if other gates are passed", async () => {
    mockPathname.mockReturnValue("/settings/exit-gates");
    await writeStore("exit-gates", [
      {
        key: "daily_ritual",
        status: "passed",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
      {
        key: "replication",
        status: "passed",
        note: "",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
      {
        key: "local_layer",
        status: "not_started",
        note: "",
        updated_at: "1970-01-01T00:00:00.000Z",
      },
    ]);
    const { ExitGatesSettingsHint } = await import(
      "@/app/(shell)/settings/exit-gates-settings-hint"
    );
    const tree = await ExitGatesSettingsHint();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("Local layer");
    expect(html).toContain("not started");
  });
});
