import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  PERF_TRACE_HEADER_NAME,
  createPerfTrace,
  perfTraceEnabled,
} from "@/lib/perf-trace";
import { ACCOUNT_RETRY_COOKIE, TENANT_COOKIE, readTenantCookie, signTenantCookie } from "./tenant-cookie";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Hard per-call ceiling for the middleware's Supabase round-trips (2026-07-08).
 *
 * The middleware runs on EVERY request. Without a ceiling, a single slow/cold Supabase
 * moment makes the middleware exceed Vercel's invocation budget and the WHOLE app
 * returns 504 MIDDLEWARE_INVOCATION_TIMEOUT, not one slow page, every page. This
 * races each call against a deadline. A timed-out account lookup is NO LONGER an
 * account verdict (see `transientAccountFailure`): the signed account cookie answers
 * it, or the request reloads itself once, and only a second failure reaches /login.
 */
const MW_SUPABASE_TIMEOUT_MS = 5000;
/** The account read is now a cold-path refresh, not the hot path, so it gets a tighter
 *  ceiling than auth: waiting five seconds to learn a starved pool is still starved
 *  spends the operator's patience for nothing. */
const MW_TENANT_TIMEOUT_MS = 2500;
function withMwTimeout<T>(p: PromiseLike<T>, onTimeout: T, ms: number = MW_SUPABASE_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(onTimeout), ms);
    }),
  ]);
}

/** THE ONE-RELOAD ANSWER to an account read that did not come back, for a document request. No new route
 *  exists for this and none is wanted: the middleware answers in place, the browser reloads itself once, and
 *  the warm second attempt almost always lands. A second failure inside the retry cookie's life redirects to
 *  /login with `next` intact instead of looping. */
function retryOnceResponse(reason = "1"): NextResponse {
  const res = new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>Reconnecting</title>` +
      `<body style="font:14px/1.6 system-ui;padding:2rem;color:#444">` +
      `<p>Reconnecting to your account. This page reloads by itself.</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
  // The mark carries WHICH check failed: the session check and the account check each get their own one
  // reload, so an auth blip can never spend the account check's retry and force a premature sign-out bounce.
  res.cookies.set(ACCOUNT_RETRY_COOKIE, reason, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 30 });
  return res;
}

