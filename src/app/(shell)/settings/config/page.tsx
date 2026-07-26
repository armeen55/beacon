import { PageHeader } from "@/components/data/page-header";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { ConfigForm } from "./config-form";
import { TrackedPromptsSection } from "./tracked-prompts-section";
import { loadSetup, loadTrackedQuestions } from "./actions";

/** Profile data changes without rebuild; avoid baking build-time defaults into static HTML. */
export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const { access } = await requireReadyAccount(await currentTenantId());
  if (access.kind === "suspended") redirect("/");
  const [initial, tracked] = await Promise.all([loadSetup(), loadTrackedQuestions()]);

  return (
    <div>
      <PageHeader
        title="Your business info"
        description="This is what I know about your business. I filled it in from your website to start. Everything you save here becomes confirmed truth, and I research and write against it."
      />
      <ConfigForm initial={initial} />
      {/* The section carries its own id="tracked-ai-prompts" anchor. */}
      <TrackedPromptsSection active={tracked.active} count={tracked.count} recommended={tracked.recommended} unknown={tracked.unknown === true} />
    </div>
  );
}
