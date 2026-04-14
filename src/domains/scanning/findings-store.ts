import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { syncScanFindings } from "@/lib/persistence/dual-write";
import type { Finding, FindingStatus, PromotionStatus } from "./types";
import { FINDING_PRIORITY_ORDER } from "./types";

const STORE_NAME = "scan-findings";
const MAX_FINDINGS = 500;

function migrateOldFinding(f: Finding): Finding {
  return {
    ...f,
    priority: f.priority ?? "minor",
    priorityScore: f.priorityScore ?? 0,
    promotionStatus: f.promotionStatus ?? "none",
    resolutionNote: f.resolutionNote ?? null,
    suppressUntil: f.suppressUntil ?? null,
    citationCount: f.citationCount ?? 0,
    isHomepage: f.isHomepage ?? false,
    contradictsChangelog: f.contradictsChangelog ?? false,
  };
}

export function getFindings(): Finding[] {
  return readStore<Finding>(STORE_NAME).map(migrateOldFinding);
}

export function getPendingFindings(): Finding[] {
  return getFindings()
    .filter((f) => f.status === "pending")
    .sort((a, b) => {
      const po = (FINDING_PRIORITY_ORDER[a.priority] ?? 3) - (FINDING_PRIORITY_ORDER[b.priority] ?? 3);
      if (po !== 0) return po;
      return b.priorityScore - a.priorityScore;
    });
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

export function getPreviouslyRejectedTypeKeys(): Set<string> {
  const findings = getFindings();
  const keys = new Set<string>();
  for (const f of findings) {
    if (f.status === "rejected") {
      keys.add(`${f.type}::${f.url.replace(/\/+$/, "").toLowerCase()}`);
    }
  }
  return keys;
}

export function getAcceptedFindings(): Finding[] {
  return getFindings().filter((f) => f.status === "accepted");
}

export function getSuppressedTypeKeys(): Set<string> {
  const now = Date.now();
  const findings = getFindings();
  const keys = new Set<string>();
  for (const f of findings) {
    if (f.status === "expected" && f.suppressUntil) {
      if (new Date(f.suppressUntil).getTime() > now) {
        keys.add(`${f.type}::${f.url.replace(/\/+$/, "").toLowerCase()}`);
      }
    }
  }
  return keys;
}

export async function addFindings(newFindings: Finding[]): Promise<void> {
  const existing = getFindings();
  const existingIds = new Set(existing.map((f) => f.id));
  const suppressed = getSuppressedTypeKeys();

  for (const f of newFindings) {
    if (existingIds.has(f.id)) continue;
    const typeKey = `${f.type}::${f.url.replace(/\/+$/, "").toLowerCase()}`;
    if (suppressed.has(typeKey)) continue;
    existing.push(f);
    existingIds.add(f.id);
  }

  pruneOldResolved(existing);
  await writeStore(STORE_NAME, existing);
  await syncScanFindings(existing);
}

export async function updateFindingStatus(
  id: string,
  status: FindingStatus,
  opts?: {
    linkedChangeId?: string | null;
    resolutionNote?: string | null;
    promotionStatus?: PromotionStatus;
    suppressDays?: number;
  },
): Promise<Finding | null> {
  const findings = getFindings();
  const finding = findings.find((f) => f.id === id);
  if (!finding) return null;

  finding.status = status;
  finding.resolvedAt = status === "pending" ? null : new Date().toISOString();

  if (opts?.linkedChangeId !== undefined) {
    finding.linkedChangeId = opts.linkedChangeId;
  }
  if (opts?.resolutionNote !== undefined) {
    finding.resolutionNote = opts.resolutionNote;
  }
  if (opts?.promotionStatus !== undefined) {
    finding.promotionStatus = opts.promotionStatus;
  }
  if (status === "expected" && (opts?.suppressDays ?? 0) > 0) {
    const until = new Date();
    until.setDate(until.getDate() + (opts?.suppressDays ?? 14));
    finding.suppressUntil = until.toISOString();
  }

  await writeStore(STORE_NAME, findings);
  await syncScanFindings(findings);
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
