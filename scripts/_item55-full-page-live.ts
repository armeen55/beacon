/**
 * _item55-full-page-live.ts (BEACON 500 item 55) — one REAL Iranopedia full-page
 * draft through the new pipeline (draftFullPageStructured -> assembleDraftPage ->
 * persist as move_drafts kind=full_page_draft). Picks the newest persisted
 * create_page_brief (preferring a BUILD serp_verdict) and walks its outline.
 *
 * SPENDS real OpenAI money (~$0.02-0.05) through the budget-gated callStructuredLLM.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/_item55-full-page-live.ts
 */
import { createClient } from "@supabase/supabase-js";
import {
  draftFullPageStructured,
  assembleDraftPage,
  serializeFullPageDraft,
  type FullPageBriefInput,
} from "@/domains/llm/draft-full-page";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { evaluateSectionDraftQuality } from "@/domains/drafts/draft-quality";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID ?? "";
  if (!tenantId) throw new Error("BEACON_TENANT_ID not set");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await sb
    .from("move_drafts")
    .select("rec_id, kind, content, created_at")
    .eq("tenant_id", tenantId)
    .in("kind", ["create_page_brief", "serp_verdict"])
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) throw error;

  const briefs = new Map<string, { content: string; createdAt: string }>();
  const verdicts = new Map<string, string>();
  for (const r of data ?? []) {
    const key = r.rec_id as string;
    if (r.kind === "create_page_brief" && !briefs.has(key)) briefs.set(key, { content: r.content as string, createdAt: r.created_at as string });
    if (r.kind === "serp_verdict" && !verdicts.has(key)) verdicts.set(key, r.content as string);
  }
  console.log(`found ${briefs.size} create_page_brief rows, ${verdicts.size} serp_verdicts for ${tenantId}`);

  type Candidate = { recId: string; brief: FullPageBriefInput; verdictReason: string | null; verdict: string | null; createdAt: string };
  const candidates: Candidate[] = [];
  for (const [recId, row] of briefs) {
    try {
      const b = JSON.parse(row.content) as Record<string, unknown>;
      if (typeof b.proposedTitle !== "string" || !Array.isArray(b.outline) || b.outline.length < 3) continue;
      let verdict: string | null = null;
      let verdictReason: string | null = null;
      const vRaw = verdicts.get(recId);
      if (vRaw) {
        try {
          const v = JSON.parse(vRaw) as { verdict?: string; reason?: string };
          verdict = v.verdict ?? null;
          verdictReason = v.reason ?? null;
        } catch { /* ignore */ }
      }
      candidates.push({
        recId,
        brief: {
          proposedTitle: b.proposedTitle as string,
          metaDescription: (b.metaDescription as string) ?? "",
          openingAnswer: (b.openingAnswer as string) ?? "",
          outline: (b.outline as string[]).filter((s) => typeof s === "string"),
          faqQuestions: Array.isArray(b.faqQuestions) ? (b.faqQuestions as string[]) : [],
        },
        verdict,
        verdictReason,
        createdAt: row.createdAt,
      });
    } catch { /* skip malformed */ }
  }
  candidates.sort(
    (a, b) => (a.verdict === "build" ? 0 : 1) - (b.verdict === "build" ? 0 : 1) || (a.createdAt < b.createdAt ? 1 : -1),
  );
  const pick = candidates[0];
  if (!pick) throw new Error("no usable create_page_brief found");

  console.log(`\nPICK: ${pick.recId}`);
  console.log(`  title: ${pick.brief.proposedTitle}`);
  console.log(`  outline (${pick.brief.outline.length}): ${pick.brief.outline.join(" | ")}`);
  console.log(`  verdict: ${pick.verdict ?? "(none)"} ${pick.verdictReason ?? ""}`);

  const t0 = Date.now();
  const result = await draftFullPageStructured(pick.brief, {
    topic: pick.brief.proposedTitle,
    competitorWhatWins: null,
    fanoutQuestions: [],
    evidenceFacts: pick.verdictReason ? [pick.verdictReason] : [],
    tenantId,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (result.status !== "drafted") {
    console.log(`\nRESULT: ${result.status} ${"reason" in result ? result.reason : ""}`);
    return;
  }

  console.log(`\nWALK DONE in ${elapsed}s: ${result.sectionsDrafted} drafted, ${result.sectionsFallback} fallback, $${result.totalCostUsd.toFixed(4)}`);
  for (const [i, o] of result.outcomes.entries()) {
    if (o.status === "drafted") {
      const q = evaluateSectionDraftQuality({ heading: o.section.heading, body: o.section.body, sourceCount: o.section.sources.length });
      console.log(
        `  [${i + 1}] drafted${o.retried ? " (retried)" : ""} $${o.costUsd.toFixed(4)} quality=${q.status} num=${o.section.containsNumber} sources=${o.section.sources.map((s) => s.kind).join(",")}`,
      );
    } else {
      console.log(`  [${i + 1}] FALLBACK ($${o.costUsd.toFixed(4)}) reason=${o.reason}`);
    }
  }

  const page = assembleDraftPage(pick.brief, result);
  const content = serializeFullPageDraft(page);
  console.log(
    `\nassembled: ${page.sections.length} sections, ${page.sourcesAppendix.length} appendix sources, markdown ${page.markdown.length} chars, persisted-size ${content?.length ?? "TOO BIG"}`,
  );
  console.log(`dash check: ${/[–—]/.test(page.markdown) ? "FAILED (banned dash present)" : "clean"}`);

  let persisted = false;
  if (content) persisted = await saveMoveDraft(tenantId, pick.recId, "full_page_draft", content);
  console.log(`persisted to move_drafts (full_page_draft): ${persisted}`);

  console.log("\n===== FULL PAGE MARKDOWN =====\n");
  console.log(page.markdown);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e?.message ?? e);
    process.exit(1);
  });
