import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/data/page-header";
import { requireReadyAccount } from "@/domains/account";
import { isResearchPaused } from "@/domains/runtime";
import { currentTenantId } from "@/lib/tenant-context";
import { SETTINGS_SECTIONS } from "./settings-sections";
import { SpendLine } from "./spend-line";
import { ResearchPause } from "./research-pause";

/**
 * `/settings` index (FP4, 2026-07-03; T0b checklist added 2026-07-03) - renders
 * the ONE settings table of contents (settings-sections.ts), the same list the
 * tab strip above shows, with a one-line description per section. The audit
 * found this page and the tab strip disagreeing on both items and labels;
 * deriving both from the same registry ends that permanently.
 *
 * The "Finish setting up" card above the list surfaces the [G] operator-gated
 * setup items (master plan) that are not yet done, and self-hides completely
 * once every one of them is done.
 */
export default async function SettingsPage() {
  const tenantId = await currentTenantId();
  const { access } = await requireReadyAccount(tenantId);
  if (access.kind === "suspended") redirect("/");
  // isResearchPaused answers false rather than throwing on a bad read; the catch is the last resort, and
  // a state I genuinely cannot read renders no switch at all rather than a guess.
  const paused = await isResearchPaused(tenantId).catch(() => null);
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        description="Your business info, the questions I track, and your connections."
      />
      <ul className="space-y-2">
        {SETTINGS_SECTIONS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-border/60 bg-surface px-4 py-3.5 transition-colors hover:border-accent-primary/40 hover:bg-surface-raised/30"
            >
              <p className="text-[13px] font-semibold text-foreground">{item.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {paused !== null && <ResearchPause paused={paused} />}
      <SpendLine />
    </div>
  );
}
