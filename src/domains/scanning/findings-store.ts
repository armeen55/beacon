import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { syncScanFindings } from "@/lib/persistence/dual-write";
import type { Finding, FindingStatus, PromotionStatus } from "./types";
import { FINDING_PRIORITY_ORDER } from "./types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

const STORE_NAME = "scan-findings";
const MAX_FINDINGS = 500;

/** Normalize URL to path-only for consistent matching across full URLs and path-only URLs. */
function normUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
}

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
  const key = normUrl(url);
  return getFindings().filter((f) => normUrl(f.url) === key);
}

export function getPendingFindingsForUrl(url: string): Finding[] {
  return getFindingsForUrl(url).filter((f) => f.status === "pending");
}

export function getPreviouslyRejectedTypeKeys(): Set<string> {
  const findings = getFindings();
  const keys = new Set<string>();
  for (const f of findings) {
    if (f.status === "rejected") {
      keys.add(`${f.type}::${normUrl(f.url)}`);
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
        keys.add(`${f.type}::${normUrl(f.url)}`);
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
    const typeKey = `${f.type}::${normUrl(f.url)}`;
    if (suppressed.has(typeKey)) continue;

    // Deduplicate persistent-state findings: replace pending entry for same
    // type+URL instead of stacking duplicates from consecutive scans.
    //   - guardrails: oscillation fix (new_guardrail / guardrail_cleared flip)
    //   - schema_missing_for_page_type: Phase 1 — persistent-state finding,
    //     refreshed on every scan until the operator deploys the missing types
    //   - Phase 3.5H (2026-04-22): add `schema_invalid`, `schema_changed`,
    //     `faq_changed`, `unexpected_change`. All four are "latest-observation"
    //     semantics — the most recent scan's reading of that (type, URL) is
    //     the one that should be pending; older-run findings describe stale
    //     page state and were stacking 2-9× per URL under the previous
    //     narrower list.
    if (
      f.type === "new_guardrail" ||
      f.type === "guardrail_cleared" ||
      f.type === "schema_missing_for_page_type" ||
      f.type === "schema_invalid" ||
      f.type === "schema_changed" ||
      f.type === "faq_changed" ||
      f.type === "unexpected_change"
    ) {
      const fNorm = normUrl(f.url);
      const dupeIdx = existing.findIndex(
        (e) =>
          e.type === f.type &&
          e.status === "pending" &&
          normUrl(e.url) === fNorm,
      );
      if (dupeIdx >= 0) {
        existing[dupeIdx] = f;
        existingIds.add(f.id);
        continue;
      }
    }

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

// ---------------------------------------------------------------------------
// Phase 11: Signal quality enrichment
// ---------------------------------------------------------------------------

const MOVEMENT_THRESHOLD = 0.15;
const MOVEMENT_WINDOW_DAYS = 7;

/**
 * Enrich findings with metric movement detection and composite signal strength.
 * Called after scan findings are generated. Mutates findings in-place.
 */
export async function enrichFindingsWithSignalQuality(opts: {
  citationIndex: CitationEvidenceIndex | null;
  snapshots: DailyMetricSnapshot[];
}): Promise<void> {
  const findings = getFindings();
  if (findings.length === 0) return;

  const { citationIndex, snapshots } = opts;

  // Build topic→snapshots index (only topic-level, derived)
  const topicSnaps = new Map<string, DailyMetricSnapshot[]>();
  for (const s of snapshots) {
    if (s.scope_type !== "topic") continue;
    const key = s.scope_id.toLowerCase();
    const arr = topicSnaps.get(key) ?? [];
    arr.push(s);
    topicSnaps.set(key, arr);
  }

  // Page URL → topics lookup
  const pageToTopics: Record<string, string[]> =
    citationIndex?.page_to_topics ?? {};

  let changed = false;

  for (const f of findings) {
    // Look up topics for this finding's URL
    const normalizedUrl = f.url.replace(/\/+$/, "").toLowerCase();
    const topics = pageToTopics[normalizedUrl] ?? pageToTopics[f.url] ?? [];

    // Check for metric movement around detection date
    const detectedDate = f.detectedAt.slice(0, 10);
    let movementDetected = false;

    for (const topic of topics) {
      const snaps = topicSnaps.get(topic.toLowerCase());
      if (!snaps || snaps.length === 0) continue;

      // Before: 7 days before detection
      const beforeStart = addDaysStr(detectedDate, -MOVEMENT_WINDOW_DAYS);
      const beforeSnaps = snaps.filter(
        (s) => s.date >= beforeStart && s.date < detectedDate,
      );
      const afterSnaps = snaps.filter(
        (s) => s.date >= detectedDate &&
          s.date <= addDaysStr(detectedDate, MOVEMENT_WINDOW_DAYS),
      );

      if (beforeSnaps.length < 3 || afterSnaps.length < 3) continue;

      const beforeDays = new Set(beforeSnaps.map((s) => s.date)).size;
      const afterDays = new Set(afterSnaps.map((s) => s.date)).size;
      if (beforeDays < 2 || afterDays < 2) continue;

      const beforeAvg =
        beforeSnaps.reduce((a, s) => a + s.citation_count, 0) / beforeDays;
      const afterAvg =
        afterSnaps.reduce((a, s) => a + s.citation_count, 0) / afterDays;

      if (beforeAvg === 0 && afterAvg > 0) {
        movementDetected = true;
        break;
      }
      if (beforeAvg > 0) {
        const delta = (afterAvg - beforeAvg) / beforeAvg;
        if (Math.abs(delta) >= MOVEMENT_THRESHOLD) {
          movementDetected = true;
          break;
        }
      }
    }

    // Compute signal strength (0-100)
    let strength = Math.min(f.priorityScore, 70); // base from priority (cap at 70)
    if (f.citationCount >= 100) strength += 15;
    else if (f.citationCount >= 10) strength += 10;
    else if (f.citationCount >= 1) strength += 3;
    if (movementDetected) strength += 15;
    strength = Math.min(100, strength);

    if (f.metricMovementDetected !== movementDetected || f.signalStrength !== strength) {
      f.metricMovementDetected = movementDetected;
      f.signalStrength = strength;
      changed = true;
    }
  }

  if (changed) {
    await writeStore(STORE_NAME, findings);
    await syncScanFindings(findings);
  }
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
