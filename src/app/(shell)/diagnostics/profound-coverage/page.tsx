/**
 * Profound Prompt-to-Page Coverage — operator diagnostic (2026-06-26).
 *
 * The decision-engine view: every tracked AI prompt mapped to the right page
 * ACTION (use an existing page / create a new page / build a hub / fix internal
 * links / ignore noise), ranked. Fuses live Profound prompt intelligence with
 * the owned-page universe (GSC + snapshots + GA4 + Clarity) via the pure
 * compileCoverage engine. Read-only, on-demand (no storage, no writes).
 *
 * OPERATOR-ONLY (404s otherwise). This raw breakdown is deliberately not a
 * customer surface — the customer cockpit gets prepared moves, never a gap count
 * as a panic number. Iranopedia-scoped for now (empty state for other tenants).
 */
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProfoundCoverageForTenant } from "@/domains/profound-coverage/load";
import type { AeoActionPack } from "@/domains/profound-coverage/types";

export const dynamic = "force-dynamic";

function gate(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

const ACTION_LABEL: Record<AeoActionPack["action"], string> = {
  add_answer_block: "Add answer block",
  expand_existing_page: "Expand page",
  create_new_page: "Create new page",
  create_hub: "Create hub",
  consolidate_pages: "Consolidate / link",
  add_internal_links: "Add internal links",
  ignore: "Ignore",
};
const ACTION_TONE: Record<AeoActionPack["action"], string> = {
  add_answer_block: "bg-rose-50 text-rose-700 border-rose-200",
  expand_existing_page: "bg-emerald-50 text-emerald-700 border-emerald-200",
  create_new_page: "bg-amber-50 text-amber-700 border-amber-200",
  create_hub: "bg-violet-50 text-violet-700 border-violet-200",
  consolidate_pages: "bg-sky-50 text-sky-700 border-sky-200",
  add_internal_links: "bg-sky-50 text-sky-700 border-sky-200",
  ignore: "bg-gray-50 text-gray-500 border-gray-200",
};

export default async function ProfoundCoveragePage() {
  if (!gate()) notFound();
  const tenantId = await currentTenantId();
  const cov = await loadProfoundCoverageForTenant(tenantId);

  const tiles = [
    { label: "Existing-page fixes", value: cov.summary.existingPage },
    { label: "New pages", value: cov.summary.newPage },
    { label: "Hubs", value: cov.summary.hubPage },
    { label: "Internal-link fixes", value: cov.summary.internalLinkFix },
    { label: "Ignored noise", value: cov.summary.ignoredNoise },
  ];
  const packs = cov.actionPacks.filter((p) => p.action !== "ignore").slice(0, 30);

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
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">{t.label}</div>
                <div className="mt-1 text-2xl font-semibold text-gray-900">{t.value}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {cov.opportunityCount} AI prompts vs {cov.ownedPageCount} owned pages · live read of {cov.answerRows} answers
            + {cov.fanoutRows} fan-out rows over 30 days (topic-scoped; no bots/referrals; ownership = owned domain only).
          </p>

          {packs.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
              No actionable coverage moves for this topic/window yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {packs.map((p, i) => (
                <li key={`${p.promptId ?? p.prompt}-${i}`} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-gray-900">{p.prompt}</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{Math.round(p.priorityScore)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_TONE[p.action]}`}>
                        {ACTION_LABEL[p.action]}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {p.targetUrl ? (
                      <>Target: <span className="text-gray-700">{p.targetUrl}</span></>
                    ) : p.newPageSlug ? (
                      <>New: <span className="text-gray-700">/{p.newPageSlug}</span></>
                    ) : (
                      "No owned page"
                    )}
                  </div>
                  {p.competitorPagesToBeat.length > 0 && (
                    <div className="mt-2 text-xs text-gray-700">
                      <span className="text-gray-500">Beat: </span>
                      {p.competitorPagesToBeat.slice(0, 3).join(", ")}
                    </div>
                  )}
                  {p.faqQuestions.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">Fan-outs to answer: {p.faqQuestions.slice(0, 4).join(" · ")}</div>
                  )}
                  <div className="mt-2 text-xs text-gray-600">{p.evidence}</div>
                  {p.needsSerpValidation && (
                    <div className="mt-1 text-[11px] text-amber-600">A SERP check would sharpen this call.</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
