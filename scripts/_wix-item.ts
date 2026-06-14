/**
 * Ad-hoc (throwaway): dump FULL field values for candidate Wix CMS items so we
 * can pick a safe, MEANINGFUL first push (verify-first: is the field actually
 * empty, or did the crawler miss JS-rendered content?). Prints content values
 * (not secrets).
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-item.ts
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

// (collection, substring to match in any field value identifying the item)
const TARGETS: Array<{ col: string; match: string }> = [
  { col: "PersianRugs", match: "mashhad" },
  { col: "IranAnimals", match: "bee-eater" },
  { col: "PersianKabobs", match: "koobideh" },
  { col: "CaliforniaPersianRestaurants", match: "berkeley" },
];

function show(v: unknown): string {
  if (typeof v === "string") return v.length > 160 ? v.slice(0, 160) + "…" : v;
  if (v == null) return String(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  return String(v);
}

async function main() {
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const token = await getWixConnectorToken("tenant-iranopedia");
  if (!token?.api_key || !token?.site_id) {
    console.error("NO WIX TOKEN");
    process.exit(1);
  }
  const headers: Record<string, string> = {
    Authorization: token.api_key,
    "wix-site-id": token.site_id,
    "Content-Type": "application/json",
  };

  for (const t of TARGETS) {
    const q = await fetch(`${BASE}/wix-data/v2/items/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dataCollectionId: t.col, query: { paging: { limit: 200 } } }),
    });
    if (!q.ok) {
      console.log(`\n### ${t.col} → HTTP ${q.status}`);
      continue;
    }
    const body = (await q.json()) as Record<string, unknown>;
    const items = (body.dataItems as Array<Record<string, unknown>>) ?? [];
    const hit = items.find((it) => {
      const data = (it.data as Record<string, unknown>) ?? {};
      return Object.values(data).some(
        (v) => typeof v === "string" && v.toLowerCase().includes(t.match),
      );
    });
    console.log(`\n### ${t.col}  (matched "${t.match}": ${hit ? "yes" : "NO — " + items.length + " items"})`);
    if (!hit) continue;
    const data = (hit.data as Record<string, unknown>) ?? {};
    console.log(`itemId: ${hit.id ?? data._id}`);
    for (const [k, v] of Object.entries(data)) {
      if (k === "_owner") continue;
      console.log(`  ${k} = ${show(v)}`);
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
