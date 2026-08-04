/**
 * Account lifecycle: the ONE resolver for "what may this account see right now".
 *
 * Every signed-in surface asks this instead of hand-rolling status checks, so
 * the four outcomes stay identical everywhere and no customer can land on a
 * dead end.
 *
 * INVARIANT: a failed read must never masquerade as a lifecycle state. A
 * transient `tenants` read failure resolves to `unavailable`, a bounded
 * retryable error surface, never to `incomplete` (which would bounce a fully
 * onboarded customer back into onboarding) and never to a redirect (which is
 * how sign-in loops are born).
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getTenant } from "./tenants/store";
import type { Account } from "./tenants/types";

export type AccountAccess =
  /** Onboarding is done; render the product. */
  | { kind: "ready"; account: Account }
  /** status pending_onboarding; the resume destination is /onboard. */
  | { kind: "incomplete"; account: Account }
  /** Data still resolves, but no work runs and the surface says why. */
  | { kind: "suspended"; account: Account; reason: "paused" | "cancelled" }
  /** Read failed or the row is missing. Bounded error, never a redirect. */
  | { kind: "unavailable" };

/**
 * Resolve one account's lifecycle. Pure decision over a single scoped read;
 * never redirects and never throws.
 */
export async function resolveAccountAccess(tenantId: string): Promise<AccountAccess> {
  if (!tenantId) return { kind: "unavailable" };
  let account: Account | null = null;
  try {
    account = await getTenant(tenantId);
  } catch (e) {
    console.error(
      `[account/lifecycle] tenant read THREW for ${tenantId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { kind: "unavailable" };
  }
  if (!account) return { kind: "unavailable" };
  // A status outside the known union is a data anomaly: bounded retry, never a
  // paused lockout and never a bounce into onboarding.
  if (account.status_unrecognized) return { kind: "unavailable" };
  if (account.status === "pending_onboarding") return { kind: "incomplete", account };
  if (account.status === "paused") return { kind: "suspended", account, reason: "paused" };
  if (account.status === "cancelled") return { kind: "suspended", account, reason: "cancelled" };
  return { kind: "ready", account };
}

/** Thrown when the account read failed. The route error boundary renders the
 *  bounded retry state; the raw message never reaches the customer. */
export class AccountUnavailableError extends Error {
  constructor(tenantId: string) {
    super(`account read unavailable: ${tenantId}`);
    this.name = "AccountUnavailableError";
  }
}

/** IS THIS ACTIVE ACCOUNT ACTUALLY SET UP? Runtime owns the answer (see runtime/onboarding-store setupGap); this asks it once per
 *  request so a per-render read never becomes a per-render query. Imported lazily because Runtime imports Account, and the truth
 *  belongs beside the onboarding steps rather than copied here. */
const setupGapOnce = cache(async (tenantId: string, domain: string) =>
  (await import("@/domains/runtime")).setupGap(tenantId, domain));

/**
 * Guard for signed-in product surfaces.
 *
 *   unavailable → throw AccountUnavailableError (bounded retry boundary)
 *   incomplete  → redirect("/onboard")
 *   suspended   → returned, so the caller renders the notice
 *   ready       → returned, ONCE its setup truth is proven present
 *
 * ACTIVE IS A STATUS, NOT PROOF OF SETUP. An account flipped active without a website, without a confirmed profile or without a
 * single approved question passed this guard and rendered every surface off nothing at all. It now resumes at the FIRST genuinely
 * incomplete step instead. AN OUTAGE IS NOT INCOMPLETENESS: a gap I could not read is the bounded retry surface, never a bounce
 * into onboarding, because sending an established customer back to setup over a transient read is the worse of the two failures.
 */
export async function requireReadyAccount(
  tenantId: string,
): Promise<{ access: Exclude<AccountAccess, { kind: "unavailable" }> }> {
  const access = await resolveAccountAccess(tenantId);
  if (access.kind === "unavailable") throw new AccountUnavailableError(tenantId);
  if (access.kind === "incomplete") redirect("/onboard");
  if (access.kind === "ready") {
    const gap = await setupGapOnce(tenantId, access.account.domain ?? "").catch(() => { throw new AccountUnavailableError(tenantId); });
    if (gap) redirect(`/onboard?step=${gap.step}`);
  }
  return { access };
}
