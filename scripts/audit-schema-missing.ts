/**
 * One-shot audit: run schema-missing detector against live Ritz snapshot data.
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/audit-schema-missing.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateFindings } from "../src/domains/scanning/detect-findings";
import type { PageSnapshot } from "../src/domains/pages/types";
import type { ChangelogEntry } from "../src/domains/changelog/types";

const DATA = join(process.cwd(), ".data");

const currentSnapshots: PageSnapshot[] = JSON.parse(
  readFileSync(join(DATA, "page-snapshots.json"), "utf8"),
);
const previousSnapshots: PageSnapshot[] = JSON.parse(
  readFileSync(join(DATA, "page-snapshots-prev.json"), "utf8"),
);
const changelog: ChangelogEntry[] = JSON.parse(
  readFileSync(join(DATA, "imported-changes.json"), "utf8"),
);
const historyArr = JSON.parse(
  readFileSync(join(DATA, "url-daily-citations.json"), "utf8"),
);
const history = historyArr[0];
const citationsByUrl = new Map<string, number>();
for (const s of history.series) {
  const total = (s.daily as Array<{ count: number }>).reduce(
    (a, d) => a + d.count,
    0,
  );
  citationsByUrl.set(s.url, total);
}

const findings = generateFindings({
  currentSnapshots,
  previousSnapshots,
  currentGuardrails: [],
  previousGuardrails: [],
  changelog,
  scanRunId: "audit-test",
  citationsByUrl,
  homepageUrl: "https://ritzbuilders.com",
});

const schemaMissing = findings.filter(
  (f) => f.type === "schema_missing_for_page_type",
);
console.log("TOTAL findings emitted:", findings.length);
console.log("schema_missing_for_page_type count:", schemaMissing.length);
console.log();
console.log(
  "url".padEnd(52) +
    " severity".padEnd(10) +
    "citations  missing",
);
console.log("-".repeat(160));
const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
const sorted = [...schemaMissing].sort(
  (a, b) =>
    sevOrder[a.severity] - sevOrder[b.severity] ||
    b.citationCount - a.citationCount,
);
for (const f of sorted) {
  const missing = f.currentState!
    .replace("missing_required: [", "")
    .replace(/]$/, "");
  console.log(
    f.pagePath.padEnd(52) +
      " " +
      f.severity.padEnd(9) +
      " " +
      String(f.citationCount).padStart(8) +
      "  " +
      missing,
  );
}

console.log();
console.log("Severity breakdown:");
const bySev: Record<string, number> = {};
for (const f of schemaMissing) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
for (const [k, v] of Object.entries(bySev).sort())
  console.log("  " + k + ": " + v);

console.log();
console.log("Tonight's 3 target URLs:");
for (const target of [
  "/locations/palo-alto",
  "/our-process",
  "/explore-projects/riverside-way",
]) {
  const f = schemaMissing.find((x) => x.pagePath === target);
  console.log(
    "  " +
      target +
      ": " +
      (f
        ? f.severity + " / " + f.currentState!.slice(0, 100)
        : "NOT EMITTED"),
  );
}

console.log();
console.log("Controls (must NOT emit):");
const menlo = schemaMissing.find((x) => x.pagePath === "/locations/menlo-park");
console.log(
  "  /locations/menlo-park: " +
    (menlo ? "FAIL - emitted" : "PASS - no finding"),
);
const lux = schemaMissing.find(
  (x) => x.pagePath === "/luxury-home-builder-bay-area",
);
console.log(
  "  /luxury-home-builder-bay-area: " +
    (lux ? "FAIL - emitted" : "PASS - no finding"),
);
const home = schemaMissing.find((x) => x.pagePath === "/" || x.pagePath === "");
console.log(
  "  / (homepage): " + (home ? "FAIL - emitted" : "PASS - no finding"),
);
