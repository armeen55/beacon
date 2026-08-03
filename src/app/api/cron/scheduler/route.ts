import { NextResponse, type NextRequest } from "next/server";

import { runDueAccounts } from "@/domains/runtime";

// Never statically rendered and never cached: every call claims live database work.
export const dynamic = "force-dynamic";

// The full serverless lifetime. The dispatch spends a 240-second budget of its own inside this, so the request returns a receipt rather than being killed
// part-way through an account it holds the lease on.
export const maxDuration = 300;

/**
 * /api/cron/scheduler (2026-08-03) - the ONE machine door that makes daily AI tracking daily. A single global Supabase pg_cron job POSTs here through pg_net,
 * once per tick, with `Authorization: Bearer <CRON_SECRET>`. Nothing else may call it: not a customer route, no tenant argument, no cookie, no session, counts
 * back and nothing else. THE CHECK BELOW IS THE ONLY GATE: the auth middleware treats /api/cron as PUBLIC (it has to, because a machine caller carries no
 * session cookie), so nothing upstream inspects this bearer. It FAILS CLOSED when CRON_SECRET is unset (401, never "sure"), which makes an unconfigured
 * deploy safe. It claims a bounded number of accounts whose current reporting day (src/lib/reporting-day.ts holds the one timezone contract; there is no
 * per-account timezone in V1) still owes work, under the SAME database leases a visit claims under, and drives each through the SAME canonical research
 * cycle. Idempotent by construction: a duplicate tick claims nothing the first holds and reports zero. The body is ignored.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // AN OUTAGE MUST NOT LOOK LIKE A QUIET DAY. A database that cannot be read, an RPC that was never migrated and a revoked permission used to come back as HTTP
  // 200 with a zero receipt, which is exactly what a genuinely idle fleet looks like, so the monitor recorded success on a day nothing was tracked. The answer
  // is 503 and one bounded word: no account, no identifier, no database text, nothing a caller could learn anything from; the log line already went down inside
  // the claim. A fleet that legitimately owes nothing still answers 200 with an honest zero.
  try {
    return NextResponse.json(await runDueAccounts());
  } catch {
    return NextResponse.json({ error: "scheduler_unavailable" }, { status: 503 });
  }
}
