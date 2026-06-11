/**
 * 2026-06-10 — morning digest composer (P0 wall 6).
 * Pins: row selection (drafted-first ordering, pending statuses only,
 * 24h receipts windows, per-tenant cap), the unified multi-business
 * compose (subject count, sections, +N more, approve link), and
 * HTML escaping.
 */

import { describe, it, expect } from "vitest";

import {
  selectDigestRows,
  composeMorningDigest,
  selectFirstCitations,
  selectPushRegressionAlarms,
  computeMedianApprovalHours,
  DIGEST_MOVES_PER_TENANT,
  type DigestTenantSection,
} from "@/domains/delivery/morning-digest";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const NOW = new Date("2026-06-11T14:00:00Z");

function rec(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: `id-${Math.abs(JSON.stringify(over).split("").reduce((a, c) => a + c.charCodeAt(0), 0))}-${over.created_at ?? ""}-${over.implementation_status ?? ""}`,
    tenant_id: "tenant-x",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: "https://site.com/some-page",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "This page has no title.",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-11T05:30:00Z",
    updated_at: "2026-06-11T05:30:00Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as RecommendedEditRow;
}

describe("selectDigestRows", () => {
  it("keeps only pending statuses, drafted moves first, newest next", () => {
    const sel = selectDigestRows(
      [
        rec({ created_at: "2026-06-11T05:00:00Z" }), // undrafted, newer
        rec({ created_at: "2026-06-10T05:00:00Z", proposed_text: "draft A" }),
        rec({ implementation_status: "dismissed" }),
        rec({ implementation_status: "verified_live", live_at: "2026-06-11T04:00:00Z" }),
      ],
      NOW,
    );
    expect(sel.pendingTotal).toBe(2);
    expect(sel.pending[0]!.proposed_text).toBe("draft A"); // drafted first
    expect(sel.verifiedLastDay).toBe(1);
  });

  it("caps pending at DIGEST_MOVES_PER_TENANT but reports the true total", () => {
    const rows = Array.from({ length: DIGEST_MOVES_PER_TENANT + 4 }, (_, i) =>
      rec({ created_at: `2026-06-0${(i % 9) + 1}T05:00:00Z`, rec_id: `r${i}`, id: `row-${i}` }),
    );
    const sel = selectDigestRows(rows, NOW);
    expect(sel.pending).toHaveLength(DIGEST_MOVES_PER_TENANT);
    expect(sel.pendingTotal).toBe(DIGEST_MOVES_PER_TENANT + 4);
  });

  it("24h windows: older verifications/pushes don't count", () => {
    const sel = selectDigestRows(
      [
        rec({ implementation_status: "verified_live", live_at: "2026-06-09T00:00:00Z" }),
        rec({ implementation_status: "pushed", updated_at: "2026-06-08T00:00:00Z" }),
      ],
      NOW,
    );
    expect(sel.verifiedLastDay).toBe(0);
    expect(sel.pushedLastDay).toBe(0);
  });
});

describe("composeMorningDigest", () => {
  function section(over: Partial<DigestTenantSection> = {}): DigestTenantSection {
    return {
      tenantId: "tenant-iranopedia",
      businessName: "Iranopedia",
      pending: [rec({ display_label: "Add a page title: “Persian Last Names | Iranopedia”" })],
      pendingTotal: 14,
      verifiedLastDay: 2,
      pushedLastDay: 1,
      ...over,
    };
  }

  it("subject carries the cross-business pending total", () => {
    const d = composeMorningDigest(
      [section(), section({ tenantId: "t2", businessName: "Ritz Builders", pendingTotal: 3 })],
      { appBaseUrl: "https://beacon-bice.vercel.app", dateLabel: "2026-06-11" },
    );
    expect(d.subject).toContain("17 moves waiting");
    expect(d.hasContent).toBe(true);
  });

  it("renders per-business sections with receipts + the +N more line + approve link", () => {
    const d = composeMorningDigest([section()], {
      appBaseUrl: "https://beacon-bice.vercel.app/",
      dateLabel: "2026-06-11",
    });
    expect(d.text).toContain("Iranopedia — 14 waiting");
    expect(d.text).toContain("yesterday: 1 shipped, 2 verified live");
    expect(d.text).toContain("…and 13 more in the app.");
    expect(d.text).toContain("https://beacon-bice.vercel.app/recommendations");
    // #118 (2026-06-11): per-business deep link through the switch route.
    expect(d.text).toContain(
      "/api/tenant-switch?tenant=tenant-iranopedia&next=%2Frecommendations",
    );
    expect(d.html).toContain("Review &amp; approve");
  });

  it("escapes HTML in labels", () => {
    const d = composeMorningDigest(
      [section({ pending: [rec({ display_label: 'Change <title> to "X & Y"' })] })],
      { appBaseUrl: "https://x.com", dateLabel: "2026-06-11" },
    );
    expect(d.html).toContain("Change &lt;title&gt; to &quot;X &amp; Y&quot;");
    expect(d.html).not.toContain("<title>");
  });

  it("empty queue everywhere → 'nothing waiting' subject, hasContent false when no receipts", () => {
    const d = composeMorningDigest(
      [section({ pending: [], pendingTotal: 0, verifiedLastDay: 0, pushedLastDay: 0 })],
      { appBaseUrl: "https://x.com", dateLabel: "2026-06-11" },
    );
    expect(d.subject).toContain("nothing waiting");
    expect(d.hasContent).toBe(false);
  });
});

