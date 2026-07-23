/**
 * 2026-06-11 (night shift, #119) — the tenant switcher. Server
 * component: resolves the signed-in user's memberships + the active
 * tenant and renders one button per OTHER business (a one-business
 * user sees nothing). Each button posts the fail-closed switch action,
 * which sets the `beacon_tenant` cookie the middleware already honors.
 */

import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getTenant, listActiveTenants } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { switchTenantFromForm } from "@/app/(shell)/tenant-switch-action";

export async function TenantSwitcher() {
  let tenants: Array<{ id: string; name: string }> = [];

  if (isOperatorModeServer()) {
    // Operator god-view (founder/agency): list every ACTIVE tenant so the
    // founder can hop between their sites with one click — no login, no
    // membership rows, works even on the local auth bypass. Customers are never
    // in operator mode, so they never reach this branch. 2026-07-18: switched
    // to listActiveTenants so a PAUSED tenant (e.g. Ritz) is never offered as a
    // switch target — it must be invisible until a separate account exists.
    try {
      tenants = (await listActiveTenants()).map((t) => ({
        id: t.id,
        name: t.business_name || t.slug,
      }));
    } catch {
      return null; // soft-fail: the header never breaks over the switcher
    }
  } else {
    // Customer path: resolve the signed-in user's memberships. A single-
    // business user (the common case) is a member of one tenant → the
    // switcher renders nothing. "Agency" = a login that's a member of ≥2.
    let memberships: Array<{ tenant_id: string }> = [];
    try {
      const supabase = await getSupabaseServerClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) return null;
      const { data } = await supabase
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", user.id);
      memberships = data ?? [];
    } catch {
      return null; // soft-fail: the header never breaks over the switcher
    }
    if (memberships.length < 2) return null;

    tenants = (
      await Promise.all(
        memberships.map(async (m) => {
          try {
            const t = await getTenant(m.tenant_id);
            return t ? { id: t.id, name: t.business_name || t.slug } : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((t): t is { id: string; name: string } => t !== null);
  }

  // One business → nothing to switch between (the common single-tenant case).
  if (tenants.length < 2) return null;

  let activeId = "";
  try {
    activeId = await currentTenantId();
  } catch {
    /* keep empty — render all as switchable */
  }

  const active = tenants.find((t) => t.id === activeId);
  const others = tenants.filter((t) => t.id !== activeId);

  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      {active && (
        <span className="rounded-md border border-border/60 bg-surface-inset/40 px-2 py-0.5 font-medium">
          {/* #523 — a screen reader otherwise hears only the bare business
              name with no indication it's the CURRENT one. */}
          <span className="sr-only">Current business: </span>
          {active.name}
        </span>
      )}
      {others.map((t) => (
        <form key={t.id} action={switchTenantFromForm}>
          <input type="hidden" name="tenant_id" value={t.id} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-surface-inset/60 hover:text-foreground md:min-h-0"
            // #523 — the button's visible text is just the name, so its
            // accessible name was the bare {name} (title is tooltip-only).
            // aria-label makes the action explicit: "Switch to {name}".
            aria-label={`Switch to ${t.name}`}
            title={`Switch to ${t.name}`}
          >
            {t.name}
          </button>
        </form>
      ))}
    </div>
  );
}
