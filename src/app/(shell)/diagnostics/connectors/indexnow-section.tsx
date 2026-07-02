/**
 * IndexNow lane section (BEACON_500 item 75, 2026-07-02).
 *
 * One compact section on the operator connectors surface showing:
 *   - key configured, or the one-time plain-English setup steps
 *   - the last 5 IndexNow pings + their result (the honest receipt trail:
 *     "I told Bing X minutes after this went live")
 *   - an optional Bing Webmaster submission-quota line, only when the
 *     operator has also connected a Bing Webmaster API key
 *
 * Server component; the one form on it (save key) posts to a server action
 * and revalidates this page. No client JS required.
 */

import {
  indexNowSetupInstructions,
  indexNowKeyFileReminder,
} from "@/lib/connectors/indexnow/setup-copy";
import { getIndexNowConfig } from "@/lib/connectors/indexnow/config-store";
import { getIndexNowReceipts } from "@/lib/connectors/indexnow/receipts-store";
import { getBingSubmissionQuota } from "@/lib/connectors/indexnow/bing-webmaster";
import { getTenant } from "@/domains/tenants/store";
import { currentTenantId } from "@/lib/tenant-context";
import { saveIndexNowKeyFromForm } from "./indexnow-actions";

function minutesAgo(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMin = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (diffMin < 1) return "under a minute ago";
  if (diffMin === 1) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const hours = Math.round(diffMin / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

export async function IndexNowSection() {
  const now = new Date();
  const [config, receipts, tenantId] = await Promise.all([
    getIndexNowConfig().catch(() => null),
    getIndexNowReceipts().catch(() => []),
    currentTenantId().catch(() => null),
  ]);

  const tenant = tenantId ? await getTenant(tenantId).catch(() => null) : null;
  const defaultHost = config?.host || tenant?.domain || "";

  const quota =
    config?.bingWebmasterApiKey && tenant?.domain
      ? await getBingSubmissionQuota(`https://${tenant.domain}`).catch(() => null)
      : null;

  const recent = receipts.slice(0, 5);

  return (
    <section
      className="rounded-lg border border-border/40 bg-surface-inset/30 p-4"
      data-testid="indexnow-section"
    >
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Tell Bing when a page changes
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        ChatGPT browses using Bing&apos;s index, so a page Bing has not seen
        cannot be cited by ChatGPT no matter how good it is. Once this is set
        up, I ping Bing the moment an approved change goes live, at no cost
        and with no extra clicks from you.
      </p>

      {config == null ? (
        <div data-testid="indexnow-setup" className="space-y-3">
          <p className="text-xs text-foreground">{indexNowSetupInstructions()}</p>
          <form action={saveIndexNowKeyFromForm} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Site (host)
              <input
                type="text"
                name="host"
                defaultValue={defaultHost}
                placeholder="yoursite.com"
                className="rounded border border-border/40 bg-surface px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Key
              <input
                type="text"
                name="key"
                placeholder="the key you generated"
                className="rounded border border-border/40 bg-surface px-2 py-1 text-sm text-foreground"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
            >
              Save key
            </button>
          </form>
        </div>
      ) : (
        <div data-testid="indexnow-configured" className="space-y-2">
          <p className="text-xs text-status-success">
            Key configured for {config.host || defaultHost || "your site"}.
          </p>
          <p className="text-xs text-muted-foreground">
            {indexNowKeyFileReminder(
              config.host || defaultHost || "yoursite.com",
              config.key,
              config.keyLocation,
            )}
          </p>
          {quota != null && (
            <p className="text-xs text-muted-foreground" data-testid="indexnow-quota">
              Bing Webmaster tells me you have {quota.dailyQuota.toLocaleString()} URL
              submissions left today ({quota.monthlyQuota.toLocaleString()} this month).
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Last 5 pings
        </h3>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No pings yet. The first one fires the next time an approved
            change goes live.
          </p>
        ) : (
          <ul className="divide-y divide-border/30" data-testid="indexnow-receipts">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="truncate text-xs text-foreground" title={r.url}>
                  {r.url}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={
                      r.ok
                        ? "text-status-success"
                        : "text-status-warning"
                    }
                  >
                    {r.ok ? "told Bing" : "did not reach Bing"}
                  </span>
                  <span>{minutesAgo(r.pingedAt, now)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
