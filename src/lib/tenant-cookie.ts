/**
 * 2026-06-11 — tenant-switch cookie contract (night shift #119).
 * Lives OUTSIDE the "use server" action file because server-action
 * modules may only export async functions (Turbopack build rule —
 * caught by PR #14's build gate).
 */

export const TENANT_COOKIE = "beacon_tenant";
export const TENANT_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** Pure membership check for the switch action. */
export function canSwitchToTenant(
  memberships: ReadonlyArray<{ tenant_id: string }>,
  target: string,
): boolean {
  return target.length > 0 && memberships.some((m) => m.tenant_id === target);
}
