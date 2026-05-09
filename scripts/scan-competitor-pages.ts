/**
 * scan-competitor-pages — manual scanner for competitor page structure.
 *
 * T-CompPageBlueprints (2026-05-08). Layer B of the audit's Top-leverage
 * move #5: populate `competitorPageBlueprints[].h1/topH2s/faqQuestions/
 * metaDescription` for the LLM packet by capturing competitor pages'
 * actual HTML structure (not just citation aggregates).
 *
 * Operator-locked safety posture:
 *   - DEFAULT MODE IS DRY-RUN. Persistence requires `--write`.
 *   - Bounded set: input is the top-N rows of `competitor-page-
 *     evidence.json` sorted by citationCount, capped by `--limit`
 *     (default 5).
 *   - Per-domain pacing: 1 req/sec.
 *   - Per-request timeout: 10 seconds.
 *   - Retry: single retry on 5xx; no retry on 4xx (don't pummel a
 *     page that explicitly told us not to).
 *   - User-Agent: `BeaconBot/1.0 (competitor-blueprint-scan)`.
 *   - robots.txt: fetched once per domain, parsed for User-Agent
 *     `BeaconBot` (falls back to `*`); blocked URLs are skipped with
 *     a clear log line.
 *   - NEVER wired into nightly cron in this bundle. Operator runs it
 *     manually with explicit `--write` after reviewing the dry-run.
 *
 * Run with:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/scan-competitor-pages.ts
 *
 * Flags:
 *   --dry-run          (default true) — list URLs that would be fetched, do nothing else
 *   --write            persist captured snapshots to competitor-page-snapshots.json
 *   --limit=N          number of top URLs to consider (default 5)
 *   --url=<url>        scan a single URL only (overrides --limit)
 *   --tenant=<slug>    tenant slug (default: BEACON_TENANT_SLUG env)
 *   --help / -h        show this message
 *
 * Pure of paid APIs. Read-only HTTP. No Supabase mutation. No cron.
 */

// Allow self-signed / intermediate cert issues in scanner context.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { extractPageSnapshot } from "../src/domains/pages/extractor";
import type { CompetitorPageEvidence } from "../src/domains/pages/competitor-evidence";
import {
  type CompetitorPageSnapshot,
  persistCompetitorPageSnapshots,
  pickTopCompetitorUrls,
} from "../src/domains/pages/competitor-page-snapshots";

const BEACON_BOT_UA = "BeaconBot/1.0 (competitor-blueprint-scan)";
const FETCH_TIMEOUT_MS = 10_000;
const PER_DOMAIN_DELAY_MS = 1_000;
const DEFAULT_LIMIT = 5;

// ─── Args ─────────────────────────────────────────────────────────────────

type Args = {
  dryRun: boolean;
  write: boolean;
  limit: number;
  url: string | null;
  tenant: string | null;
  help: boolean;
};

function parseArgs(argv: ReadonlyArray<string>): Args {
  const args: Args = {
    dryRun: true,
    write: false,
    limit: DEFAULT_LIMIT,
    url: null,
    tenant: null,
    help: false,
  };
  for (const a of argv) {
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--write") {
      args.write = true;
      args.dryRun = false;
    } else if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (a.startsWith("--url=")) args.url = a.slice("--url=".length);
    else if (a.startsWith("--tenant=")) args.tenant = a.slice("--tenant=".length);
  }
  return args;
}

function printUsage(): void {
  console.log(
    [
      "scan-competitor-pages — manual competitor page structural scanner",
      "",
      "Default mode is DRY-RUN. Persistence requires --write.",
      "",
      "Flags:",
      "  --dry-run          (default) list URLs that would be fetched",
      "  --write            persist captured snapshots",
      "  --limit=N          top-N urls (default 5)",
      "  --url=<url>        scan a single URL",
      "  --tenant=<slug>    tenant slug",
      "  --help / -h        show this message",
    ].join("\n"),
  );
}

