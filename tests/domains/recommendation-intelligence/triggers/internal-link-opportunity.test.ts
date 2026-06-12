/**
 * Internal-link brain tests (2026-06-12 night shift) —
 * `internal_link_opportunity`: contextual topic-cluster link
 * suggestions from the snapshot link graph. The candidate targets the
 * SOURCE page (where the edit lands); the destination + suggested
 * anchor ride in the evidence.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import {
  internalLinkOpportunity,
  MIN_SHARED_TOPIC_TOKENS,
} from "@/domains/recommendation-intelligence/triggers/internal-link-opportunity";

function snap(over: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-" + (over.url ?? "x"),
    page_id: "page-" + (over.url ?? "x"),
    url: "https://iranopedia.com/a",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 800,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-a",
    extraction_certainty: "confirmed",
    ...over,
  } as PageSnapshot;
}

// Two topically-related pages (share "persian","ceremony","tradition"
// = 3 ≥ MIN_SHARED_TOPIC_TOKENS) + one unrelated page that carries a
// resolvable owned link so the global emptiness guard passes.
function fixtures() {
  const tea = snap({
    url: "https://iranopedia.com/persian-tea-ceremony",
    title: "Persian Tea Ceremony Tradition",
    h1: "Persian Tea Ceremony",
    internal_links: [{ href: "/persian-poets", anchor_text: "poets" }],
  });
  const wedding = snap({
    url: "https://iranopedia.com/persian-wedding",
    title: "Persian Wedding Ceremony Tradition",
    h1: "Sofreh Aghd",
    internal_links: [{ href: "/persian-poets", anchor_text: "poets" }],
  });
  const poets = snap({
    url: "https://iranopedia.com/persian-poets",
    title: "Famous Iranian Poets",
    h1: "Poets of Iran",
    internal_links: [],
  });
  return { tea, wedding, poets };
}

describe("internalLinkOpportunity", () => {
  it("emits for topically-related unlinked pairs, targeting the SOURCE page", () => {
    const { tea, wedding, poets } = fixtures();
    const out = internalLinkOpportunity({
      tenantId: "tenant-a",
      snapshots: [tea, wedding, poets],
    });
    // tea→wedding and wedding→tea both qualify (neither links the other).
    expect(out).toHaveLength(2);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("internal_link_opportunity");
    expect(c.action_type).toBe("add_internal_link");
    expect([tea.url, wedding.url]).toContain(c.target_url);
    expect(c.operator_evidence).toContain("suggested_anchor=");
    expect(c.operator_evidence).toContain("play=contextual_topic_cluster_link");
    expect(c.customer_copy).toContain("never points");
    expect(c.safety_flags).toEqual([]);
  });

  it("suppresses a pair when the source already links to the destination", () => {
    const { tea, wedding, poets } = fixtures();
    tea.internal_links = [
      { href: "/persian-wedding", anchor_text: "wedding ceremony" },
      { href: "/persian-poets", anchor_text: "poets" },
    ];
    const out = internalLinkOpportunity({
      tenantId: "tenant-a",
      snapshots: [tea, wedding, poets],
    });
    // tea→wedding gone; wedding→tea remains.
    expect(out).toHaveLength(1);
    expect(out[0]!.target_url).toBe(wedding.url);
  });

  it("global emptiness guard: no resolvable owned links anywhere → zero emissions", () => {
    const { tea, wedding, poets } = fixtures();
    tea.internal_links = [];
    wedding.internal_links = [];
    poets.internal_links = [];
    expect(
      internalLinkOpportunity({ tenantId: "tenant-a", snapshots: [tea, wedding, poets] }),
    ).toEqual([]);
  });

  it("boilerplate (brand-suffix) tokens never count as topical overlap", () => {
    // Three pages all sharing "iranopedia" + "encyclopedia" in titles —
    // those are boilerplate (in >50% of docs), so no pair qualifies.
    const a = snap({
      url: "https://iranopedia.com/a",
      title: "Tea Iranopedia Persian Encyclopedia",
      internal_links: [{ href: "/b", anchor_text: "b" }],
    });
    const b = snap({
      url: "https://iranopedia.com/b",
      title: "Poets Iranopedia Persian Encyclopedia",
      internal_links: [],
    });
    const c = snap({
      url: "https://iranopedia.com/c",
      title: "Food Iranopedia Persian Encyclopedia",
      internal_links: [],
    });
    // shared meaningful tokens after boilerplate filter < MIN.
    expect(
      internalLinkOpportunity({ tenantId: "tenant-a", snapshots: [a, b, c] }),
    ).toEqual([]);
  });

  it("caps emissions and says so in the evidence (no silent caps)", () => {
    // 4 mutually-related pages → 12 ordered pairs, cap at 2. Filler
    // pages keep the shared topic tokens at exactly 50% document
    // frequency (not >50%) so the boilerplate filter leaves them be.
    const mk = (slug: string) =>
      snap({
        url: "https://iranopedia.com/" + slug,
        title: "Carpet Weaving History Looms " + slug,
        h1: "Carpet Weaving",
        internal_links: slug === "p1" ? [{ href: "/p2", anchor_text: "x" }] : [],
      });
    const filler = (slug: string, topic: string) =>
      snap({
        url: "https://iranopedia.com/" + slug,
        title: topic,
        internal_links: [],
      });
    const pages = [
      mk("p1"), mk("p2"), mk("p3"), mk("p4"),
      filler("f1", "Saffron Harvest Season"),
      filler("f2", "Nowruz Table Customs"),
      filler("f3", "Caspian Coast Travel"),
      filler("f4", "Qanat Water Systems"),
    ];
    const out = internalLinkOpportunity({
      tenantId: "tenant-a",
      snapshots: pages,
      maxEmissions: 2,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.evidence[0]!.detail).toContain("capped at 2");
  });

  it("MIN_SHARED_TOPIC_TOKENS matches the thin-content-overlap convention", () => {
    expect(MIN_SHARED_TOPIC_TOKENS).toBe(3);
  });
});
