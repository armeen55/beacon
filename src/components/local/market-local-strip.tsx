import Link from "next/link";
import { cn } from "@/lib/utils";
import type { MarketLocalStripModel } from "@/lib/local-presence";

function napTone(state: MarketLocalStripModel["napState"]): string {
  if (state === "inconsistent") return "text-status-danger";
  if (state === "incomplete") return "text-status-warning";
  return "";
}

export function MarketLocalStrip({ model, className }: { model: MarketLocalStripModel; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Local presence summary"
      className={cn(
        "flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2 text-[11px] leading-snug text-muted-foreground",
        className,
      )}
    >
      <span>
        <span className="font-medium text-foreground/85">Listing health:</span>{" "}
        {model.healthTierLabel}
      </span>
      <span className="text-border/70 select-none" aria-hidden>
        ·
      </span>
      <span>
        <span className="font-medium text-foreground/85">NAP:</span>{" "}
        <span className={napTone(model.napState)}>{model.napDisplay}</span>
      </span>
      <span className="text-border/70 select-none" aria-hidden>
        ·
      </span>
      <span>
        <span className="font-medium text-foreground/85">Reviews:</span> {model.reviewLine}
      </span>
      <span className="text-border/70 select-none" aria-hidden>
        ·
      </span>
      <Link href="/local" className="font-medium text-accent-primary hover:underline shrink-0">
        Local presence →
      </Link>
      {model.listingCompletenessPhrase && (
        <span className="w-full text-[10px] text-muted-foreground/65">{model.listingCompletenessPhrase}</span>
      )}
      <span className="w-full text-[10px] text-muted-foreground/75">{model.footnote}</span>
    </div>
  );
}
