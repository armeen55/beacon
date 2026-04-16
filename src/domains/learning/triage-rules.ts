/**
 * Learning Loop 3: Finding Triage Learning
 *
 * Analyzes resolved findings to detect which finding types the operator
 * consistently accepts, rejects, or ignores — by finding type and
 * citation bucket.
 *
 * Passive — stored only, not consumed by UI or finding presentation.
 * Runs after scan pipeline (after findings are enriched).
 */

import type { Finding } from "@/domains/scanning/types";
import { writeStore } from "@/lib/persistence/json-store";
import { syncTriageRules } from "@/lib/persistence/dual-write";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** Intentionally no tenant_id — this is a global aggregate across all tenants. CX4 replaces with GlobalPattern. */
export type TriageRule = {
  id: string; // `${finding_type}::${citation_bucket}`
  finding_type: string;
  citation_bucket: "high_citation" | "medium_citation" | "low_citation";
  total_resolved: number;
  accepted_count: number;
  rejected_count: number;
  ignored_count: number;
  acceptance_rate: number; // 0-1
  rejection_rate: number; // 0-1
  recommendation:
    | "auto_accept"
    | "suppress"
    | "boost"
    | "none";
  confidence: "high" | "low";
  computed_at: string;
};

// ---------------------------------------------------------------------------
// Noise guards
// ---------------------------------------------------------------------------

const MIN_RESOLVED_FOR_HIGH_CONFIDENCE = 5;
const AUTO_ACCEPT_THRESHOLD = 0.9;
const SUPPRESS_THRESHOLD = 0.8;
const BOOST_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Citation bucketing
// ---------------------------------------------------------------------------

function citationBucket(
  count: number,
): TriageRule["citation_bucket"] {
  if (count >= 100) return "high_citation";
  if (count >= 10) return "medium_citation";
  return "low_citation";
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export function computeTriageRules(findings: Finding[]): TriageRule[] {
  // Only resolved findings (operator has acted)
  const resolved = findings.filter((f) => f.status !== "pending");

  // Group by type::citation_bucket
  const groups = new Map<
    string,
    {
      finding_type: string;
      citation_bucket: TriageRule["citation_bucket"];
      accepted: number;
      rejected: number;
      ignored: number;
    }
  >();

  for (const f of resolved) {
    const bucket = citationBucket(f.citationCount);
    const key = `${f.type}::${bucket}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        finding_type: f.type,
        citation_bucket: bucket,
        accepted: 0,
        rejected: 0,
        ignored: 0,
      };
      groups.set(key, group);
    }

    if (f.status === "accepted") group.accepted++;
    else if (f.status === "rejected") group.rejected++;
    else if (f.status === "ignored" || f.status === "expected")
      group.ignored++;
  }

  const rules: TriageRule[] = [];

  for (const [id, group] of groups) {
    const total = group.accepted + group.rejected + group.ignored;
    if (total === 0) continue;

    const acceptanceRate =
      Math.round((group.accepted / total) * 100) / 100;
    const rejectionRate =
      Math.round((group.rejected / total) * 100) / 100;

    // Determine recommendation
    let recommendation: TriageRule["recommendation"] = "none";
    if (acceptanceRate > AUTO_ACCEPT_THRESHOLD) {
      recommendation = "auto_accept";
    } else if (rejectionRate > SUPPRESS_THRESHOLD) {
      recommendation = "suppress";
    } else if (acceptanceRate > BOOST_THRESHOLD) {
      recommendation = "boost";
    }

    const confidence: TriageRule["confidence"] =
      total >= MIN_RESOLVED_FOR_HIGH_CONFIDENCE ? "high" : "low";

    rules.push({
      id,
      finding_type: group.finding_type,
      citation_bucket: group.citation_bucket,
      total_resolved: total,
      accepted_count: group.accepted,
      rejected_count: group.rejected,
      ignored_count: group.ignored,
      acceptance_rate: acceptanceRate,
      rejection_rate: rejectionRate,
      recommendation,
      confidence,
      computed_at: new Date().toISOString(),
    });
  }

  // Sort by total_resolved descending
  rules.sort((a, b) => b.total_resolved - a.total_resolved);

  return rules;
}

// ---------------------------------------------------------------------------
// Materialization entry point
// ---------------------------------------------------------------------------

export async function materializeTriageRules(
  findings: Finding[],
): Promise<TriageRule[]> {
  const rules = computeTriageRules(findings);
  await writeStore("triage-rules", rules);
  await syncTriageRules(rules);
  return rules;
}
