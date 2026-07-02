import { getRepository } from "../src/lib/persistence/repositories";

async function main() {
  const repo = getRepository().forTenant("tenant-iranopedia");
  const snaps = await repo.getPageSnapshots();
  console.log("total", snaps.length);
  const sample = snaps[0];
  console.log("keys:", sample ? Object.keys(sample) : "none");
  console.log("word_count sample:", snaps.slice(0, 5).map((s) => s.word_count));
  console.log("card_texts present count:", snaps.filter((s) => (s.card_texts?.length ?? 0) > 0).length);
  console.log("h2_list present count:", snaps.filter((s) => (s.h2_list?.length ?? 0) > 0).length);
  console.log("body_paragraph_sample present count:", snaps.filter((s) => (s.body_paragraph_sample?.length ?? 0) > 0).length);
  console.log("h3_list present count:", snaps.filter((s) => (s.h3_list?.length ?? 0) > 0).length);
}
main();
