"use client";

/**
 * launch-form — Gap C.4 (2026-05-07).
 *
 * Step 4 of the onboarding wizard: TOS acceptance + Launch button.
 *
 * Submitting calls `launchTenant` server action which:
 *   - inserts the generated starter prompts into tracked_prompts
 *   - flips tenants.status from 'pending_onboarding' to 'active'
 *   - sets tos_accepted_at
 *   - redirects to /today
 *
 * The button is disabled until the operator checks the consent box.
 * Server-side `launchTenant` re-validates the TOS bit so a tampered
 * client cannot bypass.
 */

import { useState, useTransition } from "react";
import { launchTenant } from "./actions";

export function LaunchForm({ promptCount }: { promptCount: number }) {
  const [tosAccepted, setTosAccepted] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canLaunch = promptCount > 0 && tosAccepted;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTopError(null);
    if (!canLaunch) return;
    startTransition(async () => {
      try {
        const r = await launchTenant({ tosAccepted });
        if (!r.ok) {
          setTopError(humanizeError(r.error));
        }
        // success → server action calls redirect('/today') which throws
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "digest" in err &&
          typeof (err as { digest?: unknown }).digest === "string" &&
          (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
        ) {
          throw err;
        }
        setTopError("Something went wrong. Try again in a moment.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <label
        className={
          "flex items-start gap-3 rounded-md border px-3 py-3 text-[13px] cursor-pointer transition-colors " +
          (tosAccepted
            ? "border-foreground bg-foreground/5"
            : "border-foreground/15 hover:border-foreground/30")
        }
      >
        <input
          type="checkbox"
          checked={tosAccepted}
          onChange={(e) => setTosAccepted(e.target.checked)}
          className="mt-0.5 accent-foreground"
        />
        <span>
          I agree that Beacon will start tracking these prompts the next
          time I refresh my connected data. I can edit or pause them anytime.
        </span>
      </label>

      {promptCount === 0 ? (
        <p className="text-[13px] text-rose-600" role="alert">
          We need at least one prompt to launch. Go back and add a city,
          service, or business name.
        </p>
      ) : null}

      {topError ? (
        <p className="text-[13px] text-rose-600" role="alert">
          {topError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canLaunch || isPending}
        className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Launching…" : "Launch Beacon"}
      </button>
    </form>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case "tos_not_accepted":
      return "Please check the box above to launch.";
    case "not_authenticated":
      return "Your session expired. Sign in again to continue.";
    case "no_tenant":
      return "We couldn't find your account. Try signing in again.";
    case "tenant_fetch_failed":
    case "tenant_missing":
      return "We hit a temporary issue loading your account. Try again.";
    case "no_prompts_generated":
      return "Add at least one city, service, or business name first.";
    case "membership_lookup_failed":
      return "We hit a temporary issue. Try again in a moment.";
    case "existing_prompts_fetch_failed":
    case "prompt_insert_failed":
    case "tenant_activation_failed":
      return "Something went wrong launching. Try again — we'll pick up where we left off.";
    default:
      if (code.startsWith("tenant_invalid_status:")) {
        return "Your account is in a state we can't auto-launch. Contact support.";
      }
      return "Something went wrong. Try again.";
  }
}
