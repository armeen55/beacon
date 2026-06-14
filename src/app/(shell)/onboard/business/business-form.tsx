"use client";

/**
 * business-form — Gap C.1 (2026-05-07).
 *
 * Client component for step 1 of the onboarding wizard. Collects
 * business name + website domain, calls the `saveBusinessProfile`
 * server action, and renders per-field error messages on validation
 * failure. On success the action calls `redirect('/onboard/scope')`,
 * so the form's promise rejects with a Next.js redirect signal that
 * we let propagate.
 */

import { useState, useTransition } from "react";
import { saveBusinessProfile } from "./actions";

type FieldErrors = { businessName?: string; domain?: string };

export function BusinessForm({
  initialBusinessName,
  initialDomain,
}: {
  initialBusinessName: string;
  initialDomain: string;
}) {
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [domain, setDomain] = useState(initialDomain);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setTopError(null);
    startTransition(async () => {
      try {
        const r = await saveBusinessProfile({ businessName, domain });
        if (!r.ok) {
          if (r.fieldErrors) setFieldErrors(r.fieldErrors);
          setTopError(humanizeError(r.error));
        }
        // success path: server action calls redirect() which throws
        // NEXT_REDIRECT — we won't reach here.
      } catch (err: unknown) {
        // Re-throw the redirect signal so Next.js handles navigation.
        if (
          err &&
          typeof err === "object" &&
          "digest" in err &&
          typeof (err as { digest?: unknown }).digest === "string" &&
          (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
        ) {
          throw err;
        }
        setTopError("Something went wrong saving your business. Try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label
          htmlFor="businessName"
          className="block text-[13px] font-medium"
        >
          Business name
        </label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          autoComplete="organization"
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Acme Co"
          aria-invalid={Boolean(fieldErrors.businessName)}
          aria-describedby={
            fieldErrors.businessName ? "businessName-error" : undefined
          }
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground/40"
        />
        {fieldErrors.businessName ? (
          <p
            id="businessName-error"
            className="text-[12px] text-rose-600"
            role="alert"
          >
            {fieldErrors.businessName}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="domain" className="block text-[13px] font-medium">
          Website
        </label>
        <input
          id="domain"
          name="domain"
          type="text"
          autoComplete="url"
          inputMode="url"
          required
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="acme.com"
          aria-invalid={Boolean(fieldErrors.domain)}
          aria-describedby={
            fieldErrors.domain ? "domain-error" : "domain-hint"
          }
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground/40"
        />
        {fieldErrors.domain ? (
          <p id="domain-error" className="text-[12px] text-rose-600" role="alert">
            {fieldErrors.domain}
          </p>
        ) : (
          <p id="domain-hint" className="text-[12px] text-muted-foreground">
            We'll fetch your homepage to learn how AI search engines describe
            you. No tracking pixel installed.
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
      return "Please fix the highlighted fields.";
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
