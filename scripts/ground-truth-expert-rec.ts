/**
 * Ground-truth the expert-rec-engine reasoning on a REAL page (2026-06-16).
 *
 * Not a product surface — a one-off proof that the deterministic intent-fit +
 * the LLM strategist produce expert-grade output on real page data, and that
 * the gate rejects a topically-unrelated pairing. Run:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-expert-rec.ts
 */

import { readFileSync } from "node:fs";
import {
  scorePageTopicFit,
  classifyQueryIntent,
} from "@/domains/recommendations/page-topic-fit";

function envVal(name: string): string | null {
  try {
    const m = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    return m ? m[1]!.trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function extract(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : null;
}

async function main() {
  const url = "https://iranopedia.com/persian-kabobs/koobideh-kabob";
  console.log(`\n=== Fetching real page: ${url} ===`);
  const res = await fetch(url, { headers: { "User-Agent": "BeaconGroundTruth/1.0" } });
  const html = await res.text();
  const title = extract(html, /<title[^>]*>([^<]+)<\/title>/i) ?? "";
  const meta =
    extract(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    extract(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    "";
  const h1 = extract(html, /<h1[^>]*>([^<]+)<\/h1>/i) ?? "";
  console.log(`HTTP ${res.status}`);
  console.log(`title: ${JSON.stringify(title)}`);
  console.log(`h1:    ${JSON.stringify(h1)}`);
  console.log(`meta:  ${JSON.stringify(meta.slice(0, 140))}`);

  const page = {
    title,
    h1,
    metaDescription: meta,
    urlPath: new URL(url).pathname,
  };

  // (A) an on-topic query — should be a confident target.
  const good = scorePageTopicFit({ page, query: "koobideh kabob recipe" });
  // (B) a topically-UNRELATED query — must be rejected by the gate.
  const bad = scorePageTopicFit({ page, query: "current time in tehran now" });

  console.log(`\n=== Deterministic page-topic intent-fit (real page) ===`);
  for (const [label, fit] of [["ON-TOPIC 'koobideh kabob recipe'", good], ["OFF-TOPIC 'current time in tehran now'", bad]] as const) {
    console.log(`\n• ${label}`);
    console.log(`  intentClass: ${fit.intentClass}`);
    console.log(`  topicMatchScore: ${fit.topicMatchScore}/100 · intentMatchScore: ${fit.intentMatchScore}/100`);
    console.log(`  shouldUseQueryForOptimization: ${fit.shouldUseQueryForOptimization}`);
    console.log(`  explanation: ${fit.matchExplanation}`);
    if (fit.mismatchRisks.length) console.log(`  risks: ${fit.mismatchRisks.join(" | ")}`);
  }
  console.log(`\n  classifyQueryIntent('koobideh kabob recipe') = ${classifyQueryIntent("koobideh kabob recipe")}`);
  console.log(`  classifyQueryIntent('best persian kabob delivery') = ${classifyQueryIntent("best persian kabob delivery")}`);

  // (C) live LLM strategist on the on-topic pairing — direct call with the
  // SAME system prompt the module uses (proves expert reasoning quality).
  const key = envVal("OPENAI_API_KEY");
  const model = envVal("DEFAULT_OPENAI_MODEL") || "gpt-5-mini";
  if (!key) {
    console.log("\n(no OPENAI_API_KEY — skipping the live strategist call)");
    return;
  }
  const SYSTEM =
    "You are a world-class SEO/AEO strategist reviewing ONE recommended edit for a non-technical business owner. Reason better and more specifically than a generic SEO consultant, but stay strictly grounded in the provided signals; never invent a number; never name an AI vendor (say 'AI assistants'); never mention internal field names. Respond with STRICT JSON ONLY with keys: opportunity_summary, why_this_now, best_action, alternatives_considered (string[]), why_not_alternatives (string[]), expected_outcome, risk_level ('low'|'medium'|'high'), risks (string[]).";
  const signals = {
    actionType: "edit_title",
    page: { title, h1, url },
    query: "koobideh kabob recipe",
    pageTopicFit: { intentClass: good.intentClass, topicMatchScore: good.topicMatchScore, intentMatchScore: good.intentMatchScore },
  };
  console.log(`\n=== Live LLM strategist (${model}) on the on-topic rec ===`);
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: "Signals (ground ONLY in these):\n" + JSON.stringify(signals, null, 2) },
      ],
      max_completion_tokens: 3000,
    }),
  });
  const j = await r.json();
  console.log(`HTTP ${r.status} · completion_tokens ${j.usage?.completion_tokens}`);
  const content = (j.choices?.[0]?.message?.content ?? "").trim();
  try {
    const a = content.indexOf("{"), b = content.lastIndexOf("}");
    const parsed = JSON.parse(content.slice(a, b + 1));
    console.log("opportunity_summary:", parsed.opportunity_summary);
    console.log("why_this_now:", parsed.why_this_now);
    console.log("best_action:", parsed.best_action);
    console.log("why_not_alternatives:", JSON.stringify(parsed.why_not_alternatives));
    console.log("expected_outcome:", parsed.expected_outcome);
    console.log("risk_level:", parsed.risk_level, "| risks:", JSON.stringify(parsed.risks));
  } catch {
    console.log("RAW:", content.slice(0, 400));
  }
}

main().catch((e) => {
  console.error("ground-truth failed:", e);
  process.exit(1);
});
