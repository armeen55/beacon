/**
 * Phase Auto-Link v2 fixture-confirm — read-only.
 *
 * Runs the NEW match-through-changelog logic against live Supabase
 * state and prints: for every pending scan_finding, would it link?
 * If yes, to which recommendation-sourced changelog entry?
 *
 * Does NOT modify Supabase. Does NOT flip the env var. Produces the
 * review artifact the operator reviews before BEACON_AUTO_LINK_FINDINGS=1
 * on hosted.
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

// Mirror the guardrails in src/domains/scanning/detect-findings.ts
const REC_LINK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const COMPATIBILITY: Record<string, ReadonlyArray<string>> = {
  title_changed: ["content"],
  meta_changed: ["content"],
  h1_changed: ["content"],
  h2_changed: ["content"],
  h3_changed: ["content"],
  content_changed: ["content"],
  faq_changed: ["content", "technical", "faq"],
  schema_changed: ["technical"],
  schema_entity_names_changed: ["technical"],
  schema_invalid: ["technical"],
  schema_missing_for_page_type: ["technical"],
  faq_without_schema: ["technical", "faq"],
  canonical_changed: ["technical"],
  links_changed: ["technical"],
  page_added: ["page"],
  page_removed: ["page"],
};

function normPath(url: string | null | undefined): string {
  if (!url) return "";
  return url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function pageAll<T>(table: string, extra?: (q: ReturnType<typeof sb.from>) => ReturnType<typeof sb.from>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = sb.from(table).select("*") as any;
    if (extra) q = extra(q);
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

type Changelog = {
  id: string;
  timestamp: string;
  url: string | null;
  signal_type: string;
  hypothesis_source?: string | null;
  source_rec_id?: string | null;
  source_pattern_id?: string | null;
  change_description?: string | null;
};

type Finding = {
  id: string;
  type: string;
  status: string;
  url: string | null;
  summary: string | null;
  detected_at: string;
  source_rec_id?: string | null;
};

async function main() {
  const nowMs = Date.now();
  const cutoff = nowMs - REC_LINK_WINDOW_MS;

  console.log("── Phase Auto-Link v2 fixture-confirm ──\n");
  console.log(`now: ${new Date(nowMs).toISOString()}`);
  console.log(`14d cutoff: ${new Date(cutoff).toISOString()}\n`);

  // ── Load eligible rec-sourced changelog entries (last 14d) ──
  const allChangelog = await pageAll<Changelog>("changelog_entries");
  const eligible = allChangelog.filter((c) => {
    if (c.hypothesis_source !== "recommendation") return false;
    if (!c.source_rec_id) return false;
    if (!c.url) return false;
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t)) return false;
    if (t < cutoff) return false;
    return true;
  });

  console.log(
    `Total changelog entries: ${allChangelog.length}  ` +
      `eligible (rec-sourced + URL + within 14d): ${eligible.length}\n`,
  );

  if (eligible.length > 0) {
    console.log("── Eligible rec-sourced changelog entries ──");
    for (const c of eligible) {
      console.log(
        `  ${c.timestamp.slice(0, 19)}Z  ${c.signal_type.padEnd(10)} ${c.url}`,
      );
      console.log(`    rec=${c.source_rec_id} cl=${c.id}`);
    }
    console.log();
  }

  // Bucket by normalised path.
  const byPath = new Map<string, Changelog[]>();
  for (const c of eligible) {
    const k = normPath(c.url);
    if (!k) continue;
    const arr = byPath.get(k) ?? [];
    arr.push(c);
    byPath.set(k, arr);
  }

  // ── Load pending findings ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findings = await pageAll<Finding>("scan_findings", (q: any) =>
    q.eq("status", "pending"),
  );
  console.log(`── Pending findings to evaluate: ${findings.length} ──\n`);

  let wouldLink = 0;
  let wouldNotLink = 0;
  const byReason = new Map<string, number>();
  const bump = (r: string) =>
    byReason.set(r, (byReason.get(r) ?? 0) + 1);

  for (const f of findings) {
    const compatible = COMPATIBILITY[f.type];
    const key = normPath(f.url);
    const detected = Date.parse(f.detected_at);

    let decision: { link: boolean; reason: string; to?: Changelog } = {
      link: false,
      reason: "",
    };

    if (!compatible) {
      decision = { link: false, reason: `unknown-type:${f.type}` };
    } else if (!key) {
      decision = { link: false, reason: "no-url" };
    } else {
      const candidates = byPath.get(key) ?? [];
      const filtered = candidates.filter((c) => {
        const t = Date.parse(c.timestamp);
        if (!Number.isFinite(t) || !Number.isFinite(detected)) return false;
        if (t >= detected) return false; // changelog must be earlier
        return compatible.includes(c.signal_type);
      });
      if (filtered.length === 0) {
        if (candidates.length === 0) {
          decision = { link: false, reason: "no-rec-changelog-on-url" };
        } else {
          decision = { link: false, reason: "no-compatible-changelog" };
        }
      } else {
        filtered.sort(
          (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
        );
        decision = { link: true, reason: "match", to: filtered[0] };
      }
    }

    if (decision.link) wouldLink += 1;
    else wouldNotLink += 1;
    bump(decision.reason);

    // Only print verbose rows that would link OR that have an eligible
    // URL but didn't link (interesting cases).
    const interesting =
      decision.link || decision.reason === "no-compatible-changelog";
    if (interesting) {
      console.log(`  ${decision.link ? "✓ LINK" : "✗ SKIP"} ${f.type.padEnd(14)} ${f.url}`);
      console.log(`    finding: ${f.summary?.slice(0, 80) ?? ""}`);
      console.log(`    detected_at: ${f.detected_at}`);
      console.log(`    reason: ${decision.reason}`);
      if (decision.to) {
        console.log(
          `    → changelog: ${decision.to.id}  rec=${decision.to.source_rec_id}  at=${decision.to.timestamp.slice(0, 19)}Z`,
        );
        console.log(
          `    → signal_type=${decision.to.signal_type}  description="${(decision.to.change_description ?? "").slice(0, 80)}"`,
        );
      }
      console.log();
    }
  }

  console.log("── Summary ──");
  console.log(`  Would link:    ${wouldLink}`);
  console.log(`  Would skip:    ${wouldNotLink}`);
  console.log(`  Skip reasons:`);
  for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${n.toString().padStart(4, " ")}  ${r}`);
  }
  console.log("\n(no Supabase writes; no env-var changes)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
