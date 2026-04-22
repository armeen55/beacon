"use server";

import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";

export async function requestMagicLink(
  email: string,
  next?: string,
): Promise<{ error: string | null }> {
  if (!email || !/@/.test(email)) {
    return { error: "Enter a valid email" };
  }

  const supabase = await getSupabaseServerClient();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "http://localhost:3000";

  const redirectTo = `${origin}/auth/callback${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true, // single-user dogfood: first sign-in creates the account
    },
  });

  if (error) return { error: error.message };
  return { error: null };
}
