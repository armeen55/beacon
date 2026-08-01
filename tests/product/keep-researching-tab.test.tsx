// @vitest-environment jsdom
/** THE OPEN TAB'S CONTROLLER, RUN (V1 closure repair). The cadence policy is pinned as pure functions next
 *  door; this runs the component itself, because everything that actually keeps an operator's research
 *  moving lives in the effect: when the first ask lands, that only ONE is ever in flight, that a hidden tab
 *  asks nothing, that the answer repaints the surface, and that closing the page leaves no timer behind.
 *  Only two seams are faked: the server action and the router. Zero network, zero server module. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

type Answer = { hop: number; next: "continue" | "wait" | "stop" };
const seam = vi.hoisted(() => ({
  hops: [] as number[],
  answer: { hop: 1, next: "continue" } as Answer,
  /** When set, the action HANGS until it is called: what "one request in flight" is measured against. */
  hold: null as null | ((a: Answer) => void),
}));
vi.mock("@/app/(shell)/settings/connectors/actions", () => ({
  researchTickNow: async (hop: number): Promise<Answer> => {
    seam.hops.push(hop);
    if (seam.hold === null) return seam.answer;
    return new Promise<Answer>((resolve) => { seam.hold = resolve; });
  },
}));
const router = vi.hoisted(() => ({ refreshes: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { router.refreshes += 1; } }) }));

import { KeepResearching } from "@/components/shell/keep-researching";

const FIRST_DELAY_MS = 20_000;
const CONTINUE_DELAY_MS = 30_000;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let visibility: "visible" | "hidden" = "visible";

const mount = async (): Promise<void> => {
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  await act(async () => { r.render(<KeepResearching />); });
};
const unmount = async (): Promise<void> => {
  const r = root;
  root = null;
  if (r) await act(async () => { r.unmount(); });
  host?.remove();
  host = null;
};
/** Move the clock and let every promise the tick awaited settle, inside one act pass. */
const wait = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const setVisibility = async (next: "visible" | "hidden"): Promise<void> => {
  visibility = next;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  visibility = "visible";
  seam.hops = [];
  seam.answer = { hop: 1, next: "continue" };
  seam.hold = null;
  router.refreshes = 0;
  vi.useFakeTimers();
});
afterEach(async () => { await unmount(); vi.useRealTimers(); });

describe("the tab that keeps the research going", () => {
  it("asks nothing until the shell has painted, then asks once and repaints on the answer", async () => {
    await mount();
    await wait(FIRST_DELAY_MS - 1);
    // The visit's own post-response pass is usually still working; a watcher that asked immediately would
    // spend the day's allowance racing a lease it cannot win.
    expect([seam.hops.length, router.refreshes]).toEqual([0, 0]);
    await wait(1);
    expect(seam.hops).toEqual([0]);
    // The status the operator is watching is read off the persisted run, so the repaint IS the point.
    expect(router.refreshes).toBe(1);
    // The server owns the hop count, and the next ask carries back what the server said.
    await wait(CONTINUE_DELAY_MS);
    expect(seam.hops).toEqual([0, 1]);
  });

  it("never lets a second request start while one is still in flight", async () => {
    seam.hold = () => {};
    await mount();
    await wait(FIRST_DELAY_MS);
    expect(seam.hops).toHaveLength(1); // asked, and still waiting for the answer
    // Everything that could start another one: the tab coming back, and a long stretch of clock.
    await setVisibility("hidden");
    await setVisibility("visible");
    await wait(10 * 60_000);
    expect(seam.hops).toHaveLength(1);
    expect(router.refreshes).toBe(0); // and nothing repaints off an answer that has not arrived
  });

  it("stops asking the moment the tab is hidden, and picks up again when it is looked at", async () => {
    await mount();
    await wait(FIRST_DELAY_MS);
    expect(seam.hops).toHaveLength(1);
    await setVisibility("hidden");
    await wait(10 * 60_000);
    expect(seam.hops).toHaveLength(1); // a tab nobody is looking at costs this account nothing
    await setVisibility("visible");
    await wait(CONTINUE_DELAY_MS);
    expect(seam.hops).toHaveLength(2);
  });

  it("stops for the rest of the page view when the server says stop", async () => {
    seam.answer = { hop: 4, next: "stop" };
    await mount();
    await wait(FIRST_DELAY_MS);
    expect(seam.hops).toEqual([0]);
    await wait(30 * 60_000);
    expect(seam.hops).toEqual([0]);
  });

  it("leaves no timer and makes no request after the operator navigates away", async () => {
    await mount();
    await wait(FIRST_DELAY_MS);
    expect(seam.hops).toHaveLength(1);
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
    await wait(10 * 60_000);
    expect(seam.hops).toHaveLength(1);
  });

  it("is mounted by the shell, so every page of the app keeps the research going", () => {
    // The controller can be perfect and reach nobody: the mount is the whole delivery mechanism, and it is
    // one JSX tag in a server layout that no rendered test in this suite can reach.
    const layout = readFileSync("src/app/(shell)/layout.tsx", "utf8");
    expect(layout).toContain("<KeepResearching />");
  });
});
