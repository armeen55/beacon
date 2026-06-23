/**
 * /prompts/[id] v2B — calm not-found state.
 *
 * Rendered when the route id doesn't match any tracked prompt
 * (Beacon may have just paused it, or the customer followed a
 * stale link). Mirrors the Changes / Recommendations not-found
 * pattern: short title + plain-English explanation + one CTA
 * back to the v2 list.
 *
 * No internal vocabulary. No raw ids in copy. Pure presentation.
 */
import Link from "next/link";

export function PromptDetailV2NotFound() {
  return (
    <div
      className="max-w-3xl"
      data-prompt-detail-not-found="true"
    >
      <p className="mb-4 text-[12px]">
        <Link
          href="/prompts?v2=1"
          className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
          data-prompt-detail-not-found-back="true"
        >
          ← Prompts
        </Link>
      </p>
      <section
        className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-6"
        aria-labelledby="prompt-detail-not-found-heading"
      >
        <h2
          id="prompt-detail-not-found-heading"
          className="text-[14px] font-semibold text-foreground tracking-tight"
        >
          This prompt is no longer available.
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Beacon may have paused it, or it was removed. Your list of
          tracked questions is up to date.
        </p>
        <Link
          href="/prompts?v2=1"
          className="mt-4 inline-flex text-[12px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          data-prompt-detail-not-found-cta="back-to-prompts"
        >
          Back to prompts →
        </Link>
      </section>
    </div>
  );
}