/** DOES THIS BROWSER ALREADY HOLD A SESSION? Supabase names its session cookie `sb-<project ref>-auth-token` and splits a large one
 *  into `.0`, `.1` chunks, so the name is matched by SHAPE and never against a configured ref: a project move can never silently turn
 *  every customer into a signed-out visitor. Presence is not proof of a VALID session. It is proof that "signed out" is the wrong
 *  answer to give when the auth read itself never came back. */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && c.value !== "");
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
 * BOTH reads here answer in three states, never two. The session read: a user signs in; no session cookie at
 * all on a protected route is a genuine signed-out login redirect; a session cookie in hand with a read that
 * timed out, errored or threw is NOT a verdict and takes the transient posture below (reload once, 503 for
 * anything that is not a document, /login?error=auth_check_failed only on a second failure).
 *
 * For an AUTHENTICATED request, membership resolution is exactly-one, and a
 * DATABASE ANSWER is a verdict while a database SILENCE is not:
 *   - a fresh `beacon_acct` signature → inject that account, no query at all;
 *   - exactly 1 `tenant_members` row → inject that account id as
 *     `x-beacon-tenant` and re-sign the cookie;
 *   - 0 rows → redirect /login?error=no_account;
 *   - 2+ rows → redirect /login?error=multiple_accounts_unsupported (no
 *     earliest-membership guessing, no switching);
 *   - query error, exception, or timeout → NOT a verdict. The last signed
 *     account answers it; with none, a document request reloads itself once and
 *     any other request gets 503; only a second failure redirects to
 *     /login?error=account_check_failed, carrying `next`.
 *
 * `beacon_acct` is HMAC-signed and httpOnly and can only ever name the account
 * the server itself injected for THIS user id, so it is not account selection:
 * an unsigned or wrong-user value buys nothing. The retired, unsigned
 * `beacon_tenant` cookie is never read and is actively expired on every response.
 *
 * Local BEACON_AUTH_DISABLED=1 (scripts / pre-auth dev): no Supabase session
 * exists; the resolver uses the explicitly configured BEACON_TENANT_ID.
 * Cookies are ignored and no account enumeration or switching exists.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (process.env.BEACON_AUTH_DISABLED === "1") {
    // audit #7 (2026-06-14): even on the auth bypass, NEVER trust an inbound
    // x-beacon-tenant header: currentTenantId() reads it before the env
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

  /** A REDIRECT THAT LOSES THE DESTINATION costs the operator the page twice: once now, once after signing
   *  in again. Where they were going travels with every account refusal. */
  const failClosed = (error: string, decision: string): NextResponse => {
    trace.data("tenant_decision", decision);
    trace.flush();
    const destination = `${path}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", error);
    if (destination !== "/") url.searchParams.set("next", destination);
    const res = expireRetiredCookie(NextResponse.redirect(url));
    res.cookies.set(ACCOUNT_RETRY_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  /** THE ONE TRANSIENT POSTURE, now shared by both reads this middleware makes. A check that did not ANSWER is not a verdict: a
   *  document request reloads itself once, anything else (a server action POST, an RSC fetch) gets an honest 503 the caller can
   *  retry, and only a second failure inside the retry cookie's life redirects, carrying `next`. */
  const busyOrRetry = (reason: string, busyCopy: string, error: string): NextResponse => {
    const wantsDocument =
      request.method === "GET" &&
      !request.headers.get("rsc") &&
      (request.headers.get("accept") ?? "").includes("text/html");
    if (!wantsDocument) {
      trace.data("tenant_decision", `${reason}_busy`);
      trace.flush();
      return new NextResponse(busyCopy, { status: 503, headers: { "cache-control": "no-store" } });
    }
    // The mark is the CHECK's identity (auth vs account), not the fine-grained reason: the same check
    // failing twice for two different reasons still escalates, while an auth blip can never spend the
    // account check's one reload. "1" is the pre-scoping legacy value, honored so a mid-deploy cookie
    // still escalates rather than looping.
    const mark = request.cookies.get(ACCOUNT_RETRY_COOKIE)?.value;
    if (mark === error || mark === "1") return failClosed(error, `${reason}_after_retry`);
    trace.data("tenant_decision", `${reason}_retry_once`);
    trace.flush();
    return retryOnceResponse(error);
  };

  // Refreshes the session cookie if near-expiry. THREE ANSWERS, NOT TWO: a user, a genuine signed-out, or NO ANSWER AT ALL. A read
  // that timed out at the ceiling above, came back with an error, or threw used to be byte-identical to signed out, so one slow
  // moment at the auth provider signed a perfectly valid session out and asked for a fresh magic link. A session cookie in hand
  // means "signed out" is the wrong answer, so an unanswered read takes the same transient posture the account read has had all
  // along. The fast ceiling stays: the middleware still never spends more than five seconds here.
  type AuthRead = { user: { id: string } | null; answered: boolean };
  const auth = await withMwTimeout<AuthRead>(
    trace.time("auth.getUser", () =>
      supabase.auth.getUser().then(
        // A 4xx from the auth provider IS a verdict (session missing, refresh token revoked): the person is
        // signed out and the clean login redirect is the honest answer. Only silence, a throw, or a 5xx is
        // "did not answer". Without this, every ordinarily expired session took the retry ladder and landed
        // on a wrong error instead of the sign-in form.
        (r) => ({ user: r.data.user, answered: r.error == null || (typeof r.error.status === "number" && r.error.status >= 400 && r.error.status < 500) }),
        (e: unknown) => {
          console.error("[mw-auth] getUser threw:", e);
          return { user: null, answered: false };
        },
      ),
    ),
    { user: null, answered: false },
  );
  const user = auth.user;

  if (!auth.answered && !isPublic && hasAuthCookie(request)) {
    return busyOrRetry("auth_check", "Signing you in is taking longer than it should. Try that again.", "auth_check_failed");
  }
  if (!user && !isPublic) {
    trace.data("decision", "redirect_login");
    trace.flush();
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return expireRetiredCookie(NextResponse.redirect(redirectUrl));
  }

  // Public paths never need account injection, and gating on isPublic is what
  // keeps /login and /auth/signout REACHABLE for a session with zero
  // memberships. Without it, the no_account redirect below fired on /login too,
  // so /login 307'd to itself forever and the user could not even sign out.
  if (user && !isPublic) {
    const nowMs = Date.now();
    const cached = await readTenantCookie(
      request.cookies.get(TENANT_COOKIE.name)?.value,
      user.id,
      nowMs,
    ).catch(() => null);

    /** Inject the account and hand the response back. `sign` re-stamps the cookie whenever the account came
     *  from a database read; a fresh cookie needs no restamp. Any retry mark is cleared: the request landed. */
    const inject = async (tenantId: string, sign: boolean, decision: string): Promise<NextResponse> => {
      requestHeaders.set("x-beacon-tenant", tenantId);
      const setCookieHeaders = response.headers.getSetCookie();
      response = NextResponse.next({ request: { headers: requestHeaders } });
      for (const c of setCookieHeaders) response.headers.append("Set-Cookie", c);
      const signed = sign ? await signTenantCookie(user.id, tenantId, nowMs).catch(() => null) : null;
      if (signed) {
        response.cookies.set(TENANT_COOKIE.name, signed, {
          path: "/", httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:",
          maxAge: TENANT_COOKIE.maxAge,
        });
      }
      response.cookies.set(ACCOUNT_RETRY_COOKIE, "", { path: "/", maxAge: 0 });
      trace.data("tenant_decision", decision);
      trace.flush();
      return expireRetiredCookie(response);
    };

    /** ONE FAILED READ IS NOT AN ACCOUNT VERDICT. The last signed account answers it first; with none, the shared transient
     *  posture takes over, because bouncing a Mark done POST to /login eats the press and the destination. */
    const transientAccountFailure = (reason: string): NextResponse | Promise<NextResponse> =>
      cached
        ? inject(cached.tenantId, false, `${reason}_served_cached_account`)
        : busyOrRetry(reason, "Your account could not be checked just now. Try that again.", "account_check_failed");

    // THE HOT PATH IS A SIGNATURE, NOT A QUERY. A fresh signed cookie names the account this session already
    // resolved, so the per-request `tenant_members` read that was starving the pool never runs.
    if (cached?.fresh) return inject(cached.tenantId, false, "cached_account");

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
          MW_TENANT_TIMEOUT_MS,
        ),
      );

      if (error) {
        console.error("[mw-account] tenant_members query failed:", error.message);
        return transientAccountFailure("lookup_error");
      }
      // AN ANSWER IS A VERDICT, a silence is not: zero and two are what the database SAID, so both still
      // redirect on the spot.
      if (!data || data.length === 0) {
        console.warn("[mw-account] no membership for user:", user.id);
        return failClosed("no_account", "no_account_redirect");
      }
      if (data.length > 1) {
        console.warn("[mw-account] multiple memberships for user:", user.id);
        return failClosed("multiple_accounts_unsupported", "multiple_accounts_fail_closed");
      }
      return inject(data[0]!.tenant_id, true, "injected");
    } catch (e) {
      console.error("[mw-account] account lookup threw:", e);
      return transientAccountFailure("lookup_threw");
    }
  } else {
    trace.data("tenant_decision", "public_path");
  }

  trace.flush();
  return expireRetiredCookie(response);
}
