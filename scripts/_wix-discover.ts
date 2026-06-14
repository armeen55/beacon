/**
 * Ad-hoc (throwaway): discover Iranopedia's Wix CMS collections + fields via
 * the connected token, so we can build the /diagnostics/wix mapping without
 * digging through the Wix editor. Prints NO secrets (only collection IDs,
 * field keys, and truncated sample values).
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-discover.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// tsx doesn't auto-load .env.local the way Next does.
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) {
      let v = m[2]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]!] = v;
    }
  }
} catch {
  /* ignore */
}
process.env.DATA_SOURCE = "supabase";

const BASE = "https://www.wixapis.com";

function truncate(v: unknown): string {
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "…" : v;
  if (v == null) return String(v);
  if (typeof v === "object") return "[object]";
  return String(v);
}

async function main() {
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const token = await getWixConnectorToken("tenant-iranopedia");
  if (!token || !token.api_key || !token.site_id) {
    console.error("NO WIX TOKEN for tenant-iranopedia");
    process.exit(1);
  }
  const headers: Record<string, string> = {
    Authorization: token.api_key,
    "wix-site-id": token.site_id,
    "Content-Type": "application/json",
  };
  console.log("site_id length:", token.site_id.length, "(value redacted)");

  // ── List data collections ──────────────────────────────────────────────
  let collections: Array<Record<string, unknown>> = [];
  let res = await fetch(`${BASE}/wix-data/v2/collections`, { method: "GET", headers });
  console.log("\nGET /wix-data/v2/collections →", res.status);
  if (res.ok) {
    const body = (await res.json()) as Record<string, unknown>;
    collections = (body.collections as Array<Record<string, unknown>>) ?? [];
  } else {
    console.log("  body:", truncate(await res.text()));
    // Fallback: query endpoint
    res = await fetch(`${BASE}/wix-data/v2/collections/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    console.log("POST /wix-data/v2/collections/query →", res.status);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      collections = (body.collections as Array<Record<string, unknown>>) ?? [];
    } else {
      console.log("  body:", truncate(await res.text()));
    }
  }

  console.log(`\n=== ${collections.length} collections ===`);
  for (const c of collections) {
    const id = c._id ?? c.id;
    const displayName = c.displayName ?? c.displayField ?? "";
    const fields = (c.fields as Array<Record<string, unknown>>) ?? [];
    // Skip obvious Wix system collections to reduce noise.
    const idStr = String(id);
    const isSystem = idStr.startsWith("Members/") || idStr.startsWith("Stores/") || idStr.startsWith("@");
    console.log(`\n• ${idStr}   "${displayName}"${isSystem ? "  [system]" : ""}`);
    if (fields.length) {
      const fieldStr = fields
        .map((f) => `${f.key ?? f.id}:${f.type ?? "?"}`)
        .join(", ");
      console.log(`    fields: ${truncate(fieldStr).slice(0, 400)}`);
    }
  }

  // ── Sample items from each NON-system collection (find slug + content) ──
  for (const c of collections) {
    const idStr = String(c._id ?? c.id);
    if (idStr.startsWith("Members/") || idStr.startsWith("Stores/") || idStr.startsWith("@")) continue;
    const q = await fetch(`${BASE}/wix-data/v2/items/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dataCollectionId: idStr, query: { paging: { limit: 2 } } }),
    });
    if (!q.ok) {
      console.log(`\n[items] ${idStr} → ${q.status} ${truncate(await q.text())}`);
      continue;
    }
    const body = (await q.json()) as Record<string, unknown>;
    const items = (body.dataItems as Array<Record<string, unknown>>) ?? [];
    console.log(`\n[items] ${idStr}: ${items.length} sampled`);
    for (const it of items) {
      const data = (it.data as Record<string, unknown>) ?? {};
      const keys = Object.keys(data);
      console.log(`   item ${truncate(it.id ?? data._id)} keys=[${keys.join(", ")}]`);
      for (const k of keys) {
        const v = truncate(data[k]);
        if (typeof data[k] === "string" && (data[k] as string).length > 0) {
          console.log(`      ${k} = ${v}`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
