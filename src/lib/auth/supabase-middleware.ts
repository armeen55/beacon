import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  PERF_TRACE_HEADER_NAME,
  createPerfTrace,
  perfTraceEnabled,
} from "@/lib/perf-trace";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Hard per-call ceiling for the middleware's Supabase round-trips (2026-07-08).
 *
 * The middleware runs on EVERY request and makes two blocking Supabase calls
 * (auth.getUser + tenant_members). Without a ceiling, a single slow/cold Supabase
 * moment makes the middleware exceed Vercel's invocation budget and the WHOLE app
 * returns 504 MIDDLEWARE_INVOCATION_TIMEOUT — not one slow page, every page. This
 * races each call against a deadline; a timed-out account lookup FAILS CLOSED
 * (redirect with account_unavailable) and self-heals on the next warm request.
 */
const MW_SUPABASE_TIMEOUT_MS = 5000;
function withMwTimeout<T>(p: PromiseLike<T>, onTimeout: T): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(onTimeout), MW_SUPABASE_TIMEOUT_MS);
    }),
  ]);
}

/** The retired account-selection cookie. Never read; actively expired so
 *  existing browsers converge to the one-login-one-account contract. */
const RETIRED_TENANT_COOKIE = "beacon_tenant";
function expireRetiredCookie(res: NextResponse): NextResponse {
  res.cookies.set(RETIRED_TENANT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/**
 * Auth gate + account injection (one user, one account, one website).
 *
 * For an AUTHENTICATED request, membership resolution is exactly-one and
 * fail-closed:
 *   - exactly 1 `tenant_members` row → inject that account id as
 *     `x-beacon-tenant` for the request-scoped resolver;
 *   - 0 rows → redirect /login?error=no_account;
 *   - 2+ rows → redirect /login?error=multiple_accounts_unsupported (no
 *     earliest-membership guessing, no switching);
 *   - query error, exception, or timeout → redirect
 *     /login?error=account_unavailable. NEVER a cookie, NEVER the
 *     BEACON_TENANT_ID env fallback: an authenticated request either gets
 *     its own account or gets nothing.
 *
 * No account-selection cookie exists. The retired `beacon_tenant` cookie is
 * never read and is actively expired on every response.
 *
 * Local BEACON_AUTH_DISABLED=1 (scripts / pre-auth dev): no Supabase session
 * exists; the resolver uses the explicitly configured BEACON_TENANT_ID.
 * Cookies are ignored and no account enumeration or switching exists.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (process.env.BEACON_AUTH_DISABLED === "1") {
    // audit #7 (2026-06-14): even on the auth bypass, NEVER trust an inbound
    // x-beacon-tenant header — currentTenantId() reads it before the env
    // fallback, so an un-stripped header is trivial tenant impersonation.
    const bypassHeaders = new Headers(request.headers);
    bypassHeaders.delete("x-beacon-tenant");
    return expireRetiredCookie(
      NextResponse.next({ request: { headers: bypassHeaders } }),
    );
  }

  const trace = createPerfTrace("middleware", {
    route: request.nextUrl.pathname,
  });

  // Strip any inbound x-beacon-tenant before any code reads request headers.
  // ONE trusted exception (2026-07-03): a cron self-call authenticated by
  // CRON_SECRET on /api/cron paths.
  const requestHeaders = new Headers(request.headers);
  const cronSecret = process.env.CRON_SECRET;
  const isTrustedCronCall =
    request.nextUrl.pathname.startsWith("/api/cron") &&
    typeof cronSecret === "string" &&
    cronSecret.length > 0 &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (!isTrustedCronCall) {
    requestHeaders.delete("x-beacon-tenant");
  }
  requestHeaders.delete(PERF_TRACE_HEADER_NAME);
  if (perfTraceEnabled()) {
    requestHeaders.set(PERF_TRACE_HEADER_NAME, trace.id);
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

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
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the session cookie if near-expiry. Timeout-guarded: a slow
  // Supabase Auth resolves to "no user" → the login redirect for protected
  // routes (fast + safe, self-heals) instead of a middleware 504.
  type GetUserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>;
  const {
    data: { user },
  } = await withMwTimeout<GetUserResult>(
    trace.time("auth.getUser", () => supabase.auth.getUser()),
    { data: { user: null }, error: null } as unknown as GetUserResult,
  );

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth") ||
    // Machine endpoints (Vercel Cron) authenticate via CRON_SECRET inside
    // the route; the session gate must let them through.
    path.startsWith("/api/cron") ||
    // Deployment identity: public, zero-secret GET for the live commit SHA.
    path === "/api/version" ||
    path.startsWith("/_next") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    trace.data("decision", "redirect_login");
    trace.flush();
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return expireRetiredCookie(NextResponse.redirect(redirectUrl));
  }

  const failClosed = (error: string, decision: string): NextResponse => {
    trace.data("tenant_decision", decision);
    trace.flush();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", error);
    return expireRetiredCookie(NextResponse.redirect(url));
  };

  // Public paths never need account injection, and gating on isPublic is what
  // keeps /login and /auth/signout REACHABLE for a session with zero
  // memberships. Without it, the no_account redirect below fired on /login too,
  // so /login 307'd to itself forever and the user could not even sign out.
  if (user && !isPublic) {
    try {
      type TenantRows = { tenant_id: string }[];
      type TenantLookupResult = { data: TenantRows | null; error: { message: string } | null };
      const { data, error } = await trace.time("tenant_lookup", () =>
        withMwTimeout<TenantLookupResult>(
          supabase
            .from("tenant_members")
            .select("tenant_id")
            .eq("user_id", user.id) as unknown as PromiseLike<TenantLookupResult>,
          { data: null, error: { message: "middleware account lookup timed out" } },
        ),
      );

      if (error) {
        console.error("[mw-account] tenant_members query failed:", error.message);
        return failClosed("account_unavailable", "lookup_error_fail_closed");
      }
      if (!data || data.length === 0) {
        console.warn("[mw-account] no membership for user:", user.id);
        return failClosed("no_account", "no_account_redirect");
      }
      if (data.length > 1) {
        console.warn("[mw-account] multiple memberships for user:", user.id);
        return failClosed("multiple_accounts_unsupported", "multiple_accounts_fail_closed");
      }
      requestHeaders.set("x-beacon-tenant", data[0]!.tenant_id);
      const setCookieHeaders = response.headers.getSetCookie();
      response = NextResponse.next({ request: { headers: requestHeaders } });
      for (const c of setCookieHeaders) {
        response.headers.append("Set-Cookie", c);
      }
      trace.data("tenant_decision", "injected");
    } catch (e) {
      console.error("[mw-account] account lookup threw:", e);
      return failClosed("account_unavailable", "lookup_threw_fail_closed");
    }
  } else {
    trace.data("tenant_decision", "public_path");
  }

  trace.flush();
  return expireRetiredCookie(response);
}
