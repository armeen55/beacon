/**
 * run-morning-digest — P0 wall 6 (2026-06-10): the queue reaches you.
 *
 * ONE unified email across ALL active tenants: each business's pending
 * moves (drafted ones first) + what shipped/verified in the last day +
 * a link through to approve. Fired by
 * .github/workflows/morning-digest.yml at 14:00 UTC (~7 AM PT) — after
 * the night's scan (04:00) → generation (05:30) → poll (07:00) chain,
 * so the queue in the email IS the fresh one.
 *
 * Delivery is env-gated (explicit opt-in):
 *   RESEND_API_KEY + BEACON_DIGEST_TO  → sends.
 *   either missing                     → logs WAITING FOR OPERATOR and
 *                                        exits 0 (a skip, not a failure).
 *
 * Read-only except the email itself. No paid AI calls. Per-tenant reads
 * go through getRepository().forTenant — no cross-tenant bleed.
 */

import { listTenants } from "../src/domains/tenants/store";
import { getRepository } from "../src/lib/persistence/repositories";
import {
  composeMorningDigest,
  selectDigestRows,
  selectFirstCitations,
  selectPushRegressionAlarms,
  computeMedianApprovalHours,
  selectTopDismissReason,
  type DigestTenantSection,
} from "../src/domains/delivery/morning-digest";
import { computeEditFeedback } from "../src/domains/recommendation-intelligence/edit-feedback";
import { resolveEmailConfig, sendEmail } from "../src/lib/email/resend";

async function main() {
  const now = new Date();
  const cfg = resolveEmailConfig();
  if (cfg.apiKey == null || cfg.defaultTo == null) {
    const missing = [
      ...(cfg.apiKey == null ? ["RESEND_API_KEY"] : []),
      ...(cfg.defaultTo == null ? ["BEACON_DIGEST_TO"] : []),
    ];
    console.warn(
      `[morning-digest] WAITING FOR OPERATOR: delivery env not configured (${missing.join(", ")}) — skipping send (exit 0)`,
    );
    process.exit(0);
  }

  const tenants = (await listTenants()).filter((t) => t.status === "active");
  if (tenants.length === 0) {
    console.warn("[morning-digest] no active tenants — nothing to send");
    process.exit(0);
  }

  const sections: DigestTenantSection[] = [];
  for (const t of tenants) {
    const rows = await getRepository().forTenant(t.id).getRecommendedEdits();
    const sel = selectDigestRows(rows, now);
    const feedback = computeEditFeedback(rows, now);
    const shipped = feedback.overall.asProposed + feedback.overall.modified;
    // First-ever citations (#94): full per-tenant citation history so
    // "first" means first, not first-in-window. Soft-fail to none.
    let firstCitations: string[] = [];
    let pushRegressions: string[] = [];
    try {
      const observations = await getRepository()
        .forTenant(t.id)
        .getPromptAnswerObservations();
      firstCitations = selectFirstCitations(
        observations as Array<{ observed_at: string; citation_urls?: string[] | null; platform?: string | null }>,
        t.domain,
        now,
      );
      // #96 v1: did an approved push HURT? Compare the week before vs
      // after for every page pushed in the last 7 days.
      pushRegressions = selectPushRegressionAlarms(
        observations as Array<{ observed_at: string; citation_urls?: string[] | null }>,
        rows,
        now,
      );
    } catch {
      /* none */
    }
    // Diagnostic-only detector findings (merge/stale etc.) — surfaced
    // as a calibration nudge. Soft-fail to 0.
    let diagnosticCount = 0;
    try {
      const { loadTriggerCandidatesForTenant } = await import(
        "../src/domains/recommendation-intelligence/load-trigger-candidates-for-tenant"
      );
      const triggers = await loadTriggerCandidatesForTenant({ tenantId: t.id });
      diagnosticCount = triggers.diagnostic_only.length;
    } catch {
      /* 0 */
    }
    sections.push({
      tenantId: t.id,
      businessName: t.business_name || t.slug,
      ...sel,
      editRate: feedback.overall.editRate,
      editRateShipped: shipped,
      firstCitations,
      pushRegressions,
      medianApprovalHours: computeMedianApprovalHours(rows, now),
      diagnosticCount,
      topDismissReason: await (async () => {
        try {
          // Explicit per-tenant read — the ambient store getter would
          // misattribute one tenant's dismissals to another's section.
          const responses = await getRepository()
            .forTenant(t.id)
            .getRecommendationResponses();
          return selectTopDismissReason(
            responses as Array<{ status: string; respondedAt: string; dismissReason?: string | null }>,
            now,
          );
        } catch {
          return null;
        }
      })(),
    });
    console.log(
      `[morning-digest] ${t.id}: pending=${sel.pendingTotal} pushed24h=${sel.pushedLastDay} verified24h=${sel.verifiedLastDay} editRate=${feedback.overall.editRate ?? "n/a"}`,
    );
  }

  // P0 wall 5 — the cross-business page-shape insight (gated by
  // BEACON_CROSS_TENANT_BRAIN inside the loader; null when off/thin).
  let networkInsight: string | null = null;
  try {
    const { loadPageShapePatterns } = await import(
      "../src/domains/recommendations/cross-tenant-brain/load-page-shape-patterns"
    );
    const { formatNetworkInsight } = await import(
      "../src/domains/recommendations/cross-tenant-brain/page-shape"
    );
    networkInsight = formatNetworkInsight(await loadPageShapePatterns());
  } catch (err) {
    console.warn(
      `[morning-digest] page-shape insight skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const appBaseUrl = process.env.BEACON_APP_URL?.trim() || "https://beacon-bice.vercel.app";
  const dateLabel = now.toISOString().slice(0, 10);
  const digest = composeMorningDigest(sections, { appBaseUrl, dateLabel, networkInsight });

  const result = await sendEmail({
    to: cfg.defaultTo,
    subject: digest.subject,
    text: digest.text,
    html: digest.html,
  });

  if (result.sent) {
    console.log(`[morning-digest] SENT to=${cfg.defaultTo} id=${result.id ?? "(none)"} subject="${digest.subject}"`);
    process.exit(0);
  }
  if (result.reason === "not_configured") {
    console.warn(`[morning-digest] WAITING FOR OPERATOR: ${result.missing.join(", ")} — skipped`);
    process.exit(0);
  }
  console.error(`::error::[morning-digest] send failed: ${result.detail}`);
  process.exit(1);
}

const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /(?:^|\/)run-morning-digest\.[cm]?[jt]s$/.test(process.argv[1]);

if (invokedAsCli) {
  main().catch((err) => {
    console.error(
      `::error::[morning-digest] crashed: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(1);
  });
}
