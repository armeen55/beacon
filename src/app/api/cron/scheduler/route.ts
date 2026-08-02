import { NextResponse, type NextRequest } from "next/server";

import { runDueAccounts } from "@/domains/runtime";

// Never statically rendered and never cached: every call claims live database work.
export const dynamic = "force-dynamic";

/**
 * /api/cron/scheduler (2026-08-03) - the ONE machine door that makes daily AI tracking daily. A single global
 * Supabase pg_cron job POSTs here through pg_net, once per tick, with `Authorization: Bearer <CRON_SECRET>`.
 * Nothing else may call it: not a customer route, no tenant argument, no cookie, no session, counts back and
 * nothing else. The auth middleware already gates /api/cron on that exact bearer; this re-checks it so the
 * endpoint is safe on its own terms, and FAILS CLOSED when CRON_SECRET is unset (401, never "sure").
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
