"use server";

/**
 * 2026-06-09 — operator-only competitor-intel refresh action. The only
 * entry point that crawls competitor sitemaps + fetches competitor
 * pages. NOT invoked on page load — only on explicit operator clicks on
 * `/diagnostics/competitor-intel`.
 *
 * Posture: operator-gated; sequential + robots-respecting + bounded
 * inside `refreshCompetitorIntel`; no cron. Revalidates this diagnostic
 * page (its own sections read the stores this refresh writes).
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  refreshCompetitorIntel,
  type RefreshCompetitorIntelResult,
} from "@/domains/competitor-intel/refresh-intel";

export type RefreshCompetitorIntelActionResult =
  | RefreshCompetitorIntelResult
  | { ok: false; reason: "not_operator" };

export async function refreshCompetitorIntelAction(): Promise<RefreshCompetitorIntelActionResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const result = await refreshCompetitorIntel();
  revalidatePath("/diagnostics/competitor-intel");
  return result;
}

// ── Void-returning <form action> wrapper (the page binds this) ──────
export async function refreshCompetitorIntelFromForm(
  _formData: FormData,
): Promise<void> {
  await refreshCompetitorIntelAction();
}
