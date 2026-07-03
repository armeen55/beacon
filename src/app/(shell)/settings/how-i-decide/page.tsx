import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { DECISION_THRESHOLDS } from "@/domains/settings/decision-thresholds";

/**
 * /settings/how-i-decide (R14b, P1 trust receipts, 2026-07-03) - every live
 * decision threshold in plain words, from ONE registry module
 * (domains/settings/decision-thresholds.ts) that IMPORTS the enforcing
 * constants, so this page can never drift from the live values. Read-only,
 * static per deploy. Tokens + primitives only.
 */
export default function HowIDecidePage() {
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="How I decide"
        description="Every threshold I use to call wins, pace work, and cap spending. These are the live values the product runs on, in plain words, not a copy that can drift."
      />
      <div className="space-y-2">
        {DECISION_THRESHOLDS.map((t) => (
          <Card key={t.id} padding="sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sub font-semibold text-foreground">{t.label}</span>
              <span className="text-sub font-medium text-foreground/80 tabular-nums">{t.value}</span>
            </div>
            <p className="mt-0.5 text-body leading-relaxed text-muted-foreground">{t.sentence}</p>
          </Card>
        ))}
      </div>
      <p className="text-meta text-muted-foreground">
        For what each number on a page means and where it comes from, see{" "}
        <Link href="/settings/methodology" className="underline underline-offset-2 hover:text-foreground">
          How Beacon measures
        </Link>
        . For every paid call, see{" "}
        <Link href="/settings/spend" className="underline underline-offset-2 hover:text-foreground">
          Spend
        </Link>
        .
      </p>
    </div>
  );
}
