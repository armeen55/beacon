import { describe, expect, it } from "vitest";

import { serviceAreaPage } from "./service-area-page";
import type { ServiceAreaGap } from "@/domains/local-seo/service-area-gaps";

const SIGNAL_AT = "2026-07-06T10:00:00Z";
const SITE_ROOT = "https://acme-plumbing.com/";

function gap(over: Partial<ServiceAreaGap> = {}): ServiceAreaGap {
  return {
    slug: "kitchen-remodeling-oakland",
    title: "kitchen remodeling in Oakland",
    city: "Oakland",
    service: "kitchen remodeling",
    competitorPages: 8,
    coverageStatus: "absent",
    relevance: 1,
    needsDemandValidation: true,
    ...over,
  };
}

describe("serviceAreaPage", () => {
  it("emits a create_page Move for a missing city x service page, anchored on the site root", () => {
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps: [gap()],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("service_area_page");
    expect(r.action_type).toBe("create_page");
    expect(r.target_url).toBe(SITE_ROOT);
    expect(r.confidence).toBe("medium");
    expect(r.impact_estimate).toBe("high");
    expect(r.generator_kind).toBe("deterministic");
    expect(r.created_from_signal_at).toBe(SIGNAL_AT);
  });

  it("customer copy names the exact service + city + competitor count with a next step", () => {
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps: [gap({ service: "kitchen remodeling", city: "Oakland", competitorPages: 8 })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("kitchen remodeling");
    expect(copy).toContain("Oakland");
    expect(copy).toContain("8");
    expect(copy).toContain("a market where you should compete");
    expect(copy).toContain("Build one page");
    // No em/en dash, no dollar sign, no lab jargon.
    expect(copy).not.toMatch(/[—–]/);
    expect(copy).not.toContain("$");
    expect(copy.toLowerCase()).not.toContain("serp");
  });

  it("customer copy omits the competitor-proof clause when the coverage matrix saw no rivals (0 pages)", () => {
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps: [gap({ service: "window cleaning", city: "Berkeley", competitorPages: 0, coverageStatus: null })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("window cleaning");
    expect(copy).toContain("Berkeley");
    // No fabricated competitor number and no false claim of seeing rivals.
    expect(copy).not.toContain("competitor page");
    expect(copy).toContain("Build one page");
  });

  it("BYTE-IDENTICAL EMPTY: no gaps yields [] (a tenant with no service areas is a no-op)", () => {
    expect(
      serviceAreaPage({ tenantId: "t", gaps: [], siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("EMPTY when the site root is missing (queue rules require a URL)", () => {
    expect(
      serviceAreaPage({ tenantId: "t", gaps: [gap()], siteRootUrl: null, signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("caps emissions and preserves the loader's ranking order", () => {
    const gaps: ServiceAreaGap[] = Array.from({ length: 8 }, (_, i) =>
      gap({ slug: `svc-${i}`, title: `service ${i} in City ${i}`, city: `City ${i}`, service: `service ${i}` }),
    );
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps,
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
      maxEmissions: 3,
    });
    expect(rows).toHaveLength(3);
    // Order is preserved from the pre-ranked loader input (slug 0,1,2).
    expect(rows.map((r) => r.topic_cluster_label)).toEqual([
      "service 0 in City 0",
      "service 1 in City 1",
      "service 2 in City 2",
    ]);
  });

  it("collapses duplicate slugs to one card", () => {
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps: [gap({ slug: "dup" }), gap({ slug: "DUP" })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
  });

  it("distinct slugs get distinct cooldown keys (so the loader dedupe never collapses two real gaps)", () => {
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps: [
        gap({ slug: "a-oakland", title: "a in Oakland" }),
        gap({ slug: "b-fremont", title: "b in Fremont" }),
      ],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cooldown_key).not.toBe(rows[1]!.cooldown_key);
    expect(rows[0]!.cooldown_key).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0]!.dedupe_key).toMatch(/^[0-9a-f]{40}$/);
  });

  it("operator evidence carries the raw signal trace (service, city, coverage, competitor pages)", () => {
    const rows = serviceAreaPage({
      tenantId: "t",
      gaps: [gap({ service: "kitchen remodeling", city: "Oakland", competitorPages: 8, coverageStatus: "absent" })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    const ev = rows[0]!.operator_evidence;
    expect(ev).toContain("signal=service_area_page");
    expect(ev).toContain("service=kitchen remodeling");
    expect(ev).toContain("city=Oakland");
    expect(ev).toContain("competitor_pages=8");
    expect(ev).toContain("coverage_status=absent");
    expect(ev).toContain("play=own_city_service_page");
  });
});
