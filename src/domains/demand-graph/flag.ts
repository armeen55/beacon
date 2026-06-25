/**
 * flag (2026-06-25) — tenant-scoped enablement for the demand-graph engine's
 * live-queue integration. A single global on/off is too blunt for a controlled
 * rollout (enable Iranopedia without touching Ritz/Finglish).
 *
 * `BEACON_DEMAND_GRAPH_RECS`:
 *   - unset / "" / "false"   → OFF for everyone
 *   - "true"                 → ON for ALL tenants
 *   - "tenant-iranopedia"    → ON for that tenant only
 *   - "tenant-a,tenant-b"    → ON for the comma-separated allowlist
 *
 * Pure + env-injectable for tests.
 */

export function isDemandGraphEnabledForTenant(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.BEACON_DEMAND_GRAPH_RECS ?? "").trim();
  if (!raw || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;
  const allow = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return allow.includes(tenantId);
}
