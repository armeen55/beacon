"use server";

/**
 * 2026-06-10 — page-factory server action (P0 wall 4: the factory gets
 * a caller). Thin wrapper: auth gate + parse + delegate to
 * src/domains/push/factory-run.ts. Drafts land in the SAME approve
 * queue; nothing ships from here.
 */

import { redirect } from "next/navigation";

import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { currentTenantId } from "@/lib/tenant-context";
import {
  parseClusterPlan,
  runClusterFactoryForTenant,
} from "@/domains/push/factory-run";

const ROUTE = "/diagnostics/factory";

function back(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`${ROUTE}?${qs}`);
}

export async function runFactoryFromForm(formData: FormData): Promise<never> {
  if (!(await canPublishForCurrentTenant())) {
    back({ error: "not_authorized" });
  }
  const raw = String(formData.get("plan_json") ?? "");
  const parsed = parseClusterPlan(raw);
  if (!parsed.ok) {
    back({ error: "bad_plan", detail: parsed.error.slice(0, 180) });
  }
  const tenantId = await currentTenantId();
  const result = await runClusterFactoryForTenant(tenantId, parsed.plan);
  if (!result.ok) {
    back({ error: result.reason, detail: (result.detail ?? "").slice(0, 180) });
  }
  back({
    ok: "1",
    persisted: String(result.persisted),
    flagged: String(result.flagged),
    rejected: String(result.rejected),
    cost: result.totalCostUsd.toFixed(4),
    ...(result.syncWarning ? { sync_warning: result.syncWarning.slice(0, 140) } : {}),
  });
}
