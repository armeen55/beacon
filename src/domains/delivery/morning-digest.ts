/**
 * 2026-06-10 — the morning digest (P0 wall 6: nothing reaches you).
 *
 * ONE email, every morning, with every business's queue: per-tenant
 * sections of the top pending moves (exact copy when a draft exists)
 * + a "what happened" line (pushed/verified in the last day) + a
 * one-click link through to approve. The composer is PURE — callers
 * load rows and hand them in; the transport lives in
 * src/lib/email/resend.ts.
 *
 * Scope note: this is the OPERATOR digest, gated on the delivery env
 * (RESEND_API_KEY + BEACON_DIGEST_TO) — an explicit opt-in. The
 * per-tenant `tenants.email_frequency` field governs future
 * per-customer emails and is deliberately NOT consulted here.
 */

import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

export type DigestTenantSection = {
  tenantId: string;
  businessName: string;
  /** Pending moves, already capped + ordered by the caller helper. */
  pending: RecommendedEditRow[];
  /** Count of rows verified live in the last 24h (the receipts line). */
  verifiedLastDay: number;
  /** Count pushed in the last 24h. */
  pushedLastDay: number;
  /** Total pending beyond the cap (for the "+N more" line). */
  pendingTotal: number;
};

export type MorningDigest = {
  subject: string;
  text: string;
  html: string;
  /** True when at least one section has something to say. */
  hasContent: boolean;
};

export const DIGEST_MOVES_PER_TENANT = 5;

/** Select + order a tenant's digest rows from its full queue. */
export function selectDigestRows(
  rows: RecommendedEditRow[],
  now: Date,
): Omit<DigestTenantSection, "tenantId" | "businessName"> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const pendingAll = rows
    .filter(
      (r) =>
        r.implementation_status === "recommended" ||
        r.implementation_status === "accepted",
    )
    .sort((a, b) => {
      // Drafted moves first (approvable on sight), then newest.
      const aDraft = a.proposed_text != null ? 0 : 1;
      const bDraft = b.proposed_text != null ? 0 : 1;
      if (aDraft !== bDraft) return aDraft - bDraft;
      return b.created_at.localeCompare(a.created_at);
    });
  const verifiedLastDay = rows.filter(
    (r) =>
      (r.implementation_status === "verified_live" ||
        r.implementation_status === "verified_live_modified") &&
      (r.live_at ?? "") >= dayAgo,
  ).length;
  const pushedLastDay = rows.filter(
    (r) => r.implementation_status === "pushed" && r.updated_at >= dayAgo,
  ).length;
  return {
    pending: pendingAll.slice(0, DIGEST_MOVES_PER_TENANT),
    pendingTotal: pendingAll.length,
    verifiedLastDay,
    pushedLastDay,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moveLabel(r: RecommendedEditRow): string {
  if (r.display_label != null && r.display_label.trim() !== "") return r.display_label;
  return r.why;
}

function movePath(r: RecommendedEditRow): string {
  try {
    return new URL(r.target_url).pathname || "/";
  } catch {
    return r.target_url;
  }
}

/** Compose the unified digest from per-tenant sections. Pure. */
export function composeMorningDigest(
  sections: DigestTenantSection[],
  opts: { appBaseUrl: string; dateLabel: string },
): MorningDigest {
  const totalPending = sections.reduce((n, s) => n + s.pendingTotal, 0);
  const subject =
    totalPending === 0
      ? `Beacon — nothing waiting today (${opts.dateLabel})`
      : `Beacon — ${totalPending} move${totalPending === 1 ? "" : "s"} waiting for your approval (${opts.dateLabel})`;

  const textParts: string[] = [];
  const htmlParts: string[] = [
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">`,
    `<h2 style="margin:16px 0 4px">Your morning queue</h2>`,
    `<p style="margin:0 0 16px;color:#555">${escapeHtml(opts.dateLabel)} — approve, edit, or skip. Nothing ships without you.</p>`,
  ];

  for (const s of sections) {
    const happened: string[] = [];
    if (s.pushedLastDay > 0) happened.push(`${s.pushedLastDay} shipped`);
    if (s.verifiedLastDay > 0) happened.push(`${s.verifiedLastDay} verified live`);
    const happenedLine = happened.length > 0 ? ` (yesterday: ${happened.join(", ")})` : "";

    textParts.push(`\n## ${s.businessName} — ${s.pendingTotal} waiting${happenedLine}`);
    htmlParts.push(
      `<h3 style="margin:20px 0 4px">${escapeHtml(s.businessName)} — ${s.pendingTotal} waiting<span style="color:#777;font-weight:normal">${escapeHtml(happenedLine)}</span></h3>`,
    );
    if (s.pending.length === 0) {
      textParts.push("Nothing pending.");
      htmlParts.push(`<p style="margin:4px 0;color:#777">Nothing pending.</p>`);
      continue;
    }
    htmlParts.push(`<ol style="margin:4px 0 8px;padding-left:20px">`);
    for (const r of s.pending) {
      const label = moveLabel(r);
      const path = movePath(r);
      textParts.push(`- ${label} → ${path}`);
      htmlParts.push(
        `<li style="margin:6px 0"><strong>${escapeHtml(label)}</strong><br><span style="color:#777">${escapeHtml(path)}</span>${
          r.proposed_text != null && r.display_label == null
            ? `<br><span style="color:#555">${escapeHtml(r.proposed_text.slice(0, 140))}</span>`
            : ""
        }</li>`,
      );
    }
    htmlParts.push(`</ol>`);
    if (s.pendingTotal > s.pending.length) {
      const more = s.pendingTotal - s.pending.length;
      textParts.push(`…and ${more} more in the app.`);
      htmlParts.push(`<p style="margin:0;color:#777">…and ${more} more in the app.</p>`);
    }
  }

  const reviewUrl = `${opts.appBaseUrl.replace(/\/+$/, "")}/recommendations`;
  textParts.push(`\nReview and approve: ${reviewUrl}`);
  htmlParts.push(
    `<p style="margin:24px 0"><a href="${escapeHtml(reviewUrl)}" style="background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; approve</a></p>`,
    `</div>`,
  );

  return {
    subject,
    text: textParts.join("\n").trim(),
    html: htmlParts.join("\n"),
    hasContent: totalPending > 0 || sections.some((s) => s.pushedLastDay + s.verifiedLastDay > 0),
  };
}
