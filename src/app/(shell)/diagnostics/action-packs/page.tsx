/**
 * /diagnostics/action-packs — the ONE unified worklist (Core Consolidation Phase D).
 *
 * Every recommendation source (demand-graph R&R Moves + profound-coverage packs)
 * normalized into the single ActionPack model, deduped, ranked. Shows the
 * collapse (raw → unified), per-source coverage, and the top moves per family.
 * Operator-only (404s otherwise). Read-only; NO live Profound API on render
 * (coverage from the durable cached store). This is the surface that must match
 * or beat the legacy surfaces before any legacy ranking path is removed (Phase E).
 */
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { ACTION_LABEL, actionFamily, type ActionPack } from "@/domains/action-pack/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function gate(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

const SOURCE_TONE: Record<string, string> = {
  rank_revenue: "bg-blue-50 text-blue-700",
  profound: "bg-violet-50 text-violet-700",
  dataforseo: "bg-sky-50 text-sky-700",
  gsc: "bg-emerald-50 text-emerald-700",
  ga4: "bg-amber-50 text-amber-700",
  clarity: "bg-rose-50 text-rose-700",
  competitor_teardown: "bg-gray-100 text-gray-600",
};

function PackRow({ p }: { p: ActionPack }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-900">{p.label}</div>
          <div className="truncate text-xs text-gray-500">{p.targetUrl ?? (p.newPageSlug ? `/${p.newPageSlug}` : "—")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{p.priorityScore.toLocaleString()}</span>
          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700">{ACTION_LABEL[p.actionType]}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-400">{p.confidence}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {p.evidenceSources.map((s) => (
          <span key={s} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_TONE[s] ?? "bg-gray-100 text-gray-600"}`}>{s}</span>
        ))}
      </div>
      <div className="mt-1.5 text-xs text-gray-600">{p.whyNotNoise}</div>
    </li>
  );
}

function Section({ title, blurb, packs }: { title: string; blurb: string; packs: ActionPack[] }) {
  if (packs.length === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title} <span className="text-gray-400">({packs.length} shown)</span></h2>
        <p className="text-xs text-gray-500">{blurb}</p>
      </div>
      <ul className="space-y-2">{packs.map((p, i) => <PackRow key={`${p.id}-${i}`} p={p} />)}</ul>
    </section>
  );
}

export default async function ActionPacksPage({ searchParams }: { searchParams?: Promise<{ mode?: string }> }) {
  if (!gate()) notFound();
  const tenantId = await currentTenantId();
  const mode = (await searchParams)?.mode === "full" ? "full" : "fast";
  const wl = await loadActionPackWorklistForTenant(tenantId, { mode });
  const s = wl.summary;

  const fam = (f: ReturnType<typeof actionFamily>, n: number) => wl.packs.filter((p) => actionFamily(p.actionType) === f).slice(0, n);

  const tiles = [
    { label: "Unified packs", value: s.total },
    { label: "Existing-page fixes", value: s.byFamily.existing_page },
    { label: "New pages", value: s.byFamily.new_page },
    { label: "Hubs", value: s.byFamily.hub },
    { label: "Link / consolidation", value: s.byFamily.links },
  ];

  return (
    <div className="space-y-5 p-1">
      <PageHeader
        title="Unified action packs (one brain)"
        description="Every recommendation source — Rank-&-Revenue Moves + Profound coverage — normalized into one ranked changes list, deduped. The surface that replaces the competing legacy paths."
      />

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className={`rounded px-1.5 py-0.5 font-medium ${mode === "fast" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{mode} mode</span>
        <span>{mode === "fast" ? "Bounded reads (canonical default)." : "Full evidence read (deep diagnostic)."}</span>
        <a href={`/diagnostics/action-packs?mode=${mode === "fast" ? "full" : "fast"}`} className="text-blue-600 underline">switch to {mode === "fast" ? "full" : "fast"}</a>
      </div>

      {s.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Degraded:</span>
          <ul className="ml-4 list-disc">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <div>
          Collapse: <span className="font-semibold text-gray-800">{s.rawFromRankRevenue}</span> R&amp;R + <span className="font-semibold text-gray-800">{s.rawFromProfoundCoverage}</span> coverage ={" "}
          <span className="font-semibold text-gray-800">{s.rawFromRankRevenue + s.rawFromProfoundCoverage}</span> raw → <span className="font-semibold text-gray-900">{s.total}</span> unified
          {" "}(<span className="font-semibold text-amber-700">{s.duplicatesRemoved}</span> duplicates merged · {s.ignoredNoise} ignored as noise)
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-gray-400">Source coverage:</span>
          {Object.entries(s.sourceCoverage).filter(([, n]) => n > 0).map(([k, n]) => (
            <span key={k} className={`rounded px-1.5 py-0.5 ${SOURCE_TONE[k] ?? ""}`}>{k}: {n}</span>
          ))}
        </div>
      </div>

      {wl.packs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">No unified action packs for this tenant yet.</div>
      ) : (
        <>
          <Section title="Top existing-page fixes" blurb="Edit / answer-block / title-meta / friction on pages you own — fastest wins." packs={fam("existing_page", 10).concat(fam("cro", 10)).sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 10)} />
          <Section title="Top new pages" blurb="AI/Google cite competitors for a topic you have no page for." packs={fam("new_page", 10)} />
          <Section title="Top hubs" blurb="A cluster of related AI questions with no single owner — one hub covers the set." packs={fam("hub", 10)} />
          <Section title="Link / consolidation" blurb="Connect or consolidate competing pages so the strongest one wins." packs={fam("links", 10)} />
        </>
      )}
    </div>
  );
}
