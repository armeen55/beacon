/**
 * Profound Question Intelligence — operator diagnostic (2026-06-26).
 *
 * Shows the live per-PROMPT AEO picture for the tenant's Profound topic: which
 * AI questions exist, where you're cited/mentioned vs absent, the exact pages AI
 * cites instead, and the fan-out queries each prompt expands into. Read-only,
 * on-demand (no storage). Operator-gated; 404s otherwise. Iranopedia-scoped for
 * now (getProfoundTenantScope returns null for other tenants → empty state).
 */
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProfoundPromptIntelligence } from "@/domains/profound-question-intelligence/load";
import { BriefButton } from "./brief-button";

export const dynamic = "force-dynamic";

function gate(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

const MOVE_LABEL: Record<string, string> = {
  answer_block: "Add answer block",
  expand_page: "Expand page",
  create_page: "Create page",
  source_gap: "Be the source",
};
const MOVE_TONE: Record<string, string> = {
  answer_block: "bg-rose-50 text-rose-700 border-rose-200",
  expand_page: "bg-emerald-50 text-emerald-700 border-emerald-200",
  create_page: "bg-amber-50 text-amber-700 border-amber-200",
  source_gap: "bg-sky-50 text-sky-700 border-sky-200",
};

export default async function ProfoundIntelligencePage() {
  if (!gate()) notFound();
  const tenantId = await currentTenantId();
  const intel = await loadProfoundPromptIntelligence(tenantId);

  return (
    <div className="space-y-6 p-1">
      <PageHeader
        title="AI question intelligence"
        description="What AI assistants are actually asked about you, who they cite instead, and the exact pages to win — from Profound, per prompt."
      />

      {!intel.scopeFound ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
          No Profound prompt-intelligence scope is configured for this tenant yet.
          (Iranopedia-only for now.)
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Topic", value: intel.topicLabel ?? "—" },
              { label: "Prompts", value: String(intel.totalPrompts) },
              { label: "Gaps (you're absent)", value: String(intel.gapPrompts) },
              { label: "You're cited / mentioned", value: String(intel.ownPresentPrompts) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">{s.label}</div>
                <div className="mt-1 text-2xl font-semibold text-gray-900">{s.value}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            Live read from {intel.answerRows} AI answers + {intel.fanoutRows} fan-out rows over the last 30 days
            (topic-scoped; no bots/referrals; ownership = iranopedia.com only).
          </p>

          {intel.opportunities.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
              No prompts returned yet for this topic/window.
            </div>
          ) : (
            <ul className="space-y-3">
              {intel.opportunities.slice(0, 40).map((o, i) => (
                <li key={`${o.promptId ?? o.prompt}-${i}`} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-gray-900">{o.prompt}</div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${MOVE_TONE[o.recommendedMove] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                      {MOVE_LABEL[o.recommendedMove] ?? o.recommendedMove}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {o.executions} AI answer{o.executions === 1 ? "" : "s"} · {o.models.length} model{o.models.length === 1 ? "" : "s"}
                    {o.ownCitationCount > 0 ? ` · you're cited (${o.ownCitationCount})` : o.ownMentionCount > 0 ? ` · you're mentioned (${o.ownMentionCount})` : " · you're absent"}
                    {o.fanoutQueries.length > 0 ? ` · ${o.fanoutQueries.length} fan-out queries` : ""}
                  </div>
                  {o.topCitedPages.length > 0 && (
                    <div className="mt-2 text-xs text-gray-700">
                      <span className="text-gray-500">AI cites now: </span>
                      {o.topCitedPages.map((p, j) => (
                        <span key={p.url} className={p.isOwned ? "font-semibold text-emerald-700" : ""}>
                          {j > 0 ? ", " : ""}{p.hostname}{p.isOwned ? " (you)" : ""}×{p.answers}
                        </span>
                      ))}
                    </div>
                  )}
                  {o.fanoutQueries.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      Fan-outs: {o.fanoutQueries.slice(0, 6).join(" · ")}
                    </div>
                  )}
                  <BriefButton
                    input={{
                      prompt: o.prompt,
                      fanoutQueries: o.fanoutQueries,
                      competitorPages: o.topCitedPages.filter((p) => !p.isOwned).map((p) => p.url),
                      ownCitedUrls: o.ownCitedUrls,
                      recommendedMove: o.recommendedMove,
                      tags: o.tags,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
