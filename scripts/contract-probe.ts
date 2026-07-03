/**
 * contract-probe (BEACON_500 R7 / N40, 2026-07-03) - OPERATOR-RUN ONLY live
 * smoke of the external API contracts.
 *
 * =====================  NEVER RUN THIS IN CI  =====================
 * This script makes REAL network calls with the operator's credentials and
 * (for DataForSEO / OpenAI) can spend real money - fractions of a cent per
 * run, but never free. CI validates the same shapes at $0 via the recorded
 * fixtures in tests/contracts/*.test.ts; this script exists so the operator
 * can occasionally confirm the LIVE APIs still match those fixtures.
 * It is double-gated: it exits immediately unless BEACON_CONTRACT_PROBE=1
 * is set AND no CI env var is present.
 * ==================================================================
 *
 * What it checks (each probe is fail-soft and independent):
 *   - GSC   sites.list + one searchanalytics.query day -> row shape
 *   - GA4   runReport (traffic) -> narrowed row shape
 *   - Wix   collections list + one items page -> id/data/fields shape
 *   - DataForSEO  one SERP read through the REAL money gauntlet (cache /
 *     dry-run / cap all honored; dry-run mode reports SKIP, never spends)
 *   - OpenAI  one tiny json_schema chat completion -> structured content shape
 *
 * A missing credential / not-connected source prints SKIP, a live shape
 * mismatch prints FAIL (exit 1), a match prints PASS.
 *
 * Usage (from the repo root):
 *   set -a; . ./.env.local; set +a
 *   BEACON_CONTRACT_PROBE=1 npx tsx --require ./scripts/mock-server-only.cjs scripts/contract-probe.ts
 */

/* eslint-disable no-console */

let failures = 0;

