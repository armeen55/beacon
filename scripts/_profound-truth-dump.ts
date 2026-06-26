/**
 * READ-ONLY Profound truth dump for tenant-iranopedia (2026-06-26).
 *
 * The operator's "see reality before building storage/UI" step. Exercises every
 * endpoint the Iranopedia AEO build needs, scoped to the "Iranopedia" TOPIC, and
 * runs a per-prompt rollup on the real answers. NO writes. NO bots/referrals
 * (borrowed account — that data is off-limits). NO openai.com ownership.
 *
 * Self-contained (no app-module imports → avoids `server-only`). Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/_profound-truth-dump.ts
 */
const BASE = "https://api.tryprofound.com";
const TENANT = "tenant-iranopedia";
const OWNED_DOMAIN = "iranopedia.com";
const OWNED_ALIASES = ["iranopedia", "iranopedia.com"];
const DIRECTORY = new Set(["reddit.com", "youtube.com", "wikipedia.org", "quora.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "pinterest.com"]);

function clip(o: unknown, n = 1400): string {
  const s = typeof o === "string" ? o : JSON.stringify(o);
  return s.length > n ? s.slice(0, n) + ` …(+${s.length - n} chars)` : s;
}
const stripWww = (h: string) => h.replace(/^www\./i, "").toLowerCase();
const isOwnedHost = (h: string) => { const x = stripWww(h); return x === OWNED_DOMAIN || x.endsWith("." + OWNED_DOMAIN); };

async function main() {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!SB_URL || !SB_KEY) { console.error("missing supabase env"); process.exit(1); }

  // Read the Profound connector token via PostgREST directly (no app imports).
  const tokRes = await fetch(
    `${SB_URL}/rest/v1/connector_tokens?tenant_id=eq.${TENANT}&provider=eq.profound&select=payload`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
  );
  const tokRows = (await tokRes.json()) as Array<{ payload: Record<string, unknown> }>;
  if (!tokRows[0]) { console.error("no profound token"); process.exit(1); }
  const payload = tokRows[0].payload;
  const apiKey = String(payload.api_key ?? "");
  const categoryId = String(payload.category_id ?? "");
  const topicId = String(payload.topic_id ?? "");
  const topicLabel = String(payload.topic_label ?? "");
  console.log("=== SCOPE ===", { categoryId, topicId, topicLabel, hasKey: apiKey.length > 0 });
  if (!apiKey || !categoryId) { console.error("missing api_key/category_id"); process.exit(1); }

  const headers: Record<string, string> = { "X-API-Key": apiKey, "Content-Type": "application/json" };
  const get = async (path: string) => {
    try { const r = await fetch(BASE + path, { headers }); if (!r.ok) return { __status: r.status, __text: (await r.text()).slice(0, 200) }; return await r.json(); }
    catch (e) { return { __fetchError: e instanceof Error ? e.message : String(e) }; }
  };
  const post = async (path: string, body: unknown) => {
    try { const r = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) }); if (!r.ok) return { __status: r.status, __text: (await r.text()).slice(0, 300) }; return await r.json(); }
    catch (e) { return { __fetchError: e instanceof Error ? e.message : String(e) }; }
  };

  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = ymd(start), endDate = ymd(end);
  const topicFilter = topicId ? [{ field: "topic", operator: "is", value: topicId }] : [];
  console.log("window:", startDate, "→", endDate, "| topicFilter:", JSON.stringify(topicFilter));

  console.log("\n=== GET /v1/org/categories ===");
  console.log(clip(await get("/v1/org/categories"), 1500));

  for (const sub of ["topics", "tags", "assets", "prompts"]) {
    console.log(`\n=== GET /v1/org/categories/{cat}/${sub} ===`);
    console.log(clip(await get(`/v1/org/categories/${categoryId}/${sub}`), 1800));
  }

  console.log("\n=== POST /v1/reports/query-fanouts (topic-scoped) ===");
  console.log(clip(await post("/v1/reports/query-fanouts", {
    category_id: categoryId, start_date: startDate, end_date: endDate, date_interval: "day",
    dimensions: ["prompt", "query", "model", "date"], metrics: ["total_fanouts", "share"],
    ...(topicFilter.length ? { filters: topicFilter } : {}), pagination: { limit: 50, offset: 0 },
  }), 2200));

  console.log("\n=== POST /v1/prompts/answers (topic-scoped) — THE GOLD ===");
  const ansRaw = await post("/v1/prompts/answers", {
    category_id: categoryId, start_date: startDate, end_date: endDate,
    ...(topicFilter.length ? { filters: topicFilter } : {}), pagination: { limit: 300, offset: 0 },
  }) as Record<string, unknown>;
  if (ansRaw.__status || ansRaw.__fetchError) { console.log("answers error:", clip(ansRaw, 400)); }
  else {
    const info = (ansRaw.info ?? {}) as Record<string, unknown>;
    const data = Array.isArray(ansRaw.data) ? ansRaw.data : [];
    console.log(`answers rows=${data.length} totalRows=${info.total_rows ?? "?"}`);
    if (data[0]) console.log("sample raw answer keys:", Object.keys(data[0] as object).join(", "));
    if (data[0]) console.log("sample answer:", clip(data[0], 900));

    // Inline per-prompt rollup (mirrors analyzeProfoundAnswersByPrompt).
    type Acc = { prompt: string; total: number; ownMentioned: number; ownCited: number; models: Set<string>; cited: Map<string, number> };
    const byPrompt = new Map<string, Acc>();
    const hostFromUrl = (u: string) => { try { return stripWww(new URL(u).hostname); } catch { return ""; } };
    for (const d of data as Array<Record<string, unknown>>) {
      const prompt = typeof d.prompt === "string" ? d.prompt : "";
      // Filter hackathon noise: "Evaluate the Frontier Models company X on Iranopedia"
      // are AI-company sentiment prompts, NOT Iranopedia AEO questions.
      if (/^Evaluate the Frontier Models company/i.test(prompt)) continue;
      const key = `text:${prompt.toLowerCase()}`;
      if (key === "text:") continue;
      let a = byPrompt.get(key);
      if (!a) { a = { prompt, total: 0, ownMentioned: 0, ownCited: 0, models: new Set(), cited: new Map() }; byPrompt.set(key, a); }
      a.total += 1;
      if (typeof d.model === "string") a.models.add(d.model);
      const mentions = Array.isArray(d.mentions) ? (d.mentions as unknown[]).filter((m): m is string => typeof m === "string") : [];
      // Ownership: brand named in mentions[] OR iranopedia.com cited. NOT response
      // text (the topic name "Iranopedia" appears in unrelated answers).
      if (mentions.some((m) => OWNED_ALIASES.includes(m.toLowerCase()))) a.ownMentioned += 1;
      const urls = Array.isArray(d.citations) ? (d.citations as unknown[]).filter((u): u is string => typeof u === "string") : [];
      const hosts = new Set<string>();
      for (const u of urls) { const h = u.includes("://") ? hostFromUrl(u) : stripWww(u); if (h) hosts.add(h); }
      let ownedHere = false;
      for (const h of hosts) { if (isOwnedHost(h)) { ownedHere = true; a.cited.set(h, (a.cited.get(h) ?? 0) + 1); } else if (!DIRECTORY.has(h)) { a.cited.set(h, (a.cited.get(h) ?? 0) + 1); } }
      if (ownedHere) a.ownCited += 1;
    }
    const prompts = [...byPrompt.values()].map((a) => {
      const top = [...a.cited.entries()].map(([h, n]) => ({ h, n, own: isOwnedHost(h) })).sort((x, y) => y.n - x.n);
      const ownPresent = a.ownMentioned > 0 || a.ownCited > 0;
      return { prompt: a.prompt, total: a.total, models: a.models.size, ownMentioned: a.ownMentioned, ownCited: a.ownCited, ownPresent, top, isGap: !ownPresent && top.some((t) => !t.own) };
    }).sort((x, y) => (x.isGap === y.isGap ? y.total - x.total : x.isGap ? -1 : 1));
    console.log(`\n=== PER-PROMPT === prompts=${prompts.length} ownPresent=${prompts.filter((p) => p.ownPresent).length} gaps=${prompts.filter((p) => p.isGap).length}`);
    for (const p of prompts.slice(0, 25)) {
      const top = p.top.slice(0, 5).map((c) => `${c.h}${c.own ? "(YOU)" : ""}×${c.n}`).join(", ");
      console.log(`${p.isGap ? "🔴GAP " : p.ownPresent ? "🟢HAVE" : "⚪    "} [${p.total}a/${p.models}m] ${clip(p.prompt, 68)}\n        cited: ${top || "(none)"}`);
    }
  }

  console.log("\n=== DONE (read-only; no bots/referrals/domains; no writes) ===");
}
main().catch((e) => { console.error("[truth-dump] fatal", e); process.exit(1); });

export {};
