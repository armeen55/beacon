import Link from "next/link";

/**
 * Customer-safe "not found" state for /recommendations/[id].
 *
 * Bundle 2B (2026-05-10): rendered when the route param doesn't match
 * any current queue / watchlist row, or when the loader fails to
 * produce a matrix. Calm copy; no internal vocabulary; one-click
 * route back to the recommendations list.
 */
export function RecommendationDetailNotFound() {
  return (
    <div
      className="max-w-4xl"
      data-recommendations-detail-not-found="true"
    >
      <Link
        href="/recommendations?v2=1"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        data-recommendations-detail-back="true"
      >
        ← Recommendations
      </Link>

      <section
        className="mt-6 rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
        role="status"
      >
        <p className="text-[14px] font-semibold text-foreground">
          This recommendation is no longer available.
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
          Beacon may have already resolved or dismissed it.
        </p>
        <Link
          href="/recommendations?v2=1"
          className="mt-4 inline-flex text-[12px] font-semibold text-accent-primary hover:underline"
          data-recommendations-detail-back-cta="true"
        >
          Back to recommendations →
        </Link>
      </section>
    </div>
  );
}
