/** Account lifecycle: the ONE resolver for "what may this account see right now", asked by every signed-in surface AND by /onboard's own
 *  door, so the outcomes stay identical everywhere and no customer can land on a dead end or bounce between two redirects. INVARIANT: a
 *  failed read must never masquerade as a lifecycle state. A transient `tenants` read failure resolves to `unavailable` with reason
 *  `unreadable`, a bounded retryable error surface, never to `incomplete` (which would bounce a fully onboarded customer back into
 *  onboarding), never to `missing` (which claims a customer does not exist), and never to a redirect (which is how sign-in loops are
 *  born). */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getTenant } from "./tenants/store";
import type { Account } from "./tenants/types";

export type AccountAccess =
  /** Onboarding is done AND its setup truth is proven present; render the product. */
  | { kind: "ready"; account: Account }
  /** Setup is unfinished; the resume destination is /onboard, at `step` when one is known. */
  | { kind: "incomplete"; account: Account; step?: 1 | 3 | 4 | 5 | 7 }
  /** Data still resolves, but no work runs and the surface says why. */
  | { kind: "suspended"; account: Account; reason: "paused" | "cancelled" }
  /** `missing` = the row is not there. `unreadable` = the read did not come back, which is NOT the same fact
   *  and must never be reported as one. Both are a bounded error surface, never a redirect. */
  | { kind: "unavailable"; reason: "missing" | "unreadable" };

/** Resolve one account's lifecycle. THE ONE ANSWER to "is this account finished and allowed to see the product", so /onboard, its
 *  server actions and every product surface read the same verdict instead of three copies that can disagree and bounce a customer
 *  between two redirects. Never redirects and never throws. */
export async function resolveAccountAccess(tenantId: string): Promise<AccountAccess> {
  if (!tenantId) return { kind: "unavailable", reason: "missing" };
  let account: Account | null = null;
  try {
    account = await getTenant(tenantId, { strict: true }); // a failed read must reach the catch, not arrive disguised as "no such account"
  } catch (e) {
    console.error(
      `[account/lifecycle] tenant read THREW for ${tenantId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { kind: "unavailable", reason: "unreadable" };
  }
  if (!account) return { kind: "unavailable", reason: "missing" };
  // A status outside the known union is a data anomaly: bounded retry, never a paused lockout and never a bounce into onboarding.
  if (account.status_unrecognized) return { kind: "unavailable", reason: "unreadable" };
  if (account.status === "pending_onboarding") return { kind: "incomplete", account };
  if (account.status === "paused") return { kind: "suspended", account, reason: "paused" };
  if (account.status === "cancelled") return { kind: "suspended", account, reason: "cancelled" };
  // ACTIVE IS A STATUS, NOT PROOF OF SETUP. An account flipped active without a website, without a confirmed profile or without a
  // single approved question renders every surface off nothing at all, so it resumes at the first genuinely incomplete step. AN
  // OUTAGE IS NOT INCOMPLETENESS: a gap that could not be READ is the bounded retry surface, because sending an established
  // customer back to setup over a transient read is the worse of the two failures.
  try {
    const gap = await setupGapOnce(tenantId, account.domain ?? "", account.growth_goal ?? "", account.tos_accepted_at ?? "");
    if (gap) return { kind: "incomplete", account, step: gap.step };
  } catch {
    return { kind: "unavailable", reason: "unreadable" };
  }
  return { kind: "ready", account };
}

/** Thrown when the account read failed. The route error boundary renders the bounded retry state; the raw message never reaches the
 *  customer. */
export class AccountUnavailableError extends Error {
  constructor(tenantId: string) {
    super(`account read unavailable: ${tenantId}`);
    this.name = "AccountUnavailableError";
  }
}

/** IS THIS ACTIVE ACCOUNT ACTUALLY SET UP? Runtime owns the answer (see runtime/onboarding-store setupGap); this asks it once per request
 *  so a per-render read never becomes a per-render query. Imported lazily because Runtime imports Account, and the truth belongs beside the
 *  onboarding steps rather than copied here. */
const setupGapOnce = cache(async (tenantId: string, domain: string, goal: string, tos: string) =>
  (await import("@/domains/runtime")).setupGap(tenantId, { status: "active", domain, growth_goal: goal || null, tos_accepted_at: tos || null }));

/** Guard for signed-in product surfaces, over the one verdict above. unavailable → throw AccountUnavailableError (bounded retry
 *  boundary) incomplete → resume setup at the step it owes suspended → returned, so the caller renders the notice ready → returned. */
export async function requireReadyAccount(
  tenantId: string,
): Promise<{ access: Exclude<AccountAccess, { kind: "unavailable" }> }> {
  const access = await resolveAccountAccess(tenantId);
  if (access.kind === "unavailable") throw new AccountUnavailableError(tenantId);
  if (access.kind === "incomplete") redirect(access.step ? `/onboard?step=${access.step}` : "/onboard");
  return { access };
}
