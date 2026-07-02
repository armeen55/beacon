"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Flame, Search } from "lucide-react";
import type { KeywordLibraryRow, KeywordLibrarySource } from "@/domains/research/keyword-library";
import { normalizeUrl } from "@/lib/url/normalize";

/**
 * Keywords library table (MASTER PLAN v2 UX2 first slice, the operator's own
 * idea). Dense, instant client-side sort + filter + tabs over every keyword
 * Beacon has ever researched, no server round-trip per interaction. The whole
 * merged library ships once from the server component and this file slices it.
 *
 * Label rule (operator hard correction): "searches/mo" = real market volume,
 * "times shown" = GSC impressions. Never render one number under the other's
 * label. No "SERP" anywhere in this UI, it says "Google results".
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

export type SortKey = "volume" | "shown" | "clicks" | "position" | "difficulty" | "keyword";
export type FilterTab = "all" | "ranking" | "close" | "not_owned" | "trending" | "seasonal";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ranking", label: "You rank" },
  { id: "close", label: "Close to page 1" },
  { id: "not_owned", label: "Not owned" },
  { id: "trending", label: "Trending" },
  { id: "seasonal", label: "Seasonal" },
];

const SOURCE_LABEL: Record<KeywordLibrarySource, string> = {
  gsc: "Google Search Console",
  dataforseo_demand: "Market volume",
  dataforseo_difficulty: "Difficulty score",
  keyword_gap: "Competitor gap check",
  serp_history: "Live Google reading",
  trend_radar: "Trend radar",
};

const ROWS_PER_PAGE = 200;

function fmtNum(n: number | null): string {
  if (n == null) return "?";
  return n.toLocaleString();
}

function fmtPosition(n: number | null): string {
  if (n == null) return "?";
  return n < 10 ? n.toFixed(1) : Math.round(n).toString();
}

/** PURE: which tab a row belongs to. Exported for the component-logic test
 *  (this repo has no jsdom/testing-library; interaction logic is pinned as
 *  pure functions + a static-render smoke test, per the existing convention). */
export function inTab(row: KeywordLibraryRow, tab: FilterTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "ranking":
      return row.yourPosition != null && row.yourPosition <= 10;
    case "close":
      return row.yourPosition != null && row.yourPosition > 10 && row.yourPosition <= 20;
    case "not_owned":
      return row.ownerPage == null;
    case "trending":
      return row.trend === "spike";
    case "seasonal":
      return row.trend === "seasonal";
    default:
      return true;
  }
}

/** PURE: text-filter predicate (keyword, owner page, competitor domains, related
 *  questions). Exported for testing. */
export function matchesFilter(row: KeywordLibraryRow, needle: string): boolean {
  if (!needle) return true;
  const hay = [row.keyword, row.ownerPage ?? "", ...row.competitorOwners, ...row.relatedQuestions].join(" ").toLowerCase();
  return hay.includes(needle);
}

/** PURE: sort comparator. Every column flips with `dir` as expected, EXCEPT
 *  that a row with no real value for the active column (unranked position,
 *  unknown volume/difficulty) always sorts to the bottom regardless of
 *  direction. Flipping direction should never surface "unknown" above a
 *  worst-but-real number. Exported for testing. */
export function sortRows(rows: KeywordLibraryRow[], key: SortKey, dir: 1 | -1): KeywordLibraryRow[] {
  const val = (r: KeywordLibraryRow): number | string | null => {
    switch (key) {
      case "volume":
        return r.searchesPerMo;
      case "shown":
        return r.timesShownPerMo;
      case "clicks":
        return r.clicks;
      case "position":
        return r.yourPosition;
      case "difficulty":
        return r.difficulty;
      case "keyword":
        return r.keyword.toLowerCase();
      default:
        return null;
    }
  };
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    // Unknown values always sort last, independent of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return dir * String(av).localeCompare(String(bv));
    }
    return dir * ((av as number) - (bv as number));
  });
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: 1 | -1;
  onClick: (key: SortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`inline-flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-100 ${FOCUS}`}
    >
      {label}
      {active && <span aria-hidden>{dir === 1 ? "↑" : "↓"}</span>}
    </button>
  );
}

