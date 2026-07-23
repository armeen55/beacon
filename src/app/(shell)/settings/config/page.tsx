import { PageHeader } from "@/components/data/page-header";
import { ConfigForm } from "./config-form";
import { loadSetup } from "./actions";

/** Profile data changes without rebuild; avoid baking build-time defaults into static HTML. */
export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const initial = await loadSetup();

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
