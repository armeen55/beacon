/**
 * Ad-hoc (throwaway): dump the FULL field schema for chosen collections (the
 * items/query response omits empty fields, so we read the collection def to
 * see every declared field — incl. an empty meta/SEO field if one exists).
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-schema.ts
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
const COLLECTIONS = ["PersianKabobs", "PersianRugs", "IranAnimals"];

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
  for (const col of COLLECTIONS) {
    const res = await fetch(`${BASE}/wix-data/v2/collections/${encodeURIComponent(col)}`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.log(`\n### ${col} → HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    const body = (await res.json()) as Record<string, unknown>;
    const c = (body.collection ?? body) as Record<string, unknown>;
    const fields = (c.fields as Array<Record<string, unknown>>) ?? [];
    console.log(`\n### ${col}  displayName="${c.displayName ?? ""}"  (${fields.length} fields)`);
    for (const f of fields) {
      const key = f.key ?? f.id;
      const type = f.type ?? "?";
      const disp = f.displayName ?? "";
      console.log(`   ${key}  [${type}]  "${disp}"`);
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
