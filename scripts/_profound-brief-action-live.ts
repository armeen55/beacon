/** Live verify #3: draftAeoBriefAction with REAL Iranopedia AEO-validated card
 * evidence (from the verified New Pages receipt). Proves action -> structured
 * drafter -> brief + budget ledger, independent of the flaky 8s graph timeout. */
import { draftAeoBriefAction } from "@/app/(shell)/diagnostics/profound-intelligence/actions";
async function main() {
  const input = {
    prompt: "I was invited to a Persian wedding — what should I expect and how should I act?",
    fanoutQueries: ["persian wedding traditions", "sofreh aghd meaning", "what to wear persian wedding", "persian wedding gift etiquette"],
    competitorPages: ["https://www.theknot.com/content/persian-wedding-traditions", "https://chaiandconversation.com/persian-wedding", "https://remitly.com/persian-wedding"],
    ownCitedUrls: [],
    recommendedMove: "create_page",
    tags: [],
  };
  console.log("prompt:", input.prompt, "\n(competitors + fanouts from CACHED receipt; no live Profound call)");
  const t0 = Date.now();
  const res = await draftAeoBriefAction(input);
  console.log(`draft ${((Date.now()-t0)/1000).toFixed(1)}s -> ok=${res.ok}`);
  if (res.ok) {
    const b = res.brief;
    console.log("direct_answer_40_80_words:", JSON.stringify(b.direct_answer_40_80_words?.slice(0, 200)));
    console.log("fanout_sections:", b.fanout_sections?.length, "| facts_to_verify:", b.facts_to_verify?.length, "| schema:", b.schema_recommendation);
    console.log("competitor_pages_to_beat:", (b.competitor_pages_to_beat ?? []).slice(0,3).join(" | "));
  } else console.log("reason:", res.reason);
}
main().catch((e)=>{console.error(e);process.exit(1);});
export {};
