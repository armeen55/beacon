/**
 * Backfill historical changelog entries into change contracts.
 *
 * Run with: npx tsx --require ./scripts/mock-server-only.cjs scripts/backfill-change-contracts.ts
 */

import { readStore, writeStore } from "../src/lib/persistence/json-store";
import type { ChangelogEntry } from "../src/domains/changelog/types";
import {
  type ChangeContract,
  type ChangeType,
  type PageType,
  inferChangeTypeFromText,
  inferPageTypeFromUrl,
  inferFaqCountFromText,
  inferSchemaFromText,
  suggestOutcomeWindow,
  scoreAttributionReadiness,
  generateVerificationChecks,
} from "../src/domains/changelog/change-contract";

async function main() {
  const entries = await readStore<ChangelogEntry>("imported-changes");
  console.log(`Loaded ${entries.length} changelog entries`);

  const existing = await readStore<ChangeContract>("change-contracts");
  const existingIds = new Set(existing.map((c) => c.linkedChangelogEntryId));

  let created = 0;
  let skipped = 0;
  const contracts: ChangeContract[] = [...existing];

  for (const entry of entries) {
    if (existingIds.has(entry.id)) { skipped++; continue; }

    const url = entry.url ?? "";
    const desc = entry.change_description ?? "";
    const name = entry.asset_name ?? "";
    const fullText = `${name} ${desc}`;

    const changeType = inferChangeTypeFromText(fullText);
    const pageType = inferPageTypeFromUrl(url);
    const faqCount = inferFaqCountFromText(fullText);
    const schemas = inferSchemaFromText(fullText);

    const topicLabel = (entry.topic_targeted ?? "")
      .replace(/^Shield: /, "")
      .replace(/ Construction$/, " custom homes");

    const draft: Partial<ChangeContract> = {
      pageUrl: url,
      changeType,
      changeSummary: desc.slice(0, 200),
      businessGoal: entry.hypothesis ?? `Improve visibility for ${topicLabel || "this topic"}`,
      intendedHypothesis: entry.hypothesis ?? `Should help with ${topicLabel || "visibility"} in AI search`,
      dateRequested: entry.timestamp,
      city: entry.city_targeted,
      topic: entry.topic_targeted,
      faqCountExpected: faqCount,
      schemaTypesExpected: schemas,
    };

    const { score } = scoreAttributionReadiness(draft);
    const verificationChecks = generateVerificationChecks(draft as ChangeContract);

    const contract: ChangeContract = {
      contractId: `cc-backfill-${entry.id}`,
      accountId: "default",
      dateRequested: entry.timestamp,
      dateLive: entry.timestamp,
      sourceDocument: null,
      sourceInputType: "csv_import",
      pageUrl: url,
      pageType,
      city: entry.city_targeted ?? null,
      service: null,
      topic: entry.topic_targeted ?? null,
      changeType,
      changeSummary: desc.slice(0, 200),
      businessGoal: entry.hypothesis ?? `Improve visibility for ${topicLabel || "this topic"}`,
      intendedHypothesis: entry.hypothesis ?? `Should help with ${topicLabel || "visibility"} in AI search`,
      faqCountExpected: faqCount,
      schemaTypesExpected: schemas,
      h1Expected: null,
      titleExpected: null,
      metaExpected: null,
      internalLinksExpected: [],
      expectedVerification: verificationChecks,
      expectedOutcomeWindowDays: suggestOutcomeWindow(changeType),
      attributionReadiness: score,
      linkedIssueId: null,
      linkedPlanId: null,
      linkedWaveId: null,
      linkedFrontierId: null,
      linkedChangelogEntryId: entry.id,
      verificationStatus: "pending",
      verificationResult: null,
      verifiedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: `Auto-backfilled from ${entry.id}: ${name}`,
      tenant_id: "",
    };

    contracts.push(contract);
    created++;
  }

  await writeStore("change-contracts", contracts);
  console.log(`Created ${created} change contracts (${skipped} already existed)`);
  console.log(`Total contracts: ${contracts.length}`);

  // Summary
  const byType = new Map<string, number>();
  const byReadiness = new Map<string, number>();
  for (const c of contracts) {
    byType.set(c.changeType, (byType.get(c.changeType) ?? 0) + 1);
    byReadiness.set(c.attributionReadiness, (byReadiness.get(c.attributionReadiness) ?? 0) + 1);
  }

  console.log("\nBy change type:");
  [...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t}: ${n}`));

  console.log("\nBy attribution readiness:");
  [...byReadiness.entries()].forEach(([r, n]) => console.log(`  ${r}: ${n}`));
}

main().catch(console.error);
