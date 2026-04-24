/**
 * Phase 5.5 — cron schedule vs actual fire-time probe.
 * Read-only. Queries observation_runs for each day's first chunk to
 * reveal when the daily poll actually fired.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  console.log("── observation_runs started_at by day+platform (last 7 days) ──");
  console.log("Scheduled cron: 0 10 * * * (10:00 UTC daily)\n");

  const { data: runs, error } = await sb
    .from("observation_runs")
    .select("run_id, source, started_at, scope_label, status")
    .in("source", ["perplexity-native-poll", "openai-native-poll"])
    .gte("started_at", "2026-04-17T00:00:00Z")
    .order("started_at", { ascending: true })
    .limit(200);
  if (error) {
    console.error(error.message);
    return;
  }

  // Group by date + source; find first chunk (offset=0) for each
  type Group = {
    firstStartedAt: string | null;
    count: number;
    statuses: Map<string, number>;
  };
  const byKey = new Map<string, Group>();
  for (const r of runs ?? []) {
    const day = (r.started_at as string).slice(0, 10);
    const key = `${day}|${r.source}`;
    const group = byKey.get(key) ?? {
      firstStartedAt: null,
      count: 0,
      statuses: new Map<string, number>(),
    };
    group.count += 1;
    const isFirstChunk =
      /chunk offset=0\b/i.test(r.scope_label) || !/chunk offset=/i.test(r.scope_label);
    if (
      isFirstChunk &&
      (group.firstStartedAt === null ||
        (r.started_at as string) < group.firstStartedAt)
    ) {
      group.firstStartedAt = r.started_at;
    }
    group.statuses.set(
      r.status as string,
      (group.statuses.get(r.status as string) ?? 0) + 1,
    );
    byKey.set(key, group);
  }

  console.log(
    `${"date".padEnd(12)} ${"platform".padEnd(24)} ${"first run UTC".padEnd(22)} ${"delay vs 10:00".padEnd(14)} ${"chunks".padEnd(8)} statuses`,
  );
  console.log("-".repeat(110));
  for (const [key, g] of [...byKey.entries()].sort()) {
    const [day, src] = key.split("|");
    const first = g.firstStartedAt ?? "";
    // Compute delay vs 10:00 UTC on same day
    let delay = "";
    if (first) {
      const firstTime = new Date(first).getTime();
      const scheduled = new Date(`${day}T10:00:00Z`).getTime();
      const minutes = Math.round((firstTime - scheduled) / 60_000);
      delay = minutes >= 0 ? `+${minutes}m` : `${minutes}m`;
    }
    const statusStr = [...g.statuses.entries()]
      .map(([s, n]) => `${s}:${n}`)
      .join(" ");
    console.log(
      `${day.padEnd(12)} ${src.padEnd(24)} ${first.slice(0, 19).padEnd(22)} ${delay.padEnd(14)} ${String(g.count).padEnd(8)} ${statusStr}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
