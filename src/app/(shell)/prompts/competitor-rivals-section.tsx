import "server-only";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Pill } from "@/components/ui/pill";
import { loadCompetitorRivals, type CompetitorRivals } from "@/domains/competitors/load-competitor-intel";
import { loadWithDeadline } from "@/lib/load-with-deadline";

/**
 * CompetitorRivalsSection (FP10b, 2026-07-02) - "Who AI recommends instead of
 * you", folded into /prompts from the retired /competitors shell. Same real
 * data /competitors rendered (the ActionPack worklist's cached AI-citation
 * receipts) via the LEAN loadCompetitorRivals loader - domains + moves only,
 * never the teardown planner, so this section cannot stall the page the way
 * the full intel loader could (see load-competitor-intel.ts). SELF-HIDING:
 * renders nothing when there are no cited rival domains yet OR when the
 * loader misses the render deadline (the losing loader keeps running and
 * warms caches for the next visit), so /prompts never shows an empty
 * "Competitors" chrome block.
 *
 * Each row: the domain, how many times AI pointed to it instead of us (real
 * citationCount), and - when a related worklist move exists - the one
 * strongest "steal this" link into /worklist.
 */

const MAX_DOMAINS_SHOWN = 6;

/** For a domain, find the strongest related move: the ActionPack with the
 *  most competitor pages to beat that includes one of this domain's cited
 *  pages. Returns null when no pack ties back to this domain (no steal-this
 *  link to show). PURE. */
function strongestMoveFor(
  domain: CompetitorRivals["domains"][number],
  actionPacks: CompetitorRivals["actionPacks"],
): CompetitorRivals["actionPacks"][number] | null {
  if (domain.topPages.length === 0) return null;
  const pages = new Set(domain.topPages);
  let best: CompetitorRivals["actionPacks"][number] | null = null;
  for (const ap of actionPacks) {
    if (!ap.competitorPagesToBeat.some((url) => pages.has(url))) continue;
    if (!best || ap.competitorPagesToBeat.length > best.competitorPagesToBeat.length) best = ap;
  }
  return best;
}

export async function CompetitorRivalsSection() {
  const raced = await loadWithDeadline(
    loadCompetitorRivals().catch((): CompetitorRivals | null => null),
  );
  if (raced.timedOut) return null; // self-hiding on a slow cold read too
  const rivals = raced.data;
  if (!rivals || rivals.domains.length === 0) return null; // self-hiding, no empty chrome

  const top = rivals.domains.slice(0, MAX_DOMAINS_SHOWN);

  return (
    <section aria-labelledby="competitor-rivals-heading" className="space-y-3">
      <SectionHeader
        title="Who AI recommends instead of you"
        sub="The sites AI points to instead of you when it answers your buyers' questions, from your cached AI citation data."
      />
      <div className="grid gap-3">
        {top.map((d) => {
          const move = strongestMoveFor(d, rivals.actionPacks);
          return (
            <Card key={d.domain} padding="md">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="text-[15px] font-semibold text-foreground">{d.domain}</span>
                <Pill intent="attention">
                  {d.citationCount} time{d.citationCount === 1 ? "" : "s"} AI pointed here
                </Pill>
              </div>
              {d.topPrompts[0] ? (
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  On &ldquo;{d.topPrompts[0]}&rdquo;
                  {d.topPrompts.length > 1 ? ` and ${d.topPrompts.length - 1} more question${d.topPrompts.length - 1 === 1 ? "" : "s"}` : ""}.
                </p>
              ) : null}
              {move ? (
                <Link
                  href="/worklist"
                  prefetch={false}
                  className="mt-2 inline-flex text-[12px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
                >
                  Steal this: {move.title} →
                </Link>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
