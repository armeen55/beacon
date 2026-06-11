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
  /**
   * P0 wall 7 — the learning proof line. Operator edit rate over the
   * feedback window (0..1), shown when ≥3 drafts shipped; null hides
   * the line. "Your edit rate is dropping" is the dream's evidence
   * that the engine is learning your taste.
   */
  editRate?: number | null;
  /** Shipped-draft count behind editRate (display denominator). */
  editRateShipped?: number;
  /**
   * Night-shift #94 (2026-06-11) — URL paths whose FIRST-EVER AI
   * citation landed in the last 24h. The "launch already cited" /
   * resurrection receipt, celebrated the morning it happens.
   */
  firstCitations?: string[];
  /** #96 v1 — post-push citation regression alarm lines. */
  pushRegressions?: string[];
  /** #127 (2026-06-11) — median hours from queue to approval over the
   *  last 14 days; null hides the line (needs ≥3 stamped accepts). */
  medianApprovalHours?: number | null;
};

/** #127: median (accepted_at − created_at) hours, last 14 days, ≥3 rows. */
export function computeMedianApprovalHours(
  rows: ReadonlyArray<{ created_at: string; accepted_at?: string | null }>,
  now: Date,
): number | null {
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const deltas: number[] = [];
  for (const r of rows) {
    if (typeof r.accepted_at !== "string" || r.accepted_at < cutoff) continue;
    const a = Date.parse(r.accepted_at);
    const c = Date.parse(r.created_at);
    if (!Number.isFinite(a) || !Number.isFinite(c) || a < c) continue;
    deltas.push((a - c) / 3_600_000);
  }
  if (deltas.length < 3) return null;
  deltas.sort((x, y) => x - y);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 1 ? deltas[mid]! : (deltas[mid - 1]! + deltas[mid]!) / 2;
  return Math.round(median * 10) / 10;
}

/**
 * Pure: URLs (own-domain, normalized) whose earliest citation across
 * the FULL observation history falls inside the last 24h. Caps at 5.
 */
export function selectFirstCitations(
  observations: ReadonlyArray<{
    observed_at: string;
    citation_urls?: string[] | null;
    /** #52-lite (2026-06-11): which engine produced the answer. */
    platform?: string | null;
  }>,
  ownDomain: string,
  now: Date,
  max = 5,
): string[] {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d = ownDomain.toLowerCase().replace(/^www\./, "");
  const earliest = new Map<string, { at: string; platform: string | null }>();
  for (const obs of observations) {
    for (const raw of obs.citation_urls ?? []) {
      if (typeof raw !== "string") continue;
      const norm = raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").split(/[?#]/)[0]!;
      const host = norm.split("/")[0] ?? "";
      if (host !== d && !host.endsWith(`.${d}`)) continue;
      const cur = earliest.get(norm);
      if (!cur || obs.observed_at < cur.at) {
        earliest.set(norm, { at: obs.observed_at, platform: obs.platform ?? null });
      }
    }
  }
  const fresh: Array<{ path: string; at: string; platform: string | null }> = [];
  for (const [norm, info] of earliest) {
    if (info.at >= dayAgo) {
      const path = "/" + norm.split("/").slice(1).join("/");
      fresh.push({ path: path === "/" ? "/ (homepage)" : path, at: info.at, platform: info.platform });
    }
  }
  fresh.sort((a, b) => a.at.localeCompare(b.at));
  return fresh
    .slice(0, max)
    .map((f) => (f.platform ? `${f.path} (via ${f.platform})` : f.path));
}

/**
 * Night-shift #96 v1 (2026-06-11) — post-push regression alarm. For
 * every page PUSHED in the last 7 days, compare own-citation counts in
 * the 7 days AFTER the push vs the 7 days BEFORE. Pre ≥ MIN_PRE and
 * post ≤ half of pre → alarm ("this approved change may have hurt").
 * Pure; conservative by construction (young pushes with thin priors
 * never alarm).
 */
export const REGRESSION_MIN_PRE_CITATIONS = 3;

