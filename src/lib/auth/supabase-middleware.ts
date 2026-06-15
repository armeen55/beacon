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
 * Phase 2 auth gate. Single-user dogfood: any authenticated Supabase user
 * may access the shell; unauthenticated users are redirected to /login.
 * Public paths: /login, /signup, /auth/*, and static assets.
 *
 * Sprint 7 Phase 7.4 (2026-04-25): tenant injection.
 *   - Strip any inbound `x-beacon-tenant` header (never trust client).
 *   - After auth succeeds, look up `tenant_members` for the user.
 *   - Exactly 1 tenant → inject `x-beacon-tenant`; resolver in RSC reads it.
 *   - 0 tenants → redirect to /login?error=no_tenant (fail closed).
 *   - 2+ tenants → redirect to /login?error=multiple_tenants. The current
 *     `tenant_members` schema (Phase 7.1) has no primary indicator; until
 *     a primary is added, multi-tenant memberships are unsupported.
 *   - Transient DB errors fall through; the resolver uses BEACON_TENANT_ID
 *     env fallback so a Supabase blip doesn't strand authenticated requests.
 *
 * Set BEACON_AUTH_DISABLED=1 in .env.local to bypass (useful for CLI scripts
 * and pre-auth local dev while we iterate). In prod / hosted dogfood the
 * flag MUST be unset.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (process.env.BEACON_AUTH_DISABLED === "1") {
    // audit #7 (2026-06-14): even on the auth bypass, NEVER trust an inbound
    // x-beacon-tenant header — currentTenantId() reads it before the env
    // fallback, so an un-stripped header is trivial tenant impersonation
    // (and masks isolation bugs in local/dogfood testing). Strip it here too.
    const bypassHeaders = new Headers(request.headers);
    bypassHeaders.delete("x-beacon-tenant");
    return NextResponse.next({ request: { headers: bypassHeaders } });
  }

  // Perf bundle 7 (2026-05-12) — production-safe tracing gated by
  // `BEACON_PERF_TRACE=true`. NOOP when disabled (zero allocations).
  // The trace ID is generated here and forwarded via header so the
  // shell layout + route loader can correlate their log lines.
  const trace = createPerfTrace("middleware", {
    route: request.nextUrl.pathname,
  });

  // Sprint 7 Phase 7.4 — strip any inbound x-beacon-tenant before any code
  // reads request headers. Mutating `requestHeaders` is the canonical Next
  // way to forward modified request headers; direct `request.headers` set
  // is unsupported.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-beacon-tenant");
  // Strip + reset the perf-trace header (untrusted from client). When
  // tracing is enabled the middleware re-sets it below with a fresh ID.
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

  // Refreshes the session cookie if near-expiry.
  const {
    data: { user },
  } = await trace.time("auth.getUser", () => supabase.auth.getUser());

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    // Gap B (2026-05-07) — public signup route. Auth callback then
    // provisions a pending tenant + tenant_members row on first login
    // and redirects to /onboard/business.
    path.startsWith("/signup") ||
    path.startsWith("/auth") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    trace.data("decision", "redirect_login");
    trace.flush();
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  // Sprint 7 Phase 7.4 — tenant injection (authenticated requests only).
  // Public paths are never tenant-scoped (login / auth / static / machine
  // endpoints). Errors fall through to the resolver's env fallback.
  if (user) {
    try {
      const { data, error } = await trace.time("tenant_lookup", () =>
        supabase
          .from("tenant_members")
          .select("tenant_id, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
      );

      if (error) {
        console.error("[mw-tenant] tenant_members query failed:", error.message);
        // Fall through — resolver uses BEACON_TENANT_ID env fallback so a
        // Supabase outage doesn't 500 every authenticated request.
        trace.data("tenant_decision", "error_fallthrough");
      } else if (!data || data.length === 0) {
        console.warn("[mw-tenant] no tenant_members row for user:", user.id);
        trace.data("tenant_decision", "no_tenant_redirect");
        trace.flush();
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "no_tenant");
        return NextResponse.redirect(url);
      } else {
        // Audit #13 (2026-06-10): MULTI-TENANT users are no longer locked
        // out. Previously >1 membership → redirect to /login?error=
        // multiple_tenants (an agency / "my app + my website" owner could
        // never use Beacon). Now we resolve a DEFAULT tenant and inject
        // it; switching is a seam (the `beacon_tenant` cookie). The
        // membership rows are ordered by created_at asc, so the default
        // is: the cookie-preferred tenant IF the user is a member of it,
        // else the earliest membership. Deterministic, never a lockout.
        const memberIds = data.map((r) => r.tenant_id);
        const preferred = request.cookies.get("beacon_tenant")?.value;
        const chosen =
          preferred && memberIds.includes(preferred)
            ? preferred
            : memberIds[0]!;
        requestHeaders.set("x-beacon-tenant", chosen);
        const setCookieHeaders = response.headers.getSetCookie();
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const c of setCookieHeaders) {
          response.headers.append("Set-Cookie", c);
        }
        trace.data(
          "tenant_decision",
          data.length > 1 ? "injected_default_of_many" : "injected",
        );
      }
    } catch (e) {
      console.error("[mw-tenant] tenant lookup threw:", e);
      // Fall through — resolver uses env fallback.
      trace.data("tenant_decision", "throw_fallthrough");
    }
  } else {
    trace.data("tenant_decision", "public_path");
  }

  trace.flush();
  return response;
}
