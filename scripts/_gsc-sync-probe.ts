/**
 * Ad-hoc DEFINITIVE probe: run the EXACT GSC sync the "Pull my data" button runs,
 * against prod data, and separately verify the refresh token works.
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_gsc-sync-probe.ts
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
  const TENANT = "tenant-iranopedia";

  // 1) Directly test the REFRESH TOKEN (needs GOOGLE_CLIENT_ID/SECRET from env).
  const { getGoogleConnectorToken } = await import("@/lib/connector-store");
  const tok = (await getGoogleConnectorToken("gsc", TENANT)) as
    | { refresh_token?: string } | null;
  console.log("=== refresh-token test ===");
  if (!tok?.refresh_token) {
    console.log("  NO refresh_token on the row");
  } else {
    try {
      const { refreshGoogleAccessToken } = await import("@/lib/connectors/google-auth");
      const r = await refreshGoogleAccessToken(tok.refresh_token);
      console.log("  REFRESH OK — got a new access token, expires_in", r.expires_in);
    } catch (e) {
      console.log("  REFRESH FAILED:", e instanceof Error ? e.message : String(e));
    }
  }

  // 2) Run the EXACT sync the Pull button runs.
  console.log("=== running syncGscSearchAnalyticsForTenant (the Pull path) ===");
  const { syncGscSearchAnalyticsForTenant } = await import(
    "@/lib/connectors/gsc/sync-search-analytics"
  );
  const result = await syncGscSearchAnalyticsForTenant({ tenantId: TENANT });
  console.log("  RESULT:", JSON.stringify(result));
}
main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
