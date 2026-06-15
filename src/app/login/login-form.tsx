"use client";

import { useState, useTransition } from "react";
import { requestMagicLink } from "./actions";

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
      <div className="rounded-md border border-foreground/15 p-4 text-[13px]">
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
    </form>
  );
}
