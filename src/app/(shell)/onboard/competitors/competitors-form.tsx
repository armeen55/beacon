"use client";

/**
 * competitors-form — Gap C.3 (2026-05-07).
 *
 * Step 3 of the onboarding wizard: 1-5 competitors the operator wants
 * Beacon to compare them against.
 *
 * Field semantics: COMPANY NAMES, not URLs. The validator rejects
 * URL-shaped tokens with a clear error message.
 *
 * On submit, calls saveCompetitorsProfile server action which redirects
 * to /onboard/review. Per-field errors render inline.
 */

import { useState, useTransition } from "react";
import { COMPETITORS_MAX_COUNT } from "@/domains/onboarding/competitors-validation";
import { saveCompetitorsProfile } from "./actions";

type FieldErrors = { competitors?: string };

export function CompetitorsForm({
  initialCompetitors,
}: {
  initialCompetitors: string[];
}) {
  const [competitorsText, setCompetitorsText] = useState<string>(
    initialCompetitors.join("\n"),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setTopError(null);
    startTransition(async () => {
      try {
        const r = await saveCompetitorsProfile({ competitors: competitorsText });
        if (!r.ok) {
          if (r.fieldErrors) setFieldErrors(r.fieldErrors);
          setTopError(humanizeError(r.error));
        }
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
        setTopError("Something went wrong saving. Try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label
          htmlFor="competitors"
          className="block text-[13px] font-medium"
        >
          Competitors to compare you against{" "}
          <span className="font-normal text-muted-foreground">
            (optional — Beacon also discovers your real rivals automatically
            once tracking starts)
          </span>
        </label>
        <textarea
          id="competitors"
          name="competitors"
          rows={5}
          value={competitorsText}
          onChange={(e) => setCompetitorsText(e.target.value)}
          placeholder={
            "Competitor One\nCompetitor Two\nCompetitor Three"
          }
          aria-invalid={Boolean(fieldErrors.competitors)}
          aria-describedby={
            fieldErrors.competitors
              ? "competitors-error"
              : "competitors-hint"
          }
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground/40 font-mono"
        />
        {fieldErrors.competitors ? (
          <p
            id="competitors-error"
            className="text-[12px] text-rose-600"
            role="alert"
          >
            {fieldErrors.competitors}
          </p>
        ) : (
          <p
            id="competitors-hint"
            className="text-[12px] text-muted-foreground"
          >
            Up to {COMPETITORS_MAX_COUNT} businesses — one per line, or
            comma-separated. Use their name, not their web address — Beacon
            looks up the matching website for you, so a name is all you need.
          </p>
        )}
      </div>

      {topError ? (
        <p className="text-[13px] text-rose-600" role="alert">
          {topError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-foreground text-background px-4 py-2 text-[14px] font-medium disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case "validation_failed":
      return "Please fix the highlighted field.";
    case "not_authenticated":
      return "Your session expired. Sign in again to continue.";
    case "no_tenant":
      return "We couldn't find your account. Try signing in again.";
    case "already_launched":
      return "Your account has already launched — heading to your dashboard.";
    case "membership_lookup_failed":
    case "update_failed":
      return "We hit a temporary issue saving. Try again in a moment.";
    default:
      return "Something went wrong. Try again.";
  }
}
