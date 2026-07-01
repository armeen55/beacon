/**
 * TeamStandup (2026-07-01, FINAL PREMIUM PLAN item 43) - the teammates, at a glance, at the top
 * of Today: each specialist's identity chip with its one-line daily report. This is the "cool
 * teamwork" moment on first paint. Server component; every line is independently fail-soft and
 * honest (a teammate with nothing new says so; a teammate with no data says that). Reuses the
 * request-cached loaders the page already touches, so the strip costs almost nothing extra.
 */
import { teammateOf } from "@/domains/team/identity";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { routeClarityFriction } from "@/domains/recommendation-intelligence/clarity-move-router";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { readCachedSerpPatterns } from "@/domains/serp/research-enrichment-producer";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";

type StandupLine = { key: string; line: string; active: boolean };

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function buildLines(tenantId: string, picksTonight: number): Promise<StandupLine[]> {
  const [daily, clarity, ga4, serp, keywords, aeo, ledger] = await Promise.all([
    safe(() => loadDailyTotalsForTenant(tenantId, 21), []),
    safe(() => loadClarityPageSignalsForTenant(tenantId), new Map()),
    safe(() => loadGa4PageValuesForTenant(tenantId), new Map()),
    safe(() => readCachedSerpPatterns(), new Map()),
    safe(() => readAllCachedKeywordDemand(), []),
    safe(() => loadBotReferralSignals(tenantId), null),
    safe(() => loadShippedChanges(), []),
  ]);

  const lines: StandupLine[] = [];

  // Search demand: last-7 vs prior-7 from whatever days exist.
  if (daily.length >= 14) {
    const last7 = daily.slice(-7).reduce((s, d) => s + d.clicks, 0);
    const prior7 = daily.slice(-14, -7).reduce((s, d) => s + d.clicks, 0);
    const delta = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;
    lines.push({
      key: "gsc",
      line: `${last7.toLocaleString()} clicks this week${delta != null ? ` (${delta >= 0 ? "+" : ""}${delta}%)` : ""}`,
      active: true,
    });
  }

  // Visitor behavior: pages with routable friction.
  const frictionPages = [...clarity.values()].filter((s) => routeClarityFriction(s) != null).length;
  lines.push({
    key: "clarity",
    line: frictionPages > 0 ? `friction on ${frictionPages} page${frictionPages === 1 ? "" : "s"}` : "no new friction",
    active: frictionPages > 0,
  });

  // Live Google results: research coverage.
  const serpCount = serp instanceof Map ? serp.size : 0;
  const kwCount = keywords.length;
  lines.push({
    key: "dataforseo",
    line: kwCount > 0 ? `${kwCount.toLocaleString()} keyword volumes, ${serpCount} live searches read` : "no keyword research yet",
    active: kwCount > 0,
  });

  // AI citations: crawler + referral reality.
  if (aeo?.hasData) {
    lines.push({
      key: "profound",
      line: `AI sent ${aeo.referralSummary.totalVisits.toLocaleString()} visits, crawled ${aeo.botSummary.pages} pages`,
      active: true,
    });
  } else {
    lines.push({ key: "profound", line: "watching who AI cites for your topics", active: false });
  }

  // Revenue: pages carrying conversion value.
  const moneyPages = [...ga4.values()].filter((v) => (v as { conversions?: number }).conversions ?? 0 > 0).length;
  lines.push({
    key: "ga4",
    line: ga4.size > 0 ? `tracking value on ${moneyPages > 0 ? moneyPages : ga4.size} page${ga4.size === 1 ? "" : "s"}` : "no analytics data yet",
    active: ga4.size > 0,
  });

  // Strategist: tonight + the measurement book.
  const measuring = ledger.filter((r) => r.verdict === "measuring").length;
  const won = ledger.filter((r) => r.verdict === "won").length;
  lines.push({
    key: "llm",
    line:
      picksTonight > 0
        ? `picked ${picksTonight} change${picksTonight === 1 ? "" : "s"} tonight, ${measuring} measuring${won > 0 ? `, ${won} won` : ""}`
        : measuring > 0
          ? `${measuring} change${measuring === 1 ? "" : "s"} measuring${won > 0 ? `, ${won} won` : ""}`
          : "reviewing the next batch",
    active: picksTonight > 0 || measuring > 0,
  });

  return lines;
}

export async function TeamStandup({ tenantId, picksTonight }: { tenantId: string; picksTonight: number }) {
  try {
    const lines = await buildLines(tenantId, picksTonight);
    if (lines.length === 0) return null;
    return (
      <section aria-label="Team standup" className="flex flex-wrap gap-2">
        {lines.map((l) => {
          const t = teammateOf(l.key);
          return (
            <span
              key={l.key}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]"
              style={{ background: t.bg, borderColor: `${t.color}33`, color: t.text }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color, opacity: l.active ? 1 : 0.35 }} />
              <span className="font-semibold">{t.short}</span>
              <span style={{ opacity: 0.85 }}>{l.line}</span>
            </span>
          );
        })}
      </section>
    );
  } catch {
    return null;
  }
}
