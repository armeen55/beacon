/**
 * Operator Page Factory — 2026-06-10 (P0 wall 4: the factory's first
 * caller). Paste a cluster plan → LLM-generate structured CMS drafts →
 * create_page cards land in the SAME approve queue as everything else.
 * Pushing them walks the capped push path after the approve click —
 * nothing ships from this page.
 *
 * Operator-only: 404s without BEACON_OPERATOR_MODE (same gate as the
 * sibling diagnostics surfaces).
 */

import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { MAX_ITEMS_PER_RUN } from "@/domains/push/cluster-factory";
import { runFactoryFromForm } from "./actions";

export const dynamic = "force-dynamic";

const EXAMPLE_PLAN = `{
  "name": "Persian Food",
  "dataCollectionId": "<wix collection id>",
  "slugField": "slug",
  "urlPrefix": "/persian-food",
  "siteBaseUrl": "https://www.iranopedia.com",
  "fields": [
    { "field": "title", "instruction": "Dish name", "maxWords": 8 },
    { "field": "description", "instruction": "What it is, key ingredients, how it is served", "maxWords": 150 }
  ],
  "items": [
    { "slug": "ghormeh-sabzi", "title": "Ghormeh Sabzi", "brief": "the herb stew — Iran's unofficial national dish" }
  ],
  "contentRules": ["Call the language Persian, never Farsi."],
  "flaggedTerms": ["Farsi"]
}`;

export default async function FactoryDiagnosticPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isOperatorModeServer()) notFound();
  const params = await searchParams;
  const one = (k: string): string | null => {
    const v = params[k];
    return typeof v === "string" ? v : null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Page factory"
        description={`Generate a cluster of new pages as drafts (max ${MAX_ITEMS_PER_RUN} per run). Drafts land in the queue — nothing publishes without your approve click.`}
      />

      {one("ok") && (
        <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/30 p-3 text-sm">
          Generated {one("persisted")} draft card(s) into the queue
          {one("flagged") !== "0" ? ` · ${one("flagged")} flagged for review` : ""}
          {one("rejected") !== "0" ? ` · ${one("rejected")} hard-rejected (content rules)` : ""}
          {" · "}cost ${one("cost")}
          {one("sync_warning") ? ` · sync warning: ${one("sync_warning")}` : ""}
        </div>
      )}
      {one("error") && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm">
          {one("error") === "not_authorized" && "You're not authorized to run the factory for this tenant."}
          {one("error") === "bad_plan" && `Plan rejected: ${one("detail") ?? "invalid"}`}
          {one("error") === "budget_exhausted" && `Daily budget reached — ${one("detail") ?? ""}`}
          {one("error") === "llm_disabled" && `LLM generation is off (${one("detail") ?? "set BEACON_LLM_PROVIDER=openai + OPENAI_API_KEY"}). The factory never fabricates deterministic content.`}
          {one("error") === "too_many_items" && `Too many items: ${one("detail") ?? ""}`}
          {one("error") === "api_error" && `Generation failed: ${one("detail") ?? ""}`}
        </div>
      )}

      <form action={runFactoryFromForm} className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="plan_json">
          Cluster plan (JSON)
        </label>
        <textarea
          id="plan_json"
          name="plan_json"
          rows={18}
          defaultValue={EXAMPLE_PLAN}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 font-mono text-xs"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
        >
          Generate drafts into the queue
        </button>
        <p className="text-xs text-neutral-400">
          Each item costs a fraction of a cent; runs are capped at {MAX_ITEMS_PER_RUN} items and
          refuse once today&apos;s tenant budget is spent. Banned-term violations are
          hard-rejected and reported here.
        </p>
      </form>
    </div>
  );
}
