/**
 * GA4 revenue migration — DRY-RUN harness (2026-06-26). READ-ONLY.
 *
 * Reports what a revenue backfill WOULD touch, WITHOUT mutating anything:
 *   • whether the additive migration is applied (revenue columns exist)
 *   • ga4_url_traffic row counts (total + in the 28d scoring window)
 *   • how many rows lack revenue (revenue_synced_at IS NULL) → enrichable
 *   • whether the tenant has a GA4 token + property (can a live fetch get revenue?)
 *
 * Usage:  npx tsx scripts/_ga4-revenue-dry-run.ts [tenantId]
 *         (defaults to tenant-iranopedia)
 *
 * Does NOT write, does NOT call GA4, does NOT mutate production. The actual
 * backfill (a real sync run that fills revenue) is operator-gated and separate.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath))
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }

const TENANT = process.argv[2] ?? "tenant-iranopedia";
const WINDOW_DAYS = 28;

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  console.log(`\n=== GA4 revenue DRY-RUN (READ-ONLY) · tenant=${TENANT} ===\n`);

  // 1. Is the additive migration applied? (probe a revenue column)
  let migrationApplied = false;
  {
    const { error } = await sb
      .from("ga4_url_traffic")
      .select("revenue_synced_at")
      .eq("tenant_id", TENANT)
      .limit(1);
    if (error) {
      console.log(`migration applied? NO — revenue columns absent (${error.code ?? ""} ${error.message})`);
    } else {
      migrationApplied = true;
      console.log("migration applied? YES — revenue columns present");
    }
  }

  // 2. Row counts (total + 28d window). Uses head:true count (no row egress).
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { count: total } = await sb
    .from("ga4_url_traffic")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", TENANT);
  const { count: inWindow } = await sb
    .from("ga4_url_traffic")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", TENANT)
    .gte("date", since);
  console.log(`ga4_url_traffic rows: total=${total ?? "?"}, in last ${WINDOW_DAYS}d=${inWindow ?? "?"}`);

  // 3. Enrichable rows (revenue not yet observed) — only meaningful post-migration.
  if (migrationApplied) {
    const { count: missingRevenue } = await sb
      .from("ga4_url_traffic")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT)
      .is("revenue_synced_at", null);
    const { count: withRevenue } = await sb
      .from("ga4_url_traffic")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT)
      .not("revenue_synced_at", "is", null);
    console.log(`revenue enriched so far: ${withRevenue ?? 0}; WOULD enrich (revenue_synced_at NULL): ${missingRevenue ?? 0}`);
  } else {
    console.log(`revenue enrichable: ALL ${total ?? "?"} rows once the migration is applied + a sync runs`);
  }

  // 4. Can a live fetch get revenue? (token + property present) — read-only.
  const { data: tok } = await sb
    .from("connector_tokens")
    .select("payload")
    .eq("tenant_id", TENANT)
    .eq("provider", "google_ga4")
    .maybeSingle();
  const payload = (tok?.payload ?? null) as { ga4_property_id?: string; scopes?: string[]; disconnected_at?: string | null } | null;
  if (!payload) {
    console.log("GA4 token: ABSENT → a live revenue fetch is not possible until GA4 is connected");
  } else {
    const hasProp = !!payload.ga4_property_id;
    const hasScope = Array.isArray(payload.scopes) && payload.scopes.some((s) => s.includes("analytics.readonly"));
    const disconnected = !!payload.disconnected_at;
    console.log(
      `GA4 token: present · property=${hasProp ? payload.ga4_property_id : "MISSING"} · scope=${hasScope ? "ok" : "MISSING"} · ${disconnected ? "DISCONNECTED" : "connected"}`,
    );
    console.log(
      hasProp && hasScope && !disconnected
        ? "→ a nightly/operator sync CAN fetch revenue (if the property has ecommerce; else revenue_unavailable, conversion fallback)"
        : "→ a live revenue fetch is blocked until the token/property/scope is fixed",
    );
  }

  console.log("\n=== END DRY-RUN — nothing was written ===\n");
}

main().catch((e) => {
  console.error("dry-run failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
