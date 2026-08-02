/**
 * Ad-network connector contracts (2026-07-01, BEACON_500 item 3).
 *
 * The MEASURED half of the honest dollar pipe: when an operator connects a
 * real ad network (AdSense, Mediavine, Raptive), its reporting API produces
 * per-page per-day dollar rows that land in `revenue_facts` with
 * source='ad_network' and basis='measured'. Until credentials exist, every
 * provider fails CLOSED with `connected: false` and the whole path ships
 * dark: no fake dollars, no placeholder numbers.
 *
 * Pure types only; the stub providers live in `registry.ts`. Building the
 * actual OAuth/credential flow is operator-gated future work.
 */

export type AdNetworkProviderId = "adsense" | "mediavine" | "raptive";

/** The basis string a REAL ad-network report carries. Only rows that came
 *  from a network's own reporting API may use it. */
export const AD_NETWORK_MEASURED_BASIS = "measured";

/** One day of measured revenue for one page, as reported by the network. */
type AdNetworkDailyRevenueRow = {
  /** YYYY-MM-DD. */
  day: string;
  /** Path form, leading slash (e.g. "/best-persian-recipes"). */
  pagePath: string;
  revenueUsd: number;
  /** ISO 4217 currency the network reported in (converted upstream if not USD). */
  currency: string;
};

/**
 * Discriminated report result. `connected: false` is the ONLY state any
 * provider returns today; consumers must branch on the discriminator and
 * write nothing when not connected.
 */
export type AdNetworkRevenueReport =
  | {
      connected: true;
      provider: AdNetworkProviderId;
      rows: AdNetworkDailyRevenueRow[];
      basis: typeof AD_NETWORK_MEASURED_BASIS;
    }
  | {
      connected: false;
      provider: AdNetworkProviderId | null;
      reason: "not_connected";
    };

export type AdNetworkFetchArgs = {
  tenantId: string;
  /** Inclusive YYYY-MM-DD window. */
  startDate: string;
  endDate: string;
};

export type AdNetworkProvider = {
  id: AdNetworkProviderId;
  /** Operator-facing name ("Google AdSense"). */
  label: string;
  fetchDailyRevenue(args: AdNetworkFetchArgs): Promise<AdNetworkRevenueReport>;
};
