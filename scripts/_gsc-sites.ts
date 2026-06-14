/**
 * Ad-hoc: list the GSC properties the connected Iranopedia token can access,
 * so we use the exact siteUrl the account has (sc-domain vs URL-prefix).
 * Prints property URLs + permission levels only (no token).
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_gsc-sites.ts
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

async function main() {
  const { getConnectorToken } = await import("@/lib/connector-store");
  const tok = (await getConnectorToken("google_gsc", "tenant-iranopedia")) as
    | { access_token?: string }
    | null;
  if (!tok?.access_token) {
    console.error("no GSC access_token on the connector row");
    process.exit(1);
  }
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  console.log("sites.list HTTP", res.status);
  const body = (await res.json()) as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
  for (const s of body.siteEntry ?? []) {
    console.log(`  ${s.permissionLevel}  ${s.siteUrl}`);
  }
  if (!body.siteEntry?.length) console.log("  (no properties returned — token scope or wrong account?)", JSON.stringify(body).slice(0, 200));
}
main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : String(e)); process.exit(1); });
