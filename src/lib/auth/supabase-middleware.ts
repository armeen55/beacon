import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Phase 2 auth gate. Single-user dogfood: any authenticated Supabase user
 * may access the shell; unauthenticated users are redirected to /login.
 * Public paths: /login, /auth/*, static assets, and a narrow allowlist of
 * machine-auth API endpoints that protect themselves with their own bearer
 * tokens (see below).
 *
 * Machine-auth allowlist:
 * - /api/poll/run — Phase 5 Step 1. Hosted trigger for native polling.
 *   Handler at src/app/api/poll/run/route.ts requires
 *   `Authorization: Bearer ${CRON_SECRET}`. Session-cookie auth would be
 *   wrong here since cron / curl have no session. Allowlist is an exact
 *   path match (not a prefix) so future /api/poll/* endpoints have to be
 *   added deliberately.
 *
 * Set BEACON_AUTH_DISABLED=1 in .env.local to bypass (useful for CLI scripts
 * and pre-auth local dev while we iterate). In prod / hosted dogfood the
 * flag MUST be unset.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  if (process.env.BEACON_AUTH_DISABLED === "1") {
    return response;
  }

  const supabase = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the session cookie if near-expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico" ||
    // Machine-auth endpoints (see allowlist note in docstring). Exact match
    // only — NOT a prefix — so this cannot accidentally expose sibling
    // routes added later without a deliberate middleware edit.
    path === "/api/poll/run";

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
