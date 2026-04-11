import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { Finding, FindingStatus } from "./types";

const STORE_NAME = "scan-findings";
const MAX_FINDINGS = 500;

export function getFindings(): Finding[] {
  return readStore<Finding>(STORE_NAME);
}

export function getPendingFindings(): Finding[] {
  return getFindings().filter((f) => f.status === "pending");
}

export function getResolvedFindingsCount(): number {
  return getFindings().filter((f) => f.status !== "pending").length;
}

export function getFindingsForUrl(url: string): Finding[] {
  const key = url.replace(/\/+$/, "").toLowerCase();
  return getFindings().filter(
    (f) => f.url.replace(/\/+$/, "").toLowerCase() === key,
  );
}

export function getPendingFindingsForUrl(url: string): Finding[] {
  return getFindingsForUrl(url).filter((f) => f.status === "pending");
}

export async function addFindings(newFindings: Finding[]): Promise<void> {
  const existing = getFindings();
  const existingIds = new Set(existing.map((f) => f.id));

  for (const f of newFindings) {
    if (!existingIds.has(f.id)) {
      existing.push(f);
      existingIds.add(f.id);
    }
  }

  pruneOldResolved(existing);
  await writeStore(STORE_NAME, existing);
}

export async function updateFindingStatus(
  id: string,
  status: FindingStatus,
  linkedChangeId?: string | null,
): Promise<Finding | null> {
  const findings = getFindings();
  const finding = findings.find((f) => f.id === id);
  if (!finding) return null;

  finding.status = status;
  finding.resolvedAt = status === "pending" ? null : new Date().toISOString();
  if (linkedChangeId !== undefined) {
    finding.linkedChangeId = linkedChangeId;
  }

  await writeStore(STORE_NAME, findings);
  return finding;
}

function pruneOldResolved(findings: Finding[]): void {
  if (findings.length <= MAX_FINDINGS) return;

  const resolved = findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.status !== "pending")
    .sort(
      (a, b) =>
        new Date(a.f.detectedAt).getTime() -
        new Date(b.f.detectedAt).getTime(),
    );

  let toRemove = findings.length - MAX_FINDINGS;
  const removeIndices = new Set<number>();
  for (const { i } of resolved) {
    if (toRemove <= 0) break;
    removeIndices.add(i);
    toRemove--;
  }

  if (removeIndices.size > 0) {
    for (let i = findings.length - 1; i >= 0; i--) {
      if (removeIndices.has(i)) findings.splice(i, 1);
    }
  }
}
