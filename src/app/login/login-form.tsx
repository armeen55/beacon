"use client";

import { useState, useTransition } from "react";
import { requestMagicLink } from "./actions";

/**
 * Every error code the sign-in chain can produce, mapped to words a customer
 * can act on. Raw codes ("no_account") must never render: they read as a bug
 * report, not a next step. Unknown codes fall through to the generic retry.
 */
const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  no_account:
    "I could not find a workspace for this sign in. Create one from the signup page to get started.",
  multiple_accounts_unsupported:
    "This email is attached to more than one workspace, which I cannot open yet. Reply to your welcome email and I will sort it out.",
  account_unavailable: "I could not open your account just now. Try again in a minute.",
};
const LOGIN_ERROR_FALLBACK =
  "I could not finish signing you in just now. Request a fresh link below and try again.";

export function LoginForm({
  next,
  sent,
  error,
}: {
  next?: string;
  sent: boolean;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSent, setLocalSent] = useState(false);
  const mappedError = error
    ? (LOGIN_ERROR_MESSAGES[error] ?? LOGIN_ERROR_FALLBACK)
    : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    startTransition(async () => {
      const res = await requestMagicLink(email, next);
      if (res.error) setLocalError(res.error);
      else setLocalSent(true);
    });
  }

  if (sent || localSent) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-foreground/15 p-4 text-[13px]"
      >
        Check your email. Click the link to sign in.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label
        htmlFor="login-email"
        className="block text-[12px] text-muted-foreground"
      >
        Email
      </label>
      <input
        id="login-email"
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-[13px] outline-none focus:border-foreground/40"
        placeholder="you@example.com"
      />
      {(localError || mappedError) && (
        <p role="alert" className="text-[12px] text-red-600">
          {localError || mappedError}
          {!localError && error === "no_account" && (
            <>
              {" "}
              <a href="/signup?error=no_account" className="underline">
                Create your account
              </a>
            </>
          )}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !email}
        className="w-full rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background disabled:opacity-50"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
