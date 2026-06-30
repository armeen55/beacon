#!/usr/bin/env node
/**
 * supabase-management-check — preflight for Beacon's Supabase ownership (Phase 5).
 * Reports ONLY: target project ref, which management paths are available, and data-plane visibility
 * of the daily-experiment tables + accept RPC. NEVER prints secrets/tokens. Read-only; writes nothing.
 *   node scripts/supabase-management-check.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = (() => {
  try { return readFileSync(join(ROOT, ".env.local"), "utf8"); } catch { return ""; }
})();
const get = (k) => { const m = env.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+?)\\s*$`, "m")); return m ? m[1].replace(/^["']|["']$/g, "") : (process.env[k] ?? null); };
const present = (v) => (v ? "present" : "absent");

const url = get("NEXT_PUBLIC_SUPABASE_URL");
const ref = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
const mgmtToken = get("SUPABASE_MGMT_TOKEN");
const accessToken = get("SUPABASE_ACCESS_TOKEN");

console.log("Beacon Supabase management preflight");
console.log("  project ref:        ", ref ?? "UNKNOWN");
console.log("  data-plane (service):", present(serviceKey));
console.log("  mgmt token (sbp_):   ", mgmtToken?.startsWith("sbp_") ? "present" : (accessToken?.startsWith("sbp_") ? "present (SUPABASE_ACCESS_TOKEN)" : "absent"));

// Management-path liveness (no secret printed) — only a status code.
const tok = (mgmtToken?.startsWith("sbp_") && mgmtToken) || (accessToken?.startsWith("sbp_") && accessToken) || null;
if (tok && ref) {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}`, { headers: { Authorization: `Bearer ${tok}` } });
    console.log("  management API:      ", r.ok ? "OK" : `unavailable (HTTP ${r.status})`);
  } catch (e) { console.log("  management API:      ", `unreachable (${e.code ?? "error"})`); }
} else {
  console.log("  management API:      ", "no token to test");
}

// Data-plane visibility of the daily-experiment objects (service-role / PostgREST).
if (serviceKey && url) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  for (const t of ["daily_experiment_plans", "control_reservations"]) {
    try {
      const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=0`, { headers });
      console.log(`  table ${t}:`, r.ok ? "visible" : `NOT visible (HTTP ${r.status})`);
    } catch { console.log(`  table ${t}:`, "unreachable"); }
  }
  try {
    const r = await fetch(`${url}/rest/v1/rpc/accept_daily_experiment_plan`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_tenant: "__preflight__", p_plan_id: "__none__", p_input_hash: "x", p_idempotency_key: "x", p_reservations: [] }),
    });
    const body = await r.json().catch(() => ({}));
    const live = r.ok && body?.reason === "plan_not_found"; // no-write liveness signature
    console.log("  rpc accept_daily_experiment_plan:", live ? "LIVE (plan_not_found, no write)" : `NOT callable (HTTP ${r.status}${body?.code ? ` ${body.code}` : ""})`);
  } catch { console.log("  rpc accept_daily_experiment_plan:", "unreachable"); }
}