// ─── robots.txt gate ──────────────────────────────────────────────────────

type RobotsState = "allowed" | "blocked" | "fetch_failed";

const robotsCache = new Map<string, Set<string> | "all_allowed">();

async function isAllowedByRobots(url: string): Promise<RobotsState> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "blocked"; // malformed URL — defensive
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (!robotsCache.has(origin)) {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        method: "GET",
        headers: { "User-Agent": BEACON_BOT_UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        robotsCache.set(origin, "all_allowed");
      } else {
        const txt = await res.text();
        const disallows = parseRobotsDisallows(txt, "BeaconBot");
        robotsCache.set(
          origin,
          disallows.size === 0 ? "all_allowed" : disallows,
        );
      }
    } catch {
      robotsCache.set(origin, "all_allowed"); // fetch failure → permissive (we already have UA + pacing)
    }
  }
  const cached = robotsCache.get(origin);
  if (cached === "all_allowed") return "allowed";
  if (cached) {
    const path = parsed.pathname || "/";
    for (const dis of cached) {
      if (dis === "/") return "blocked";
      if (path.startsWith(dis)) return "blocked";
    }
    return "allowed";
  }
  return "fetch_failed";
}

function parseRobotsDisallows(text: string, userAgent: string): Set<string> {
  // Minimal robots parser: collect all `Disallow:` lines that apply
  // to either our UA or the wildcard `*`. Pure / deterministic.
  const disallows = new Set<string>();
  const lines = text.split(/\r?\n/);
  let activeForUs = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      const ua = val.toLowerCase();
      activeForUs = ua === "*" || ua === userAgent.toLowerCase();
      continue;
    }
    if (activeForUs && key === "disallow" && val.length > 0) {
      disallows.add(val);
    }
  }
  return disallows;
}

// ─── HTTP fetch with timeout + retry ──────────────────────────────────────

