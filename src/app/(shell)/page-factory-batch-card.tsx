"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FactoryBatchCardData, FactoryBatchCardItem } from "./page-factory-batch-data";
import { approveFactoryBatchItemAction, skipFactoryBatchItemAction, confirmFactoryPagePublishedAction } from "./page-factory-batch-actions";

/**
 * PageFactoryBatchCard (BEACON 500 item 62) - the weekly review card for the
 * entity-attribute page factory's production line. Beacon drafted these pages
 * because I found real demand for them (a cached search-volume number or your
 * own site's demand data); I never publish anything myself. Approve the ones
 * you want, skip the rest, and once you've actually published one, tell me the
 * live URL so I can start measuring it against a comparison set.
 */

const SOURCE_LABEL: Record<FactoryBatchCardItem["demandSource"], string> = {
  cached_keyword: "Real search demand",
  graph_demand: "Your own site data",
};

function OneItem({ item, weekOf }: { item: FactoryBatchCardItem; weekOf: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishUrl, setPublishUrl] = useState("");
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const approve = () => {
    start(async () => {
      const r = await approveFactoryBatchItemAction({ weekOf, slug: item.slug });
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      router.refresh();
    });
  };

  const skip = () => {
    start(async () => {
      const r = await skipFactoryBatchItemAction({ weekOf, slug: item.slug });
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      router.refresh();
    });
  };

  const confirmPublished = () => {
    if (!publishUrl.trim()) {
      setMsg("Enter the live page URL first.");
      return;
    }
    start(async () => {
      const r = await confirmFactoryPagePublishedAction({ weekOf, slug: item.slug, targetUrl: publishUrl.trim() });
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      setMsg(r.recorded ? "I started measuring this page." : "Published. I could not start measuring yet, I will keep trying.");
      router.refresh();
    });
  };

  const copyPage = () => {
    const text = item.fullPage?.markdown ?? item.brief?.openingAnswer ?? "";
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{item.title}</p>
          <p className="mt-0.5 text-[11px] text-gray-500">{item.why}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
              {SOURCE_LABEL[item.demandSource]}
              {item.searchVolume ? `: ${item.searchVolume.toLocaleString()}/mo` : ""}
            </span>
            {item.status !== "pending" ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                {item.status === "approved" ? "Approved" : item.status === "published" ? "Published, measuring" : "Skipped"}
              </span>
            ) : null}
          </div>
        </div>
        {item.status === "pending" ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={pending}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60"
            >
              Skip
            </button>
          </div>
        ) : item.status === "approved" ? (
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setShowPublishForm((v) => !v)}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              I published this
            </button>
          </div>
        ) : null}
      </div>

      {showPublishForm ? (
        <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
          <p className="text-[11px] text-gray-700">
            I did not publish this myself. Once you paste it live in your site, tell me the URL so I can start measuring it against
            similar pages.
          </p>
          <input
            type="text"
            value={publishUrl}
            onChange={(e) => setPublishUrl(e.target.value)}
            placeholder="https://yoursite.com/the-new-page"
            className="mt-2 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px]"
          />
          <button
            type="button"
            onClick={confirmPublished}
            disabled={pending}
            className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Recording…" : "Start measuring"}
          </button>
        </div>
      ) : null}

      {item.brief ? (
        <div className="mt-2.5 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              {open ? "▾" : "▸"} {item.fullPage ? `Full page drafted (${item.fullPage.stats.sectionsDrafted} sections)` : "Page brief drafted"}
            </button>
            <button type="button" onClick={copyPage} className="rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-indigo-500">
              {copied ? "Copied ✓" : "Copy page"}
            </button>
          </div>
          {open ? (
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded bg-white p-2 ring-1 ring-indigo-100">
              <div>
                <p className="text-[11px] font-semibold text-gray-900">{item.brief.proposedTitle}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-gray-700">{item.brief.openingAnswer}</p>
              </div>
              {item.fullPage
                ? item.fullPage.sections.map((s, i) => (
                    <div key={i}>
                      <p className="text-[11px] font-semibold text-gray-900">{s.heading}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-gray-700">{s.body}</p>
                    </div>
                  ))
                : (
                    <ul className="space-y-0.5">
                      {item.brief.outline.map((h, i) => (
                        <li key={i} className="text-[10px] text-gray-500">
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
            </div>
          ) : null}
        </div>
      ) : null}

      {msg ? <p className="mt-1.5 text-[11px] text-gray-600">{msg}</p> : null}
    </div>
  );
}

export function PageFactoryBatchCard({ data }: { data: FactoryBatchCardData }) {
  const pendingCount = data.items.filter((i) => i.status === "pending").length;
  if (data.items.length === 0) return null;

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-indigo-50/40 via-white to-gray-50 p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-gray-900">This week's page factory batch</h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          {data.items.length} demand-validated page{data.items.length === 1 ? "" : "s"} drafted this week, ready for your review.
          {pendingCount > 0 ? ` ${pendingCount} waiting on you.` : " All reviewed."}
          {data.queuedCount > 0 ? ` ${data.queuedCount} more are queued for the next keyword check.` : ""}
        </p>
        <p className="mt-1 text-[11px] text-gray-400">Spent ${data.totalCostUsd.toFixed(3)} drafting this batch.</p>
      </div>
      <div className="mt-4 space-y-3">
        {data.items.map((item) => (
          <OneItem key={item.slug} item={item} weekOf={data.weekOf} />
        ))}
      </div>
    </section>
  );
}
