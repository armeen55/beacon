import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { PageHeader } from "@/components/data/page-header";
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
      <ConfigForm initial={initial} />
    </div>
  );
}
