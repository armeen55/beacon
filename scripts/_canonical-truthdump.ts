/** Phase F.7 canonical truth dump (run twice: SEMrush live vs quarantined). */
import { loadCanonicalWorklistForTenant } from "@/domains/action-pack/load-canonical-worklist";
async function main() {
  const q = process.env.BEACON_QUARANTINE_SEMRUSH === "true";
  const w = await loadCanonicalWorklistForTenant("tenant-iranopedia", "2026-06-27T00:00:00.000Z");
  console.log(`\n===== CANONICAL WORKLIST (semrush ${q ? "QUARANTINED" : "live"}) =====`);
  console.log("total packs:", w.packs.length);
  const f = w.families;
  console.log("families:", JSON.stringify({ existingPageFixes:f.existingPageFixes.length, newPages:f.newPages.length, hubs:f.hubs.length, internalLinks:f.internalLinks.length, experienceFixes:f.experienceFixes.length, titleMetaFixes:f.titleMetaFixes.length, answerBlocks:f.answerBlocks.length, ignoredNoise:f.ignoredNoise }));
  console.log("sourceCoverage:", JSON.stringify(w.sourceCoverage));
  console.log("staleSources:", w.staleSources.join(", ") || "(none)");
  console.log("warnings:", w.warnings.length, w.warnings);
  console.log("suppressedLegacyRows:", w.suppressedLegacyRows.length);
  if (w.parity) { console.log("parity surfaces:"); for (const s of w.parity.surfaces) console.log(`   ${s.verdict.padEnd(15)} ${s.represented}/${s.legacyRows} ${s.surface}`); }
  console.log("TOP 15:");
  for (const [i,p] of w.packs.slice(0,15).entries()) console.log(` ${String(i+1).padStart(2)}. [${p.priorityScore}] ${p.actionType} ${(p.targetUrl??("/"+(p.newPageSlug??""))).slice(0,52)} | ${p.evidenceSources.join("+")}`);
}
main().catch((e)=>{console.error("fatal",e);process.exit(1);});
export {};
