import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadOpportunityMap } from "@/domains/insight/compute-opportunity-map";
import { OpportunityList } from "./opportunity-list";

/**
 * Opportunity Map — operator-OS rebuild, surface (2).
 *
 * A ranked, filterable map of the pages that need action first, fused from
 * GSC + SEMrush + Clarity + GA4 + Page Surgeon. Read-only; CTAs route to the
 * Workbench (no publish path here). Operator-gated like /diagnostics/*.
 */
export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  if (!isOperatorModeServer()) notFound();

  const tenantId = await currentTenantId();
  const items = await loadOpportunityMap(tenantId);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Opportunity Map</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Every page ranked by what's at stake — fused across Search, SEMrush,
          Clarity and Analytics. Highest-leverage first.
        </p>
      </div>
      <OpportunityList items={items} />
    </div>
  );
}
