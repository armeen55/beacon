"use server";

import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";

/**
 * requestSignupMagicLink — Gap B (2026-05-07).
 *
 * Sends a magic link for new-account signup. After the user clicks it,
 * /auth/callback exchanges the code for a session AND provisions a
 * pending tenant + tenant_members row (idempotent — repeat clicks
 * don't duplicate).
 *
 * Mirrors /login's `requestMagicLink` but routes through the signup
 * code path so the callback can detect first-time provisioning.
 *
 * The redirectTo URL passes `?signup=1` so the callback knows this
 * came from the signup flow (informational; provisioning logic
 * actually keys off "does tenant_members already exist for this user"
 * to stay idempotent across login + signup re-uses).
 */
export async function requestSignupMagicLink(
  email: string,
): Promise<{ error: string | null }> {
  if (!email || !/@/.test(email)) {
    return { error: "Enter a valid work email" };
  }

  const supabase = await getSupabaseServerClient();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "http://localhost:3000";

  const redirectTo = `${origin}/auth/callback?signup=1`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) return { error: error.message };
  return { error: null };
}
