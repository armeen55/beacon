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
import { readAllCachedLlmMentions } from "@/domains/serp/dataforseo-llm-mentions";
import { loadTeamScoreboardView } from "@/domains/team-scoreboard/load-team-scoreboard";
import { recordLine } from "@/domains/team-scoreboard/brier";
import { currentTenantSlug } from "@/lib/tenant-context";

type StandupLine = { key: string; line: string; active: boolean };

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Item 38 (2026-07-02) - "5 of 6" style record suffix for a chip, when that specialist has any
 *  settled votes in the last-computed scoreboard. Trivially additive: a lookup map built once from
 *  loadTeamScoreboardView, keyed by the same specialist id the chip already uses. Empty map when
 *  the scoreboard has never run (chips render exactly as before). */
function recordSuffixFor(records: Map<string, string>, key: string): string {
  const r = records.get(key);
  return r ? ` (${r})` : "";
}

async function buildLines(
  tenantId: string,
  picksTonight: number,
  records: Map<string, string>,
): Promise<StandupLine[]> {
  const [daily, clarity, ga4, serp, keywords, aeo, ledger, llmMentions, slug] = await Promise.all([
    safe(() => loadDailyTotalsForTenant(tenantId, 21), []),
    safe(() => loadClarityPageSignalsForTenant(tenantId), new Map()),
    safe(() => loadGa4PageValuesForTenant(tenantId), new Map()),
    safe(() => readCachedSerpPatterns(), new Map()),
    safe(() => readAllCachedKeywordDemand(), []),
    safe(() => loadBotReferralSignals(tenantId), null),
    safe(() => loadShippedChanges(), []),
    safe(() => readAllCachedLlmMentions(), []),
    safe(() => currentTenantSlug(), ""),
  ]);

  const lines: StandupLine[] = [];

  // Search demand: last-7 vs prior-7 from whatever days exist.
  if (daily.length >= 14) {
    const last7 = daily.slice(-7).reduce((s, d) => s + d.clicks, 0);
    const prior7 = daily.slice(-14, -7).reduce((s, d) => s + d.clicks, 0);
    const delta = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;
    lines.push({
      key: "gsc",
      line: `${last7.toLocaleString()} clicks this week${delta != null ? ` (${delta >= 0 ? "+" : ""}${delta}%)` : ""}${recordSuffixFor(records, "gsc")}`,
      active: true,
    });
  }

  // Visitor behavior: pages with routable friction.
  const frictionPages = [...clarity.values()].filter((s) => routeClarityFriction(s) != null).length;
  lines.push({
    key: "clarity",
    line: `${frictionPages > 0 ? `friction on ${frictionPages} page${frictionPages === 1 ? "" : "s"}` : "no new friction"}${recordSuffixFor(records, "clarity")}`,
    active: frictionPages > 0,
  });

  // Live Google results: research coverage.
  const serpCount = serp instanceof Map ? serp.size : 0;
  const kwCount = keywords.length;
  lines.push({
    key: "dataforseo",
    line: `${kwCount > 0 ? `${kwCount.toLocaleString()} keyword volumes, ${serpCount} live searches read` : "no keyword research yet"}${recordSuffixFor(records, "dataforseo")}`,
    active: kwCount > 0,
  });

  // AI citations: crawler + referral reality.
  if (aeo?.hasData) {
    lines.push({
      key: "profound",
      line: `AI sent ${aeo.referralSummary.totalVisits.toLocaleString()} visits, crawled ${aeo.botSummary.pages} pages${recordSuffixFor(records, "profound")}`,
      active: true,
    });
  } else if (llmMentions.length > 0) {
    // Owned AI-visibility (DataForSEO LLM answers): are WE cited for the topics we checked?
    const citedUs = slug
      ? llmMentions.filter((r) => r.mentions.some((m) => m.domain.includes(slug))).length
      : 0;
    lines.push({
      key: "profound",
      line: `AI answers cite you on ${citedUs} of ${llmMentions.length} topic${llmMentions.length === 1 ? "" : "s"} checked${recordSuffixFor(records, "profound")}`,
      active: citedUs > 0,
    });
  } else {
    lines.push({ key: "profound", line: "watching who AI cites for your topics", active: false });
  }

  // Revenue: pages carrying conversion value.
  const moneyPages = [...ga4.values()].filter((v) => (v as { conversions?: number }).conversions ?? 0 > 0).length;
  lines.push({
    key: "ga4",
    line: `${ga4.size > 0 ? `tracking value on ${moneyPages > 0 ? moneyPages : ga4.size} page${ga4.size === 1 ? "" : "s"}` : "no analytics data yet"}${recordSuffixFor(records, "ga4")}`,
    active: ga4.size > 0,
  });

  // Strategist: tonight + the measurement book.
  const measuring = ledger.filter((r) => r.verdict === "measuring").length;
  const won = ledger.filter((r) => r.verdict === "won").length;
  lines.push({
    key: "llm",
    line:
      (picksTonight > 0
        ? `picked ${picksTonight} change${picksTonight === 1 ? "" : "s"} tonight, ${measuring} measuring${won > 0 ? `, ${won} won` : ""}`
        : measuring > 0
          ? `${measuring} change${measuring === 1 ? "" : "s"} measuring${won > 0 ? `, ${won} won` : ""}`
          : "reviewing the next batch") + recordSuffixFor(records, "llm"),
    active: picksTonight > 0 || measuring > 0,
  });

  return lines;
}

/** Item 38 (2026-07-02) - the scoreboard view for this render: the honest one-line footer (which
 *  specialist has called the most winners right so far, with its real won/n number - silent below
 *  5 settled-and-joined picks or when no specialist clears its own sample bar) plus a per-specialist
 *  "5 of 6" record map for the chips. Reads the last-computed scoreboard only (no recompute on
 *  render - that runs from the measure-pass tail). Fail-soft -> no footer, empty record map. */
async function loadScoreboardForStandup(tenantId: string): Promise<{ footer: string | null; records: Map<string, string> }> {
  try {
    const view = await loadTeamScoreboardView(tenantId);
    if (!view) return { footer: null, records: new Map() };
    const records = new Map<string, string>();
    for (const row of view.rows) {
      const line = recordLine(row.overall);
      if (line) records.set(row.specialist, line);
    }
    return { footer: view.footerLine, records };
  } catch {
    return { footer: null, records: new Map() };
  }
}

export async function TeamStandup({ tenantId, picksTonight }: { tenantId: string; picksTonight: number }) {
  try {
    const { footer, records } = await loadScoreboardForStandup(tenantId);
    const lines = await buildLines(tenantId, picksTonight, records);
    if (lines.length === 0) return null;
    return (
      <div className="flex flex-col gap-1.5 beacon-rise-in">
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
        {footer ? <p className="px-1 text-[11.5px] text-slate-500">{footer}</p> : null}
      </div>
    );
  } catch {
    return null;
  }
}