export function selectPushRegressionAlarms(
  observations: ReadonlyArray<{ observed_at: string; citation_urls?: string[] | null }>,
  pushedRows: ReadonlyArray<{ target_url: string; updated_at?: string | null; implementation_status?: string | null; live_at?: string | null }>,
  now: Date,
): string[] {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const norm = (raw: string) =>
    raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").split(/[?#]/)[0]!;

  const recentPushes = pushedRows.filter((r) => {
    if ((r.implementation_status ?? "") !== "pushed") return false;
    const at = r.live_at ?? r.updated_at ?? "";
    if (at === "") return false;
    const t = Date.parse(at);
    return Number.isFinite(t) && now.getTime() - t <= weekMs && now.getTime() - t >= 0;
  });
  if (recentPushes.length === 0) return [];

  const alarms: string[] = [];
  for (const push of recentPushes) {
    const pushedAt = Date.parse(push.live_at ?? push.updated_at ?? "");
    const target = norm(push.target_url);
    let pre = 0;
    let post = 0;
    for (const obs of observations) {
      const t = Date.parse(obs.observed_at);
      if (!Number.isFinite(t)) continue;
      const cites = (obs.citation_urls ?? []).some(
        (u) => typeof u === "string" && norm(u) === target,
      );
      if (!cites) continue;
      if (t < pushedAt && pushedAt - t <= weekMs) pre++;
      else if (t >= pushedAt && t - pushedAt <= weekMs) post++;
    }
    if (pre >= REGRESSION_MIN_PRE_CITATIONS && post <= pre / 2) {
      let path: string;
      try {
        path = new URL(push.target_url).pathname || "/";
      } catch {
        path = push.target_url;
      }
      alarms.push(`${path} — ${pre} citations the week before the push, ${post} since. Consider the Revert button on the Wix console.`);
    }
  }
  return alarms.slice(0, 3);
}

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
  opts: {
    appBaseUrl: string;
    dateLabel: string;
    /**
     * P0 wall 5 — one cross-business page-shape insight line
     * ("pages with a Q&A section get cited 2.1× more"), already
     * formatted; null hides the strip. Gated upstream by
     * BEACON_CROSS_TENANT_BRAIN.
     */
    networkInsight?: string | null;
  },
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

    // #118 (2026-06-11): the section heading deep-links into the RIGHT
    // business via the tenant-switch route (fail-closed membership check
    // server-side; the cookie the middleware honors).
    const sectionUrl = `${opts.appBaseUrl.replace(/\/+$/, "")}/api/tenant-switch?tenant=${encodeURIComponent(s.tenantId)}&next=${encodeURIComponent("/recommendations")}`;
    textParts.push(`\n## ${s.businessName} — ${s.pendingTotal} waiting${happenedLine}\n${sectionUrl}`);
    htmlParts.push(
      `<h3 style="margin:20px 0 4px"><a href="${escapeHtml(sectionUrl)}" style="color:inherit;text-decoration:none">${escapeHtml(s.businessName)}</a> — ${s.pendingTotal} waiting<span style="color:#777;font-weight:normal">${escapeHtml(happenedLine)}</span></h3>`,
    );
    if (s.pending.length === 0) {
      textParts.push("Nothing pending.");
      htmlParts.push(`<p style="margin:4px 0;color:#777">Nothing pending.</p>`);
    } else {
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
    // Post-push regression alarms (#96 v1) — loud and first.
    if (s.pushRegressions && s.pushRegressions.length > 0) {
      for (const line of s.pushRegressions) {
        textParts.push(`⚠ Possible regression: ${line}`);
        htmlParts.push(
          `<p style="margin:4px 0 0;color:#b42318;font-size:13px">⚠ Possible regression: ${escapeHtml(line)}</p>`,
        );
      }
    }
    // First-ever citations (#94) — the resurrection/launch receipt.
    if (s.firstCitations && s.firstCitations.length > 0) {
      const line = `First AI citation ever: ${s.firstCitations.join(", ")}`;
      textParts.push(line);
      htmlParts.push(
        `<p style="margin:4px 0 0;color:#0a7a3d;font-size:13px">★ ${escapeHtml(line)}</p>`,
      );
    }
    // The learning proof line (P0 wall 7) — renders with or without a
    // pending queue; it's a receipts line about SHIPPED drafts.
    if (s.medianApprovalHours != null) {
      const line = `Median time from queue to your approval: ${s.medianApprovalHours}h (last 14 days).`;
      textParts.push(line);
      htmlParts.push(`<p style="margin:4px 0 0;color:#777;font-size:13px">${escapeHtml(line)}</p>`);
    }
    if (s.editRate != null && (s.editRateShipped ?? 0) >= 3) {
      const pct = Math.round(s.editRate * 100);
      const line = `You reworded ${pct}% of the last ${s.editRateShipped} drafts before shipping.`;
      textParts.push(line);
      htmlParts.push(`<p style="margin:4px 0 0;color:#777;font-size:13px">${escapeHtml(line)}</p>`);
    }
  }

  if (opts.networkInsight != null && opts.networkInsight.trim() !== "") {
    textParts.push(`\n${opts.networkInsight}`);
    htmlParts.push(
      `<p style="margin:16px 0 0;padding:10px 12px;background:#f4f4f5;border-radius:8px;color:#333">${escapeHtml(opts.networkInsight)}</p>`,
    );
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
