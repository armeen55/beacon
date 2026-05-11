import { PageHeader } from "@/components/data/page-header";

export default function RecommendationsLoading() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Recommendations"
        description="Loading recommendations…"
      />
      <div className="space-y-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border/50 bg-surface-inset/20 px-5 py-4 animate-pulse"
          >
            <div className="h-3 w-24 rounded bg-surface-inset/60" />
            <div className="mt-3 space-y-2">
              <div className="h-12 rounded-md bg-surface-inset/40" />
              <div className="h-12 rounded-md bg-surface-inset/40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
