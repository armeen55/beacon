import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runNativePoll } from "@/domains/observations/run-poll";
import type { NativePollPlatform } from "@/domains/observations/run-poll";

/**
 * POST /api/poll/run
 *
 * Hosted trigger for native polling. Accepts `platform` + `tenantId` (+ optional
 * chunking params) and runs the shared pipeline. Designed to be called:
 *
 *   (a) Manually via curl with offset/limit chunking (Phase 5 Step 1.5)
 *   (b) Later by Vercel Cron (Phase 5 Step 2 — not wired yet)
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Body:
 *   {
 *     platform: "perplexity" | "openai",
 *     tenantId: string,
 *     offset?: number,    // chunk start (default 0)
 *     limit?: number,     // chunk size (default: all remaining from offset)
 *     force?: boolean
 *   }
 *
 * Runtime:
 *   Node.js, maxDuration 300s — Vercel Hobby serverless cap. Single-shot 100-
 *   prompt runs take ~685s and cannot fit in this window; chunk in 4 × 25
 *   (~171s each, 43% margin) and the caller orchestrates them sequentially.
 */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type PollRunBody = {
  platform?: unknown;
  tenantId?: unknown;
  offset?: unknown;
  limit?: unknown;
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

  // Optional chunk params. Either both unset (full run), or one/both set
  // (chunked). Invalid numeric types are rejected with 400.
  let offset: number | undefined;
  if (body.offset !== undefined) {
    if (typeof body.offset !== "number" || !Number.isFinite(body.offset) || body.offset < 0) {
      return NextResponse.json(
        { error: "`offset` must be a non-negative integer" },
        { status: 400 },
      );
    }
    offset = Math.floor(body.offset);
  }
  let limit: number | undefined;
  if (body.limit !== undefined) {
    if (typeof body.limit !== "number" || !Number.isFinite(body.limit) || body.limit <= 0) {
      return NextResponse.json(
        { error: "`limit` must be a positive integer" },
        { status: 400 },
      );
    }
    limit = Math.floor(body.limit);
  }

  // ── Run ──
  const startedAt = Date.now();
  try {
    const result = await runNativePoll({
      tenantId: body.tenantId,
      platform: body.platform,
      offset,
      limit,
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
