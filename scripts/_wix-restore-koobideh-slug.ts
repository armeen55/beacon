/**
 * EMERGENCY restore: re-populate Koobideh's slug (cleared by the strip+PUT bug)
 * so /persian-kabobs/koobideh-kabob resolves again. Uses a RAW PUT that
 * PRESERVES every current field (no stripForbiddenFields) + restores slug.
 * Keeps seoDescription untouched (operator: do not rollback it).
 *
 *   (default)  DRY-RUN — print exactly what would be written.
 *   --execute  perform the restore (operator-approved slug write), then verify.
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-restore-koobideh-slug.ts [--execute]
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
} catch {}
process.env.DATA_SOURCE = "supabase";

const BASE = "https://www.wixapis.com";
const COLLECTION = "PersianKabobs";
const ID = "598d88d8-e4cd-4be1-9e55-4defbf5aaca7";
const SLUG = "koobideh-kabob";
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const t = await getWixConnectorToken("tenant-iranopedia");
  if (!t?.api_key) { console.error("no token"); process.exit(1); }
  const h = { Authorization: t.api_key, "wix-site-id": t.site_id, "Content-Type": "application/json" } as Record<string, string>;

  // Read CURRENT full item (the survivors after the bad push).
  const q = await fetch(`${BASE}/wix-data/v2/items/query`, {
    method: "POST", headers: h,
    body: JSON.stringify({ dataCollectionId: COLLECTION, query: { paging: { limit: 200 } } }),
  });
  const items = (((await q.json()) as any).dataItems ?? []) as any[];
  const item = items.find((i) => i.id === ID);
  if (!item) { console.error("koobideh not found"); process.exit(1); }
  const cur = item.data ?? {};
  console.log("current slug:", JSON.stringify(cur.slug), "| link:", JSON.stringify(cur["link-persian-kabobs-title"]), "| fields:", Object.keys(cur).length);

  // Restore: preserve EVERY current field, set slug. Wix re-derives the
  // PAGE_LINK + dynamic-page URL from the slug on save. seoDescription kept.
  const data = { ...cur, _id: ID, slug: SLUG };
  console.log("\n=== RESTORE PLAN ===");
  console.log("mode:    ", EXECUTE ? "LIVE WRITE (slug)" : "DRY-RUN");
  console.log("item:    ", `${COLLECTION}/${ID}`);
  console.log("set slug:", JSON.stringify(SLUG), "(was undefined)");
  console.log("preserve:", Object.keys(cur).length, "current fields incl. seoDescription + recipe content");
  console.log("====================");
  if (!EXECUTE) { console.log("\n(dry-run — rerun with --execute to restore)"); return; }

  const put = await fetch(`${BASE}/wix-data/v2/items/${encodeURIComponent(ID)}`, {
    method: "PUT", headers: h,
    body: JSON.stringify({ dataCollectionId: COLLECTION, dataItem: { data } }),
  });
  if (!put.ok) { console.error(`PUT failed ${put.status}: ${(await put.text()).slice(0, 400)}`); process.exit(1); }
  const saved = ((await put.json()) as any).dataItem?.data ?? {};
  console.log("\n[verify] saved slug:", JSON.stringify(saved.slug), "| link:", JSON.stringify(saved["link-persian-kabobs-title"]));
  // Live URL (may need a site republish + cache TTL to recover from 404).
  for (const u of [`https://www.iranopedia.com/persian-kabobs/${SLUG}`]) {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
    console.log("[verify] live", u, "→ HTTP", r.status);
  }
}
main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.stack : String(e)); process.exit(1); });