async function fetchHtmlWithRetry(
  url: string,
): Promise<{ html: string; status: number } | null> {
  const tryOnce = async (): Promise<Response | null> => {
    try {
      return await fetch(url, {
        method: "GET",
        headers: { "User-Agent": BEACON_BOT_UA, Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(
        `  fetch error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  };

  let res = await tryOnce();
  // Single retry on 5xx only. No retry on 4xx (page told us not to).
  if (res && res.status >= 500 && res.status < 600) {
    console.warn(`  ${res.status} on first try — retrying once`);
    res = await tryOnce();
  }
  if (!res) return null;
  if (!res.ok) {
    console.warn(`  http ${res.status} ${res.statusText}`);
    return { html: "", status: res.status };
  }
  const html = await res.text();
  return { html, status: res.status };
}

// ─── Snapshot conversion ──────────────────────────────────────────────────

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function buildCompetitorSnapshot(args: {
  url: string;
  html: string;
  status: number;
  tenantId: string;
  fetchedAt: string;
}): CompetitorPageSnapshot {
  // The owned-page extractor returns a full PageSnapshot. We narrow to
  // structure-only fields per the type's safety posture (see
  // CompetitorPageSnapshot doc comment).
  const pageId = `comp-${urlHash(args.url)}`;
  const owned = extractPageSnapshot(
    args.html,
    args.url,
    pageId,
    args.tenantId,
    args.status,
  );
  return {
    id: `comp-snap-${args.tenantId}-${urlHash(args.url)}`,
    tenant_id: args.tenantId,
    url: args.url,
    canonical_url: owned.canonical_url,
    fetched_at: args.fetchedAt,
    http_status: args.status,
    title: owned.title,
    meta_description: owned.meta_description,
    h1: owned.h1,
    h2_list: owned.h2_list,
    // FAQ questions ONLY — never persist answers (operator-locked
    // safety posture).
    faq_questions: owned.faqs.map((f) => f.question),
    extraction_certainty: owned.extraction_certainty ?? "uncertain",
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function loadCompetitorEvidence(tenantSlug: string): CompetitorPageEvidence[] {
  const repoRoot = resolve(__dirname, "..");
  const path = join(
    repoRoot,
    ".data",
    "tenants",
    tenantSlug,
    "competitor-page-evidence.json",
  );
  if (!existsSync(path)) {
    console.error(
      `❌ No competitor-page-evidence.json found for tenant '${tenantSlug}' at ${path}`,
    );
    process.exit(1);
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as CompetitorPageEvidence[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const tenantSlug =
    args.tenant ?? process.env.BEACON_TENANT_SLUG ?? "ritz-builders";
  const tenantId = process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder";

  console.log("scan-competitor-pages — T-CompPageBlueprints (2026-05-08)");
  console.log(`  tenant:   ${tenantSlug} (${tenantId})`);
  console.log(`  mode:     ${args.write ? "WRITE" : "DRY-RUN"}`);
  console.log(`  limit:    ${args.url ? "(single url)" : args.limit}`);
  console.log("");

  // ── 1. Pick the URL set ─────────────────────────────────────────────
  let target: { url: string; domain: string; citationCount: number }[];
  if (args.url) {
    let dom = "";
    try {
      dom = new URL(args.url).hostname;
    } catch {
      console.error(`❌ Invalid --url: ${args.url}`);
      process.exit(1);
    }
    target = [{ url: args.url, domain: dom, citationCount: 0 }];
  } else {
    const evidence = loadCompetitorEvidence(tenantSlug);
    target = pickTopCompetitorUrls(evidence, args.limit);
  }

  if (target.length === 0) {
    console.warn(
      "  no competitor URLs to scan (evidence file empty or all rows filtered out)",
    );
    return;
  }

  console.log(`  ${target.length} url(s) selected:`);
  for (const t of target) {
    console.log(
      `    [${t.citationCount.toString().padStart(4)}] ${t.url}`,
    );
  }
  console.log("");

  if (args.dryRun) {
    console.log(
      "  DRY-RUN — no HTTP fetched, no snapshots persisted.",
    );
    console.log(
      "  to persist, re-run with --write (review the URL list above first).",
    );
    return;
  }

  // ── 2. Fetch + extract per URL (only on --write) ────────────────────
  const captured: CompetitorPageSnapshot[] = [];
  const lastFetchByDomain = new Map<string, number>();
  for (const t of target) {
    console.log(`  ${t.url}`);
    // robots.txt gate
    const robots = await isAllowedByRobots(t.url);
    if (robots === "blocked") {
      console.warn(`    skipped — robots.txt disallow`);
      continue;
    }
    // pacing — 1 req/sec per domain
    const last = lastFetchByDomain.get(t.domain);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      const wait = Math.max(0, PER_DOMAIN_DELAY_MS - elapsed);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    lastFetchByDomain.set(t.domain, Date.now());

    const fetched = await fetchHtmlWithRetry(t.url);
    if (!fetched || fetched.html.length === 0) {
      console.warn(`    skipped — fetch failed or empty body`);
      continue;
    }
    const snap = buildCompetitorSnapshot({
      url: t.url,
      html: fetched.html,
      status: fetched.status,
      tenantId,
      fetchedAt: new Date().toISOString(),
    });
    captured.push(snap);
    console.log(
      `    captured: title=${JSON.stringify(snap.title)?.slice(0, 60)}, h1=${JSON.stringify(snap.h1)?.slice(0, 60)}, h2s=${snap.h2_list.length}, faqs=${snap.faq_questions.length}`,
    );
  }

  if (captured.length === 0) {
    console.log("\n  no snapshots captured — exiting without persisting.");
    return;
  }

  console.log(`\n  persisting ${captured.length} snapshot(s)…`);
  await persistCompetitorPageSnapshots(captured);
  console.log("  done.");
}

// `--require ./scripts/mock-server-only.cjs` makes the imported
// modules' "server-only" checks pass; main() runs here.
main().catch((err) => {
  console.error("scan-competitor-pages crashed:", err);
  process.exit(2);
});
