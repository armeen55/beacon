/** Verify the New Pages AEO badge on real data (tenant-iranopedia). */
import { buildNewPagesData } from "@/app/(shell)/today-newpages-data";
async function main() {
  const data = await buildNewPagesData("tenant-iranopedia");
  const withBadge = data.opportunities.filter((o) => o.aeoReceipt);
  console.log(`New Page cards: ${data.opportunities.length} | with ✦ AI-validated badge: ${withBadge.length}`);
  for (const o of withBadge.slice(0, 3)) {
    const r = o.aeoReceipt!;
    console.log(`\n• ${o.topic}`);
    console.log(`   AI asks: "${r.topPrompt}"`);
    console.log(`   fans out into ${r.fanoutCount} related questions`);
    console.log(`   AI cites: ${r.citedDomains.join(", ")}`);
    console.log(`   ${r.ownAbsent ? "Iranopedia not cited yet" : "your page: cited"}`);
  }
}
main().catch((e)=>{console.error(e);process.exit(1);});
export {};