describe("composeMorningDigest — the learning line (P0 wall 7)", () => {
  it("renders the edit-rate line at ≥3 shipped drafts", () => {
    const d = composeMorningDigest(
      [
        {
          tenantId: "t",
          businessName: "Iranopedia",
          pending: [],
          pendingTotal: 0,
          verifiedLastDay: 0,
          pushedLastDay: 0,
          editRate: 0.4,
          editRateShipped: 5,
        },
      ],
      { appBaseUrl: "https://x.com", dateLabel: "2026-06-11" },
    );
    expect(d.text).toContain("You reworded 40% of the last 5 drafts before shipping.");
  });

  it("hides the line under 3 shipped or when null", () => {
    const d = composeMorningDigest(
      [
        {
          tenantId: "t",
          businessName: "Iranopedia",
          pending: [],
          pendingTotal: 0,
          verifiedLastDay: 0,
          pushedLastDay: 0,
          editRate: 1,
          editRateShipped: 2,
        },
      ],
      { appBaseUrl: "https://x.com", dateLabel: "2026-06-11" },
    );
    expect(d.text).not.toContain("reworded");
  });
});

describe("selectFirstCitations (#94) — the first-ever-citation receipt", () => {
  const NOW2 = new Date("2026-06-11T14:00:00Z");
  const obs = (observed_at: string, urls: string[], platform?: string) => ({
    observed_at,
    citation_urls: urls,
    platform: platform ?? null,
  });

  it("reports own-domain URLs whose EARLIEST citation is within 24h, naming the engine", () => {
    const out = selectFirstCitations(
      [
        obs("2026-06-11T07:10:00Z", ["https://www.iranopedia.com/persian-last-names"], "perplexity"),
        obs("2026-06-11T07:10:00Z", ["https://other-site.com/x"]), // foreign — never
      ],
      "iranopedia.com",
      NOW2,
    );
    expect(out).toEqual(["/persian-last-names (via perplexity)"]);
  });

  it("a URL cited long ago is NOT 'first' even when cited again today", () => {
    const out = selectFirstCitations(
      [
        obs("2026-05-01T07:00:00Z", ["https://iranopedia.com/famous-iranians"]),
        obs("2026-06-11T07:10:00Z", ["https://iranopedia.com/famous-iranians"]),
      ],
      "iranopedia.com",
      NOW2,
    );
    expect(out).toEqual([]);
  });

  it("normalizes www/protocol/trailing-slash so variants don't fake a 'first'", () => {
    const out = selectFirstCitations(
      [
        obs("2026-05-01T07:00:00Z", ["https://www.iranopedia.com/cities/"]),
        obs("2026-06-11T07:10:00Z", ["http://iranopedia.com/cities"]),
      ],
      "iranopedia.com",
      NOW2,
    );
    expect(out).toEqual([]);
  });

  it("caps at 5, oldest-first within the day", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      obs(`2026-06-11T0${i}:00:00Z`, [`https://iranopedia.com/p${i}`]),
    );
    const out = selectFirstCitations(rows, "iranopedia.com", NOW2);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("/p0");
  });

  it("composer renders the receipt line", () => {
    const d = composeMorningDigest(
      [
        {
          tenantId: "t",
          businessName: "Iranopedia",
          pending: [],
          pendingTotal: 0,
          verifiedLastDay: 0,
          pushedLastDay: 0,
          firstCitations: ["/persian-last-names"],
        },
      ],
      { appBaseUrl: "https://x.com", dateLabel: "2026-06-11" },
    );
    expect(d.text).toContain("First AI citation ever: /persian-last-names");
  });
});

