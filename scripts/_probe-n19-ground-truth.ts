/**
 * Ground-truth probe for N19 (2026-07-02). Live-fetches 5 real tenant-iranopedia
 * pages (including the two known zero-paragraph /persian-kabobs/* pages named in
 * the 2026-07-02 handoff) and reports body_paragraph_sample count + total chars
 * extracted by the FIXED extractor, so before/after is visible without needing
 * the old extractor around.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/_probe-n19-ground-truth.ts
 */
import { extractPageSnapshot } from "../src/domains/pages/extractor";

const URLS = [
  "https://www.iranopedia.com/persian-kabobs/barg-kabob", // known 0-paragraph page (handoff 2026-07-02)
  "https://www.iranopedia.com/persian-kabobs/joojeh-kabob", // known 0-paragraph page (handoff 2026-07-02)
  "https://www.iranopedia.com/iran-animals", // real no-<p>-tag, has-real-content page (div/span shape)
  "https://www.iranopedia.com/iran-timeline", // substantial page with real <p> tags (should be unaffected)
  "https://www.iranopedia.com/funny-farsi-phrases", // mid-size page with real <p> tags
];

async function main() {
  const tenantId = "tenant-iranopedia";
  type Row = { url: string; paragraphs: number; chars: number; wordCount: number; sample: string };
  const rows: Row[] = [];

  for (const url of URLS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "BeaconGroundTruth/1.0" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.log(`SKIP ${url}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const snap = extractPageSnapshot(html, url, `probe-${url}`, tenantId, res.status);
      const sample = snap.body_paragraph_sample ?? [];
      const chars = sample.join("").length;
      rows.push({
        url,
        paragraphs: sample.length,
        chars,
        wordCount: snap.word_count,
        sample: sample[0]?.slice(0, 100) ?? "(none)",
      });
    } catch (e) {
      console.log(`ERROR ${url}: ${e}`);
    }
  }

  console.log("\n=== N19 ground-truth: body_paragraph_sample AFTER the fix ===\n");
  for (const r of rows) {
    console.log(`${r.url}`);
    console.log(`  paragraphs: ${r.paragraphs}  |  total excerpt chars: ${r.chars}  |  page word_count: ${r.wordCount}`);
    console.log(`  first entry: "${r.sample}"`);
    console.log();
  }

  const before = {
    "https://www.iranopedia.com/persian-kabobs/barg-kabob": 0,
    "https://www.iranopedia.com/persian-kabobs/joojeh-kabob": 0,
    "https://www.iranopedia.com/iran-animals": 0,
  };
  console.log("=== Before/after on the known zero-paragraph pages (handoff 2026-07-02) ===");
  for (const [url, beforeCount] of Object.entries(before)) {
    const row = rows.find((r) => r.url === url);
    console.log(`${url}: before=${beforeCount} paragraphs -> after=${row?.paragraphs ?? "N/A"} paragraphs (${row?.chars ?? 0} chars)`);
  }
}

main();
