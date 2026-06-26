/**
 * LIVE truth dump for the Profound Prompt-to-Page Coverage Compiler
 * (tenant-iranopedia). Read-only: pulls live Profound answers+fanouts + GSC owned
 * pages, runs the REAL pure compiler, prints the ranked page-action decisions.
 * NO writes, NO bots/referrals, ownership = iranopedia.com only. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/_profound-coverage-live.ts
 */
import { buildPromptOpportunities } from "@/domains/profound-question-intelligence/prompt-opportunity";
import { compileCoverage } from "@/domains/profound-coverage/compiler";
import { isProfoundNoisePrompt } from "@/lib/connectors/profound/tenant-scope";
import type { ProfoundAnswerRow } from "@/lib/connectors/profound/client";
import type { OwnedPageCandidate } from "@/domains/profound-coverage/types";

const PROF = "https://api.tryprofound.com";
const TENANT = "tenant-iranopedia";
const OWNED_DOMAIN = "iranopedia.com";
const stripWww = (h: string) => h.replace(/^www\./i, "").toLowerCase();
const hostOf = (u: string) => { try { return stripWww(new URL(u).hostname); } catch { return ""; } };

async function sbGet(path: string): Promise<unknown[]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` } });
  return r.ok ? ((await r.json()) as unknown[]) : [];
}

async function main() {
  // ── Profound token + live pulls ──
  const tok = (await sbGet(`connector_tokens?tenant_id=eq.${TENANT}&provider=eq.profound&select=payload`)) as Array<{ payload: Record<string, unknown> }>;
  const p = tok[0].payload as Record<string, string>;
  const ph = { "X-API-Key": p.api_key, "Content-Type": "application/json" };
  const end = new Date(), start = new Date(end.getTime() - 30 * 864e5);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const tf = [{ field: "topic", operator: "is", value: p.topic_id }];

  const ansRaw = await (await fetch(PROF + "/v1/prompts/answers", { method: "POST", headers: ph, body: JSON.stringify({ category_id: p.category_id, start_date: ymd(start), end_date: ymd(end), filters: tf, pagination: { limit: 1000, offset: 0 } }) })).json();
  const answers: ProfoundAnswerRow[] = ((ansRaw.data ?? []) as Array<Record<string, unknown>>).map((d) => {
    const urls = Array.isArray(d.citations) ? (d.citations as unknown[]).filter((u): u is string => typeof u === "string") : [];
    return {
      promptId: typeof d.prompt_id === "string" ? d.prompt_id : null,
      prompt: typeof d.prompt === "string" ? d.prompt : "",
      response: typeof d.response === "string" ? d.response : "",
      mentions: Array.isArray(d.mentions) ? (d.mentions as unknown[]).filter((m): m is string => typeof m === "string") : [],
      citationUrls: urls,
      citationHostnames: [...new Set(urls.map(hostOf).filter(Boolean))],
      themes: Array.isArray(d.themes) ? (d.themes as unknown[]).filter((t): t is string => typeof t === "string") : [],
      topic: typeof d.topic === "string" ? d.topic : null,
      model: typeof d.model === "string" ? d.model : null,
      asset: null,
      createdAt: typeof d.created_at === "string" ? d.created_at : null,
    };
  });
  const fanRaw = await (await fetch(PROF + "/v1/reports/query-fanouts", { method: "POST", headers: ph, body: JSON.stringify({ category_id: p.category_id, start_date: ymd(start), end_date: ymd(end), date_interval: "day", dimensions: ["date", "model", "prompt", "query"], metrics: ["total_fanouts", "share"], filters: tf, pagination: { limit: 2000, offset: 0 } }) })).json();
  const fanouts = ((fanRaw.data ?? []) as Array<{ dimensions: string[] }>).map((r) => ({ prompt: r.dimensions?.[2] ?? "", query: r.dimensions?.[3] ?? "", model: r.dimensions?.[1] ?? null }));

  const opportunities = buildPromptOpportunities({ answers, fanouts, ownedDomain: OWNED_DOMAIN, ownedMentionAliases: ["Iranopedia", "iranopedia.com"], isNoisePrompt: isProfoundNoisePrompt });

  // ── Owned-page candidates from GSC + snapshots ──
  const pageTotals = (await sbGet(`gsc_daily_page_totals?tenant_id=eq.${TENANT}&select=page,clicks,impressions,ctr,position&order=clicks.desc&limit=4000`)) as Array<Record<string, number | string>>;
  const aggByPage = new Map<string, { clicks: number; impressions: number; ctr: number; pos: number; n: number }>();
  for (const r of pageTotals) {
    const url = String(r.page); if (!url) continue;
    const a = aggByPage.get(url) ?? { clicks: 0, impressions: 0, ctr: 0, pos: 0, n: 0 };
    a.clicks += Number(r.clicks) || 0; a.impressions += Number(r.impressions) || 0; a.pos += Number(r.position) || 0; a.n += 1;
    aggByPage.set(url, a);
  }
  const topPages = [...aggByPage.entries()].sort((x, y) => y[1].clicks - x[1].clicks).slice(0, 200);
  const queryRows = (await sbGet(`gsc_daily_rows?tenant_id=eq.${TENANT}&select=page,query,clicks&order=clicks.desc&limit=8000`)) as Array<Record<string, number | string>>;
  const qByPage = new Map<string, Set<string>>();
  for (const r of queryRows) { const u = String(r.page), q = String(r.query); if (!u || !q) continue; if (!qByPage.has(u)) qByPage.set(u, new Set()); if (qByPage.get(u)!.size < 30) qByPage.get(u)!.add(q); }
  const snaps = (await sbGet(`page_snapshots?tenant_id=eq.${TENANT}&select=url,title,h1,h2_list,meta_description,word_count,schema_types&order=fetched_at.desc&limit=2000`)) as Array<Record<string, unknown>>;
  const snapByUrl = new Map<string, Record<string, unknown>>();
  for (const s of snaps) { const u = String(s.url); if (u && !snapByUrl.has(u)) snapByUrl.set(u, s); }

  const ownedPages: OwnedPageCandidate[] = topPages.map(([url, a]) => {
    const s = snapByUrl.get(url);
    return {
      url,
      title: (s?.title as string) ?? null,
      h1: (s?.h1 as string) ?? null,
      h2s: Array.isArray(s?.h2_list) ? (s!.h2_list as string[]) : [],
      metaDescription: (s?.meta_description as string) ?? null,
      wordCount: Number(s?.word_count) || 0,
      gscQueries: [...(qByPage.get(url) ?? [])],
      clicks90d: a.clicks, impressions90d: a.impressions, position90d: a.n ? a.pos / a.n : null, ctr90d: a.impressions ? a.clicks / a.impressions : 0,
      ga4Visits28d: 0, ga4Value: 0, clarityFriction: 0,
      existingSchemaTypes: Array.isArray(s?.schema_types) ? (s!.schema_types as string[]) : [],
    };
  });

  // ── Run the REAL compiler ──
  const { assignments, actionPacks, summary } = compileCoverage(opportunities, ownedPages);

  console.log("=== COVERAGE COMPILER (live, tenant-iranopedia) ===");
  console.log(`profound opportunities (post-noise): ${opportunities.length} | owned GSC pages: ${ownedPages.length}`);
  console.log("SUMMARY:", JSON.stringify(summary));
  console.log(`\n=== TOP 10 ACTION PACKS ===`);
  for (const ap of actionPacks.slice(0, 10)) {
    console.log(`\n[${ap.priorityScore}] ${ap.action.toUpperCase()} ${ap.targetUrl ?? ap.newPageSlug ?? ""}`);
    console.log(`   prompt: ${ap.prompt}`);
    console.log(`   beat: ${(ap.competitorPagesToBeat ?? []).slice(0, 3).join(", ") || "(none)"}`);
    console.log(`   fanouts: ${(ap.faqQuestions ?? []).slice(0, 3).join(" | ") || "(none)"}`);
    console.log(`   why: ${ap.evidence}`);
  }
  const ex = (kind: string, n: number) => assignments.filter((a) => a.assignment === kind).slice(0, n);
  console.log(`\n=== 5 EXISTING-PAGE ===`); for (const a of ex("existing_page", 5)) console.log(`  "${a.prompt}" -> ${a.targetUrl} (${a.confidence}; ${a.why})`);
  console.log(`\n=== 5 NEW-PAGE ===`); for (const a of ex("new_page", 5)) console.log(`  "${a.prompt}" (${a.confidence}; ${a.why})`);
  console.log(`\n=== 3 IGNORED NOISE ===`); for (const a of ex("ignore_noise", 3)) console.log(`  "${a.prompt}" (${a.why})`);
  console.log("\n=== DONE (read-only; no writes; no bots/referrals; ownership=iranopedia.com) ===");
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });

export {};
