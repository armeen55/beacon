import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runNativePoll } from "@/domains/observations/run-poll";
import type { NativePollPlatform } from "@/domains/observations/run-poll";

/**
 * POST /api/poll/run
 *
 * Hosted trigger for native polling. Accepts `platform` + `tenantId` and runs
 * the same shared pipeline the CLI scripts use. Designed to be called:
 *
 *   (a) Manually via curl (Phase 5 Step 1 — verify hosted path works)
 *   (b) Later by Vercel Cron (Phase 5 Step 2 — not wired yet)
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Body:
 *   { platform: "perplexity" | "openai", tenantId: string, force?: boolean }
 *
 * Runtime:
 *   Node.js, maxDuration 800s (Vercel Pro ceiling). Perplexity 100 took ~685s,
 *   ChatGPT 100 took ~685s — both land under the cap with ~100-115s margin
 *   on observed runs. Genuinely close to the ceiling; see handoff notes in
 *   Phase 5 plan for the cron-vs-chunking decision.
 */

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

type PollRunBody = {
  platform?: unknown;
  tenantId?: unknown;
  force?: unknown;
};

function isPlatform(v: unknown): v is NativePollPlatform {
  return v === "perplexity" || v === "openai";
}

export async function POST(req: NextRequest) {
  // ── Auth ──
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Body parsing ──
  let body: PollRunBody;
  try {
    body = (await req.json()) as PollRunBody;
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isPlatform(body.platform)) {
    return NextResponse.json(
      { error: "`platform` must be 'perplexity' or 'openai'" },
      { status: 400 },
    );
  }
  if (typeof body.tenantId !== "string" || body.tenantId.length === 0) {
    return NextResponse.json(
      { error: "`tenantId` must be a non-empty string" },
      { status: 400 },
    );
  }
  const force = body.force === true;

  // ── Run ──
  const startedAt = Date.now();
  try {
    const result = await runNativePoll({
      tenantId: body.tenantId,
      platform: body.platform,
      force,
    });
    const elapsedMs = Date.now() - startedAt;
    return NextResponse.json({ ...result, elapsedMs });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[/api/poll/run] error (${elapsedMs}ms): ${message}`);
    return NextResponse.json(
      {
        error: "poll failed",
        message,
        elapsedMs,
      },
      { status: 500 },
    );
  }
}
