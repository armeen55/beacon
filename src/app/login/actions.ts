"use server";

import { headers } from "next/headers";
import { sendMagicLink } from "@/lib/auth/magic-link";

export async function requestMagicLink(
  email: string,
  next?: string,
): Promise<{ error: string | null }> {
  if (!email || !/@/.test(email)) {
    return { error: "Enter a valid email" };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "http://localhost:3000";

  const redirectTo = `${origin}/auth/callback${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  return sendMagicLink(email, redirectTo);
}
