import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { decodeWorkbenchPath } from "@/domains/insight/workbench-route";
import { loadWorkbench } from "../workbench-data";
import { WorkbenchView } from "../workbench-view";
import { WorkbenchMomentumStrip } from "../workbench-momentum-strip";

/**
 * Workbench — operator-OS rebuild, Phase 2 (v1). The locked-page deep-audit
 * surface every "Run Deep Audit" / "Review Change Pack" CTA lands on. Operator-
 * gated (404 for non-operators) + force-dynamic. Read-only: composes existing
 * Page Surgeon / Opportunity / Change-Pack loaders. No paid APIs, no publish.
 */
export const dynamic = "force-dynamic";

export default async function WorkbenchPage({
  params,
}: {
  params: Promise<{ encodedPagePath: string }>;
}) {
  // IA consolidation (2026-06-23): available to everyone, no operator gate.

  const { encodedPagePath } = await params;
  const path = decodeWorkbenchPath(encodedPagePath);
  if (!path) notFound();

  const tenantId = await currentTenantId();
  const data = await loadWorkbench(tenantId, path);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Per-page momentum (2026-06-25) — the 8-week trajectory in context. Self-hides without data. */}
      <WorkbenchMomentumStrip tenantId={tenantId} canonUrl={data.canonUrl} />
      <WorkbenchView data={data} />
    </div>
  );
}
