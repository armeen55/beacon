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
        description="This is what I know about your business. I filled it in from your website to start. Everything you save here becomes confirmed truth, and I research and write against it."
      />
      <ConfigForm initial={initial} />
    </div>
  );
}
