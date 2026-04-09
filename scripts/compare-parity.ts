/**
 * File-vs-Supabase parity comparison for all 15 route-critical stores.
 *
 * Reads each file-backed store from .data/*.json and counts/checks
 * against the Supabase table. Reports mismatches clearly.
 *
 * Usage: npx tsx scripts/compare-parity.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ──

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      process.env[key] ??= val;
    }
  }
}

// ── Supabase client ──

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// ── File reading ──

const DATA_DIR = join(process.cwd(), ".data");

function readJson<T>(name: string): T | null {
  const path = join(DATA_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

// ── DB count/ID queries ──

async function dbCount(table: string): Promise<number> {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error(`  DB error on ${table}: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

async function dbIds(table: string, idColumn = "id"): Promise<Set<string>> {
  const { data, error } = await sb.from(table).select(idColumn);
  if (error) return new Set();
  return new Set(
    (data ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return String(row[idColumn]);
    }),
  );
}

// ── Comparison logic ──

type StoreSpec = {
  label: string;
  fileKey: string;
  dbTable: string;
  fileReader: () => unknown[];
  hasId: boolean;
};

const stores: StoreSpec[] = [
  {
    label: "import-runs",
    fileKey: "import-runs",
    dbTable: "import_runs",
    fileReader: () => readJson<unknown[]>("import-runs") ?? [],
    hasId: true,
  },
  {
    label: "results",
    fileKey: "imported-results",
    dbTable: "results",
    fileReader: () => readJson<unknown[]>("imported-results") ?? [],
    hasId: true,
  },
  {
    label: "changelog-entries",
    fileKey: "imported-changes",
    dbTable: "changelog_entries",
    fileReader: () => readJson<unknown[]>("imported-changes") ?? [],
    hasId: true,
  },
  {
    label: "opportunities",
    fileKey: "imported-opportunities",
    dbTable: "opportunities",
    fileReader: () => readJson<unknown[]>("imported-opportunities") ?? [],
    hasId: true,
  },
  {
    label: "competitors",
    fileKey: "imported-competitors",
    dbTable: "competitors",
    fileReader: () => readJson<unknown[]>("imported-competitors") ?? [],
    hasId: true,
  },
  {
    label: "event-decisions",
    fileKey: "event-decisions",
    dbTable: "attribution_decisions",
    fileReader: () => readJson<unknown[]>("event-decisions") ?? [],
    hasId: true,
  },
  {
    label: "candidate-links",
    fileKey: "candidate-links",
    dbTable: "candidate_links",
    fileReader: () => readJson<unknown[]>("candidate-links") ?? [],
    hasId: true,
  },
  {
    label: "page-issues",
    fileKey: "page-issues",
    dbTable: "page_issues",
    fileReader: () => readJson<unknown[]>("page-issues") ?? [],
    hasId: true,
  },
  {
    label: "change-contracts",
    fileKey: "change-contracts",
    dbTable: "change_contracts",
    fileReader: () => readJson<unknown[]>("change-contracts") ?? [],
    hasId: true,
  },
  {
    label: "pages",
    fileKey: "pages",
    dbTable: "pages",
    fileReader: () => readJson<unknown[]>("pages") ?? [],
    hasId: true,
  },
  {
    label: "page-snapshots",
    fileKey: "page-snapshots",
    dbTable: "page_snapshots",
    fileReader: () => readJson<unknown[]>("page-snapshots") ?? [],
    hasId: true,
  },
  {
    label: "guardrail-alerts",
    fileKey: "page-guardrails",
    dbTable: "guardrail_alerts",
    fileReader: () => readJson<unknown[]>("page-guardrails") ?? [],
    hasId: false,
  },
  {
    label: "citation-evidence-index",
    fileKey: "citation-evidence-index",
    dbTable: "citation_evidence_index",
    fileReader: () => {
      const data = readJson<unknown>("citation-evidence-index");
      return data ? [data] : [];
    },
    hasId: false,
  },
  {
    label: "observation-runs",
    fileKey: "observation-runs",
    dbTable: "observation_runs",
    fileReader: () => {
      const obsRaw =
        (readJson<Record<string, unknown>[]>("observation-runs") ?? []).filter(
          (r) => r && typeof r === "object" && "run_type" in r,
        );

      type LegacyRow = { run_id: string; [k: string]: unknown };
      const legacyRaw =
        (readJson<LegacyRow[]>("scan-runs") ?? []) as LegacyRow[];
      const existingIds = new Set(obsRaw.map((r) => String(r.run_id)));
      const legacy = legacyRaw.filter(
        (r) => r?.run_id && !existingIds.has(r.run_id),
      );
      return [...obsRaw, ...legacy];
    },
    hasId: false,
  },
  {
    label: "competitor-config",
    fileKey: "competitor-universe",
    dbTable: "competitor_config",
    fileReader: () => {
      const raw = readJson<{ competitors?: unknown[] }>(
        "competitor-universe",
      );
      return raw?.competitors?.filter(Boolean) ?? [];
    },
    hasId: false,
  },
];

// ── Main ──

async function main() {
  console.log("Beacon Parity Check — File vs. Supabase\n");
  console.log(
    "Store".padEnd(28) +
      "File".padStart(8) +
      "DB".padStart(8) +
      "  Status",
  );
  console.log("─".repeat(60));

  let mismatches = 0;
  const notes: string[] = [];

  for (const store of stores) {
    const fileRows = store.fileReader();
    const fileCount = fileRows.length;
    const dbRows = await dbCount(store.dbTable);
    const match = fileCount === dbRows;
    if (!match) mismatches++;

    const status = match ? "✓" : "✗ MISMATCH";
    console.log(
      store.label.padEnd(28) +
        String(fileCount).padStart(8) +
        String(dbRows).padStart(8) +
        `  ${status}`,
    );

    if (!match && store.hasId) {
      const fileIds = new Set(
        fileRows
          .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
          .map((r) => String(r.id)),
      );
      const dbIdSet = await dbIds(store.dbTable);
      const onlyInFile = [...fileIds].filter((id) => !dbIdSet.has(id));
      const onlyInDb = [...dbIdSet].filter((id) => !fileIds.has(id));

      if (onlyInFile.length > 0) {
        notes.push(
          `  ${store.label}: ${onlyInFile.length} IDs only in file (first 5: ${onlyInFile.slice(0, 5).join(", ")})`,
        );
      }
      if (onlyInDb.length > 0) {
        notes.push(
          `  ${store.label}: ${onlyInDb.length} IDs only in DB (first 5: ${onlyInDb.slice(0, 5).join(", ")})`,
        );
      }
    }
  }

  console.log("─".repeat(60));

  if (notes.length > 0) {
    console.log("\nID drift details:");
    for (const note of notes) console.log(note);
  }

  if (mismatches === 0) {
    console.log("\n✓ All 15 stores in parity.");
  } else {
    console.log(`\n✗ ${mismatches} store(s) have count mismatches.`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
