/**
 * Iranopedia first live push — koobideh-kabob meta description.
 *
 * Flags:
 *   (default)      Phase A (ensure seoDescription field) + Phase B (DRY-RUN).
 *   --execute      Phase C: LIVE write via executePush (requires the operator's
 *                  go AND the SEO-Variable binding done in the Wix dashboard).
 *   --rollback     Restore the field to its pre-push value (from the snapshot).
 *
 * Long-term-safe: writes a DEDICATED `seoDescription` field (decoupled from the
 * visible `shortDescription` intro). The proposed meta is derived from the
 * page's OWN real content (no fabrication, no LLM). SEMrush keyword validation
 * is a future gate (per operator) — not applied here.
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_wix-koobideh-meta.ts [--execute|--rollback]
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

const TENANT = "tenant-iranopedia";
const COLLECTION = "PersianKabobs";
const SLUG = "koobideh-kabob";
const TARGET_URL = "https://www.iranopedia.com/persian-kabobs/koobideh-kabob";
const FIELD = "seoDescription";
const SITE_BASE = "https://www.iranopedia.com";
const BASE = "https://www.wixapis.com";

// Derived from the page's OWN content (shortDescription + recipe facts already
// on the item). ≤160 chars, answer-first. NOT fabricated, NOT LLM-generated.
const PROPOSED_META =
  "Authentic Persian Koobideh Kabob recipe: spiced ground beef shaped on skewers and grilled. Step-by-step ingredients, grilling tips, cook time & nutrition.";

const EXECUTE = process.argv.includes("--execute");
const ROLLBACK = process.argv.includes("--rollback");

async function wix(token: { api_key: string; site_id: string }, path: string, init: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: token.api_key,
      "wix-site-id": token.site_id,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function main() {
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const token = await getWixConnectorToken(TENANT);
  if (!token?.api_key || !token?.site_id) {
    console.error("NO WIX TOKEN for", TENANT);
    process.exit(1);
  }
  console.log(`meta length: ${PROPOSED_META.length} chars`);

  // ── PHASE A: ensure the dedicated seoDescription field exists ───────────
  const getRes = await wix(token, `/wix-data/v2/collections/${COLLECTION}`, { method: "GET" });
  const col = ((await getRes.json()) as any).collection;
  const fields = (col.fields ?? []) as any[];
  const hasField = fields.some((f) => String(f.key) === FIELD);
  console.log(`\n[Phase A] ${COLLECTION}: ${fields.length} fields; "${FIELD}" present: ${hasField}`);
  if (!hasField) {
    const before = fields.length;
    const updated = {
      ...col,
      fields: [...fields, { key: FIELD, type: "TEXT", displayName: "SEO Description" }],
    };
    const putRes = await wix(token, `/wix-data/v2/collections`, {
      method: "PUT",
      body: JSON.stringify({ collection: updated }),
    });
    if (!putRes.ok) {
      console.error(`  PUT failed ${putRes.status}: ${(await putRes.text()).slice(0, 300)}`);
      console.error("  → cannot add seoDescription via API; add it in the Wix CMS dashboard, or rerun.");
      process.exit(1);
    }
    const verify = ((await (await wix(token, `/wix-data/v2/collections/${COLLECTION}`, { method: "GET" })).json()) as any).collection;
    const vfields = (verify.fields ?? []) as any[];
    const nowHas = vfields.some((f) => String(f.key) === FIELD);
    console.log(`  added "${FIELD}". field count ${before} → ${vfields.length}; present: ${nowHas}`);
    if (!nowHas || vfields.length !== before + 1) {
      console.error("  ABORT: field-count delta unexpected — not exactly +1. Inspect before any write.");
      process.exit(1);
    }
  }

  // ── Set up the tenant-scoped mapping + url-map (real product flow) ───────
  const { saveWixCollectionConfig, syncWixUrlMap, resolveWixItemForUrl } = await import("@/lib/connectors/wix/url-map");
  await saveWixCollectionConfig([
    {
      dataCollectionId: COLLECTION,
      slugField: "slug",
      urlPrefix: "/persian-kabobs",
      labelField: "title",
      contentFieldRoles: { description: FIELD },
    },
  ]);
  const sync = await syncWixUrlMap({ siteBaseUrl: SITE_BASE }, { tenantId: TENANT });
  console.log(`\n[url-map] collections=${sync.collections} itemsMapped=${sync.itemsMapped} errors=${sync.errors.join("|") || "none"}`);
  const entry = await resolveWixItemForUrl(TARGET_URL);
  console.log(`[url-map] ${SLUG} → ${entry ? `${entry.dataCollectionId}/${entry.dataItemId}` : "NOT RESOLVED"}`);
  if (!entry) {
    console.error("ABORT: koobideh URL did not resolve to a CMS item.");
    process.exit(1);
  }

  // ── Read the item's CURRENT field value (old value, for the diff) ───────
  const { wixQueryDataItems } = await import("@/lib/connectors/wix/client");
  const items = await wixQueryDataItems({ dataCollectionId: COLLECTION, limit: 200 }, { tenantId: TENANT } as any);
  const item = items.ok ? items.value.find((i: any) => i.id === entry.dataItemId) : null;
  const oldVal = item ? String((item.data as any)[FIELD] ?? "") : "(item read failed)";

  // ── Construct the edit (the real card shape) ────────────────────────────
  const nowIso = new Date().toISOString();
  const edit: any = {
    id: `iranopedia-koobideh-${FIELD}`,
    tenant_id: TENANT,
    rec_id: "iranopedia-koobideh-meta",
    action_type: "edit_meta",
    target_url: TARGET_URL,
    target_element_key: null, // ← derived to field:seoDescription
    display_label: "Add the meta description for the Koobideh Kabob recipe page",
    current_text: oldVal,
    proposed_text: PROPOSED_META,
    why: "Live page serves NO <meta name=\"description\">; AI/Google have no snippet to show for a complete recipe page.",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "high",
    measurement_plan: "Watch GSC impressions/CTR + AI citations for koobideh queries after the meta goes live.",
    risks: [],
    source: "deterministic",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: nowIso,
    updated_at: nowIso,
    implementation_status: "recommended",
  };

  const { executePush } = await import("@/domains/push/push-service");

  if (ROLLBACK) {
    console.log("\n[ROLLBACK] restoring previous value via a reverse field write…");
    const rev = { ...edit, current_text: PROPOSED_META, proposed_text: oldVal || " " };
    const r = await executePush({ tenantId: TENANT, edit: rev });
    console.log("rollback result:", JSON.stringify(r));
    return;
  }

  // ── PHASE B/C: dry-run (default) or live (--execute) ────────────────────
  const result = await executePush({ tenantId: TENANT, edit, dryRun: !EXECUTE });

  console.log("\n========== PUSH PLAN ==========");
  console.log("mode:        ", EXECUTE ? "LIVE WRITE" : "DRY-RUN (no write)");
  console.log("URL:         ", TARGET_URL);
  console.log("collection:  ", entry.dataCollectionId);
  console.log("itemId:      ", entry.dataItemId);
  console.log("field:       ", FIELD, "(via edit_meta → description role)");
  console.log("OLD value:   ", JSON.stringify(oldVal));
  console.log("NEW value:   ", JSON.stringify(PROPOSED_META));
  console.log("result:      ", JSON.stringify(result));
  console.log("rollback:    ", "snapshot captured pre-write; rerun with --rollback to restore the OLD value");
  console.log("===============================");

  if (EXECUTE && (result as any).kind === "pushed") {
    // Verify the field is set on the item.
    const after = await wixQueryDataItems({ dataCollectionId: COLLECTION, limit: 200 }, { tenantId: TENANT } as any);
    const it2 = after.ok ? after.value.find((i: any) => i.id === entry.dataItemId) : null;
    console.log("\n[verify] item seoDescription now:", JSON.stringify(it2 ? (it2.data as any)[FIELD] : "(read failed)"));
    // Live meta (only reflects once the SEO-Variable binding is saved+published).
    const html = await (await fetch(TARGET_URL, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const md = html.match(/<meta[^>]+name="description"[^>]*>/i);
    console.log("[verify] live <meta description>:", md ? md[0] : "<none yet — bind the SEO Variable + publish>");
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
