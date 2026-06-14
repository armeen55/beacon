/**
 * Ad-hoc (throwaway): find GENUINE, safe-to-fill gaps on Iranopedia CMS items —
 * empty image alt-text and empty title/description fields — so the first live
 * push is a pure ADDITION (zero risk, verifiable live), not an edit of good
 * content or a no-op. items/query omits empty fields, so "declared TEXT field
 * absent from data" == empty.
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-gaps.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) {
      let v = m[2]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]!] = v;
    }
  }
} catch {
  /* ignore */
}
process.env.DATA_SOURCE = "supabase";

const BASE = "https://www.wixapis.com";
// Collections + the slug-ish field that identifies an item for humans.
const COLLECTIONS = ["IranAnimals", "PersianRugs", "PersianKabobs", "PersianRestaurants", "IranFlags"];

async function main() {
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const token = await getWixConnectorToken("tenant-iranopedia");
  if (!token?.api_key || !token?.site_id) { console.error("NO TOKEN"); process.exit(1); }
  const headers: Record<string, string> = {
    Authorization: token.api_key, "wix-site-id": token.site_id, "Content-Type": "application/json",
  };

  for (const col of COLLECTIONS) {
    // schema → declared TEXT fields that look like alt text
    const sres = await fetch(`${BASE}/wix-data/v2/collections/${encodeURIComponent(col)}`, { headers });
    if (!sres.ok) { console.log(`### ${col} schema HTTP ${sres.status}`); continue; }
    const sc = ((await sres.json()) as any).collection ?? {};
    const altFields: string[] = ((sc.fields ?? []) as any[])
      .filter((f) => f.type === "TEXT" && /alt/i.test(String(f.key ?? "")))
      .map((f) => String(f.key));
    const imageFields: string[] = ((sc.fields ?? []) as any[])
      .filter((f) => f.type === "IMAGE")
      .map((f) => String(f.key));

    const q = await fetch(`${BASE}/wix-data/v2/items/query`, {
      method: "POST", headers,
      body: JSON.stringify({ dataCollectionId: col, query: { paging: { limit: 200 } } }),
    });
    if (!q.ok) { console.log(`### ${col} items HTTP ${q.status}`); continue; }
    const items = (((await q.json()) as any).dataItems ?? []) as any[];

    let emptyAlt = 0, emptyTitle = 0;
    const examples: string[] = [];
    for (const it of items) {
      const d = it.data ?? {};
      const name = d.title ?? d.slug ?? it.id;
      if (typeof d.title !== "string" || d.title.trim() === "") emptyTitle++;
      // an alt field that is missing/empty WHILE the corresponding image exists
      for (const af of altFields) {
        const hasAlt = typeof d[af] === "string" && d[af].trim() !== "";
        if (!hasAlt) {
          emptyAlt++;
          if (examples.length < 6) examples.push(`${name} :: empty "${af}" (images: ${imageFields.filter((f) => d[f]).join(",") || "none"})`);
          break;
        }
      }
    }
    console.log(`\n### ${col}: ${items.length} items | emptyTitle=${emptyTitle} | items-with-an-empty-alt=${emptyAlt} | altFields=[${altFields.join(",")}]`);
    for (const e of examples) console.log(`   - ${e}`);
  }
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
