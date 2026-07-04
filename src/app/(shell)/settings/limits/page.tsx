import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PRODUCT_LIMITS } from "@/domains/settings/product-limits";

/**
 * /settings/limits (P21, v1 356 - "what I cannot do yet") - the honest list of the
 * product's current limits, from ONE registry (domains/settings/product-limits.ts), in
 * plain first person, so the operator trusts the tool instead of hitting a limit by
 * surprise. Read-only, static per deploy. Tokens + primitives only (design-system
 * ratchet); Beacon voice; no em or en dashes.
 */
export default function ProductLimitsPage() {
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="What I cannot do yet"
        description="I would rather tell you my limits up front than have you find them the hard way. Here is what I cannot do yet, and what I do instead."
      />
      {PRODUCT_LIMITS.length === 0 ? (
        <EmptyState
          headline="There is nothing to list here right now."
          nextStep="When I add a limit worth calling out, it will show up here in plain words."
        />
      ) : (
        <div className="space-y-2">
          {PRODUCT_LIMITS.map((limit) => (
            <Card key={limit.id} padding="sm">
              <p className="text-sub font-semibold text-foreground">{limit.label}</p>
              <p className="mt-0.5 text-body leading-relaxed text-muted-foreground">
                {limit.sentence}
              </p>
            </Card>
          ))}
        </div>
      )}
      <p className="text-meta text-muted-foreground">
        For what each number on a page means and where it comes from, see{" "}
        <Link href="/settings/methodology" className="underline underline-offset-2 hover:text-foreground">
          How Beacon measures
        </Link>
        . For every threshold I use to call a win, see{" "}
        <Link href="/settings/how-i-decide" className="underline underline-offset-2 hover:text-foreground">
          How I decide
        </Link>
        .
      </p>
    </div>
  );
}
