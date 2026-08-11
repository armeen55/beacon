// @vitest-environment jsdom
/** THE BROWSER IS A RECOVERY SURFACE, NOT THE ENGINE (2026-08-02). One global scheduler drives the daily
 *  round now, so the tab-side loop that used to finish the day is gone and what is left has to be honest:
 *  ONE press of Update data is ONE recovery continuation, and Settings carries a pause switch that says
 *  plainly what pausing costs. Two seams are faked (the server actions and the router); zero network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const calls = vi.hoisted(() => ({ continues: [] as number[], refreshes: 0, paused: [] as boolean[], setOk: true }));
vi.mock("@/app/(shell)/settings/connectors/actions", () => ({
  refreshAllConnectedDataNow: async () => ({ ranAt: "2026-08-02T00:00:00.000Z", results: [] }),
  continueResearchNow: async (hop: number) => { calls.continues.push(hop); return { hop: hop + 1, more: true }; },
}));
vi.mock("@/app/(shell)/settings/actions", () => ({
  setResearchPausedNow: async (paused: boolean) => { calls.paused.push(paused); return { ok: calls.setOk }; },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { calls.refreshes += 1; } }) }));

import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";
import { ResearchPause } from "@/app/(shell)/settings/research-pause";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const mount = async (node: ReactElement): Promise<HTMLDivElement> => {
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  await act(async () => { r.render(node); });
  return host;
};
const unmount = async (): Promise<void> => {
  const r = root;
  root = null;
  if (r) await act(async () => { r.unmount(); });
  host?.remove();
  host = null;
};
const press = async (button: HTMLButtonElement): Promise<void> => {
  await act(async () => { button.click(); });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.continues = [];
  calls.refreshes = 0;
  calls.paused = [];
  calls.setOk = true;
});
afterEach(async () => { await unmount(); });

describe("Update data is one recovery press", () => {
  it("asks for exactly ONE continuation per press, whatever the server says is still owed", async () => {
    // THE DEFECT THIS PINS. The press used to drive an eight-hop client loop, because nothing else
    // finished the day. The fixture answers `more: true` every time: a loop would show up here as 8.
    const el = await mount(<RefreshMyDataButton connectedCount={2} />);
    const button = el.querySelector("button")!;
    await press(button);
    expect(calls.continues).toEqual([0]);
    // And a second press is still one continuation, not a fresh loop.
    await press(button);
    expect(calls.continues).toEqual([0, 0]);
  });
  it("says what it does in ONE short sentence, and never that research needs this button or an open tab", async () => {
    const el = await mount(<RefreshMyDataButton connectedCount={2} />);
    const copy = el.textContent ?? "";
    expect(copy).toContain("Pulls your latest numbers now, and the daily round runs on its own either way.");
    expect(copy.split(".").filter((s) => s.trim().length > 0)).toHaveLength(1); // one sentence under the button, never a paragraph
    expect(copy).not.toMatch(/[–—]/);
  });
});

describe("the pause switch over daily research", () => {
  it("renders the running state and pauses on press", async () => {
    const el = await mount(<ResearchPause paused={false} />);
    expect(el.textContent).toContain("Daily research is on.");
    await press(el.querySelector("button")!);
    expect(calls.paused).toEqual([true]);
    expect(el.textContent).toContain("Daily research is paused.");
  });
  it("renders the paused state and resumes on press", async () => {
    const el = await mount(<ResearchPause paused />);
    const button = el.querySelector("button")!;
    expect(button.textContent).toBe("Resume daily research");
    await press(button);
    expect(calls.paused).toEqual([false]);
    expect(el.querySelector("button")!.textContent).toBe("Pause daily research");
  });
  it("says what pausing costs and what it does not, in both states, in Beacon voice", async () => {
    for (const paused of [false, true]) {
      await unmount();
      const copy = (await mount(<ResearchPause paused={paused} />)).textContent ?? "";
      // The one question a customer cannot answer for themselves: do I lose the days I skipped?
      expect(copy).toContain("Paused days stay blank, and research picks up from today.");
      expect(copy).not.toMatch(/[–—]/);
      expect(copy.toLowerCase()).not.toMatch(/experiment|control group|baseline|treatment|serp/);
    }
    // Deleting is the fear pausing raises; the paused state answers it outright.
    await unmount();
    expect((await mount(<ResearchPause paused />)).textContent)
      .toContain("nothing already found was deleted");
  });
  it("keeps the old state on screen when the save fails, and says so", async () => {
    calls.setOk = false;
    const el = await mount(<ResearchPause paused={false} />);
    await press(el.querySelector("button")!);
    // A switch that flips on a failed write is a lie the operator acts on for the rest of the day.
    expect(el.textContent).toContain("Daily research is on.");
    expect(el.textContent).toContain("That could not be saved just now; try again in a minute.");
  });
});
