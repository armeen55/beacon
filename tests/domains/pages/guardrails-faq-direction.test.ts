import { describe, expect, it } from "vitest";

import { classifyGuardrails } from "@/domains/pages/guardrails";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";
import type { PageSnapshot } from "@/domains/pages/types";

const faq = (question: string) => ({
  question,
  answer_excerpt: "Answer",
  source: "html_section" as const,
});

function snap(faqs: PageSnapshot["faqs"]): PageSnapshot {
  return {
    id: "snap",
    page_id: "page",
    url: "https://example.com/page",
    canonical_url: null,
    fetched_at: "2026-07-17T00:00:00.000Z",
    http_status: 200,
    title: "Title",
    meta_description: "Description",
    h1: "H1",
    h2_list: [],
    h3_count: 0,
    faqs,
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 500,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: String(faqs.length),
    headings_hash: "h",
    faq_hash: String(faqs.length),
    schema_hash: "s",
    tenant_id: "tenant-a",
  };
}

describe("FAQ guardrail direction", () => {
  it("emits a regression when fresh extraction loses FAQs", () => {
    const previous = snap([faq("One"), faq("Two"), faq("Three")]);
    const current = snap([faq("One")]);
    const alerts = classifyGuardrails(current, diffSnapshots(current, previous), "tenant-a");
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "faq_lost", severity: "regression", message: "Lost 2 FAQs" }),
    ]));
  });

  it("emits an improvement when fresh extraction adds FAQs", () => {
    const previous = snap([faq("One")]);
    const current = snap([faq("One"), faq("Two"), faq("Three")]);
    const alerts = classifyGuardrails(current, diffSnapshots(current, previous), "tenant-a");
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "faq_added", severity: "improvement", message: "Added 2 FAQs" }),
    ]));
  });
});
