import { currentTenantId } from "@/lib/tenant-context";
import { getTenantSpentThisMonthUsd } from "@/lib/cost/budget-ledger-supabase";
import { valueWithDeadline, DEFAULT_DEADLINE_MS } from "@/lib/load-with-deadline";

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * SpendLine (Settings collapse follow-up, 2026-07-21) - the deleted /settings/spend
 * page folded to the one honest line the operator actually needs here: this
 * calendar month's total AI/API spend, straight from the durable ledger
 * (getTenantSpentThisMonthUsd, the same reader the poll runner's monthly cap
 * uses). One bounded read, deadline-raced like every other shell read.
 *
 * Fail-soft contract: getTenantSpentThisMonthUsd already returns `null` on any
 * Supabase read error (never a fake number), and a genuine no-spend month
 * returns `0`. This component self-hides on `null` OR a deadline timeout, and
 * renders "$0.00" plainly when the month really is empty - a real zero is
 * honest, a swallowed error is not.
 */
export async function SpendLine() {
  const tenantId = await currentTenantId().catch(() => null);
  if (!tenantId) return null;
  const spentUsd = await valueWithDeadline(
    getTenantSpentThisMonthUsd(tenantId).catch(() => null),
    null,
    DEFAULT_DEADLINE_MS,
  );
  if (spentUsd === null) return null;
  return (
    <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
      I spent {usd(spentUsd)} this month on AI and data calls. Every call is capped and
      logged before it runs.
    </p>
  );
}
