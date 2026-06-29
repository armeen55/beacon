/**
 * Profound Prompt-to-Page Coverage — operator diagnostic (2026-06-26).
 *
 * The decision-engine view: every tracked AI prompt mapped to the right page
 * ACTION, grouped into the operator's actual workflow — fastest wins (pages you
 * already own), new pages to create, hubs to build, internal-link fixes — each
 * ranked, each card a full brief (direct answer, sections, FAQ, schema,
 * competitors to beat). Fuses live Profound prompt intelligence with the owned
 * page universe (GSC + snapshots + GA4 + Clarity) via the pure compileCoverage
 * engine. Read-only, on-demand (no storage, no writes).
 *
 * OPERATOR-ONLY (404s otherwise). This raw breakdown is deliberately not a
 * customer surface — the customer cockpit gets prepared moves, never a gap count
 * as a panic number. Iranopedia-scoped for now (empty state for other tenants).
 */
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { loadCachedProfoundCoverageForTenant } from "@/domains/profound-coverage/load-cached";
import type { AeoActionPack } from "@/domains/profound-coverage/types";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import { RefreshCoverageButton } from "./refresh-button";

export const dynamic = "force-dynamic";

function gate(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

type GroupKey = "fastest" | "new" | "hub" | "links";

const GROUPS: { key: GroupKey; title: string; blurb: string; actions: AeoActionPack["action"][] }[] = [
  { key: "fastest", title: "Fastest wins — pages you already own", blurb: "Add an extractable answer block or expand a page that already ranks. Lowest effort, fastest to cite.", actions: ["add_answer_block", "expand_existing_page"] },
  { key: "new", title: "New pages to create", blurb: "AI is asked these, cites competitors, and you have no page. Build it.", actions: ["create_new_page"] },
  { key: "hub", title: "Hubs to build", blurb: "A cluster of related AI questions with no single owner — one hub page covers the set.", actions: ["create_hub"] },
  { key: "links", title: "Internal-link / consolidation fixes", blurb: "You already cover this — connect or consolidate the pages so the strongest one wins.", actions: ["add_internal_links", "consolidate_pages"] },
];

const ACTION_LABEL: Record<AeoActionPack["action"], string> = {
  add_answer_block: "Add answer block",
  expand_existing_page: "Expand page",
  create_new_page: "Create new page",
  create_hub: "Create hub",
  consolidate_pages: "Consolidate",
  add_internal_links: "Add internal links",
  ignore: "Ignore",
};

const SCHEMA_TONE: Record<AeoActionPack["schemaRecommendation"], string> = {
  FAQPage: "bg-rose-50 text-rose-700 border-rose-200",
  Article: "bg-sky-50 text-sky-700 border-sky-200",
  ItemList: "bg-violet-50 text-violet-700 border-violet-200",
  None: "bg-gray-50 text-gray-500 border-gray-200",
};

function PackCard({ p }: { p: AeoActionPack }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium text-gray-900">{p.prompt}</div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{Math.round(p.priorityScore)}</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">{ACTION_LABEL[p.action]}</span>
        </div>
      </div>

      <div className="mt-1 text-xs text-gray-500">
        {p.targetUrl ? (
          <>Target: <span className="text-gray-700">{p.targetUrl}</span></>
        ) : p.newPageSlug ? (
          <>New page: <span className="text-gray-700">/{p.newPageSlug}</span>{p.title ? <span className="text-gray-400"> · “{p.title}”</span> : null}</>
        ) : (
          "No owned page"
        )}
      </div>

      {p.directAnswerBrief && (
        <p className="mt-2 text-xs text-gray-700"><span className="text-gray-500">Direct answer: </span>{p.directAnswerBrief}</p>
      )}

      {p.sectionsToAdd.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.sectionsToAdd.slice(0, 6).map((s, i) => (
            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={`rounded-full border px-2 py-0.5 font-medium ${SCHEMA_TONE[p.schemaRecommendation]}`}>Schema: {p.schemaRecommendation}</span>
        {p.competitorPagesToBeat.length > 0 && (
          <span className="text-gray-600"><span className="text-gray-400">Beat: </span>{p.competitorPagesToBeat.slice(0, 3).join(", ")}</span>
        )}
      </div>

      {p.faqQuestions.length > 0 && (
        <div className="mt-1 text-xs text-gray-500">Answer these fan-outs: {p.faqQuestions.slice(0, 5).join(" · ")}</div>
      )}
      <div className="mt-2 text-xs text-gray-600">{p.evidence}</div>
      {p.needsSerpValidation && <div className="mt-1 text-[11px] text-amber-600">A SERP check would sharpen this call.</div>}
    </li>
  );
}

export default async function ProfoundCoveragePage() {
  if (!gate()) notFound();
  const tenantId = await currentTenantId();
  const cov = await loadCachedProfoundCoverageForTenant(tenantId);
  const empty = cov.scopeFound && cov.answerRows === 0 && cov.fanoutRows === 0;

  const tiles = [
    { label: "Existing-page fixes", value: cov.summary.existingPage },
    { label: "New pages", value: cov.summary.newPage },
    { label: "Hubs", value: cov.summary.hubPage },
    { label: "Internal-link fixes", value: cov.summary.internalLinkFix },
    { label: "Ignored noise", value: cov.summary.ignoredNoise },
  ];
  const actionable = cov.actionPacks.filter((p) => p.action !== "ignore");
  const groups = GROUPS.map((g) => ({
    ...g,
    packs: actionable.filter((p) => g.actions.includes(p.action)).slice(0, 8),
    total: actionable.filter((p) => g.actions.includes(p.action)).length,
  }));

  // AI crawler + referral coverage (consumes the previously-dead bot/referral tables).
  const aiVisits = await loadBotReferralSignals(tenantId);

  return (
    <div className="space-y-6 p-1">
      <PageHeader
        title="Prompt-to-page coverage"
        description="Every AI question mapped to the exact page move — use an existing page, create a new one, build a hub, or fix links. Ranked by demand × attention × citation concentration."
      />

      {!cov.scopeFound ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
          No Profound prompt-intelligence scope is configured for this tenant yet. (Iranopedia-only for now.)
        </div>
      ) : empty ? (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
          <p>No durable Profound coverage stored yet. Click refresh to pull the live data once (≈20s) — after that this page reads it instantly.</p>
          <RefreshCoverageButton />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">Reading durable Profound coverage (cached, no live API call).</p>
            <RefreshCoverageButton />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">{t.label}</div>
                <div className="mt-1 text-2xl font-semibold text-gray-900">{t.value}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {cov.opportunityCount} AI prompts vs {cov.ownedPageCount} owned pages · from {cov.answerRows} stored answers
            + {cov.fanoutRows} fan-out rows (topic-scoped; no bots/referrals; ownership = owned domain only).
          </p>

          {actionable.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
              No actionable coverage moves for this topic/window yet.
            </div>
          ) : (
            groups
              .filter((g) => g.packs.length > 0)
              .map((g) => (
                <section key={g.key} className="space-y-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">
                      {g.title} <span className="text-gray-400">({g.total})</span>
                    </h2>
                    <p className="text-xs text-gray-500">{g.blurb}</p>
                  </div>
                  <ul className="space-y-3">
                    {g.packs.map((p, i) => (
                      <PackCard key={`${p.promptId ?? p.prompt}-${i}`} p={p} />
                    ))}
                  </ul>
                </section>
              ))
          )}
        </>
      )}

      {/* AI crawler & referral coverage — turns the previously-dead profound_bot_rows /
          profound_referral_rows into honest per-page signals. Renders the real data
          when populated; an honest readiness note (NOT a fabricated signal) when not. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">AI crawler &amp; referral coverage</h2>
        {!aiVisits.hasData ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            <p>
              No AI-crawler or AI-referral rows for this tenant yet
              {aiVisits.latestDate ? ` (latest ${aiVisits.latestDate})` : ""}. This feed
              comes from a <span className="font-medium">site-scoped Profound workspace</span>{" "}
              (Agent Analytics — which AI crawlers hit your pages + which AI assistants send
              visits). The current workspace is topic/prompt-scoped, so these tables stay empty.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              The loader + per-page aggregates are wired and dormant: connect a site-scoped
              workspace and this panel + the proof/Worklist signals populate with zero further code.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              {aiVisits.botSummary.totalHits} AI-crawler hits · {aiVisits.referralSummary.totalVisits} AI-referral visits
              {aiVisits.latestDate ? ` · latest ${aiVisits.latestDate}` : ""} (cached, no live API).
            </p>
            {aiVisits.referralByPath.length > 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Top pages by AI-referral visits</div>
                <ul className="mt-1 space-y-1">
                  {aiVisits.referralByPath.slice(0, 8).map((p) => (
                    <li key={p.path} className="text-xs text-gray-700">
                      <span className="font-medium">{p.visits}</span> · {p.path}
                      <span className="text-gray-400"> · {p.sources.slice(0, 3).map((s) => s.source).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {aiVisits.botByPath.length > 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Top pages by AI-crawler hits</div>
                <ul className="mt-1 space-y-1">
                  {aiVisits.botByPath.slice(0, 8).map((p) => (
                    <li key={p.path} className="text-xs text-gray-700">
                      <span className="font-medium">{p.totalHits}</span> · {p.path}
                      <span className="text-gray-400"> · {p.bots.slice(0, 3).map((b) => b.bot).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
