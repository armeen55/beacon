"use client";

import { useActionState } from "react";

import {
  registerBlindHoldoutAction,
  type RegisterBlindHoldoutState,
} from "./actions";

const INITIAL_STATE: RegisterBlindHoldoutState = { ok: false, message: "" };

/** One internal evidence-registration control. This is deliberately absent from
 * customer surfaces: ordinary Beacon use never asks a SaaS user to run an eval. */
export function BlindHoldoutForm() {
  const [state, action, pending] = useActionState(
    registerBlindHoldoutAction,
    INITIAL_STATE,
  );
  return (
    <form action={action} className="mt-4 space-y-2">
      <label htmlFor="blind-holdout-receipt" className="block text-meta font-medium">
        Register independently produced receipt JSON
      </label>
      <textarea
        id="blind-holdout-receipt"
        name="receipt"
        required
        rows={6}
        spellCheck={false}
        className="w-full rounded-md border border-border/50 bg-bg/50 p-3 font-mono text-xs"
        placeholder='{"candidateSha":"…","cases":[…]}'
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Checking…" : "Register receipt"}
        </button>
        {state.message ? (
          <p
            role="status"
            className={state.ok ? "text-meta text-status-success" : "text-meta text-status-warning"}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
