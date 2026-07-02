/**
 * Ad-network provider registry (2026-07-01, BEACON_500 item 3).
 *
 * Every provider here is a FAIL-CLOSED stub: there is no credential store,
 * no OAuth flow, and no reporting client yet, so `fetchDailyRevenue` always
 * returns `{ connected: false, reason: "not_connected" }`. The nightly
 * revenue pass consults this registry first; while nothing is connected it
 * writes zero ad_network rows, so no measured-looking dollar can appear
 * before a real network report exists. Wiring credentials + the reporting
 * pull per provider is operator-gated future work (needs the operator's
 * AdSense/Mediavine account).
 */

import type {
  AdNetworkFetchArgs,
  AdNetworkProvider,
  AdNetworkProviderId,
  AdNetworkRevenueReport,
} from "./types";

function notConnected(provider: AdNetworkProviderId): AdNetworkRevenueReport {
  return { connected: false, provider, reason: "not_connected" };
}

function stubProvider(id: AdNetworkProviderId, label: string): AdNetworkProvider {
  return {
    id,
    label,
    fetchDailyRevenue: async () => notConnected(id),
  };
}

export const AD_NETWORK_PROVIDERS: readonly AdNetworkProvider[] = [
  stubProvider("adsense", "Google AdSense"),
  stubProvider("mediavine", "Mediavine"),
  stubProvider("raptive", "Raptive"),
];

/**
 * Ask every registered provider for this tenant's measured revenue. Returns
 * the FIRST connected report, or a not-connected result when none is (the
 * only outcome today). Never throws; a provider error counts as not
 * connected for that provider.
 */
export async function fetchAdNetworkRevenueForTenant(
  args: AdNetworkFetchArgs,
): Promise<AdNetworkRevenueReport> {
  for (const provider of AD_NETWORK_PROVIDERS) {
    try {
      const report = await provider.fetchDailyRevenue(args);
      if (report.connected) return report;
    } catch {
      // A broken provider must never fabricate a connection; keep looking.
    }
  }
  return { connected: false, provider: null, reason: "not_connected" };
}
