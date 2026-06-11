import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import {
  TENANT_COOKIE,
  TENANT_COOKIE_MAX_AGE_S,
  canSwitchToTenant,
} from "@/lib/tenant-cookie";

/**
 * GET /api/tenant-switch?tenant=<id>&next=<path> — night-shift #118
 * (2026-06-11): deep links from the morning digest land in the RIGHT
 * business. Sets the beacon_tenant cookie (the one the middleware
 * honors) and redirects to `next`.
 *
 * Fail-closed: requires a signed-in session AND membership in the
 * target tenant (same source of truth as the middleware + the header
 * switcher action). Non-members are redirected without any change.
 * `next` is constrained to same-origin paths (no open redirect).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = (url.searchParams.get("tenant") ?? "").trim();
  const next = safeNextPath(url.searchParams.get("next"));
  const dest = new URL(next, url.origin);

  if (target === "") return NextResponse.redirect(dest);

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      const login = new URL("/login", url.origin);
      login.searchParams.set("next", `${url.pathname}${url.search}`);
      return NextResponse.redirect(login);
    }
    const { data: memberships, error } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id);
    if (error || !canSwitchToTenant(memberships ?? [], target)) {
      return NextResponse.redirect(dest); // fail-closed: no change
    }
  } catch {
    return NextResponse.redirect(dest);
  }

  const res = NextResponse.redirect(dest);
  res.cookies.set(TENANT_COOKIE, target, {
    path: "/",
    maxAge: TENANT_COOKIE_MAX_AGE_S,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
