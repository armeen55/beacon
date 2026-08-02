import { NextResponse, type NextRequest } from "next/server";

import { runDueAccounts } from "@/domains/runtime";

// Never statically rendered and never cached: every call claims live database work.
export const dynamic = "force-dynamic";

// The full serverless lifetime. The dispatch spends a 240-second budget of its own inside this, so the
// request returns a receipt rather than being killed part-way through an account it holds the lease on.
export const maxDuration = 300;

/**
 * /api/cron/scheduler (2026-08-03) - the ONE machine door that makes daily AI tracking daily. A single global
 * Supabase pg_cron job POSTs here through pg_net, once per tick, with `Authorization: Bearer <CRON_SECRET>`.
 * Nothing else may call it: not a customer route, no tenant argument, no cookie, no session, counts back and
 * nothing else. THE CHECK BELOW IS THE ONLY GATE: the auth middleware treats /api/cron as PUBLIC (it has to,
 * because a machine caller carries no session cookie), so nothing upstream inspects this bearer. It FAILS
 * CLOSED when CRON_SECRET is unset (401, never "sure"), which is what makes an unconfigured deploy safe.
 *
 * It claims a bounded number of accounts whose current Pacific day still owes work, under the SAME database
 * leases a visit claims under, and drives each through the SAME canonical research cycle. Idempotent by
 * construction: a duplicate tick claims nothing the first holds and reports zero. The body is ignored.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const receipt = await runDueAccounts();
  return NextResponse.json(receipt);
}
