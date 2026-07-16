import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const changes = { changes: [{ id: "ready-1" }] };
const today = { today: { cards: [] }, daily: null, hasChanges: true };
const newPages = { opportunities: [], totalCandidates: 0, ownDomain: "iranopedia.com" };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/single-flight", () => ({ runSingleFlight: async (_key: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: async (_id: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("./moves/moves-data", () => ({ refreshWorklistSurface: async () => { calls.push("worklist"); } }));
vi.mock("./changes-data", () => ({ rebuildChangesSurface: async () => { calls.push("changes"); return changes; } }));
vi.mock("./today-view-data", () => ({ buildTodayCompositeFromChanges: async () => { calls.push("today"); return today; } }));
vi.mock("./today-newpages-data", () => ({ buildNewPagesData: async () => { calls.push("new-pages"); return newPages; } }));
vi.mock("./today-surface-store", () => ({ writeTodaySurface: async () => { calls.push("legacy-today-write"); } }));
vi.mock("./customer-surface-store", () => ({ writeCustomerSurface: async () => { calls.push("customer-write"); } }));

import { refreshCustomerSurface } from "./customer-surface-refresh";

describe("refreshCustomerSurface", () => {
  it("hydrates preparation first and publishes the atomic customer release last", async () => {
    calls.length = 0;
    const surface = await refreshCustomerSurface("tenant-iranopedia");
    expect(calls[0]).toBe("worklist");
    expect(calls.indexOf("changes")).toBeLessThan(calls.indexOf("customer-write"));
    expect(calls.indexOf("today")).toBeLessThan(calls.indexOf("customer-write"));
    expect(calls.indexOf("new-pages")).toBeLessThan(calls.indexOf("customer-write"));
    expect(calls.at(-1)).toBe("customer-write");
    expect(surface.releaseId).toContain("tenant-iranopedia:");
    expect(surface.today.surfaceVersion).toBe(surface.releaseId);
    expect(surface.changes).toBe(changes);
    expect(surface.newPages).toBe(newPages);
  });
});
