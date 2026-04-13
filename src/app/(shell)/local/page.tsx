import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import {
  formatReviewSourceTimeForDisplay,
  getLocalPresenceSnapshot,
  napStateDisplay,
  napStateExplanation,
  type NapConsistencyState,
} from "@/lib/local-presence";
import { getBusinessConfig } from "@/lib/business-config";

function tierLabel(t: "weak" | "ok" | "strong"): string {
  if (t === "weak") return "Weak";
  if (t === "ok") return "OK";
  return "Strong";
}

function tierColor(t: "weak" | "ok" | "strong"): string {
  if (t === "weak") return "text-status-danger";
  if (t === "ok") return "text-status-warning";
  return "text-status-success";
}

function sentimentLabel(band: "positive" | "mixed" | "concerning"): string {
  if (band === "positive") return "Mostly positive";
  if (band === "mixed") return "Mixed";
  return "Concerning";
}

function napFieldLabel(f: string): string {
  if (f === "name") return "Business name";
  if (f === "domain") return "Domain";
  if (f === "phone") return "Phone";
  if (f === "address") return "Address";
  return f;
}

function napStateColor(s: NapConsistencyState): string {
  if (s === "complete") return "text-status-success";
  if (s === "inconsistent") return "text-status-danger";
  if (s === "incomplete") return "text-status-warning";
  return "text-muted-foreground";
}

function connectorSyncLine(iso: string | null): string {
  return iso ? `Last synced: ${formatReviewSourceTimeForDisplay(iso)}` : "Never synced";
}

function manualImportLine(iso: string | null): string {
  return iso ? `Last imported: ${formatReviewSourceTimeForDisplay(iso)}` : "No imports yet";
}

