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
  type DigestTenantSection,
} from "../src/domains/delivery/morning-digest";
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
    sections.push({
      tenantId: t.id,
      businessName: t.business_name || t.slug,
      ...sel,
    });
    console.log(
      `[morning-digest] ${t.id}: pending=${sel.pendingTotal} pushed24h=${sel.pushedLastDay} verified24h=${sel.verifiedLastDay}`,
    );
  }

  const appBaseUrl = process.env.BEACON_APP_URL?.trim() || "https://beacon-bice.vercel.app";
  const dateLabel = now.toISOString().slice(0, 10);
  const digest = composeMorningDigest(sections, { appBaseUrl, dateLabel });

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
