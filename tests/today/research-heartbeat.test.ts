import { describe, expect, it, vi } from "vitest";
import { projectStatusView } from "@/domains/runtime/run-status";

const RUN = vi.hoisted(() => ({ row: null as unknown, permission: "running" }));
vi.mock("next/server", () => ({ after: (f: () => unknown) => { void f; } }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-one" }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("./changes-data", () => ({ loadChangesView: async () => ({ proposals: [], ready: [], toDo: [], researching: [], summary: { ready: 0 }, computedAt: null }), sanitizeSurfaceComputedAt: () => null }));
vi.mock("@/app/(shell)/changes-data", () => ({ loadChangesView: async () => ({ proposals: [], ready: [], toDo: [], researching: [], summary: { ready: 0 }, computedAt: null }), sanitizeSurfaceComputedAt: () => null }));
vi.mock("@/app/(shell)/surface-release", () => ({ readCustomerSurface: async () => null, isCustomerSurfaceStale: () => false, refreshCustomerSurface: async () => null }));
vi.mock("@/domains/decision", () => ({ checkBudget: async () => ({ allowed: true }) }));
vi.mock("@/domains/runtime", async () => ({ countTrackedQuestions: async () => 4, researchPermission: async () => RUN.permission,
  researchRunStatus: async () => projectStatusView(RUN.row as never, Date.parse("2026-09-05T17:47:00.000Z")) }));
import { loadTodayView } from "@/app/(shell)/today-view-data";

const SITES = [{ t: "tenant-one", phase: "publish_surface" as const, label: "updating your ranked changes" },
  { t: "tenant-two", phase: "fact_check" as const, label: "checking what your pages claim against outside sources" }] as const;
const run = (over: Record<string, unknown> = {}) => ({ id: "r1", tenant_id: "t", cycle_key: "t:2026-09-05", status: "paused", current_phase: "publish_surface",
  started_at: "2026-09-05T16:00:04.000Z", updated_at: "2026-09-05T17:33:24.196Z", completed_at: null, last_error: null,
  progress: { sourcesRefreshed: 3, funnel: { answersAnalyzed: 10 },
    state: { blocker: "Publishing what this day found needs 40 seconds and this drive had 32 left, so nothing was started for it. The next pass runs it first.", checksDone: 133, checksTotal: 140, checksAnswers: 133 } }, ...over });

it("does not promise continuation after operator pause or a missed dispatch", async () => {
  RUN.row = run(); RUN.permission = "paused"; expect((await loadTodayView()).researchLiveness).toBeUndefined(); RUN.permission = "running";
  const row = run(); expect(projectStatusView(row as never, Date.parse(row.updated_at) + 30 * 60_000).state).toBe("queued");
  expect(projectStatusView(row as never, Date.parse(row.updated_at) + 45 * 60_000).state).toBe("paused");
});
describe("Today says what the last drive left undone", () => {
  it.each(SITES)("names the step that has not run, after how many of the day's steps, and what happens next, on $t", async (s) => {
    RUN.row = run({ current_phase: s.phase });
    const line = (await loadTodayView()).researchLiveness ?? "";
    expect(line, "the heartbeat still says what the drive did, the paused day says which step it never reached, and the step it could not pay for is said in the drive's own words with its own seconds instead of a made-up next step")
      .toBe(`Read 10 new answers closely today at 10:33 AM. Research continues from ${s.label} on the next pass. Publishing what this day found needs 40 seconds and this drive had 32 left, so nothing was started for it. The next pass runs it first.`);
    });
  it.each(SITES)("tells the drive giving up on a running walk apart from a step it never started, on $t", async (s) => {
    const boxed = { replenish: { day: "2026-09-05", jobs: {}, outcomes: { readySaved: 0, evidenceBanked: 0, refused: 0, blocked: 1, unreached: 1, stuck: [], ended: "boxed" as const } } };
    RUN.row = run({ current_phase: s.phase, progress: { ...run().progress, ...boxed } });
    const both = (await loadTodayView()).researchLiveness ?? "";
    expect(both, "both facts are said, each in its own sentence, and the one about work still owed comes first").toContain(
      "Writing your changes was still running when this drive's time ran out, so what it had already spent is remembered and the rest is owed again at its own rank. The next pass picks it up there. Publishing what this day found needs 40 seconds");
    RUN.row = run({ current_phase: s.phase, progress: { sourcesRefreshed: 3, funnel: { answersAnalyzed: 10 }, state: { checksDone: 133, checksTotal: 140, checksAnswers: 133 }, ...boxed } });
    const alone = (await loadTodayView()).researchLiveness ?? "";
    expect([alone.includes("still running when this drive's time ran out"), alone.includes("nothing was started for it")],
      "and a drive that started everything it planned and only stopped waiting says that alone, with no invented second fact").toEqual([true, false]); });
  it.each(SITES)("says how many pages winning a search already bought are owed a read, and says nothing where none are, on $t", async (s) => {
    const owed = async (n: number) => { RUN.row = run({ current_phase: s.phase, progress: { ...run().progress, state: { ...(run().progress.state as Record<string, unknown>), winnersUnranked: n } } }); return (await loadTodayView()).researchLiveness ?? ""; };
    const [many, one, none] = [await owed(9), await owed(1), await owed(0)];
    expect([many.includes("9 pages winning a search already bought are owed a read. The next pass reads them."), one.includes("1 page winning a search already bought is owed a read. The next pass reads it."), none.includes("owed a read")], "the count is the pages the next pass will read, said in plain words with what happens next, and a day owing none says nothing at all rather than a bare zero").toEqual([true, true, false]); });
  it.each(SITES)("says nothing extra on a day that finished its steps, and defers to a recorded reason where one exists, on $t", async (s) => {
    RUN.row = run({ status: "completed", current_phase: "done", completed_at: "2026-09-05T17:33:24.196Z" });
    const finished = (await loadTodayView()).researchLiveness ?? "";
    RUN.row = run({ current_phase: s.phase, last_error: { phase: s.phase, message: "Beacon needs your confirmed business basics before it can read the results pages.", at: "2026-09-05T17:33:24.196Z" } });
    const owned = (await loadTodayView()).researchLiveness ?? "";
    expect([finished.includes("has not run yet"), owned.endsWith("Beacon needs your confirmed business basics before it can read the results pages."), owned.includes(`${s.label} has not run yet`)],
      "a finished day carries no unrun step, and a pause that recorded its own reason says that reason rather than a made-up next step").toEqual([false, true, true]); });
});
