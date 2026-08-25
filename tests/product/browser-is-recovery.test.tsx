// @vitest-environment jsdom
/** THE BROWSER IS A RECOVERY SURFACE, NOT THE ENGINE (2026-08-02). One global scheduler drives the daily round now, so the tab-side loop that used to finish the day is gone and what is left has to be honest: ONE press of Update data is ONE recovery continuation, and Settings carries a pause switch that says plainly what pausing costs. Two seams are faked (the server actions and the router); zero network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
const calls = vi.hoisted(() => ({ continues: [] as number[], refreshes: 0, paused: [] as boolean[], setOk: true, more: true }));
vi.mock("@/app/(shell)/settings/connectors/actions", () => ({
  refreshAllConnectedDataNow: async () => ({ ranAt: "2026-08-02T00:00:00.000Z", results: [] }),
  continueResearchNow: async (hop: number) => { calls.continues.push(hop); return { hop: hop + 1, more: calls.more }; },
}));
vi.mock("@/app/(shell)/settings/actions", () => ({
  setResearchPausedNow: async (paused: boolean) => { calls.paused.push(paused); return { ok: calls.setOk }; } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { calls.refreshes += 1; } }) }));
import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";
import { ResearchPause } from "@/app/(shell)/settings/research-pause";
let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = async (node: ReactElement): Promise<HTMLDivElement> => {
  host = document.createElement("div"); document.body.appendChild(host);
  const r = createRoot(host); root = r;
  await act(async () => { r.render(node); });
  return host;
};
const unmount = async (): Promise<void> => {
  const r = root; root = null;
  if (r) await act(async () => { r.unmount(); });
  host?.remove(); host = null;
};
const press = async (button: HTMLButtonElement): Promise<void> => { await act(async () => { button.click(); }); };
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.continues = []; calls.refreshes = 0; calls.paused = []; calls.setOk = true; });
afterEach(async () => { await unmount(); });
describe("Update data is one recovery press", () => {
  it("continues while the server says more is owed, and stops the moment it says otherwise", async () => {
    // THE DEFECT THIS PINS, reversed on 2026-08-25: one hop of six left five sixths of the day owed while the button reported the same success either way. The SERVER still owns the bound (the fixture's `more: true` is capped by the client at six asks, the server's own per-day allowance), and a server that answers `more: false` ends the press at once.
    const el = await mount(<RefreshMyDataButton connectedCount={2} />); const button = el.querySelector("button")!;
    await press(button); expect(calls.continues).toEqual([0, 1, 2, 3, 4, 5]); // more:true throughout: the press works the day down to the server's own ceiling
    calls.continues.length = 0; calls.more = false;
    await press(button); expect(calls.continues).toEqual([0]); // nothing more owed: one ask, immediate stop
  });
  it("says what it does in ONE short sentence, and never that research needs this button or an open tab", async () => {
    const el = await mount(<RefreshMyDataButton connectedCount={2} />); const copy = el.textContent ?? "";
    expect(copy).toContain("Pulls your latest numbers now, and the daily round runs on its own either way.");
    expect(copy.split(".").filter((s) => s.trim().length > 0)).toHaveLength(1); // one sentence under the button, never a paragraph
    expect(copy).not.toMatch(/[–—]/);
  });
});
describe("the pause switch over daily research", () => {
  it("renders the running state and pauses on press", async () => {
    const el = await mount(<ResearchPause permission="running" />); expect(el.textContent).toContain("Daily research is on."); await press(el.querySelector("button")!);
    expect([calls.paused, el.textContent?.includes("Daily research is paused.")]).toEqual([[true], true]);
  });
  it("renders the paused state and resumes on press", async () => {
    const el = await mount(<ResearchPause permission="paused" />); const button = el.querySelector("button")!; expect(button.textContent).toBe("Resume daily research"); await press(button);
    expect([calls.paused, el.querySelector("button")!.textContent]).toEqual([[false], "Pause daily research"]);
  });
  // A STATE THAT COULD NOT BE READ IS ITS OWN STATE. Rendering the switch as on or paused there is a claim about whether money is being spent right now, made out of a failed read, and a toggle under it invites the operator to "fix" a setting nobody can see.
  it("says the status could not be checked when the state is unreadable, and offers no toggle to guess with", async () => {
    const el = await mount(<ResearchPause permission="unreadable" />); const copy = el.textContent ?? "";
    expect(copy).toContain("The daily research setting could not be checked just now, so neither state is shown. Reload Settings in a minute to check it again.");
    expect(copy).not.toContain("Daily research is on."); expect(copy).not.toContain("Daily research is paused."); expect(el.querySelector("button")).toBeNull();
    expect(copy).not.toMatch(/[–—]/); expect(copy.toLowerCase()).not.toMatch(/\bi\b|\bmy\b|experiment|control group|baseline|treatment|serp/);
  });
  // The one question a customer cannot answer for themselves: do I lose the days I skipped? And deleting is the fear pausing raises, so the paused state answers that outright.
  it("says what pausing costs and what it does not, in both live states, in Beacon voice", async () => {
    for (const permission of ["running", "paused"] as const) {
      await unmount(); const copy = (await mount(<ResearchPause permission={permission} />)).textContent ?? ""; expect(copy).toContain("Paused days stay blank, and research picks up from today.");
      expect(copy).not.toMatch(/[–—]/); expect(copy.toLowerCase()).not.toMatch(/experiment|control group|baseline|treatment|serp/);
    }
    await unmount(); expect((await mount(<ResearchPause permission="paused" />)).textContent).toContain("nothing already found was deleted");
  });
  it("keeps the old state on screen when the save fails, and says so", async () => {
    calls.setOk = false; const el = await mount(<ResearchPause permission="running" />); await press(el.querySelector("button")!);
    // A switch that flips on a failed write is a lie the operator acts on for the rest of the day.
    expect(el.textContent).toContain("Daily research is on."); expect(el.textContent).toContain("That could not be saved just now; try again in a minute.");
  });
});
