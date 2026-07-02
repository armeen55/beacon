/**
 * One-off ground-truth probe (item 6 verification): pull REAL GA4 AI-referral
 * sessions for tenant-iranopedia, upsert them into ga4_ai_referral_daily, then
 * read the 30-day summary back and print the Today line the operator would see.
 * Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia BEACON_TENANT_SLUG=iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_ai-referrals-live.ts
 */
import { pullGa4AiReferralsForTenant } from "../src/lib/connectors/ga4/sync-ai-referrals";
import { loadAiReferralSummary, aiReferralTodayLine } from "../src/domains/ai-visibility/ai-referrals";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";

  const sync = await pullGa4AiReferralsForTenant({ tenantId, days: 60 });
  console.log("sync:", JSON.stringify(sync));

  const summary = await loadAiReferralSummary(tenantId, 30);
  console.log(
    "summary30d:",
    JSON.stringify({
      hasData: summary.hasData,
      totalSessions: summary.totalSessions,
      totalEngagedSessions: summary.totalEngagedSessions,
      totalKeyEvents: summary.totalKeyEvents,
      bySource: summary.bySource,
      topPages: summary.topPages.slice(0, 5),
      latestDay: summary.latestDay,
      days: summary.byDay.length,
    }),
  );
  console.log("todayLine:", aiReferralTodayLine(summary) ?? "(silent: zero AI-referred sessions)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
