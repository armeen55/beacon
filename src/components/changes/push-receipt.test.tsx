/**
 * Phase 5 — <PushReceipt> render tests (one per verify status).
 *
 * SSR via renderToStaticMarkup. Confirms:
 *   • the status badge renders per verifyStatus (data-push-receipt root)
 *   • the BEFORE→AFTER diff renders, with "(added)" when before is null
 *   • the failed state hides the diff and shows the honest message
 *   • the Revert control appears only when revertable
 *   • white-label, plain-English copy (no jargon / vendor names)
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The component imports the EXISTING revert server action; stub it so the
// render test doesn't pull in the server-only push/Wix chain. The form's
// `action` only needs to be a function reference for SSR.
vi.mock("@/app/(shell)/diagnostics/wix/actions", () => ({
  revertPushFromForm: async () => {},
}));

import { PushReceipt } from "./push-receipt";
import type { PushReceipt as PushReceiptShape } from "@/domains/push/push-receipt";

function receipt(over: Partial<PushReceiptShape> = {}): PushReceiptShape {
  return {
    editId: "rec-1__edit_meta__field:description",
    url: "https://www.iranopedia.com/poets",
    field: "description",
    before: "The old meta description.",
    after: "A richer meta description naming Ferdowsi, Hafez, and Rumi.",
    actionLabel: "Rewrite the poets meta description",
    result: "pushed",
    pushedAt: "2026-06-15T10:00:00.000Z",
    detail: 'updated "description"',
    verifyStatus: "pending",
    evidence: ["The page ranks #8 but few click through."],
    revertable: true,
    ...over,
  };
}

describe("<PushReceipt> — render per verify status", () => {
  it("verified_live: green 'Live on your site' badge + before/after + revert", () => {
    const html = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ verifyStatus: "verified_live" })} />,
    );
    expect(html).toContain('data-push-receipt="verified_live"');
    expect(html).toContain('data-push-receipt-badge="verified_live"');
    expect(html).toContain("Live on your site");
    // before→after diff blocks present.
    expect(html).toContain('data-push-receipt-diff="before"');
    expect(html).toContain('data-push-receipt-diff="after"');
    expect(html).toContain("The old meta description.");
    expect(html).toContain(
      "A richer meta description naming Ferdowsi, Hafez, and Rumi.",
    );
    // revertable → control present.
    expect(html).toContain('data-push-receipt-revert="true"');
    expect(html).toContain("Revert this change");
  });

  it("pending: 'Pushed — confirming live' badge", () => {
    const html = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ verifyStatus: "pending" })} />,
    );
    expect(html).toContain('data-push-receipt="pending"');
    expect(html).toContain("Pushed — confirming live");
  });

  it("unverified: plain 'Pushed' badge", () => {
    const html = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ verifyStatus: "unverified" })} />,
    );
    expect(html).toContain('data-push-receipt="unverified"');
    expect(html).toContain('data-push-receipt-badge="unverified"');
  });

  it("failed: hides the diff, shows the honest 'didn't go live' message, no revert", () => {
    const html = renderToStaticMarkup(
      <PushReceipt
        receipt={receipt({
          verifyStatus: "failed",
          result: "push_failed",
          revertable: false,
          detail: "write failed: 502",
        })}
      />,
    );
    expect(html).toContain('data-push-receipt="failed"');
    expect(html).toContain("Push failed");
    expect(html).toContain('data-push-receipt-failed="true"');
    expect(html).toContain("didn&#x27;t go live");
    expect(html).toContain("write failed: 502");
    // No diff, no revert on a failed push.
    expect(html).not.toContain('data-push-receipt-diff="before"');
    expect(html).not.toContain('data-push-receipt-revert="true"');
  });

  it("before-null renders the '(added)' empty label for the Before block", () => {
    const html = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ before: null })} />,
    );
    expect(html).toContain('data-push-receipt-diff-empty="true"');
    expect(html).toContain("(added)");
  });

  it("hides the revert control when not revertable", () => {
    const html = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ revertable: false })} />,
    );
    expect(html).not.toContain('data-push-receipt-revert="true"');
  });

  it("renders evidence lines when present, omits the section when empty", () => {
    const withEv = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ evidence: ["12 AI answers cite a rival, not you"] })} />,
    );
    expect(withEv).toContain('data-push-receipt-evidence="true"');
    expect(withEv).toContain("12 AI answers cite a rival, not you");

    const noEv = renderToStaticMarkup(
      <PushReceipt receipt={receipt({ evidence: [] })} />,
    );
    expect(noEv).not.toContain('data-push-receipt-evidence="true"');
  });
});
