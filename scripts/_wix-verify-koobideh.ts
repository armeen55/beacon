/**
 * Ad-hoc: ground-truth check of Koobideh's slug/link/seoDescription after the
 * push, + whether any item already owns slug `koobideh-kabob`, + the live URL.
 * Read-only. Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-verify-koobideh.ts
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
const KOOBIDEH_ID = "598d88d8-e4cd-4be1-9e55-4defbf5aaca7";

async function main() {
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const t = await getWixConnectorToken("tenant-iranopedia");
  if (!t?.api_key) { console.error("no token"); process.exit(1); }
  const h = { Authorization: t.api_key, "wix-site-id": t.site_id, "Content-Type": "application/json" } as Record<string, string>;

  const q = await fetch(`${BASE}/wix-data/v2/items/query`, {
    method: "POST", headers: h,
    body: JSON.stringify({ dataCollectionId: "PersianKabobs", query: { paging: { limit: 200 } } }),
  });
  const items = (((await q.json()) as any).dataItems ?? []) as any[];

  console.log("=== all PersianKabobs items: id | title | slug | link | seoDescription? ===");
  for (const it of items) {
    const d = it.data ?? {};
    console.log(`  ${it.id} | ${JSON.stringify(d.title)} | slug=${JSON.stringify(d.slug)} | link=${JSON.stringify(d["link-persian-kabobs-title"])} | seoDesc=${d.seoDescription ? "SET" : "(empty)"}`);
  }

  const koob = items.find((it) => it.id === KOOBIDEH_ID);
  console.log("\n=== Koobideh (598d88d8) detail ===");
  if (koob) {
    const d = koob.data ?? {};
    console.log("  slug:", JSON.stringify(d.slug));
    console.log("  link-persian-kabobs-title:", JSON.stringify(d["link-persian-kabobs-title"]));
    console.log("  title:", JSON.stringify(d.title));
    console.log("  seoDescription:", JSON.stringify(d.seoDescription)?.slice(0, 80));
    console.log("  shortDescription present:", !!d.shortDescription);
    console.log("  field count:", Object.keys(d).length);
  } else {
    console.log("  NOT FOUND in query results!");
  }

  // Q1: does any OTHER item own slug koobideh-kabob?
  const owners = items.filter((it) => (it.data?.slug ?? "") === "koobideh-kabob");
  console.log("\n=== items with slug 'koobideh-kabob':", owners.map((o) => o.id).join(", ") || "NONE");

  // Q2: live URL status
  const res = await fetch("https://www.iranopedia.com/persian-kabobs/koobideh-kabob", { headers: { "User-Agent": "Mozilla/5.0" } });
  console.log("\n=== live URL /persian-kabobs/koobideh-kabob → HTTP", res.status);
}
main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.stack : String(e)); process.exit(1); });
