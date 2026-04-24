/**
 * Phase C — read-only FAQ snapshot probe for the 4 pages the operator
 * called out: /services, /faq, /our-process, /locations/palo-alto.
 *
 * For each page, show the two most recent snapshots' FAQ breakdown:
 *   - faqs array size
 *   - per-source counts (jsonld / html_details / html_section)
 *   - faq_schema_block_count
 *   - schema_types contains "FAQPage"?
 *   - fetched_at timestamps
 *
 * Expected to reveal whether the 5 Today findings are:
 *   - true visible removal
 *   - schema removal with visible intact
 *   - duplicate schema cleanup (halving)
 *   - content expansion
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Snap = {
  id: string;
  page_id: string;
  url: string;
  fetched_at: string;
  faqs: Array<{ question: string; source: string }>;
  faq_schema_block_count?: number;
  schema_types?: string[];
};

const PAGES = [
  "/services",
  "/faq",
  "/our-process",
  "/locations/palo-alto",
];

async function main() {
  console.log("── Phase C FAQ snapshot probe ──\n");

  for (const path of PAGES) {
    console.log(`══════ ${path} ══════`);
    const { data, error } = await sb
      .from("page_snapshots")
      .select("id,page_id,url,fetched_at,faqs,faq_schema_block_count,schema_types")
      .ilike("url", `%${path}`)
      .order("fetched_at", { ascending: false })
      .limit(4);
    if (error) {
      console.log(`  ERROR: ${error.message}\n`);
      continue;
    }
    if (!data || data.length === 0) {
      console.log("  No snapshots.\n");
      continue;
    }
    // Narrow to exact path match (avoid .../services/... false positives)
    const exact = data.filter((s: Snap) => {
      try {
        const p = new URL(s.url).pathname.replace(/\/$/, "");
        return p === path || p === path.replace(/\/$/, "");
      } catch {
        return false;
      }
    });
    const subset = exact.length > 0 ? exact : data;

    for (const snap of subset as Snap[]) {
      const faqs = snap.faqs ?? [];
      const bySrc = new Map<string, number>();
      for (const f of faqs) {
        bySrc.set(f.source, (bySrc.get(f.source) ?? 0) + 1);
      }
      const hasFaqPage = (snap.schema_types ?? []).includes("FAQPage");
      console.log(
        `  fetched_at=${snap.fetched_at.slice(0, 19)}Z  url=${snap.url}`,
      );
      console.log(`    total faqs=${faqs.length}`);
      console.log(
        `    by source: jsonld=${bySrc.get("jsonld") ?? 0}, html_details=${bySrc.get("html_details") ?? 0}, html_section=${bySrc.get("html_section") ?? 0}`,
      );
      console.log(
        `    faq_schema_block_count=${snap.faq_schema_block_count ?? "undef"}  FAQPage in schema_types=${hasFaqPage}`,
      );
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