describe("selectPushRegressionAlarms (#96 v1)", () => {
  const NOW3 = new Date("2026-06-11T14:00:00Z");
  const obs = (observed_at: string, urls: string[]) => ({ observed_at, citation_urls: urls });
  const PUSH_URL = "https://iranopedia.com/famous-iranians";
  const pushed = (live_at: string) => [
    { target_url: PUSH_URL, implementation_status: "pushed", live_at, updated_at: live_at },
  ];

  function citations(beforeCount: number, afterCount: number, pushedAt: string) {
    const t0 = Date.parse(pushedAt);
    const rows: Array<{ observed_at: string; citation_urls: string[] }> = [];
    for (let i = 0; i < beforeCount; i++) {
      rows.push(obs(new Date(t0 - (i + 1) * 12 * 3600 * 1000).toISOString(), [PUSH_URL]));
    }
    for (let i = 0; i < afterCount; i++) {
      rows.push(obs(new Date(t0 + (i + 1) * 12 * 3600 * 1000).toISOString(), [PUSH_URL]));
    }
    return rows;
  }

  it("alarms when citations halve after a push (pre ≥3)", () => {
    const pushedAt = "2026-06-08T07:00:00Z";
    const out = selectPushRegressionAlarms(citations(6, 1, pushedAt), pushed(pushedAt), NOW3);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("/famous-iranians");
    expect(out[0]).toContain("6 citations the week before");
    expect(out[0]).toContain("Revert");
  });

  it("never alarms on thin priors (pre <3) — young pages stay quiet", () => {
    const pushedAt = "2026-06-08T07:00:00Z";
    const out = selectPushRegressionAlarms(citations(2, 0, pushedAt), pushed(pushedAt), NOW3);
    expect(out).toEqual([]);
  });

  it("no alarm when citations hold steady", () => {
    const pushedAt = "2026-06-08T07:00:00Z";
    const out = selectPushRegressionAlarms(citations(6, 5, pushedAt), pushed(pushedAt), NOW3);
    expect(out).toEqual([]);
  });

  it("pushes older than 7 days are out of scope", () => {
    const pushedAt = "2026-05-20T07:00:00Z";
    const out = selectPushRegressionAlarms(citations(6, 0, pushedAt), pushed(pushedAt), NOW3);
    expect(out).toEqual([]);
  });

  it("composer renders the alarm loudly", () => {
    const d = composeMorningDigest(
      [
        {
          tenantId: "t",
          businessName: "Iranopedia",
          pending: [],
          pendingTotal: 0,
          verifiedLastDay: 0,
          pushedLastDay: 0,
          pushRegressions: ["/famous-iranians — 6 citations the week before the push, 1 since. Consider the Revert button on the Wix console."],
        },
      ],
      { appBaseUrl: "https://x.com", dateLabel: "2026-06-11" },
    );
    expect(d.text).toContain("⚠ Possible regression: /famous-iranians");
  });
});

describe("computeMedianApprovalHours (#127)", () => {
  const NOW4 = new Date("2026-06-11T14:00:00Z");
  const row = (created: string, accepted: string | null) => ({
    created_at: created,
    accepted_at: accepted,
  });

  it("median over stamped accepts in the last 14 days (≥3 required)", () => {
    const out = computeMedianApprovalHours(
      [
        row("2026-06-10T00:00:00Z", "2026-06-10T02:00:00Z"), // 2h
        row("2026-06-09T00:00:00Z", "2026-06-09T10:00:00Z"), // 10h
        row("2026-06-08T00:00:00Z", "2026-06-08T04:00:00Z"), // 4h
      ],
      NOW4,
    );
    expect(out).toBe(4);
  });

  it("returns null under 3 stamped accepts (no fake precision)", () => {
    expect(
      computeMedianApprovalHours(
        [row("2026-06-10T00:00:00Z", "2026-06-10T02:00:00Z")],
        NOW4,
      ),
    ).toBeNull();
  });

  it("ignores unstamped rows and accepts older than 14 days", () => {
    const out = computeMedianApprovalHours(
      [
        row("2026-05-01T00:00:00Z", "2026-05-01T01:00:00Z"), // too old
        row("2026-06-10T00:00:00Z", null),
        row("2026-06-10T00:00:00Z", "2026-06-10T02:00:00Z"),
      ],
      NOW4,
    );
    expect(out).toBeNull();
  });
});
