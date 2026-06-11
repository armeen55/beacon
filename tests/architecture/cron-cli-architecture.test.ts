/**
 * Architecture invariant — Bundle 2 (2026-05-07).
 *
 * Pins the new cron architecture: scheduled daily polling runs as a
 * GitHub-runner CLI (`scripts/cron-poll.ts` via `npm run cron:poll`),
 * NOT as 4-chunk curl-to-Vercel calls. The Vercel `/api/poll/run`
 * route stays in place as a manual/debug fallback (operators can
 * still curl it).
 *
 * Why: the chunked-curl approach hit Vercel's 300s `maxDuration` cap
 * on every chunk during today's (2026-05-07) abnormally-slow upstream
 * Perplexity latency, causing a 21m32s RED workflow with 0 observations
 * persisted (Operator R4 verify-persistence guard caught it). Moving
 * the cron onto the GitHub runner eliminates the 300s wall.
 *
 * Both code paths converge at runNativePoll, so persistence semantics
 * (raw_poll_chunks safety net, persistence-gate guard, dual-write,
 * budget guard) are byte-identical between the two.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const POLL_YAML_PATH = join(REPO_ROOT, ".github/workflows/daily-native-poll.yml");
const CRON_POLL_PATH = join(REPO_ROOT, "scripts/cron-poll.ts");
const PKG_PATH = join(REPO_ROOT, "package.json");
const ACTIVE_TENANTS_PATH = join(REPO_ROOT, "ops/active-tenants.json");
const VERCEL_ROUTE_PATH = join(REPO_ROOT, "src/app/api/poll/run/route.ts");

const POLL_YAML = readFileSync(POLL_YAML_PATH, "utf8");
const CRON_POLL = readFileSync(CRON_POLL_PATH, "utf8");
const PKG = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
  scripts?: Record<string, string>;
};
const ACTIVE_TENANTS = JSON.parse(readFileSync(ACTIVE_TENANTS_PATH, "utf8")) as Array<{
  tenantId: string;
  enabled: boolean;
}>;

/** Strip YAML `#` comments so assertions target active configuration. */
function stripComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((l) => l.replace(/(^|[^"'#])#.*$/, "$1"))
    .join("\n");
}

describe("Bundle 2 — daily-native-poll cron uses GitHub runner CLI, not /api/poll/run", () => {
  const ACTIVE_YAML = stripComments(POLL_YAML);

  it("scheduled poll jobs do NOT curl /api/poll/run", () => {
    // The pre-Bundle-2 shape was 4 × `curl POST /api/poll/run` per platform
    // per tenant. Post-Bundle-2 the scheduled path is a single CLI call;
    // /api/poll/run only appears in comments documenting the manual
    // fallback path.
    expect(ACTIVE_YAML).not.toContain("/api/poll/run");
  });

  it("scheduled poll jobs do NOT use the 300s curl --max-time wall", () => {
    expect(ACTIVE_YAML).not.toContain("--max-time 320");
    expect(ACTIVE_YAML).not.toContain("--max-time 300");
  });

  it("uses npm run cron:poll for both poll jobs", () => {
    expect(ACTIVE_YAML).toMatch(/npm run cron:poll[\s\S]{0,200}--platform=perplexity/);
    expect(ACTIVE_YAML).toMatch(/npm run cron:poll[\s\S]{0,200}--platform=openai/);
  });

  it("matrix substitution drives --tenant arg (no hardcoded tenant ids)", () => {
    expect(ACTIVE_YAML).toMatch(
      /--tenant=\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}\s+--platform=perplexity/,
    );
    expect(ACTIVE_YAML).toMatch(
      /--tenant=\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}\s+--platform=openai/,
    );
    expect(ACTIVE_YAML).not.toContain("--tenant=tenant-ritz-founder");
  });

  it("each poll job uses the canary-proven CI shape (checkout + setup-node + npm ci + npx tsx)", () => {
    expect(ACTIVE_YAML).toMatch(/poll-perplexity:[\s\S]{0,800}actions\/checkout@v4/);
    expect(ACTIVE_YAML).toMatch(/poll-perplexity:[\s\S]{0,800}actions\/setup-node@v4/);
    expect(ACTIVE_YAML).toMatch(/poll-perplexity:[\s\S]{0,800}npm ci\s+--no-audit\s+--no-fund/);
    expect(ACTIVE_YAML).toMatch(/poll-openai:[\s\S]{0,800}actions\/checkout@v4/);
    expect(ACTIVE_YAML).toMatch(/poll-openai:[\s\S]{0,800}actions\/setup-node@v4/);
    expect(ACTIVE_YAML).toMatch(/poll-openai:[\s\S]{0,800}npm ci\s+--no-audit\s+--no-fund/);
  });

  it("each poll job sets the required env block (Supabase + provider key + DUAL_WRITE + DATA_SOURCE + BEACON_TENANT_ID)", () => {
    const perpBlock = POLL_YAML.match(/poll-perplexity:[\s\S]{0,2000}/)?.[0] ?? "";
    expect(perpBlock).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(perpBlock).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(perpBlock).toContain("PERPLEXITY_API_KEY");
    expect(perpBlock).toMatch(/DUAL_WRITE:\s*"true"/);
    expect(perpBlock).toMatch(/DATA_SOURCE:\s*supabase/);
    expect(perpBlock).toContain("BEACON_TENANT_ID");

    const oaiBlock = POLL_YAML.match(/poll-openai:[\s\S]{0,2000}/)?.[0] ?? "";
    expect(oaiBlock).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(oaiBlock).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(oaiBlock).toContain("OPENAI_API_KEY");
    expect(oaiBlock).toMatch(/DUAL_WRITE:\s*"true"/);
    expect(oaiBlock).toMatch(/DATA_SOURCE:\s*supabase/);
    expect(oaiBlock).toContain("BEACON_TENANT_ID");
  });

  it("active-tenants matrix is preserved (still drives both poll jobs)", () => {
    expect(ACTIVE_YAML).toMatch(
      /poll-perplexity:[\s\S]{0,600}strategy:[\s\S]{0,300}matrix:[\s\S]{0,300}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
    expect(ACTIVE_YAML).toMatch(
      /poll-openai:[\s\S]{0,600}strategy:[\s\S]{0,300}matrix:[\s\S]{0,300}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
  });

  it("verify-persistence + rebuild-citation-evidence-index jobs are still wired", () => {
    expect(/^\s*verify-persistence:/m.test(POLL_YAML)).toBe(true);
    expect(/^\s*rebuild-citation-evidence-index:/m.test(POLL_YAML)).toBe(true);
  });
});

describe("Bundle 2 — scripts/cron-poll.ts contract", () => {
  it("file exists", () => {
    expect(existsSync(CRON_POLL_PATH)).toBe(true);
  });

  it("calls runNativePoll directly (not via the Vercel HTTP route)", () => {
    expect(CRON_POLL).toContain("import { runNativePoll }");
    expect(CRON_POLL).toContain("runNativePoll({");
    // Strip /* ... */ block comments + // line comments before negative
    // assertion — the file's docstring intentionally mentions
    // `/api/poll/run` to document what this script replaces.
    const code = CRON_POLL
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("/api/poll/run");
    expect(code).not.toContain("fetch(");
  });

  it("supports --tenant + --platform + optional --limit / --offset / --force", () => {
    expect(CRON_POLL).toContain('getArg("--tenant")');
    expect(CRON_POLL).toContain('getArg("--platform")');
    expect(CRON_POLL).toContain('getArg("--limit")');
    expect(CRON_POLL).toContain('getArg("--offset")');
    expect(CRON_POLL).toContain('args.includes("--force")');
  });

  it("validates --platform is perplexity | openai", () => {
    expect(CRON_POLL).toContain('platformRaw === "perplexity"');
    expect(CRON_POLL).toContain('platformRaw === "openai"');
  });

  it("loads .env.local for local dev", () => {
    expect(CRON_POLL).toContain(".env.local");
  });

  it("exits non-zero on hard failure modes (failed | persistence-gate-blocked)", () => {
    expect(CRON_POLL).toMatch(/result\.status === "failed"/);
    expect(CRON_POLL).toMatch(/result\.status === "skipped_persistence_failure_gate"/);
    expect(CRON_POLL).toMatch(/process\.exit\(1\)/);
  });

  it("does NOT call recommendation LLMs (no openai/anthropic SDK calls; no rec generation)", () => {
    // Negative invariants: this script is a poll wrapper, not a rec
    // engine. It must not import or call the LLM-rec providers.
    expect(CRON_POLL).not.toContain("anthropic");
    expect(CRON_POLL).not.toContain("@anthropic-ai/sdk");
    expect(CRON_POLL).not.toContain("OpenAI({");
    expect(CRON_POLL).not.toContain("openai-recommendations");
    expect(CRON_POLL).not.toContain("runProviderAndPersist");
    expect(CRON_POLL).not.toContain("acceptAllHighConfidence");
    expect(CRON_POLL).not.toContain("generateSpecificEdits");
  });

  it("does NOT mutate the recommendation queue", () => {
    expect(CRON_POLL).not.toContain("syncRecommendedEdits");
    expect(CRON_POLL).not.toContain("persistRecommendedEditsLocal");
    expect(CRON_POLL).not.toContain("recommended-edits");
  });

  it("does NOT introduce a Profound dependency", () => {
    expect(CRON_POLL).not.toContain("@/adapters/profound");
    expect(CRON_POLL).not.toContain("scripts/profound");
    expect(CRON_POLL).not.toContain("PROFOUND_");
  });
});

describe("Bundle 2 — package.json + active-tenants invariants", () => {
  it("package.json has cron:poll script", () => {
    expect(PKG.scripts?.["cron:poll"]).toBeTruthy();
    expect(PKG.scripts?.["cron:poll"]).toContain("scripts/cron-poll.ts");
    expect(PKG.scripts?.["cron:poll"]).toContain("mock-server-only.cjs");
  });

  // 2026-06-10 (P0 wall 2): the fleet is two tenants — Ritz + Iranopedia.
  it("active-tenants.json has exactly two enabled tenants (Ritz + Iranopedia)", () => {
    expect(Array.isArray(ACTIVE_TENANTS)).toBe(true);
    const enabled = ACTIVE_TENANTS.filter((t) => t.enabled === true);
    expect(enabled.length).toBe(2);
    const ids = enabled.map((t) => t.tenantId).sort();
    expect(ids).toEqual(["tenant-iranopedia", "tenant-ritz-founder"]);
  });

  it("Vercel /api/poll/run route still exists as the manual/debug fallback", () => {
    expect(existsSync(VERCEL_ROUTE_PATH)).toBe(true);
    const route = readFileSync(VERCEL_ROUTE_PATH, "utf8");
    expect(route).toContain("export async function POST");
    expect(route).toContain("runNativePoll");
  });
});
