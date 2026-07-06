import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { linkGap } from "./link-gap";
import type { LinkGap } from "@/domains/link-authority/link-gap";

const SIGNAL_AT = "2026-07-06T10:00:00Z";
const SITE_ROOT = "https://iranopedia.com/";

function gap(over: Partial<LinkGap> = {}): LinkGap {
  return {
    keyword: "persian rugs",
    volume: 1900,
    competitorDomain: "supplehomes.com",
    competitorRank: 3,
    competitorUrl: "https://supplehomes.com/persian-rugs",
    ownRank: 24,
    competitorReferringDomains: 210,
    ownReferringDomains: 3,
    referringDomainMultiple: 70,
    score: 7600,
    ...over,
  };
}

describe("linkGap trigger", () => {
  it("emits a pursue_local_pr authority directive anchored on the site root", () => {
    const rows = linkGap({ tenantId: "t", gaps: [gap()], siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("link_gap");
    // Off-site authority action so applyQueueRules routes it to diagnostic_only.
    expect(r.action_type).toBe("pursue_local_pr");
    expect(r.generator_kind).toBe("human_task");
    expect(r.target_url).toBe(SITE_ROOT);
    expect(r.confidence).toBe("medium");
    expect(r.impact_estimate).toBe("high");
    expect(r.created_from_signal_at).toBe(SIGNAL_AT);
  });

  it("customer copy names the query, competitor, multiple, referring-domain counts, and next step", () => {
    const rows = linkGap({ tenantId: "t", gaps: [gap()], siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("persian rugs");
    expect(copy).toContain("supplehomes.com");
    expect(copy).toContain("70x");
    expect(copy).toContain("210 referring domains to your 3");
    expect(copy).toContain("build authority first");
    // No em/en dash, no dollar sign, no lab jargon.
    expect(copy).not.toMatch(/[—–]/);
    expect(copy).not.toContain("$");
    expect(copy.toLowerCase()).not.toContain("serp");
    expect(copy.toLowerCase()).not.toContain("backlink");
  });

  it("renders the exact customer copy in a static HTML row (renderToStaticMarkup)", () => {
    const rows = linkGap({ tenantId: "t", gaps: [gap()], siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT });
    const html = renderToStaticMarkup(
      React.createElement(
        "tr",
        { "data-row-trigger-signal": rows[0]!.trigger_signal, "data-row-action-type": rows[0]!.action_type },
        React.createElement("td", null, rows[0]!.customer_copy),
      ),
    );
    expect(html).toContain('data-row-trigger-signal="link_gap"');
    expect(html).toContain('data-row-action-type="pursue_local_pr"');
    expect(html).toContain(
      "supplehomes.com ranks for &quot;persian rugs&quot; and their page has about 70x the links from other sites that yours does (210 referring domains to your 3).",
    );
  });

  it("BYTE-IDENTICAL EMPTY: no gaps yields [] (a tenant with no warmed backlink cache is a no-op)", () => {
    expect(linkGap({ tenantId: "t", gaps: [], siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("EMPTY when the site root is missing (queue rules require a URL)", () => {
    expect(linkGap({ tenantId: "t", gaps: [gap()], siteRootUrl: null, signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("caps emissions and preserves the loader's ranking order", () => {
    const gaps: LinkGap[] = Array.from({ length: 6 }, (_, i) =>
      gap({ keyword: `query ${i}`, score: 1000 - i }),
    );
    const rows = linkGap({ tenantId: "t", gaps, siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT, maxEmissions: 3 });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.topic_cluster_label)).toEqual(["link_gap:query 0", "link_gap:query 1", "link_gap:query 2"]);
  });

  it("collapses duplicate queries to one card", () => {
    const rows = linkGap({
      tenantId: "t",
      gaps: [gap({ keyword: "persian rugs" }), gap({ keyword: "Persian Rugs" })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
  });

  it("distinct queries get distinct cooldown keys", () => {
    const rows = linkGap({
      tenantId: "t",
      gaps: [gap({ keyword: "a" }), gap({ keyword: "b" })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cooldown_key).not.toBe(rows[1]!.cooldown_key);
    expect(rows[0]!.cooldown_key).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0]!.dedupe_key).toMatch(/^[0-9a-f]{40}$/);
  });

  it("operator evidence carries the raw signal trace", () => {
    const rows = linkGap({ tenantId: "t", gaps: [gap()], siteRootUrl: SITE_ROOT, signalAt: SIGNAL_AT });
    const ev = rows[0]!.operator_evidence;
    expect(ev).toContain("signal=link_gap");
    expect(ev).toContain("query=persian rugs");
    expect(ev).toContain("competitor=supplehomes.com");
    expect(ev).toContain("referring_domains=210 vs your 3");
    expect(ev).toContain("70x");
    expect(ev).toContain("play=build_authority_before_more_content_edits");
  });
});
