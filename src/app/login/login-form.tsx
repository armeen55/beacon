"use client";

import { useState, useTransition } from "react";
import { requestMagicLink, signInWithPassword } from "./actions";

/**
 * EVERY error code the sign-in chain can produce, mapped to words a customer can act on, and nothing else:
 * a code with no emitter is dead copy, and an emitter with no code here tells the customer to burn a fresh
 * magic link when a reload was the fix. Raw codes ("no_account") must never render, and neither may a raw
 * provider message: they read as a bug report, not a next step. Unknown codes fall through to the generic
 * retry.
 */
const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  no_account:
    "No workspace matches this sign in. Create one from the signup page to get started.",
  multiple_accounts_unsupported:
    "This email is attached to more than one workspace, which Beacon cannot open yet. Reply to your welcome email to get it sorted.",
  // Twice in a row the account check did not answer. The session is still good, so reloading is the fix and
  // burning a fresh sign-in link is not.
  account_check_failed:
    "Checking your account timed out twice. You are still signed in, so reload the page in a minute. A new link is not needed.",
  // Twice in a row the SESSION check did not answer. The session is intact; the link is spent, so
  // pointing at it would send the customer through two dead ends before the request form.
  auth_check_failed:
    "Your connection could not be checked twice in a row. You are still signed in, so reload the page in a minute. A new link is not needed.",
  onboarding_lookup_failed:
    "Your account could not be looked up just now. You are still signed in, so reload the page in a minute.",
  tenant_missing:
    "This sign in is not attached to a workspace yet. Create one from the signup page to get started.",
  link_invalid: "That sign-in link is expired or already used. Request a fresh one below.",
  missing_code: "That sign-in link is incomplete. Request a fresh one below.",
  session_missing_after_exchange:
    "Signing in did not finish. Request a fresh link below and open it in this browser.",
};
const LOGIN_ERROR_FALLBACK =
  "Signing you in could not finish just now. Request a fresh link below and try again.";

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
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSent, setLocalSent] = useState(false);
  const mappedError = error
    ? (LOGIN_ERROR_MESSAGES[error] ?? LOGIN_ERROR_FALLBACK)
    : null;
  // Same-origin paths only, exactly as the auth callback's safeNext: a protocol-relative "//evil.com"
  // handed to the browser after a successful sign-in is a real open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  /** THE PRIMARY DOOR: no email is sent, so nothing about this depends on a delivery limit. A full
   *  navigation (never a client-side push) so the session cookie the server just set is the one the
   *  middleware reads when it resolves the account. */
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    startTransition(async () => {
      try {
        const res = await signInWithPassword(email, password);
        if (res.error) setLocalError(res.error);
        else window.location.assign(safeNext);
      } catch {
        setLocalError("Signing in could not finish just now. Try again in a moment.");
      }
    });
  }

  /** THE FALLBACK, kept for the day a password is not to hand. It can be refused by the provider's own
   *  send limit, which is why it is no longer the only way in. */
  function onEmailLink() {
    setLocalError(null);
    startTransition(async () => {
      // The invocation ITSELF can reject (the server unreachable, the action throwing before it
      // returns), and an uncaught rejection here rendered a raw parse exception on this form.
      try {
        const res = await requestMagicLink(email, next);
        if (res.error) setLocalError(res.error);
        else setLocalSent(true);
      } catch {
        setLocalError("Sign-in email could not be sent just now. Use your password instead.");
      }
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
        name="email"
        autoComplete="username"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-[13px] outline-none focus:border-foreground/40"
        placeholder="you@example.com"
      />
      <label
        htmlFor="login-password"
        className="block text-[12px] text-muted-foreground"
      >
        Password
      </label>
      <input
        id="login-password"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-[13px] outline-none focus:border-foreground/40"
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
        disabled={pending || !email || !password}
        className="w-full rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <div className="pt-1 text-[12px] text-muted-foreground">
        <button
          type="button"
          onClick={onEmailLink}
          disabled={pending || !email}
          className="underline disabled:opacity-50"
        >
          Email me a sign-in link
        </button>{" "}
        instead. The emailed link is limited by our email provider and may be refused for a while.
      </div>
    </form>
  );
}
