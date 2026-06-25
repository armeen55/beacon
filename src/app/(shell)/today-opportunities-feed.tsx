import Link from "next/link";
import { currentTenantId } from "@/lib/tenant-context";
import {
  loadTopDecliningPagesForTenant,
  loadTopStrikingPagesForTenant,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import { clicksAtStakeForStriking } from "@/domains/recommendation-intelligence/ctr-curve";
import { workbenchHref } from "@/domains/insight/workbench-route";
import { buildOpportunityFeed, feedClicksAtStake } from "./today-opportunities-feed-rows";

/**
 * today-opportunities-feed (2026-06-25) — the headline "do these first" list: the
 * §2 promise made literal. Fuses the two rank axes (recover declines + win
 * striking-distance) into ONE feed ranked by estimated monthly clicks at stake, so
 * the operator's eye lands on the single highest-impact handful before the detailed
 * per-axis sections below. Self-hides when nothing clears the bar.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}

export async function TodayOpportunitiesFeed() {
  let items: ReturnType<typeof buildOpportunityFeed> = [];
  try {
    const tenantId = await currentTenantId();
    const [declines, striking] = await Promise.all([
      loadTopDecliningPagesForTenant(tenantId).catch(() => []),
      loadTopStrikingPagesForTenant(tenantId).catch(() => []),
    ]);
    items = buildOpportunityFeed(declines, striking, clicksAtStakeForStriking);
  } catch {
    return null;
  }
  if (items.length === 0) return null;

  const totalClicks = feedClicksAtStake(items);

  return (
    <section className="rounded-3xl border border-violet-200/70 bg-gradient-to-br from-violet-50/60 via-white to-sky-50/40 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-violet-500">★</span> Biggest opportunities right now
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Your highest-impact moves across the whole site, ranked by the clicks at stake — whether you&apos;re
            losing them or just within reach of winning them. Start at the top.
          </p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-violet-600">~{fmtNum(totalClicks)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly clicks at stake</div>
        </div>
      </div>

      <ol className="mt-5 space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">
                {i + 1}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  it.kind === "recover" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {it.kind === "recover" ? "Recover" : "Win"}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-gray-900">{it.query}</span>
                <span className="ml-2 text-xs text-gray-400">on {slugOf(it.page)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-violet-600">~{fmtNum(it.clicksAtStake)} clicks/mo</span>
              <Link href={workbenchHref(it.page)} className="font-semibold text-violet-600 hover:text-violet-800">
                Act →
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