export function KeywordsTableClient({ rows, worklistBaseHref }: { rows: KeywordLibraryRow[]; worklistBaseHref: string }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("shown");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Keyboard: "/" focuses the filter input (unless already typing somewhere).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      filterRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tabCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = { all: 0, ranking: 0, close: 0, not_owned: 0, trending: 0, seasonal: 0 };
    for (const r of rows) {
      for (const t of TABS) if (inTab(r, t.id)) counts[t.id] += 1;
    }
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => inTab(r, tab) && matchesFilter(r, needle));
  }, [rows, tab, q]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const visible = sorted.slice(0, visibleCount);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === "keyword" ? 1 : key === "position" ? 1 : -1);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter keywords" className="-mx-1 max-w-full overflow-x-auto px-1">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-neutral-700">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    setVisibleCount(ROWS_PER_PAGE);
                  }}
                  aria-pressed={active}
                  className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${
                    active ? "bg-gray-900 text-white hover:bg-gray-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300" : "text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {t.label} <span aria-hidden className={active ? "text-gray-300" : "text-gray-400 dark:text-neutral-500"}>{tabCounts[t.id]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            ref={filterRef}
            aria-label="Filter keywords"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setVisibleCount(ROWS_PER_PAGE);
            }}
            placeholder="Filter by keyword, page, or competitor (press /)"
            className={`min-h-[32px] w-full rounded-md border border-gray-200 py-1 pl-7 pr-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:placeholder:text-neutral-500 ${FOCUS}`}
          />
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-neutral-400">
        Showing {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} keywords.
      </p>

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          No keywords match that filter. Try clearing the text or picking a different tab.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-neutral-700">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900/60">
              <tr>
                <th className="w-6 px-2 py-2" />
                <th className="px-2 py-2 text-left">
                  <SortHeader label="Keyword" sortKey="keyword" active={sortKey === "keyword"} dir={sortDir} onClick={handleSort} />
                </th>
                <th className="px-2 py-2 text-right">
                  <SortHeader label="Searches/mo" sortKey="volume" active={sortKey === "volume"} dir={sortDir} onClick={handleSort} />
                </th>
                <th className="px-2 py-2 text-right">
                  <SortHeader label="Times shown" sortKey="shown" active={sortKey === "shown"} dir={sortDir} onClick={handleSort} />
                </th>
                <th className="px-2 py-2 text-right">
                  <SortHeader label="Clicks" sortKey="clicks" active={sortKey === "clicks"} dir={sortDir} onClick={handleSort} />
                </th>
                <th className="px-2 py-2 text-right">
                  <SortHeader label="Your position" sortKey="position" active={sortKey === "position"} dir={sortDir} onClick={handleSort} />
                </th>
                <th className="px-2 py-2 text-right">
                  <SortHeader label="Difficulty" sortKey="difficulty" active={sortKey === "difficulty"} dir={sortDir} onClick={handleSort} />
                </th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Owner page</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Trend</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const key = row.keyword;
                const isOpen = expanded === key;
                const hasDetail = row.relatedQuestions.length > 0 || row.competitorOwners.length > 0 || row.sources.length > 0;
                return (
                  <>
                    <tr
                      key={key}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                    >
                      <td className="px-2 py-2 align-top">
                        {hasDetail && (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : key)}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? `Collapse details for ${row.keyword}` : `Expand details for ${row.keyword}`}
                            className={`flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-neutral-700 ${FOCUS}`}
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top font-medium text-gray-900 dark:text-neutral-100">{row.keyword}</td>
                      <td className="px-2 py-2 text-right align-top tabular-nums text-gray-700 dark:text-neutral-300">{fmtNum(row.searchesPerMo)}</td>
                      <td className="px-2 py-2 text-right align-top tabular-nums text-gray-700 dark:text-neutral-300">{fmtNum(row.timesShownPerMo)}</td>
                      <td className="px-2 py-2 text-right align-top tabular-nums text-gray-700 dark:text-neutral-300">{fmtNum(row.clicks)}</td>
                      <td className="px-2 py-2 text-right align-top tabular-nums text-gray-700 dark:text-neutral-300">{fmtPosition(row.yourPosition)}</td>
                      <td className="px-2 py-2 text-right align-top tabular-nums text-gray-700 dark:text-neutral-300">{row.difficulty != null ? row.difficulty : "?"}</td>
                      <td className="px-2 py-2 align-top max-w-[240px] truncate">
                        {row.ownerPageHref ? (
                          <Link href={row.ownerPageHref} prefetch={false} title={row.ownerPage ?? undefined} className="text-sky-700 hover:underline dark:text-sky-400">
                            {normalizeUrl(row.ownerPage) ?? row.ownerPage}
                          </Link>
                        ) : (
                          <span className="text-gray-400 dark:text-neutral-500">Not owned</span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {row.trend === "spike" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                            <Flame className="h-3 w-3" /> Spiking
                          </span>
                        )}
                        {row.trend === "seasonal" && (
                          <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                            Seasonal
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${key}-detail`} className="border-b border-gray-100 bg-gray-50/60 dark:border-neutral-800 dark:bg-neutral-900/40">
                        <td className="px-2 py-3" />
                        <td colSpan={7} className="px-2 py-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Related questions</p>
                              {row.relatedQuestions.length > 0 ? (
                                <ul className="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-neutral-300">
                                  {row.relatedQuestions.slice(0, 6).map((q2) => (
                                    <li key={q2}>{q2}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">No questions found for this keyword yet.</p>
                              )}
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Who else shows up</p>
                              {row.competitorOwners.length > 0 ? (
                                <ul className="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-neutral-300">
                                  {row.competitorOwners.slice(0, 6).map((c) => (
                                    <li key={c}>{c}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">I have not seen a competitor own this in a Google check yet.</p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Where this comes from</p>
                                <p className="mt-1 text-xs text-gray-600 dark:text-neutral-400">{row.sources.map((s) => SOURCE_LABEL[s]).join(", ")}</p>
                                {row.lastChecked && (
                                  <p className="mt-0.5 text-[11px] text-gray-400 dark:text-neutral-500">Last checked {new Date(row.lastChecked).toLocaleDateString()}.</p>
                                )}
                              </div>
                              <Link
                                href={`${worklistBaseHref}?search=${encodeURIComponent(row.keyword)}`}
                                prefetch={false}
                                className={`inline-flex min-h-[30px] items-center rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 ${FOCUS}`}
                              >
                                Plan a change for this keyword
                              </Link>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visibleCount < sorted.length && (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + ROWS_PER_PAGE)}
          className={`inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 ${FOCUS}`}
        >
          Show {Math.min(ROWS_PER_PAGE, sorted.length - visibleCount).toLocaleString()} more
        </button>
      )}
    </div>
  );
}
