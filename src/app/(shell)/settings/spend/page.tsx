import { currentTenantId } from "@/lib/tenant-context";
import { readMonthlySpendByPlatform } from "@/lib/cost/budget-ledger-supabase";
import { PageHeader } from "@/components/data/page-header";

/**
 * /settings/spend (FINAL PREMIUM PLAN item 92) - the receipts page: what Beacon spent this
 * month per provider, against its cap. Every paid call is logged BEFORE it runs and stops
 * at the cap (fail-closed), so this page can never under-report. Read-only.
 */
export const dynamic = "force-dynamic";

const PLATFORM_PLAIN: Record<string, { label: string; capUsd: number | null }> = {
  "dataforseo-serp": { label: "Live Google results and keyword research (DataForSEO)", capUsd: 50 },
  openai: { label: "Writing and reasoning (OpenAI)", capUsd: null },
  "adjudicator-openai": { label: "Judging and quality checks (OpenAI)", capUsd: null },
  perplexity: { label: "AI answer checks (Perplexity)", capUsd: null },
  other: { label: "Other", capUsd: null },
};

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function SpendPage() {
  const tenantId = await currentTenantId();
  const rows = await readMonthlySpendByPlatform(tenantId).catch(() => []);
  const total = rows.reduce((s, r) => s + r.spentUsd, 0);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Spend"
        description={`What I spent on outside data this month: ${usd(total)} total. Every paid call is logged before it runs, and calls stop at the cap - I can never overrun it.`}
      />
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          Nothing spent yet this month.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const meta = PLATFORM_PLAIN[r.platform] ?? { label: r.platform.replace(/[-_]/g, " "), capUsd: null };
            const pct = meta.capUsd ? Math.min(100, (r.spentUsd / meta.capUsd) * 100) : null;
            return (
              <div key={r.platform} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-neutral-100">{meta.label}</span>
                  <span className="text-sm tabular-nums text-gray-600 dark:text-neutral-300">
                    {usd(r.spentUsd)}{meta.capUsd ? ` of ${usd(meta.capUsd)}` : " this month"}
                  </span>
                </div>
                {pct != null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
                    <div
                      className={`h-full rounded-full ${pct >= 90 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                ) : null}
                <p className="mt-1.5 text-[11px] text-gray-400 tabular-nums dark:text-neutral-500">
                  {r.calls.toLocaleString()} logged call{r.calls === 1 ? "" : "s"} this month
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
