import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { PageHeader } from "@/components/data/page-header";
import { TenantSwitcher } from "@/components/shell/tenant-switcher";
import { ConfigForm } from "./config-form";

/** Local JSON can change without rebuild; avoid baking build-time defaults into static HTML. */
export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const cfg = await getBusinessConfigForCurrentTenant();

  const initial = {
    name: cfg.name,
    domain: cfg.domain,
    industry: cfg.industry,
    phone: cfg.phone ?? "",
    address: cfg.address ?? "",
    locationsLine: cfg.locations.join(", "),
    servicesLine: cfg.services.join(", "),
    competitorsLine: cfg.primaryCompetitors.join(", "),
    contentRulesLine: (cfg.contentRules ?? []).join("\n"),
    flaggedTermsLine: (cfg.flaggedTerms ?? []).join(", "),
    yelpBusinessId: cfg.yelpBusinessId ?? "",
  };

  return (
    <div>
      <PageHeader
        title="Your business info"
        description="This is what Beacon knows about your business. We filled it in from your website to start. Anything you type here replaces our guess."
      />
      {/* Item 52 - tenant switching lives here, not in the daily header. */}
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-gray-500">Switch business:</span><TenantSwitcher /></div>
      <p className="text-xs text-gray-500">Spending on outside data: <a href="/settings/spend" className="text-accent-primary underline underline-offset-2">see this month's receipts</a>.</p>
      <ConfigForm initial={initial} />
    </div>
  );
}
