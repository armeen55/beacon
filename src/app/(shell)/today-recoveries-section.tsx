import { currentTenantId } from "@/lib/tenant-context";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { loadPageClicksInRange } from "@/domains/recommendation-intelligence/gsc-page-queries";
import {
  buildRecoveryWins,
  recoveryClicksRegained,
  type RecoveryInput,
} from "./today-recoveries-rows";

/**
 * today-recoveries-section (2026-06-25) — the payoff of the recover loop: pages you
 * SHIPPED a fix on whose Google clicks have since climbed. Derived from the shipped
 * ledger + before/after GSC clicks around each ship date (no new storage). Only
 * shows changes that have had ≥21 days to measure. Self-hides when there are none.
 */

const WINDOW_DAYS = 28;
const MIN_DAYS_ELAPSED = 21;

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}
function isoOffset(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export async function TodayRecoveriesSection() {
  let wins: ReturnType<typeof buildRecoveryWins> = [];
  try {
    const tenantId = await currentTenantId();
    const shipped = await loadShippedChanges().catch(() => []);
    const now = new Date();
    // Only changes old enough to have a meaningful after-window.
    const eligible = shipped.filter((s) => {
      if (!s.page || !s.shippedAt) return false;
      const ship = new Date(s.shippedAt);
      if (Number.isNaN(ship.getTime())) return false;
      return (now.getTime() - ship.getTime()) / 86_400_000 >= MIN_DAYS_ELAPSED;
    });
    if (eligible.length === 0) return null;

    const inputs: RecoveryInput[] = [];
    for (const s of eligible) {
      const ship = new Date(s.shippedAt);
      const before = await loadPageClicksInRange(
        tenantId,
        [s.page],
        isoOffset(ship, -WINDOW_DAYS),
        isoOffset(ship, 0),
      ).catch(() => new Map<string, number>());
      const after = await loadPageClicksInRange(
        tenantId,
        [s.page],
        isoOffset(ship, 0),
        isoOffset(ship, WINDOW_DAYS),
      ).catch(() => new Map<string, number>());
      const beforeClicks = before.get(s.page) ?? [...before.values()][0] ?? 0;
      const afterClicks = after.get(s.page) ?? [...after.values()][0] ?? 0;
      if (beforeClicks === 0 && afterClicks === 0) continue;
      inputs.push({ page: s.page, label: slugOf(s.page), beforeClicks, afterClicks });
    }
    wins = buildRecoveryWins(inputs);
  } catch {
    return null;
  }
  if (wins.length === 0) return null;

  const regained = recoveryClicksRegained(wins);

  return (
    <section className="rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/30 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-emerald-500">✓</span> Pages you&apos;ve turned around
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Changes you shipped that are paying off — these pages are getting more Google clicks now than
            in the 28 days before you fixed them. Proof your work is moving the needle.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-emerald-600">+{fmtNum(regained)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly clicks regained</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {wins.map((w, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  w.status === "recovered" ? "bg-emerald-100 text-emerald-700" : "bg-teal-100 text-teal-700"
                }`}
              >
                {w.status === "recovered" ? "Recovered" : "Improving"}
              </span>
              <span className="truncate font-medium text-gray-900">{w.label}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500">
                {w.beforeClicks.toLocaleString()} → {w.afterClicks.toLocaleString()} clicks/mo
              </span>
              <span className="font-semibold text-emerald-600">+{w.deltaPct}%</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
