"use client";

/**
 * launch-button — finish-setup control on the first-audit scorecard
 * (Core 100K minimal onboarding).
 *
 * Replaces the retired multi-step review wizard. One consent checkbox +
 * one Launch button. Submitting calls `launchTenant`, which persists the
 * minimal config, seeds starter prompts, flips the tenant to 'active', and
 * redirects to the dashboard. Server-side `launchTenant` re-validates the
 * TOS bit so a tampered client cannot bypass it.
 */

import { useState, useTransition } from "react";
import { launchTenant } from "./actions";

export function LaunchButton() {
  const [tosAccepted, setTosAccepted] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTopError(null);
    if (!tosAccepted) return;
    startTransition(async () => {
      try {
        const r = await launchTenant({ tosAccepted });
        if (!r.ok) {
          setTopError(humanizeError(r.error));
        }
        // success → server action redirects('/') which throws
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
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-foreground/15 p-4 space-y-3"
      noValidate
    >
      <p className="text-[13px] font-medium">Start daily tracking</p>
      <p className="text-[13px] text-muted-foreground">
        I will begin checking whether AI assistants recommend you and hand you
        a daily worklist of changes worth making.
      </p>

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
          Start tracking my site. I can edit or pause anything anytime.
        </span>
      </label>

      {topError ? (
        <p className="text-[13px] text-rose-600" role="alert">
          {topError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!tosAccepted || isPending}
        className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Starting…" : "Start tracking"}
      </button>
    </form>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case "tos_not_accepted":
      return "Please check the box above to start.";
    case "not_authenticated":
      return "Your session expired. Sign in again to continue.";
    case "no_tenant":
      return "I could not find your account. Try signing in again.";
    case "tenant_fetch_failed":
    case "tenant_missing":
      return "I hit a temporary issue loading your account. Try again.";
    case "no_prompts_generated":
      return "Add your business name first, then start tracking.";
    case "config_persist_failed":
      return "I could not save your setup just now. Try again in a moment.";
    case "membership_lookup_failed":
      return "I hit a temporary issue. Try again in a moment.";
    case "existing_prompts_fetch_failed":
    case "prompt_insert_failed":
    case "tenant_activation_failed":
      return "Something went wrong starting. Try again — I will pick up where we left off.";
    default:
      if (code.startsWith("tenant_invalid_status:")) {
        return "Your account is in a state I cannot auto-start. Contact support.";
      }
      return "Something went wrong. Try again.";
  }
}
