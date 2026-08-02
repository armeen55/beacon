"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { researchTickNow } from "@/app/(shell)/settings/connectors/actions";

/**
 * KeepResearching (V1 closure, 2026-08-01) - the shell's continuation controller.
 *
 * THE PROBLEM IT EXISTS FOR. A visit scheduled exactly ONE post-response research pass, and the loop that
 * keeps asking for the next one lived behind the Update data button. So the operator who opened Beacon and
 * left it open got one pass and silence, and the only way to finish the day's research was to keep pressing
 * a button. Now the open tab asks for itself.
 *
 * IT IS DELIBERATELY DUMB. It holds no truth: it asks the server "is there work, and please continue", and
 * repaints. Every bound that matters is server-counted on the account's own row (the day's continuations,
 * the day's passes, the durable lease that makes two tabs safe), so nothing here can be gamed by a stale
 * browser, a duplicated component, or a second window.
 *
 * WHAT IT WILL NOT DO. No cron and no queue. No interval under fifteen seconds. Never more than ONE request
 * in flight, and never a request at all while the tab is hidden. Past its own per-page-view ceiling it stops
 * asking even if the server would keep answering.
 */

/** The first ask lands after the shell paints, never in the seconds around it: the visit's own
 *  post-response pass is usually still working, and this is a watcher, not a second engine. */
const FIRST_DELAY_MS = 20_000;
/** More work is owed and the server just took a hop: ask again at the base interval. */
const CONTINUE_DELAY_MS = 30_000;
/** Nothing to ask for yet (a pass is already advancing the run): back off, doubling, to this ceiling. */
const WAIT_MIN_MS = 45_000;
const WAIT_MAX_MS = 180_000;
/** The hard ceiling on how many times ONE page view may ask, whatever the server keeps answering. */
const MAX_TICKS_PER_VIEW = 12;
/** How long the browser waits for ONE answer before it stops waiting. A server action that never settles (a
 *  killed lambda, a dropped connection) left the in-flight flag set for the life of the page view, because
 *  the line that cleared it sat after the await: the loop went silent and only a reload brought it back. A
 *  request that misses this deadline is answered as a wait, so the backoff applies and the tab asks again. */
const REQUEST_DEADLINE_MS = 45_000;

type TickAnswer = "continue" | "wait" | "stop";
/** What one request came back with, or null when it came back with nothing usable. */
type Answer = Awaited<ReturnType<typeof researchTickNow>> | null;
type LoopState = { ticks: number; waits: number; delayMs: number; stopped: boolean };

/** A fresh page view's loop state. */
export const LOOP_START: LoopState = { ticks: 0, waits: 0, delayMs: FIRST_DELAY_MS, stopped: false };

/** PURE: may this page view ask right now? A hidden tab never asks, a stopped loop never asks again, and
 *  the per-view ceiling holds even if every answer says there is more. */
export function shouldAsk(state: LoopState, visible: boolean): boolean {
  return visible && !state.stopped && state.ticks < MAX_TICKS_PER_VIEW;
}

/** PURE: the whole cadence policy, from the answer the server just gave. `stop` is terminal for this page
 *  view (work complete, a pause the operator must clear, or the day's bound spent). A failed request is
 *  treated as a wait: back off, never hammer. */
export function afterTick(state: LoopState, answer: TickAnswer): LoopState {
  const ticks = state.ticks + 1;
  if (answer === "stop" || ticks >= MAX_TICKS_PER_VIEW) return { ...state, ticks, stopped: true };
  if (answer === "continue") return { ticks, waits: 0, delayMs: CONTINUE_DELAY_MS, stopped: false };
  const waits = state.waits + 1;
  return { ticks, waits, delayMs: Math.min(WAIT_MIN_MS * 2 ** (waits - 1), WAIT_MAX_MS), stopped: false };
}

export function KeepResearching() {
  const router = useRouter();
  const loop = useRef<LoopState>(LOOP_START);
  const hop = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const visible = () => document.visibilityState === "visible";
    // Only the SCHEDULING timer: the request deadline belongs to the request in flight, and a hidden tab
    // cancelling it would put the wedge straight back (nothing left to answer a promise that never settles).
    const clear = () => {
      if (timer.current != null) clearTimeout(timer.current);
      timer.current = null;
    };
    const schedule = (ms: number) => {
      clear();
      if (live && shouldAsk(loop.current, visible())) timer.current = setTimeout(() => void tick(), ms);
    };
    /** ONE request, bounded by the client's own clock. "late" is a request that never came back at all,
     *  which is a different thing from one that came back with nothing: there is no fresh persisted state
     *  behind it, so it earns a backoff and no repaint. */
    const ask = async (): Promise<Answer | "late"> => {
      const missed = new Promise<"late">((resolve) => { deadline = setTimeout(() => resolve("late"), REQUEST_DEADLINE_MS); });
      try { return await Promise.race([researchTickNow(hop.current).catch(() => null), missed]); }
      finally { if (deadline != null) clearTimeout(deadline); deadline = null; }
    };
    async function tick() {
      timer.current = null;
      if (!live || inFlight.current || !shouldAsk(loop.current, visible())) return;
      inFlight.current = true;
      // THE FLAG IS CLEARED WHATEVER HAPPENS. It used to be cleared on the line after the await, so one
      // request that never settled wedged the loop for the whole page view.
      let answer: Answer | "late";
      try { answer = await ask(); } finally { inFlight.current = false; }
      if (!live) return;
      const settled = answer !== "late" ? answer : null;
      if (settled) hop.current = settled.hop;
      loop.current = afterTick(loop.current, settled?.next ?? "wait");
      // The status the operator is watching is read off the persisted run, so the repaint IS the point of
      // asking: today's numbers advance while the tab sits open, with no refresh and no button.
      if (answer !== "late") router.refresh();
      schedule(loop.current.delayMs);
    }
    const onVisibility = () => (visible() ? schedule(loop.current.delayMs) : clear());
    document.addEventListener("visibilitychange", onVisibility);
    schedule(FIRST_DELAY_MS);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisibility);
      clear();
      if (deadline != null) clearTimeout(deadline);
      deadline = null;
    };
  }, [router]);

  return null;
}