function pass(name: string, detail: string): void {
  console.log(`[PASS] ${name} - ${detail}`);
}
function skip(name: string, detail: string): void {
  console.log(`[SKIP] ${name} - ${detail}`);
}
function fail(name: string, detail: string): void {
  failures += 1;
  console.error(`[FAIL] ${name} - ${detail}`);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function probeGsc(tenantId: string): Promise<void> {
  const NAME = "gsc-searchanalytics";
  try {
    const { resolveGscAccessToken, gscListSites, pickGscPropertyForDomain, gscSearchAnalyticsQuery } =
      await import("@/lib/connectors/gsc/search-analytics");
    const token = await resolveGscAccessToken(tenantId);
    if (token == null) return skip(NAME, "no usable GSC token for this tenant");

    const sites = await gscListSites(token);
    if (sites.length === 0) return fail(NAME, "sites.list returned no entries (shape or auth drift)");
    if (sites.some((s) => typeof s.siteUrl !== "string")) {
      return fail(NAME, "sites.list entry missing string siteUrl");
    }

    const { getTenant } = await import("@/domains/tenants/store");
    const domain = (await getTenant(tenantId))?.domain ?? "";
    const property = pickGscPropertyForDomain(sites, domain) ?? sites[0]!.siteUrl;

    // GSC data is ~3 days behind; probe a single settled day, tiny rowLimit.
    const rows = await gscSearchAnalyticsQuery({
      accessToken: token,
      siteUrl: property,
      startDate: daysAgoIso(5),
      endDate: daysAgoIso(5),
      dimensions: ["page", "query"],
      rowLimit: 10,
    });
    if (rows == null) return fail(NAME, "searchanalytics.query returned null (auth/quota/shape)");
    for (const r of rows) {
      if (!Array.isArray(r.keys) || r.keys.length !== 2) return fail(NAME, "row.keys is not [page, query]");
      if (typeof r.clicks !== "number" || typeof r.impressions !== "number") {
        return fail(NAME, "row metrics are not numbers");
      }
      if (r.ctr < 0 || r.ctr > 1) return fail(NAME, `row.ctr out of the 0..1 fraction range: ${r.ctr}`);
    }
    pass(NAME, `${property} answered ${rows.length} rows with the expected shape`);
  } catch (e) {
    fail(NAME, e instanceof Error ? e.message : String(e));
  }
}

async function probeGa4(tenantId: string): Promise<void> {
  const NAME = "ga4-run-report";
  try {
    const { getGoogleConnectorToken } = await import("@/lib/connector-store");
    const token = await getGoogleConnectorToken("ga4", tenantId);
    const propertyId = token?.ga4_property_id ?? "";
    if (token == null || propertyId === "") return skip(NAME, "no GA4 token/property for this tenant");

    const { runGa4UrlTrafficReport } = await import("@/lib/connectors/ga4/data-api");
    const result = await runGa4UrlTrafficReport({
      tenantId,
      propertyId,
      startDate: daysAgoIso(3),
      endDate: daysAgoIso(1),
    });
    if (!result.ok) {
      if (result.reason === "no_token" || result.reason === "disconnected" || result.reason === "token_expired") {
        return skip(NAME, `not usable right now (${result.reason})`);
      }
      return fail(NAME, `api_error: ${result.message ?? "?"} status=${result.status ?? "?"}`);
    }
    for (const r of result.rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return fail(NAME, `row.date not normalized: ${r.date}`);
      if (typeof r.sessions !== "number") return fail(NAME, "row.sessions is not a number");
    }
    pass(NAME, `property ${propertyId} answered ${result.rows.length} narrowed rows`);
  } catch (e) {
    fail(NAME, e instanceof Error ? e.message : String(e));
  }
}

async function probeWix(tenantId: string): Promise<void> {
  const NAME = "wix-collections-items";
  try {
    const { wixListDataCollections, wixQueryDataItems } = await import("@/lib/connectors/wix/client");
    const cols = await wixListDataCollections({ tenantId });
    if (!cols.ok) {
      if (cols.reason === "no_key" || cols.reason === "disconnected") {
        return skip(NAME, `Wix not connected (${cols.reason})`);
      }
      return fail(NAME, `collections list: ${cols.reason} ${"detail" in cols ? cols.detail : ""}`);
    }
    if (cols.value.length === 0) return skip(NAME, "connected, but the site has no data collections");
    const first = cols.value[0]!;
    if (typeof first.id !== "string" || !Array.isArray(first.fields)) {
      return fail(NAME, "collection shape drifted (id/fields)");
    }

    const items = await wixQueryDataItems({ dataCollectionId: first.id, limit: 1 }, { tenantId });
    if (!items.ok) return fail(NAME, `items query: ${items.reason}`);
    for (const it of items.value) {
      if (typeof it.id !== "string" || typeof it.data !== "object") {
        return fail(NAME, "item shape drifted (id/data)");
      }
    }
    pass(NAME, `${cols.value.length} collections; '${first.id}' answered ${items.value.length} item(s)`);
  } catch (e) {
    fail(NAME, e instanceof Error ? e.message : String(e));
  }
}

async function probeDataForSeo(): Promise<void> {
  const NAME = "dataforseo-serp";
  try {
    const { isDataForSeoConfigured } = await import("@/domains/serp/dataforseo-serp");
    if (!isDataForSeoConfigured()) return skip(NAME, "DataForSEO credentials not configured");

    const { runSerpQuery } = await import("@/domains/serp/dataforseo-serp");
    // Rides the REAL money gauntlet: 14d cache first ($0), dry-run default
    // (SKIP, $0), fail-closed monthly cap. A true live read costs ~$0.002.
    const run = await runSerpQuery("koobideh kabob recipe");
    if (run.status === "dry_run") {
      return skip(NAME, "dry-run mode is on (BEACON_DATAFORSEO_DRY_RUN); no spend, no live check");
    }
    if (run.status === "capped" || run.status === "disabled") return skip(NAME, run.detail);
    if (run.status === "error" || run.snapshot == null) return fail(NAME, run.detail);
    const items = run.snapshot.results;
    if (!Array.isArray(items) || items.length === 0) {
      return fail(NAME, "no organic items parsed from a live/cached body");
    }
    if (typeof items[0]!.url !== "string" || typeof items[0]!.rank !== "number") {
      return fail(NAME, "organic item shape drifted (url/rank)");
    }
    pass(NAME, `${run.status}: ${items.length} organic items parsed (cost $${run.costUsd})`);
  } catch (e) {
    fail(NAME, e instanceof Error ? e.message : String(e));
  }
}

async function probeOpenAi(): Promise<void> {
  const NAME = "openai-structured-response";
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return skip(NAME, "OPENAI_API_KEY not set");
  try {
    // One tiny structured completion (~$0.001): validates the SAME envelope
    // fields the provider parses (choices[0].message.content as JSON + usage).
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "Answer with the word ok." }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "probe",
            strict: true,
            schema: {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
              additionalProperties: false,
            },
          },
        },
        max_completion_tokens: 300,
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return fail(NAME, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return fail(NAME, "choices[0].message.content missing/empty (envelope drift)");
    }
    const parsed = JSON.parse(content) as { answer?: unknown };
    if (typeof parsed.answer !== "string") return fail(NAME, "structured content did not match the schema");
    if (typeof body.usage?.prompt_tokens !== "number") {
      return fail(NAME, "usage.prompt_tokens missing (cost accounting would break)");
    }
    pass(NAME, `structured content parsed ("${parsed.answer.slice(0, 20)}"), usage present`);
  } catch (e) {
    fail(NAME, e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<void> {
  if (process.env.BEACON_CONTRACT_PROBE !== "1" || process.env.CI) {
    console.log(
      "contract-probe: refusing to run. This is an OPERATOR-ONLY live probe " +
        "(real credentials, small real spend). Set BEACON_CONTRACT_PROBE=1 " +
        "outside CI to run it. CI covers the same shapes via tests/contracts/.",
    );
    return;
  }
  const tenantId = process.env.BEACON_TENANT_ID ?? "";
  if (tenantId === "") {
    console.log("contract-probe: set BEACON_TENANT_ID (and source .env.local) first.");
    return;
  }

  console.log(`contract-probe: live shape check for tenant ${tenantId}\n`);
  await probeGsc(tenantId);
  await probeGa4(tenantId);
  await probeWix(tenantId);
  await probeDataForSeo();
  await probeOpenAi();

  console.log(failures === 0 ? "\ncontract-probe: no live shape drift found" : `\ncontract-probe: ${failures} probe(s) FAILED`);
  if (failures > 0) process.exitCode = 1;
}

void main();
