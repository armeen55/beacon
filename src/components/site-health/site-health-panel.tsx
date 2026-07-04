/**
 * site-health-panel (BEACON_500 P16, 2026-07-03) - the self-hiding READ surface
 * for the three generic onboarding-intelligence facts:
 *   - AI-crawler-block  : which AI assistants / Google's crawler are blocked.
 *   - JS-shell pages    : pages whose content only appears after JavaScript.
 *   - CMS / platform     : the platform Beacon detected + what it can do here.
 *
 * PURE presentational. Token-only (Card / Pill / SectionHeader / ReceiptLine),
 * no raw palette classes, no em or en dashes. Renders NOTHING when every fact is
 * empty (empty-safe by construction): a healthy, custom-coded site sees no
 * panel at all. Each fact hides itself independently.
 *
 * This component lives outside src/app/(shell) so it does not enter the
 * design-system raw-palette ratchet; a route can drop it in wherever the
 * operator reviews site health.
 */

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SectionHeader } from "@/components/ui/section-header";
import { ReceiptLine, buildReceiptLine } from "@/components/data/receipt-line";
import type {
  AiCrawlerBlockFact,
  CmsFact,
  JsShellFact,
} from "@/domains/site-health/types";

export type SiteHealthPanelProps = {
  aiCrawlerBlock: AiCrawlerBlockFact | null;
  jsShell: ReadonlyArray<JsShellFact>;
  cms: CmsFact | null;
  /** ISO date the robots / snapshot data runs through (for the receipt line). */
  dataThrough?: string | null;
  /** ISO timestamp the site-health read was computed. */
  checkedAt?: string | null;
  /** Clock for the relative receipt label. */
  nowMs: number;
};

export function SiteHealthPanel({
  aiCrawlerBlock,
  jsShell,
  cms,
  dataThrough,
  checkedAt,
  nowMs,
}: SiteHealthPanelProps) {
  const hasJsShell = jsShell.length > 0;
  // Empty-safe: nothing true to say means no panel at all.
  if (!aiCrawlerBlock && !hasJsShell && !cms) return null;

  const receipt = buildReceiptLine({
    source: "your site scan",
    through: dataThrough ?? null,
    checkedAt: checkedAt ?? null,
    verb: "checked",
    nowMs,
  });

  return (
    <section data-slot="site-health-panel" className="flex flex-col gap-3">
      <SectionHeader
        title="Site health"
        sub="What AI assistants and Google can and cannot see on your site."
      />

      {aiCrawlerBlock ? (
        <Card variant="alert" data-fact="ai-crawler-block">
          <div className="flex items-center justify-between gap-2">
            <Pill intent="attention">
              {aiCrawlerBlock.aiBlockedCount > 0 ? "AI cannot read you" : "Google cannot read you"}
            </Pill>
          </div>
          <p className="mt-2 text-body text-card-foreground">{aiCrawlerBlock.headline}</p>
        </Card>
      ) : null}

      {hasJsShell
        ? jsShell.map((f) => (
            <Card variant="alert" key={f.path} data-fact="js-shell">
              <Pill intent="attention">Loads empty until JavaScript runs</Pill>
              <p className="mt-2 text-body text-card-foreground">{f.headline}</p>
            </Card>
          ))
        : null}

      {cms ? (
        <Card variant="quiet" data-fact="cms">
          <div className="flex items-center justify-between gap-2">
            <Pill intent={cms.capability === "push_and_draft" ? "live" : "neutral"}>
              {cms.capability === "push_and_draft" ? "I can push here" : "Draft and paste"}
            </Pill>
            <span className="text-meta text-muted-foreground">{cms.platform}</span>
          </div>
          <p className="mt-2 text-body text-card-foreground">{cms.headline}</p>
        </Card>
      ) : null}

      <ReceiptLine line={receipt} />
    </section>
  );
}
