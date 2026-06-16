"use client";

import { useState, useTransition } from "react";
import { requestSignupMagicLink } from "./actions";

export function SignupForm({
  sent,
  error,
}: {
  sent: boolean;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSent, setLocalSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    startTransition(async () => {
      const res = await requestSignupMagicLink(email);
      if (res.error) setLocalError(res.error);
      else setLocalSent(true);
    });
  }

  function resend() {
    setLocalError(null);
    startTransition(async () => {
      const res = await requestSignupMagicLink(email);
      if (res.error) setLocalError(res.error);
    });
  }

  if (sent || localSent) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-3 rounded-md border border-foreground/15 p-4 text-[13px]"
      >
        <p>Check your email. Click the link to finish creating your account.</p>
        <p className="text-[12px] text-muted-foreground">
          No email after a minute? Check your spam or promotions folder.
        </p>
        {localError && (
          <p role="alert" className="text-[12px] text-red-600">
            {localError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <button
            type="button"
            onClick={resend}
            disabled={pending || !email}
            className="font-medium underline disabled:opacity-50"
          >
            {pending ? "Sending…" : "Resend link"}
          </button>
          <button
            type="button"
            onClick={() => setLocalSent(false)}
            className="text-muted-foreground underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-[12px] text-muted-foreground">
        Work email
      </label>
      <input
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-[13px] outline-none focus:border-foreground/40"
        placeholder="you@yourcompany.com"
      />
      {(localError || error) && (
        <p className="text-[12px] text-red-600">{localError || error}</p>
      )}
      <button
        type="submit"
        disabled={pending || !email}
        className="w-full rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>
      <p className="text-[11px] text-muted-foreground">
        {/* #126 — previously asked the user to "agree to Beacon's terms"
            with no /terms page or link anywhere, i.e. agreement to
            invisible terms (a credibility hit for someone authorizing
            edits to their live site). Until a real terms page exists,
            don't request agreement to something that can't be read; keep
            the honest, high-value cost disclosure. */}
        Free to set up. Running AI readings and data refreshes uses paid
        APIs — you'll always see the cost before you spend.
      </p>
    </form>
  );
}
