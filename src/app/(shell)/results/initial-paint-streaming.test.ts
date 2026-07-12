import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("Results initial paint dependency boundary", () => {
  it("awaits only the ledger before constructing the page shell", () => {
    const start = source.indexOf("const initialContext = loadResultsInitialContext(tenantId)");
    const ledger = source.indexOf("const ledgerRaced = await loadWithDeadline", start);
    const timeout = source.indexOf("if (ledgerRaced.timedOut)", ledger);
    const initialWindow = source.slice(start, timeout);

    expect(start).toBeGreaterThan(-1);
    expect(ledger).toBeGreaterThan(start);
    expect(initialWindow).not.toContain("await initialContext");
    expect(initialWindow).not.toContain("loadConnectionHealth(");
    expect(initialWindow).not.toContain("loadActionPackWorklistForTenant(");
    expect(initialWindow).not.toContain("readLastFinalizedDate(");
    expect(initialWindow).not.toContain("loadCalibrationRecords(");
  });

  it("starts one shared context promise and awaits it only inside streamed consumers", () => {
    expect(source).toContain("<RecomputeControlStream ledger={ledger} initialContext={initialContext} />");
    expect(source).toContain("<ResultsStatusStream ledger={ledger} tenantId={tenantId} initialContext={initialContext} />");
    expect(source).toContain("<MeasuredOutcomesContextStream");
    expect(source).toContain("<LearningDiagnosticsStream ledger={ledger} initialContext={initialContext} />");

    const loaderStart = source.indexOf("async function loadResultsInitialContext");
    const loaderEnd = source.indexOf("type ResultsInitialContext", loaderStart);
    const loader = source.slice(loaderStart, loaderEnd);
    expect(loader.match(/loadConnectionHealth\(/g)).toHaveLength(1);
    expect(loader.match(/loadActionPackWorklistForTenant\(/g)).toHaveLength(1);
    expect(loader.match(/readLastFinalizedDate\(/g)).toHaveLength(1);
    expect(loader.match(/loadCalibrationRecords\(/g)).toHaveLength(1);
  });

  it("keeps truthful loading UI while status and measured cards stream", () => {
    expect(source).toContain('disabledReason="Checking Search Console data."');
    expect(source).toContain("<MeasuredOutcomesFallback rowCount={Math.min(ledger.length, 3)} />");
    expect(source).toContain("I am pulling each change&apos;s daily clicks and comparison checks together.");
  });
});
