import Link from "next/link";
import type { TodayLocalAttention } from "@/lib/local-presence";

export function TodayLocalAttentionStrip({ attention }: { attention: TodayLocalAttention }) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
      aria-labelledby="today-local-attention-heading"
    >
      <h2
        id="today-local-attention-heading"
        className="text-[12px] font-semibold text-foreground tracking-tight"
      >
        {attention.headline}
      </h2>
      <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground leading-relaxed list-disc pl-4">
        {attention.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <Link
        href={attention.href}
        className="mt-3 inline-flex text-[11px] font-semibold text-accent-primary hover:underline"
      >
        Review local presence →
      </Link>
      <p className="mt-2 text-[10px] text-muted-foreground/80">{attention.footnote}</p>
    </section>
  );
}
