export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { loadCompetitorIntel, type CompetitorIntel } from "@/domains/competitors/load-competitor-intel";
import { ReadQueueButton } from "./read-queue-button";

/**
 * /competitors (2026-06-28 — ActionPack execution loop, Phase 6) — the real enemy
 * map: who AI/Google cite instead of this tenant, the pages they win with, and the
 * ActionPacks that beat them. Built from cached sources only (ActionPack worklist
 * profound receipts + competitorPagesToBeat + the competitor-page-audit teardown
 * cache) — no seed/demo data, no connect-data empty state, no SEMrush, no live API.
 */

const SOURCE_LABEL: Record<string, string> = {
  gsc: "Google Search", ga4: "Analytics", clarity: "Clarity UX",
  profound: "AI citations", dataforseo: "Live SERP",
  competitor_teardown: "Competitor teardown", rank_revenue: "Demand graph",
};

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

const TEARDOWN_BADGE: Record<CompetitorIntel["pages"][number]["teardownStatus"], { label: string; cls: string }> = {
  read: { label: "Read", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  blocked: { label: "Blocked", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  not_read: { label: "Not read yet", cls: "bg-gray-100 text-gray-500 ring-gray-200" },
};

function prettyUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

async function CompetitorsBody() {
  const intel = await loadCompetitorIntel().catch(() => null);
  if (!intel || intel.domains.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No competitor citations yet. Once your AI prompt intelligence syncs, the domains and pages AI
        cites instead of you appear here, with the moves to beat them.
      </p>
    );
  }
  const s = intel.summary;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile value={String(s.competitorDomains)} label="Competitor domains" accent="text-gray-900" />
        <StatTile value={String(s.competitorPages)} label="Pages they win" accent="text-violet-600" />
        <StatTile value={String(s.aiCitedDomains)} label="AI-cited domains" accent="text-sky-600" />
        <StatTile value={String(s.pagesTornDown)} label="Pages read" accent="text-emerald-600" />
        <StatTile value={String(s.actionPacksToBeatCompetitors)} label="Moves to beat them" accent="text-indigo-600" />
      </div>

      {/* Read these first — the prioritized action queue (replaces the doom number). */}
      {intel.readQueue.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            {(() => {
              const unread = intel.readQueue.filter((r) => r.teardownStatus === "not_read").length;
              return (
                <>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Read these competitor pages first</h2>
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      Your highest-priority competitor pages — read the unread ones first; read ones show what wins.
                      {intel.gaps.notTornDown > 0 ? ` (${intel.gaps.notTornDown} unread in total.)` : ""}
                    </p>
                  </div>
                  {unread > 0 ? <ReadQueueButton unread={unread} /> : null}
                </>
              );
            })()}
          </div>
          <div className="grid gap-2">
            {intel.readQueue.map((item, i) => (
              <div key={item.url} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-gray-400">{i + 1}</span>
                    <a href={item.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-gray-900 underline-offset-2 hover:underline">
                      {prettyUrl(item.url)}
                    </a>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${TEARDOWN_BADGE[item.teardownStatus].cls}`}>
                    {TEARDOWN_BADGE[item.teardownStatus].label}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-600"><span className="font-medium text-gray-700">Why first:</span> {item.why}</p>
                {item.prompt ? <p className="mt-0.5 text-[11px] text-gray-500">Cited for “{item.prompt}”</p> : null}
                {item.whatWins ? (
                  <p className="mt-0.5 text-[11px] text-emerald-700"><span className="font-medium">What wins:</span> {item.whatWins}</p>
                ) : null}
                {item.moveLabel ? <p className="mt-1 text-[11px] font-medium text-indigo-600">Beat it: {item.moveLabel} →</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Top competitor domains */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Who AI cites instead of you</h2>
        <div className="grid gap-3">
          {intel.domains.slice(0, 10).map((d) => (
            <div key={d.domain} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-gray-900">{d.domain}</span>
                <span className="text-[11px] text-gray-500">
                  {d.citationCount} citation{d.citationCount === 1 ? "" : "s"} · {d.promptCount} prompt{d.promptCount === 1 ? "" : "s"} · {d.actionPackCount} move{d.actionPackCount === 1 ? "" : "s"} to beat them
                </span>
              </div>
              {d.topPrompts.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {d.topPrompts.map((p, i) => (
                    <li key={i} className="text-[12px] text-gray-600">“{p}”</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Pages to beat */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Pages to beat</h2>
        <div className="grid gap-2">
          {intel.pages.slice(0, 20).map((pg) => {
            const badge = TEARDOWN_BADGE[pg.teardownStatus];
            return (
              <div key={pg.url} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <a href={pg.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-gray-900 underline-offset-2 hover:underline">
                    {prettyUrl(pg.url)}
                  </a>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${badge.cls}`}>{badge.label}</span>
                </div>
                {pg.prompts[0] ? <p className="mt-1 text-[11px] text-gray-500">Cited for “{pg.prompts[0]}”</p> : null}
                {pg.whatWins ? (
                  <p className="mt-1 text-[11px] text-gray-600"><span className="font-medium text-gray-700">What wins:</span> {pg.whatWins}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-gray-400">Teardown {pg.teardownStatus === "blocked" ? "blocked" : "not read yet"}.</p>
                )}
                {pg.actionPackLabel ? (
                  <p className="mt-1.5 text-[11px] font-medium text-indigo-600">Beat it: {pg.actionPackLabel} →</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* Moves caused by competitors */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Moves to beat competitors</h2>
          <Link href="/worklist" className="text-[12px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
            Open the worklist →
          </Link>
        </div>
        <div className="grid gap-2">
          {intel.actionPacks.slice(0, 12).map((ap) => (
            <div key={ap.actionPackId} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium text-gray-900">{ap.title}</span>
                <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">{ap.action}</span>
                {ap.evidenceSources.map((s2) => (
                  <span key={s2} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">{SOURCE_LABEL[s2] ?? s2}</span>
                ))}
              </div>
              {ap.competitorPagesToBeat[0] ? (
                <p className="mt-1 text-[11px] text-gray-500">vs {prettyUrl(ap.competitorPagesToBeat[0])}{ap.competitorPagesToBeat.length > 1 ? ` +${ap.competitorPagesToBeat.length - 1}` : ""}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Coverage — secondary, not a doom banner. The read queue above is the action. */}
      {intel.gaps.notTornDown > 0 || intel.gaps.needsSerpValidation > 0 ? (
        <p className="text-[11px] text-gray-400">
          Coverage:{" "}
          {intel.gaps.notTornDown > 0 ? `${intel.gaps.notTornDown} competitor page${intel.gaps.notTornDown === 1 ? "" : "s"} not read yet` : ""}
          {intel.gaps.notTornDown > 0 && intel.gaps.needsSerpValidation > 0 ? " · " : ""}
          {intel.gaps.needsSerpValidation > 0 ? `${intel.gaps.needsSerpValidation} move${intel.gaps.needsSerpValidation === 1 ? "" : "s"} not SERP-validated` : ""}
          . Work the prioritized queue above first.
        </p>
      ) : null}
    </div>
  );
}

export default function CompetitorsPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Competitors"
        description="Who AI and Google cite instead of you, the pages they win with, and the moves to beat them."
      />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}>
        <CompetitorsBody />
      </Suspense>
    </div>
  );
}
