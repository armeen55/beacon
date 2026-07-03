import Link from "next/link";
import { loadFinishSetupChecklist } from "@/domains/ops/finish-setup";

/**
 * FinishSetupCard (BEACON_500 T0b, 2026-07-03) - the ONE "Finish setting up"
 * checklist on /settings. Each row is a [G] operator-gated setup item from
 * the master plan (Wix page mapping, the digest email env vars, the
 * IndexNow key, the GSC full backfill, the revenue model), sourced from real
 * persisted state via loadFinishSetupChecklist and worded through the SAME
 * shared recovery map (recovery-actions.ts) the Connections page and cron
 * health panel use. Self-hides completely once every item is done, never a
 * permanent fixture nagging a fully-configured operator.
 */
export async function FinishSetupCard() {
  const items = await loadFinishSetupChecklist().catch(() => []);
  if (items.length === 0) return null;

  return (
    <section
      className="mb-6 rounded-lg border border-status-warning/40 bg-status-warning/[0.05] p-5"
      data-finish-setup-card="true"
    >
      <h2 className="text-[14px] font-semibold text-foreground">Finish setting up</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {items.length} thing{items.length === 1 ? "" : "s"} left before I am running at full
        strength. Each one disappears from this list the moment it is done.
      </p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li
            key={item.kind}
            className="rounded-md border border-border/50 bg-surface px-3 py-2.5"
            data-finish-setup-item={item.kind}
          >
            <p className="text-[12px] text-foreground">{item.plainProblem}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              <Link href={item.href} className="font-medium text-accent-primary hover:underline">
                {item.exactFix}
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
