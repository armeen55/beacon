/**
 * LIVE verification (read-only + one capped LLM call) of the full Profound AEO
 * chain for tenant-iranopedia: live prompt → fan-outs → cited pages → structured
 * brief. Self-contained (no app imports → avoids server-only). Mirrors the
 * drafter's model/params (gpt-5-mini, /chat/completions, max_completion_tokens,
 * reasoning_effort low, robust JSON parse). Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/_profound-brief-live.ts
 */
const PROF = "https://api.tryprofound.com";
const OPENAI = "https://api.openai.com/v1/chat/completions";
const TENANT = "tenant-iranopedia";
const OWNED_DOMAIN = "iranopedia.com";
const OWNED_ALIASES = ["iranopedia", "iranopedia.com"];
const DIRECTORY = new Set(["reddit.com", "youtube.com", "wikipedia.org", "en.wikipedia.org", "quora.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "pinterest.com", "tiktok.com"]);
const stripWww = (h: string) => h.replace(/^www\./i, "").toLowerCase();
const hostOf = (u: string) => { try { return stripWww(new URL(u).hostname); } catch { return ""; } };
const isOwned = (h: string) => { const x = stripWww(h); return x === OWNED_DOMAIN || x.endsWith("." + OWNED_DOMAIN); };

const AEO_SYSTEM =
  "You write a STRUCTURED brief (never a vague summary) for an encyclopedia / content site to WIN one specific AI-assistant question (AEO). " +
  'Return ONLY a JSON object with keys: "direct_answer_40_80_words" (one quotable, self-contained factual answer of 40-80 words an AI could lift verbatim), ' +
  '"fanout_sections" (array of {"question","answer_goal"}), "facts_to_verify" (array), "entities_to_include" (array), "sources_to_reference" (array), ' +
  '"competitor_pages_to_beat" (array), "schema_recommendation" ("FAQPage"|"Article"|"ItemList"|"None"), "internal_links" (array), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one; source one of gsc|ga4|clarity|profound|dataforseo|semrush|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array), "operatorSteps" (array). ' +
  "Ground EVERYTHING only in the prompt, fan-out queries, and competitor pages provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes.";

function robustJson(text: string): unknown {
  const a = text.indexOf("{"); const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return undefined;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return undefined; }
}

async function main() {
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const tok = await (await fetch(`${SB}/rest/v1/connector_tokens?tenant_id=eq.${TENANT}&provider=eq.profound&select=payload`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
  const p = tok[0].payload; const ph = { "X-API-Key": p.api_key, "Content-Type": "application/json" };
  const end = new Date(), start = new Date(end.getTime() - 30 * 864e5);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const topicFilter = [{ field: "topic", operator: "is", value: p.topic_id }];

  // Answers
  const ans = await (await fetch(PROF + "/v1/prompts/answers", { method: "POST", headers: ph, body: JSON.stringify({ category_id: p.category_id, start_date: ymd(start), end_date: ymd(end), filters: topicFilter, pagination: { limit: 300, offset: 0 } }) })).json();
  // Fanouts
  const fan = await (await fetch(PROF + "/v1/reports/query-fanouts", { method: "POST", headers: ph, body: JSON.stringify({ category_id: p.category_id, start_date: ymd(start), end_date: ymd(end), date_interval: "day", dimensions: ["date", "model", "prompt", "query"], metrics: ["total_fanouts", "share"], filters: topicFilter, pagination: { limit: 1000, offset: 0 } }) })).json();
  const fanByPrompt = new Map<string, Set<string>>();
  for (const r of (fan.data ?? []) as Array<{ dimensions: string[] }>) { const pr = (r.dimensions?.[2] ?? "").toLowerCase(); const q = r.dimensions?.[3] ?? ""; if (pr && q) { if (!fanByPrompt.has(pr)) fanByPrompt.set(pr, new Set()); fanByPrompt.get(pr)!.add(q); } }

  // Build per-prompt + pick the top gap (most answers, no own citation, has competitor).
  type Acc = { prompt: string; total: number; ownCited: number; cited: Map<string, number> };
  const byPrompt = new Map<string, Acc>();
  for (const d of (ans.data ?? []) as Array<Record<string, unknown>>) {
    const prompt = typeof d.prompt === "string" ? d.prompt : "";
    if (!prompt || /^Evaluate the Frontier Models company/i.test(prompt)) continue;
    const k = prompt.toLowerCase();
    let a = byPrompt.get(k); if (!a) { a = { prompt, total: 0, ownCited: 0, cited: new Map() }; byPrompt.set(k, a); }
    a.total += 1;
    const urls = Array.isArray(d.citations) ? (d.citations as unknown[]).filter((u): u is string => typeof u === "string") : [];
    let own = false;
    for (const u of urls) { const h = hostOf(u); if (!h) continue; if (isOwned(h)) { own = true; a.cited.set(u, (a.cited.get(u) ?? 0) + 1); } else if (!DIRECTORY.has(h)) a.cited.set(u, (a.cited.get(u) ?? 0) + 1); }
    if (own) a.ownCited += 1;
  }
  const gaps = [...byPrompt.values()].filter((a) => a.ownCited === 0 && a.cited.size > 0).sort((x, y) => y.total - x.total);
  const top = gaps[0];
  if (!top) { console.log("no gap prompt found"); return; }
  const topCited = [...top.cited.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => `${u} ×${n}`);
  const fanouts = [...(fanByPrompt.get(top.prompt.toLowerCase()) ?? [])].slice(0, 8);

  console.log("=== TOP GAP PROMPT ===\n", top.prompt, `(${top.total} answers, you absent)`);
  console.log("\n=== TOP CITED PAGES (AI cites now) ===\n", topCited.join("\n "));
  console.log("\n=== FAN-OUT QUERIES ===\n", fanouts.join("\n "));

  // Live LLM brief (mirror the drafter).
  const user = [
    `AI prompt to win: "${top.prompt}"`, `Recommended move: answer_block`,
    fanouts.length ? `Fan-out queries: ${fanouts.join("; ")}` : "",
    `Pages AI cites now (study + beat): ${topCited.join("; ")}`,
    "Your site is NOT currently cited for this prompt.", "", "Return the JSON now.",
  ].filter(Boolean).join("\n");
  console.log("\n=== CALLING gpt-5-mini (reasoning_effort low) … ===");
  const res = await fetch(OPENAI, { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5-mini", messages: [{ role: "system", content: AEO_SYSTEM }, { role: "user", content: user }], max_completion_tokens: 6000, reasoning_effort: "low" }) });
  if (!res.ok) { console.log("OpenAI error", res.status, (await res.text()).slice(0, 300)); return; }
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "";
  const brief = robustJson(text);
  console.log("\n=== STRUCTURED AEO BRIEF (live) ===");
  console.log(brief ? JSON.stringify(brief, null, 2) : `(unparseable)\n${text.slice(0, 600)}`);
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });

export {};
