import { getLatestMoveDrafts } from "../src/domains/demand-graph/move-draft-store";
import { parsePreparedPack } from "../src/domains/demand-graph/prepared-move-pack";
import { evaluateDraftQuality } from "../src/domains/drafts/draft-quality";

async function main() {
  const drafts = await getLatestMoveDrafts("tenant-iranopedia");
  let n = 0;
  for (const [key, draft] of drafts.entries()) {
    if (!key.endsWith("::prepared_pack")) continue;
    const pack = parsePreparedPack(draft.content);
    if (!pack || pack.structuredDraft?.kind !== "answer_block") continue;
    const v = pack.structuredDraft.value as Record<string, unknown>;
    const answer = typeof v.answer === "string" ? v.answer : "";
    if (!answer) continue;
    n += 1;
    const result = evaluateDraftQuality({ answer, evidenceRefs: Array.isArray(v.evidenceRefs) ? v.evidenceRefs.length : 0, query: pack.primaryQuery });
    console.log(`[${n}] ${pack.primaryQuery}`);
    console.log(`    words=${answer.trim().split(/\s+/).length} status=${result.status}`);
    console.log(`    "${answer.slice(0, 140)}..."`);
  }
  console.log(`\ntotal answer_block drafts: ${n}`);
}
main();
