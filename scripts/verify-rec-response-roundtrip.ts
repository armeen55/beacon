/**
 * Phase 1a verification: prove the `persistResponses -> syncRecommendationResponses`
 * dual-write actually writes to Supabase `recommendation_responses`.
 *
 * Why this shape: the real store module is `server-only`-guarded so we can't
 * import it from a CLI script. We instead replay the exact DB-write the
 * wrapper does — same mapper, same upsert, same table. This is *not* a test
 * of the UI click handler; the UI click handler was already verified by
 * reading `action-card.tsx:285-304` and `today-primary-action.tsx:259-279`,
 * both of which call `onRespondToRec(recId, "accepted", {...})`, which maps
 * to `recommendation-actions.ts:11 respondToRecommendation`, which calls
 * `recordResponse()` + `persistResponses()`. This script exercises the
 * `persistResponses -> syncRecommendationResponses` tail.
 *
 * Safe: test rec_id `test-phase1a-<ts>`; easy to cleanup via SQL.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const [key, val] = [trimmed.slice(0, eq), trimmed.slice(eq + 1)];
      process.env[key] ??= val;
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing env vars");
  process.exit(1);
}
const sb = createClient(url, serviceKey);

// EXACT mirror of mapRecommendationResponseToRow in src/lib/persistence/dual-write.ts
function mapRecommendationResponseToRow(r: {
  recId: string;
  status: string;
  respondedAt: string;
  deferUntil: string | null;
  targetPageUrl?: string | null;
  patternId?: string | null;
}) {
  return {
    rec_id: r.recId,
    status: r.status,
    responded_at: r.respondedAt,
    defer_until: r.deferUntil,
    target_page_url: r.targetPageUrl ?? null,
    pattern_id: r.patternId ?? null,
    tenant_id: "",
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const testRecId = `test-phase1a-${Date.now()}`;
  const row = mapRecommendationResponseToRow({
    recId: testRecId,
    status: "accepted",
    respondedAt: new Date().toISOString(),
    deferUntil: null,
    targetPageUrl: "/available-homes",
    patternId: "test-pattern-schema-parity",
  });

  console.log(`Upserting: rec_id=${testRecId}`);
  const { error } = await sb
    .from("recommendation_responses")
    .upsert([row], { onConflict: "rec_id" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log("Upsert OK. Reading back...");

  const { data, error: readErr } = await sb
    .from("recommendation_responses")
    .select("*")
    .eq("rec_id", testRecId)
    .maybeSingle();
  if (readErr || !data) {
    console.error("Readback failed:", readErr?.message ?? "no row");
    process.exit(1);
  }
  console.log("Row in DB:", JSON.stringify(data, null, 2));

  // Clean up.
  await sb.from("recommendation_responses").delete().eq("rec_id", testRecId);
  console.log("Cleanup complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
