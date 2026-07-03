import Link from "next/link";

/**
 * results-recap (R14a, P1 trust receipts, 2026-07-03) - the "We got this wrong"
 * section on /results, below the verdict bands. The misses-owned-plainly law made
 * a surface: it lists (a) verdicts a later read revised DOWNWARD (a win taken
 * back, a slide into hurting) and (b) changes the 28-day equivalence read PROVED
 * did nothing, each in first person, each linking to its own card. Max 5,
 * newest first, self-hiding when there is nothing to own.
 *
 * PURE selection (buildRecapItems, unit-tested) + a presentational section.
 * Reads ONLY fields already on the ledger records (verdictRevisions persisted by
 * the measureRecord seam; equivalence computed at measure time) - no new stores.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  isDownwardRevision,
  VERDICT_PLAIN,
} from "@/domains/proof-gsc/verdict-revisions";

export type RecapItem = {
  id: string;
  path: string;
  /** Anchor deep link to this record's own card on /results. */
  href: string;
  /** The owned-plainly first sentence. */
  headline: string;
  /** What changed / what we learned. */
  detail: string;
  /** Sort key (newest first). */
  at: string;
};

const MAX_RECAP_ITEMS = 5;

/** Fallback change-type label; the page passes its own richer plainAction. */
function defaultLabel(actionType: string): string {
  return actionType.replace(/_/g, " ");
}

/**
 * Membership rules (pinned by results-recap.test.tsx):
 *  - a record whose verdictRevisions contain a DOWNWARD entry joins with the
 *    retraction voice, keyed on its most recent downward revision;
 *  - otherwise a record whose equivalence read PROVED neutral joins with the
 *    "did not work, here is what we learned" voice;
 *  - max 5 items, newest first; anything else stays off the surface.
 */
export function buildRecapItems(
  ledger: ReadonlyArray<ShippedChangeRecord>,
  labelOf: (actionType: string) => string = defaultLabel,
): RecapItem[] {
  const items: RecapItem[] = [];
  for (const rec of ledger) {
    const href = `/results#proof-${rec.id}`;
    const down = [...(rec.verdictRevisions ?? [])].reverse().find(isDownwardRevision);
    if (down) {
      const headline =
        down.from === "won"
          ? `I called the ${labelOf(rec.actionType)} on ${rec.path} a win too early and took it back.`
          : `The ${labelOf(rec.actionType)} on ${rec.path} turned out worse than my first read.`;
      items.push({
        id: rec.id,
        path: rec.path,
        href,
        headline,
        detail: `Here is what changed: ${down.reason} on ${down.at.slice(0, 10)} showed ${VERDICT_PLAIN[down.to] ?? down.to}.`,
        at: down.at,
      });
      continue;
    }
    if (rec.equivalence?.provenNeutral === true) {
      items.push({
        id: rec.id,
        path: rec.path,
        href,
        headline: `That one did not work: the ${labelOf(rec.actionType)} on ${rec.path}.`,
        detail: `Here is what we learned: ${
          rec.equivalence.sentence ??
          "the full 28-day window proved any effect too small to matter, so I try a different lever on pages like this."
        }`,
        at: rec.measuredAt ?? rec.shippedAt,
      });
    }
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, MAX_RECAP_ITEMS);
}

/** Self-hiding: renders nothing when there is nothing to own. */
export function WeGotThisWrongSection({ items }: { items: RecapItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        We got this wrong
      </h2>
      <p className="mb-2 text-[11px] text-muted-foreground">
        When a later read overturns an early call, I say so here instead of quietly
        rewriting it. Every one of these keeps its full history on its own card.
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="text-[12px] leading-relaxed text-foreground/80">
            <span className="font-medium">{item.headline}</span> {item.detail}{" "}
            <Link
              href={item.href}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              See the full read
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
