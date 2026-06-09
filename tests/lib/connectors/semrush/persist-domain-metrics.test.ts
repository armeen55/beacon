/**
 * 2026-06-09 — Semrush refresh/assemble tests. No network, no Supabase:
 * `fetchImpl` + `token` injected; persistence soft-fails to
 * `persisted:false` (no admin client) so the fetch→assemble logic is
 * exercised in isolation.
 */

import { describe, it, expect, vi } from "vitest";
import { refreshSemrushDomainMetrics } from "@/lib/connectors/semrush/persist-domain-metrics";

function fakeRes(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response;
}

const TOKEN = { api_key: "k", database: "us" };

function routedFetch(overviewCsv: string, compCsv: string) {
  return (async (u: string) => {
    if (u.includes("type=domain_ranks")) return fakeRes(overviewCsv);
    if (u.includes("type=domain_organic_organic")) return fakeRes(compCsv);
    return fakeRes("", false, 404);
  }) as unknown as typeof fetch;
}

const OVERVIEW = "Db;Dn;Rk;Or;Ot;Oc;Ad\nus;ritzbuilders.com;152000;340;1200;5400;12";
const COMPETITORS =
  "Dn;Cr;Np;Or;Ot;Oc\nsupplehomes.com;0.83;120;5000;9000;3000\nrival.com;0.5;40;800;1200;500";

const NOW = new Date("2026-06-09T12:00:00.000Z");

describe("refreshSemrushDomainMetrics — assembly", () => {
  it("assembles a snapshot from overview + competitors", async () => {
    const r = await refreshSemrushDomainMetrics(
      { tenantId: "t", domain: "ritzbuilders.com", now: NOW },
      { token: TOKEN, fetchImpl: routedFetch(OVERVIEW, COMPETITORS) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.domain).toBe("ritzbuilders.com");
      expect(r.snapshot.database).toBe("us");
      expect(r.snapshot.fetched_at).toBe(NOW.toISOString());
      expect(r.snapshot.overview?.organicKeywords).toBe(340);
      expect(r.snapshot.organic_competitors.map((c) => c.domain)).toEqual([
        "supplehomes.com",
        "rival.com",
      ]);
      // No Supabase admin in test → persistence soft-fails.
      expect(r.persisted).toBe(false);
    }
  });

  it("bails with no_key BEFORE spending competitor units", async () => {
    const fetchImpl = vi.fn();
    const r = await refreshSemrushDomainMetrics(
      { tenantId: "t", domain: "x.com", now: NOW },
      { token: null, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(r).toEqual({ ok: false, reason: "no_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps competitors when overview is empty (null overview)", async () => {
    const r = await refreshSemrushDomainMetrics(
      { tenantId: "t", domain: "ritzbuilders.com", now: NOW },
      { token: TOKEN, fetchImpl: routedFetch("Db;Dn;Rk", COMPETITORS) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.overview).toBeNull();
      expect(r.snapshot.organic_competitors).toHaveLength(2);
    }
  });

  it("fails with empty when both reports return nothing", async () => {
    const r = await refreshSemrushDomainMetrics(
      { tenantId: "t", domain: "x.com", now: NOW },
      { token: TOKEN, fetchImpl: routedFetch("Db;Dn;Rk", "Dn;Cr;Np") },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });
});
