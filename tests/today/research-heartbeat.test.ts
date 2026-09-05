/** WHAT THE LAST DRIVE LEFT UNDONE REACHES THE PERSON PAYING FOR IT (measured, 2026-09-05). A drive that runs out of time writes the step it could not pay for onto its own run row, and nothing outside the runtime read it: on 2026-09-05 the account's own row carried "Publishing what this day found needs 40 seconds and this drive had 32 left, so nothing was started for it" while Today painted "Read 10 new answers closely today at 10:33 AM." and said nothing about the day's last step. The heartbeat is composed here from the run row's own projection, so a paused day says which step has not run, after how many, and what happens next. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { projectStatusView } from "@/domains/runtime/run-status";

const RUN = vi.hoisted(() => ({ row: null as unknown }));
vi.mock("next/server", () => ({ after: (f: () => unknown) => { void f; } }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-one" }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("./changes-data", () => ({ loadChangesView: async () => ({ proposals: [], ready: [], toDo: [], researching: [], summary: { ready: 0 }, computedAt: null }), sanitizeSurfaceComputedAt: () => null }));
vi.mock("@/app/(shell)/changes-data", () => ({ loadChangesView: async () => ({ proposals: [], ready: [], toDo: [], researching: [], summary: { ready: 0 }, computedAt: null }), sanitizeSurfaceComputedAt: () => null }));
vi.mock("@/app/(shell)/surface-release", () => ({ readCustomerSurface: async () => null, isCustomerSurfaceStale: () => false, refreshCustomerSurface: async () => null }));
vi.mock("@/domains/decision", () => ({ checkBudget: async () => ({ allowed: true }) }));
vi.mock("@/domains/runtime", async () => ({ countTrackedQuestions: async () => 4, researchPermission: async () => "active",
  researchRunStatus: async () => projectStatusView(RUN.row as never, Date.parse("2026-09-05T17:47:00.000Z")) }));
import { loadTodayView } from "@/app/(shell)/today-view-data";

/** TWO SYNTHETIC ACCOUNTS, neither a real customer: the same run shape in two languages of subject, so a sentence that only reads right for one account fails here. */
const SITES = [{ t: "tenant-one", phase: "publish_surface" as const, label: "updating your ranked changes" },
  { t: "tenant-two", phase: "fact_check" as const, label: "checking what your pages claim against outside sources" }] as const;
const run = (over: Record<string, unknown> = {}) => ({ id: "r1", tenant_id: "t", cycle_key: "t:2026-09-05", status: "paused", current_phase: "publish_surface",
  started_at: "2026-09-05T16:00:04.000Z", updated_at: "2026-09-05T17:33:24.196Z", completed_at: null, last_error: null,
  progress: { sourcesRefreshed: 3, funnel: { answersAnalyzed: 10 },
    state: { blocker: "Publishing what this day found needs 40 seconds and this drive had 32 left, so nothing was started for it. The next pass runs it first.", checksDone: 133, checksTotal: 140, checksAnswers: 133 } }, ...over });

describe("Today says what the last drive left undone", () => {
  it.each(SITES)("names the step that has not run, after how many of the day's steps, and what happens next, on $t", async (s) => {
    RUN.row = run({ current_phase: s.phase });
    const line = (await loadTodayView()).researchLiveness ?? "";
    expect(line, "the heartbeat still says what the drive did, and the paused day now says which step it never reached")
      .toBe(`Read 10 new answers closely today at 10:33 AM. Research paused after ${s.phase === "publish_surface" ? 8 : 3} of 9 steps, so ${s.label} has not run yet. The next pass starts there.`);
    expect(renderToStaticMarkup(createElement("p", { "data-research-liveness": "true" }, line)), "and it paints as the one heartbeat element Today already carries")
      .toContain(`${s.label} has not run yet`); });
  it.each(SITES)("says nothing extra on a day that finished its steps, and defers to a recorded reason where one exists, on $t", async (s) => {
    RUN.row = run({ status: "completed", current_phase: "done", completed_at: "2026-09-05T17:33:24.196Z" });
    const finished = (await loadTodayView()).researchLiveness ?? "";
    RUN.row = run({ current_phase: s.phase, last_error: { phase: s.phase, message: "Beacon needs your confirmed business basics before it can read the results pages.", at: "2026-09-05T17:33:24.196Z" } });
    const owned = (await loadTodayView()).researchLiveness ?? "";
    expect([finished.includes("has not run yet"), owned.endsWith("Beacon needs your confirmed business basics before it can read the results pages."), owned.includes(`${s.label} has not run yet`)],
      "a finished day carries no unrun step, and a pause that recorded its own reason says that reason rather than a made-up next step").toEqual([false, true, true]); });
});