export default function LocalPresencePage() {
  const snapshot = getLocalPresenceSnapshot();
  const business = getBusinessConfig();

  const stalenessNote =
    snapshot.lastReviewImportAt && snapshot.reviewImportAgeDays != null
      ? snapshot.reviewImportAgeDays > 90
        ? "Review data is significantly outdated — re-import recommended."
        : snapshot.reviewImportAgeDays > 30
          ? "Review data may not reflect your current review profile — consider re-importing."
          : null
      : null;

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Local presence"
        description="How you appear in maps, listings, and reviews"
      />

      <section className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 py-4 space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Listing identity
        </h2>
        <p className="text-[13px] font-semibold text-foreground">
          {snapshot.hasListing ? "Present" : "Not detected"}
          <span className={`ml-2 text-[11px] font-medium ${napStateColor(snapshot.napState)}`}>
            NAP: {napStateDisplay(snapshot.napState)}
          </span>
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="nap-explanation">
          {napStateExplanation(snapshot.napState)}
        </p>
        <div className="text-[12px] text-muted-foreground leading-relaxed space-y-0.5">
          {business.name && (
            <p><span className="text-foreground/80 font-medium">Name:</span> {business.name}</p>
          )}
          {business.domain && (
            <p><span className="text-foreground/80 font-medium">Domain:</span>{" "}
              <span className="font-mono text-foreground/90">{business.domain}</span>
            </p>
          )}
          {business.phone && (
            <p><span className="text-foreground/80 font-medium">Phone:</span> {business.phone}</p>
          )}
          {business.address && (
            <p><span className="text-foreground/80 font-medium">Address:</span> {business.address}</p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Based on configured business identity in{" "}
          <Link href="/settings/config" className="text-accent-primary hover:underline">Settings → Config</Link>.
        </p>
      </section>

      <section className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 py-4 space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Listing health
        </h2>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {snapshot.healthScore}
          </span>
          <span className="text-[12px] text-muted-foreground">/ 100</span>
          <span className={`ml-1 text-[12px] font-semibold ${tierColor(snapshot.healthTier)}`}>
            {tierLabel(snapshot.healthTier)}
          </span>
        </div>

        <div className="space-y-1.5">
          {snapshot.healthBreakdown.components.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[12px]">
              <span className="w-[140px] shrink-0 text-muted-foreground truncate">
                {c.label}
              </span>
              <div className="relative flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    c.earned === c.maxPoints ? "bg-status-success" : c.earned > 0 ? "bg-status-warning" : "bg-border/60"
                  }`}
                  style={{ width: `${(c.earned / c.maxPoints) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right tabular-nums text-muted-foreground">
                {c.earned}/{c.maxPoints}
              </span>
            </div>
          ))}
        </div>

        {snapshot.nap.missing.length > 0 && (
          <p className="text-[11px] text-status-warning font-medium leading-relaxed">
            Missing: {snapshot.nap.missing.map(napFieldLabel).join(", ")}
            {" — "}
            add in{" "}
            <Link href="/settings/config" className="text-accent-primary hover:underline">
              Settings → Config
            </Link>
            .
          </p>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Completeness heuristic based on configured identity + imported reviews —
          not a competitive audit or ranking claim.{" "}
          <Link
            href="/settings/methodology#listing-health"
            className="text-accent-primary hover:underline"
          >
            Methodology →
          </Link>
        </p>
      </section>

      <section
        className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 py-4 space-y-3"
        data-testid="local-data-freshness"
      >
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Data freshness
        </h2>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          When each path last wrote review rows into Beacon. Timestamps are not merged across sources.
        </p>
        <ul className="space-y-2 text-[12px] text-foreground/90 leading-relaxed">
          <li>
            <span className="font-medium text-foreground">Google</span>
            {" — "}
            <span className="text-muted-foreground">{connectorSyncLine(snapshot.lastSync.google)}</span>
          </li>
          <li>
            <span className="font-medium text-foreground">Yelp</span>
            {" — "}
            <span className="text-muted-foreground">{connectorSyncLine(snapshot.lastSync.yelp)}</span>
          </li>
          <li>
            <span className="font-medium text-foreground">Manual import</span>
            {" — "}
            <span className="text-muted-foreground">{manualImportLine(snapshot.lastSync.manual)}</span>
          </li>
        </ul>
        <p className="text-[10px] text-muted-foreground/85 leading-relaxed space-y-0.5">
          <span className="block">Each source updates independently.</span>
          <span className="block">Based only on imported or synced data.</span>
          <span className="block">No automatic syncing unless you trigger it.</span>
        </p>
        <p className="text-[10px] text-muted-foreground/80">
          <Link
            href="/settings/methodology#review-source-timestamps"
            className="text-accent-primary font-medium hover:underline"
          >
            Methodology → per-source timestamps
          </Link>
        </p>
      </section>

      <section className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 py-4 space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Reviews
        </h2>
        {!snapshot.hasReviews ? (
          <>
            <p className="text-[13px] font-semibold text-foreground">No review data yet</p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Import reviews in{" "}
              <Link href="/settings/import" className="text-accent-primary font-medium hover:underline">
                Settings → Import
              </Link>{" "}
              (entity: Local reviews), or pull on demand via optional{" "}
              <Link href="/settings/connectors" className="text-accent-primary font-medium hover:underline">
                Settings → Connectors
              </Link>{" "}
              (Google / Yelp), to see counts and average rating. Beacon does not estimate ratings or
              review counts from other signals.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-semibold text-foreground">
              {snapshot.reviewCount} stored review{snapshot.reviewCount !== 1 ? "s" : ""}
              {snapshot.avgRating != null && (
                <>
                  {" "}
                  · {snapshot.avgRating.toFixed(1)} average (1–5)
                </>
              )}
            </p>
            {snapshot.sentimentBand && snapshot.avgRating != null && (
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Recent review signal: {sentimentLabel(snapshot.sentimentBand).toLowerCase()} — based only
                on average rating across stored review rows (not text analysis).
              </p>
            )}
            {snapshot.lastReviewImportAt && (
              <p className="text-[11px] text-muted-foreground/90 tabular-nums">
                Last import:{" "}
                {new Date(snapshot.lastReviewImportAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}
            {stalenessNote && (
              <p className="text-[11px] text-status-warning font-medium leading-relaxed">{stalenessNote}</p>
            )}
            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
              Counts reflect rows stored in Beacon (manual import and/or connector sync) and may not be
              complete. Sync is on demand only — see Data freshness above.
            </p>
          </>
        )}
      </section>

      <details className="text-[12px] text-muted-foreground leading-relaxed">
        <summary className="cursor-pointer font-medium text-foreground/85 hover:underline select-none">
          How this works
        </summary>
        <ul className="mt-2 ml-4 list-disc space-y-1.5 pl-0.5">
          <li>
            This page is read-only. Beacon does not post replies or edit listings on Google or Yelp.
            Optional connectors pull read-only review snapshots when you run Sync now — there is no
            automatic syncing.
          </li>
          <li>
            Listing presence is inferred only from your saved business domain in Settings → Config — not
            from live maps scraping.
          </li>
          <li>
            {snapshot.hasReviews
              ? "Review rows reach Beacon via Settings → Import (CSV/JSON) and/or optional Settings → Connectors pulls. They reflect what reached Beacon, not necessarily everything shown on the platforms."
              : "Review data is not ingested until you import under Settings → Import or run Sync now on a connector."}
          </li>
          <li>
            Average rating and the simple signal line are derived from imported star ratings only — no NLP
            or sentiment model.
          </li>
          <li>
            Listing health is a weighted completeness score (0–100) from configured NAP fields +
            stored review rows. The tier label (Weak / OK / Strong) is derived from that score — this
            is not a competitive audit, not a ranking claim, and not a verified consistency check.
          </li>
          <li>
            NAP consistency (Complete / Incomplete / Inconsistent / Unknown) reflects configured
            identity and listing names on imported or synced review rows — Beacon does not verify live
            directories beyond what those rows show.
          </li>
        </ul>
        <p className="mt-2">
          <Link
            href="/settings/methodology#nap-consistency"
            className="text-accent-primary font-medium hover:underline"
          >
            Methodology & boundaries →
          </Link>
        </p>
      </details>
    </div>
  );
}
