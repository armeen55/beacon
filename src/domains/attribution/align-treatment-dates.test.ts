/**
 * align-treatment-dates tests — audit fix #26 (2026-06-12 night shift).
 * Treatment dates must anchor to the linked edit's evidence-backed
 * `live_at`, not the changelog's accept-time stamp; everything without
 * an unambiguous trusted-live link passes through untouched.
 */

import { describe, expect, it } from "vitest";

import type { ChangelogEntry } from "@/domains/changelog/types";
import {
  alignTreatmentDates,
  type LiveEditLike,
} from "./align-treatment-dates";

function entry(over: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: "ch-1", timestamp: "2026-05-15T00:00:00.000Z", signal_type: "content",
    asset_type: "service_page", url: "/services/roofing", asset_name: "Roofing",
    change_description: "Accepted title rewrite for the roofing page.",
    topic_targeted: "roofing", city_targeted: null, hypothesis: null,
    expected_impact_window: null, brief_id: null, opportunity_id: null, notes: null,
    created_at: "2026-05-15T00:00:00.000Z", updated_at: "2026-05-15T00:00:00.000Z",
    ...over,
  } as ChangelogEntry;
}

function edit(over: Partial<LiveEditLike>): LiveEditLike {
  return {
    rec_id: "rec-1",
    target_element_key: "title[0]:abc",
    implementation_status: "verified_live",
    live_at: "2026-05-20T08:00:00.000Z",
    ...over,
  };
}

describe("alignTreatmentDates", () => {
  it("realigns a per-edit entry to its exact edit's live_at", () => {
    const e = entry({
      source_rec_id: "rec-1",
      target_element_key: "title[0]:abc",
    });
    const out = alignTreatmentDates([e], [edit({})]);
    expect(out[0]!.timestamp).toBe("2026-05-20T08:00:00.000Z");
    // Everything else untouched.
    expect(out[0]!.created_at).toBe(e.created_at);
  });

  it("legacy entry without element key takes the EARLIEST trusted live_at of the rec", () => {
    const e = entry({ source_rec_id: "rec-1", target_element_key: undefined });
    const out = alignTreatmentDates(
      [e],
      [
        edit({ target_element_key: "h2[1]:x", live_at: "2026-05-22T00:00:00.000Z" }),
        edit({ target_element_key: "title[0]:abc", live_at: "2026-05-19T00:00:00.000Z" }),
      ],
    );
    expect(out[0]!.timestamp).toBe("2026-05-19T00:00:00.000Z");
  });

  it("passes through when the entry has no source_rec_id", () => {
    const e = entry({});
    const out = alignTreatmentDates([e], [edit({})]);
    expect(out[0]).toBe(e); // same reference — untouched
  });

  it("passes through when the linked edit is not in a trusted-live state", () => {
    const e = entry({ source_rec_id: "rec-1", target_element_key: "title[0]:abc" });
    for (const status of ["recommended", "accepted", "push_failed", "wrong_page", "needs_review"]) {
      const out = alignTreatmentDates([e], [edit({ implementation_status: status })]);
      expect(out[0]!.timestamp).toBe("2026-05-15T00:00:00.000Z");
    }
  });

  it("passes through on missing/unparseable live_at and on element-key mismatch", () => {
    const e = entry({ source_rec_id: "rec-1", target_element_key: "title[0]:abc" });
    expect(alignTreatmentDates([e], [edit({ live_at: null })])[0]!.timestamp)
      .toBe("2026-05-15T00:00:00.000Z");
    expect(alignTreatmentDates([e], [edit({ live_at: "not-a-date" })])[0]!.timestamp)
      .toBe("2026-05-15T00:00:00.000Z");
    expect(
      alignTreatmentDates([e], [edit({ target_element_key: "h2[9]:zz" })])[0]!
        .timestamp,
    ).toBe("2026-05-15T00:00:00.000Z");
  });

  it("trusts `pushed` (Beacon's own push receipt) and verified_live_modified", () => {
    const e = entry({ source_rec_id: "rec-1", target_element_key: "title[0]:abc" });
    for (const status of ["pushed", "verified_live_modified"]) {
      const out = alignTreatmentDates([e], [edit({ implementation_status: status })]);
      expect(out[0]!.timestamp).toBe("2026-05-20T08:00:00.000Z");
    }
  });

  it("is idempotent — realigning aligned entries is a no-op", () => {
    const e = entry({ source_rec_id: "rec-1", target_element_key: "title[0]:abc" });
    const once = alignTreatmentDates([e], [edit({})]);
    const twice = alignTreatmentDates(once, [edit({})]);
    expect(twice[0]).toBe(once[0]); // same reference — no rewrite
  });

  it("no edits at all → identity copy", () => {
    const e = entry({ source_rec_id: "rec-1" });
    expect(alignTreatmentDates([e], [])[0]).toBe(e);
  });
});
