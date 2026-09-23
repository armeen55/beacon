import "server-only";
/** Rank appearances, acquire bounded winner/owned reads, then compare under a renewed lease; failures retain retry dates. */
import { log } from "@/lib/logger";
import { PROOF_SPEND } from "@/lib/spend-scope";
import { reportingDay } from "@/lib/reporting-day";
import type { BusinessProfile } from "@/domains/account";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { resolveCitationTargets } from "@/domains/evidence/competitor-intel/polite-fetch";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { PageSnapshot } from "@/domains/evidence/pages/types";
import { renderUnreadOwnedPages } from "@/domains/evidence/pages/rendered-read";
import type { FunnelUnitFn, ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { owedWinnerReads, PRIORITY_WINNERS_PER_QUERY, rankWinningPages } from "./normalize";
import { type FunnelState, type FunnelWinningPage } from "./state";
import { askIdentity, normalizePageIntersection, parsePageIntersection, type PageIntersectionAsk } from "@/domains/evidence/page-intersection";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { mainOf, pageExtractFrom, pageExtractFromRecord, type IntersectionUnavailable, type OwnedPageReadOutcome, type ResearchPageComparison, type ResearchPageExtract, type ResearchWinningAppearance, type WinnerReadOutcome } from "./research-evidence";
import { isCurrent } from "@/domains/evidence/freshness";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, interp, NO_BASIS_DETAIL, resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps } from "./shared";
import type { CanonicalPairObservation } from "./research-evidence";

/** Per cycle: three queries' five-page reserves, one substitute each, and a separate paid-read ceiling. */
const WINNER_READ_BUDGET = 15, MAX_COMPARISONS = 8, MAX_PAGE_ATTEMPTS = 18, MAX_PAID_BODY_READS = 6;
/** CONTENT identity, never the address: the same parsed extract in any key order hashes the SAME, and a changed title, heading, opening or body hashes DIFFERENTLY. Banking sha16(url) on the provider path froze
 *  a page's identity at its address forever, so a rewritten page looked unchanged to a store whose whole point is content-hash-aware reuse. fetchedAt is when I looked, not what the page says, so it is excluded. */
const extractHash = (x: ResearchPageExtract): string => sha16(JSON.stringify(Object.entries(x).filter(([k, v]) => k !== "fetchedAt" && v !== undefined).sort((a, b) => a[0].localeCompare(b[0]))));
/** A WINNER CARRIES A READING when its extract holds the page's own words, or says in type that the read happened and found none (`truncated` is written by every read and by no row banked before reading existed). THE one test, asked where a banked row is reused and where the winners are written, so one of them can never call a page read while the other calls it unread. */ const carriesReading = (x: ResearchPageExtract | null | undefined): boolean => !!x && (x.mainText != null || x.truncated != null);
/** WHAT THE RESEARCH ROW CARRIES OF A READING (Stage 2, 2026-09-14; bounded on review): the cache holds the whole reading up to the crawler's ceiling; the row holds the comparison ceiling of the text and then ONLY the sections whose words lie past that prefix, each cut to the window the comparison opens, the whole row under 16,000 characters a winner, so a deep section reaches the comparison without the row carrying the same words twice. `truncated` is true whenever the row holds less than the page measured, the capture's own cut or the row's. */
const SECTION_CHARS = 1_200, ROW_CHARS = 16_000;
const heldInRow = (x: ResearchPageExtract): ResearchPageExtract => { const held = mainOf(x.mainText, x.totalChars ?? 0), sections: NonNullable<ResearchPageExtract["sections"]> = []; let room = ROW_CHARS - (held.heldChars ?? 0);
  for (const c of x.sections ?? []) { const text = c.text.slice(0, SECTION_CHARS), flat = text.replace(/\s+/g, " ").trim(); if (!flat || (held.mainText ?? "").includes(flat)) continue; if (room < text.length) break; room -= text.length; sections.push({ heading: c.heading, text }); }
  return { ...x, ...held, truncated: x.truncated === true || held.truncated, ...(x.sections ? { sections } : {}) }; };
/** A ROW BANKED UNDER THE OLD 12,000 CEILING HOLDS A PREFIX OF A PAGE IT MEASURED WHOLE, and is re-read once, free crawl first, to replace it; a reading at the crawler's own ceiling is never re-read for length. */
const prefixOnly = (x: ResearchPageExtract | null): boolean => !!x && x.truncated === true && (x.heldChars ?? 0) < (x.totalChars ?? 0) && (x.heldChars ?? 0) < 100_000;
/** The engines and the real prompt texts of ONE page's OWN appearances, derived wherever a winner row is written so a carried row describes the evidence that names it today rather than the evidence that named it when it was read. */ const facetsOf = (as: ResearchWinningAppearance[]) => ({ engines: [...new Set(as.map((a) => a.engine).filter((e): e is string => !!e))].sort(), examplePrompts: [...new Set(as.map((a) => a.promptText).filter((t): t is string => !!t))].slice(0, 5) });


/** SERPs plus dated canonical AI citations. Ranking dedupes modes after redirects resolve. */
function collectAppearances(state: FunnelState, fallbackIso: string, observations: CanonicalPairObservation[]): ResearchWinningAppearance[] {
  const out: ResearchWinningAppearance[] = [];
  for (const s of owedWinnerReads(state.serps.queries, [], null).currentSerps) {
    const at = s.observedAt || state.updatedAt || fallbackIso;
    for (const o of s.organic ?? []) out.push({ kind: "serp_organic", query: s.query, promptId: null, promptText: null, engine: null, rank: o.rank, citedUrl: o.url, observedAt: at, modelServed: null, observationMode: null });
    for (const a of s.aiOverview ?? []) out.push({ kind: "ai_overview", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null, observationMode: null });
    for (const a of s.aiMode ?? []) out.push({ kind: "ai_mode", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null, observationMode: null });
  }
  for (const p of observations) for (const c of p.citations ?? [])
    out.push({ kind: "ai_answer", query: null, promptId: p.promptId, promptText: p.promptText, promptVersion: p.promptVersion, observationId: p.observationId, reportingDay: p.reportingDay, engine: p.engine, rank: null, citedUrl: c.url, observedAt: p.observedAt ?? p.reportingDay, modelServed: p.modelServed, observationMode: p.observationMode });
  return out;
}

/** What the caller wants compared page by page, in plain Evidence terms (Evidence never reads Decision): the topic it belongs to and the page set. */
export type FunnelIntersectionAsk = { topicKey: string; ask: PageIntersectionAsk };
/** Every disposition that produced NO comparison. `failed` is the fallback, so an unmapped one can never read as a finding. */
const COMPARISON_GAP: Partial<Record<string, IntersectionUnavailable>> = { blocked: "blocked", daily_limit: "capped", quarantined: "quarantined", retry_free: "ambiguous", repost_once: "ambiguous" };

/** THE page-by-page comparison: at most ONE request, carrying the WHOLE page set (one call per page or per keyword is a defect). It rides the same money core as every other unit, so the reservation, the
 *  deterministic identity, the reconcile to actual and the cache reuse are the boundary's, not a second copy here. TWO guards stop a second buy: a landed answer for this topic AND this normalized ask is never
 *  re-requested, and a crash after the provider answered but before this phase saved re-derives the SAME identity, so the money core serves it warm. Under two usable pages is not a comparison and never pays. */
async function buyComparison(d: ResolvedDeps, state: FunnelState, want: FunnelIntersectionAsk, ids: { tenantId: string; unitKey: string }, nowIso: string): Promise<ResearchPageComparison | null> {
  const ask = normalizePageIntersection(want.ask), askKey = askIdentity(ask); // ONE definition, shared with the reader
  if (ask.pages.length < 2 || state.pageComparisons.some((c) => c.topicKey === want.topicKey && c.askKey === askKey && c.comparison)) return null;
  const raw = await d.callProvider("labs_page_intersection", ask, ids), r = interp(raw);
  track(state, r);
  const row: ResearchPageComparison = { topicKey: want.topicKey, askKey, pages: ask.pages, excludePages: ask.exclude_pages ?? [], observedAt: nowIso, receipt: r.cacheKey, comparison: null, unavailable: null };
  // Parsed WITH the ask: the envelope carries numbered slots and the money core strips the request echo, so without it the answer knows the ranks but not WHICH page took them. An unreadable answer says so.
  if (r.kind === "evidence") { try { row.comparison = parsePageIntersection(r.payload as ProviderEnvelope, ask); } catch { row.unavailable = "ambiguous"; } }
  else if (r.kind === "waiting") row.unavailable = "waiting";
  else row.unavailable = raw.state === "capped" ? "capped" : COMPARISON_GAP[r.disposition ?? ""] ?? "failed";
  return row;
}

/** How long a failed read holds its URL out of the read budget. A robots denial is the publisher's own answer, so I honor it for a month and never ask a provider to go around it; my one paid read of a body is
 *  held a week; a site that simply did not answer me is retried tomorrow. Without this memory the same dead URL was refetched on every single pass forever, because "403" and "not tried yet" looked alike. */
const RETRY_MS: Record<WinnerReadOutcome["state"], number> = { robots_blocked: 30 * 86_400_000, provider_unavailable: 7 * 86_400_000, temporarily_unavailable: 86_400_000 };
const readOutcomeAt = <S extends WinnerReadOutcome["state"]>(state: S, at: number) => ({ state, attemptedAt: new Date(at).toISOString(), retryAfter: new Date(at + RETRY_MS[state]).toISOString() });
type OwnedRead = { held: OwnedPageReadOutcome[]; pause: string | null; acquired: boolean; attempted?: false };
const OWNED_WRITE_PAUSE = "The page was read, but its contents could not be saved, so it is not counted as read yet. The next visit will read it again.";

/** A named debt settles only against the canonical durable capture, not a fetch or a stage transition. */
async function readOwnedPage(d: ResolvedDeps, tenantId: string, held: OwnedPageReadOutcome[], url: string,
  deadline: number, profile: BusinessProfile | null, bustedAt: string | null, state: FunnelState): Promise<OwnedRead> {
  const now = d.now(), key = canonicalUrlKey(url), kept: OwnedPageReadOutcome[] = [], seen = new Set<string>(), absolute = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const authorizedRetry = PROOF_SPEND.activeFor(tenantId) === true && PROOF_SPEND.externalClosed(tenantId, { capability: "onpage_rendered_html", url: absolute }) === false;
  const due = (t: string): boolean => { const ms = Date.parse(t); return !Number.isFinite(ms) || now >= ms; };
  for (const o of held) { const k = canonicalUrlKey(o.url); if (due(o.retryAfter) || seen.has(k) || (authorizedRetry && k === key && o.state === "temporarily_unavailable")) continue; seen.add(k); kept.push(o); }
  let captureProblem = false, priorWords = 0, unresolvedHash: string | null = null, latestCapture: Record<string, unknown> | null = null;
  const settled = async (): Promise<boolean> => {
    const body = await d.readOwnedBodies(tenantId, [url]).then((m) => m.get(key) ?? null).catch(() => null);
    latestCapture = body?.captureStates?.find((row) => row.id === body.latestCaptureId) ?? null;
    captureProblem ||= body?.version === "stale_known_good" || body?.completeness === "partial";
    if (body && captureProblem) {
      priorWords = Math.max(priorWords, body.vocabulary.trim().split(/\s+/).filter(Boolean).length);
      const latest = body.captureStates?.find((row) => row.id === body.latestCaptureId);
      unresolvedHash = typeof latest?.content_hash === "string" ? latest.content_hash : body.contentHash;
    }
    return body?.version === "current" && body.completeness === "complete" && !!body.contentHash
      && isCurrent("owned_page", body.fetchedAt, d.now(), bustedAt);
  };
  if (await settled()) return { held: kept.filter((o) => canonicalUrlKey(o.url) !== key), pause: null, acquired: true };
  // Retry protection belongs to each URL. Ten unrelated failures cannot deny
  // an eleventh page, and admitting it must not evict an active hold.
  const heldForKey = kept.find((o) => canonicalUrlKey(o.url) === key);
  if (now >= deadline) return { held: kept, pause: null, acquired: false, attempted: false };
  const remember = (state: OwnedPageReadOutcome["state"], retryMs = RETRY_MS[state]): OwnedRead => ({
    held: [{ url, ...readOutcomeAt(state, now), retryAfter: new Date(now + retryMs).toISOString() }, ...kept], pause: null, acquired: false,
  });
  if (heldForKey) {
    const saved = latestCapture as Partial<PageSnapshot> | null, capture = saved?.content_capture;
    if (heldForKey.state === "robots_blocked" || !saved || typeof saved.content_hash !== "string"
      || !Object.hasOwn(saved, "title") || !Object.hasOwn(saved, "h1") || !Object.hasOwn(saved, "meta_description")
      || capture?.version !== 1 || typeof capture.mainHtml !== "string" || !Array.isArray(capture.jsonLd))
      return { held: kept, pause: null, acquired: false, attempted: false };
    let attempted = false;
    try { await renderUnreadOwnedPages(tenantId, 1, { url: absolute, deps: d, profile, deadline, bustedAt,
      rawSnapshot: saved as PageSnapshot, bankedAfter: heldForKey.attemptedAt,
      onRead: (r, raw) => { attempted = raw.state === "hit" || raw.state === "ok" || raw.state === "error" && ["retry_free", "quarantined"].includes(raw.disposition); track(state, r); } }); }
    catch { return { held: kept, pause: null, acquired: false, attempted: false }; }
    if (await settled()) return { held: kept.filter((o) => canonicalUrlKey(o.url) !== key), pause: null, acquired: true };
    return attempted ? remember("temporarily_unavailable", RETRY_MS.provider_unavailable) : { held: kept, pause: null, acquired: false, attempted: false };
  }
  let res;
  try { res = await d.fetchPage(absolute, new Map(), { timeoutMs: Math.max(1, Math.min(10_000, (deadline - d.now()) / 2)) }); }
  catch { return remember("temporarily_unavailable"); }
  if (!res.ok) return remember(res.reason === "robots_blocked" ? "robots_blocked" : "temporarily_unavailable");
  if (res.finalUrl && canonicalUrlKey(res.finalUrl) !== key) return remember("temporarily_unavailable");
  const snapshot = extractPageSnapshot(res.html, absolute, pageIdFor(key), tenantId, res.status, profile ?? undefined, res.finalUrl);
  const latest = latestCapture as Record<string, unknown> | null, source = latest?.content_capture as typeof snapshot.content_capture;
  const unchanged = captureProblem && latest?.content_hash === snapshot.content_hash && latest.title === snapshot.title && latest.h1 === snapshot.h1
    && latest.meta_description === snapshot.meta_description && source?.mainHtml === snapshot.content_capture?.mainHtml
    && JSON.stringify(source?.jsonLd) === JSON.stringify(snapshot.content_capture?.jsonLd);
  // Repeating the same raw shell does not corroborate a known missing rendered body.
  if (captureProblem && snapshot.content_capture && (snapshot.content_hash === unresolvedHash || (priorWords >= 100 && snapshot.word_count * 5 < priorWords * 3))) {
    snapshot.content_capture.complete = false; snapshot.extraction_certainty = "uncertain";
  }
  try { if (!unchanged) await d.writeOwnedPage(snapshot, tenantId); }
  catch { return { ...remember("temporarily_unavailable"), pause: OWNED_WRITE_PAUSE }; }
  if (await settled()) return { held: kept.filter((o) => canonicalUrlKey(o.url) !== key), pause: null, acquired: true };
  if (deadline - d.now() < 50_000) return { held: kept, pause: null, acquired: false, attempted: false };
  let attempted = false;
  try {
    await renderUnreadOwnedPages(tenantId, 1, { url: absolute, deps: d, profile, deadline, bustedAt, rawSnapshot: snapshot, onRead: (r, raw) => {
      attempted = raw.state !== "capped" && raw.state !== "not_configured" && raw.state !== "waiting" && !(raw.state === "error" && ["none", "daily_limit"].includes(raw.disposition));
      track(state, r);
    } });
  } catch { return { ...remember("temporarily_unavailable", RETRY_MS.provider_unavailable), pause: "The rendered page could not be acquired or saved; the capture remains unresolved." }; }
  if (await settled()) return { held: kept.filter((o) => canonicalUrlKey(o.url) !== key), pause: null, acquired: true };
  return attempted ? remember("temporarily_unavailable", RETRY_MS.provider_unavailable) : { held: kept, pause: null, acquired: false, attempted: false };
}

/** Read winners before comparing them under a renewed lease. Short turns persist one public reading and resume. */
export function winningPagesUnit(deps: FunnelDeps = {}, priorityQueries: string[] = [], intersection: FunnelIntersectionAsk | null = null, ownedUrl: string | null = null, ownedBustedAt: string | null = null, competitorUrl: string | null = null, ownedOnly = false): FunnelUnitFn {
  const d = resolveDeps(deps);
  const resolve = deps.resolveCitations ?? resolveCitationTargets; // wrapper citations resolve to their REAL target before ranking, so one page is never two winners
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const shortRead = budgetMs < 40_000, deadline = d.now() + Math.max(1000, budgetMs), ids = { tenantId, unitKey: `winning:${tenantId}` };
    const loaded = await d.loadState(tenantId, basis), state = loaded.state;
    beginCycle(state, cursor, ids.unitKey);
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion }, nowIso = new Date(d.now()).toISOString();
    const pages: FunnelWinningPage[] = []; let attempts = 0; // attempts = pages I actually went out and read this cycle, the bounded total the counter reports
    try {
      if (ownedOnly) {
        if (!ownedUrl) return { status: "failed", cursor: null, progress: {}, detail: "The owned-page acquisition names no page." };
        const account = await d.getAccount(tenantId).catch(() => null);
        if (!account?.domain || rootDomain(ownedUrl) !== rootDomain(account.domain)) return { status: "failed", attempted: false, cursor: null, progress: {}, detail: "The requested page does not belong to this account's website." };
        const profile = await d.loadProfile(tenantId).catch(() => null);
        const owned = await readOwnedPage(d, tenantId, state.ownedReads ?? [], ownedUrl, deadline, profile, ownedBustedAt, state);
        state.ownedReads = owned.held;
        await save(d, tenantId, basis, state, ctx);
        return { status: owned.acquired ? "done" : "failed", cursor: null, ...(owned.attempted === false ? { attempted: false as const } : {}),
          progress: { cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) },
          detail: owned.pause ?? (owned.acquired ? "The requested page has a current complete capture on file." : "The requested page still lacks a current complete capture; its retry remains on file.") };
      }
      // The caller renews the run lease between persisted readings and this comparison stage.
      if ((cursor as { stage?: string } | null)?.stage === "compare") {
        const bought = intersection ? await buyComparison(d, state, intersection, ids, nowIso) : null;
        if (bought) { state.pageComparisons = [bought, ...state.pageComparisons.filter((c) => c.topicKey !== bought.topicKey)].slice(0, MAX_COMPARISONS);
          await save(d, tenantId, basis, state, ctx); }
        return { status: "done", cursor: null, progress: { cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) } };
      }
      const account = await d.getAccount(tenantId).catch(() => null), profile = await d.loadProfile(tenantId).catch(() => null);
      const ownDomain = account?.domain ? rootDomain(account.domain) : null;
      const toDay = reportingDay(d.now()), fromDay = new Date(Date.parse(`${toDay}T12:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
      const observations = await d.loadCanonicalObservations(tenantId, { fromDay, toDay }).catch(() => null);
      if (observations === null) return { status: "failed", cursor, progress: {}, detail: "Stored AI evidence could not be read, so nothing was spent and saved research was preserved." };
      const raw = collectAppearances(state, nowIso, observations);
      const resolved = await Promise.resolve().then(() => resolve(raw, undefined, deadline)).catch(() => raw); // a resolver failure (sync OR async) degrades to raw appearances; the unit deadline bounds it
      const prior = new Map(state.winningPages.map((w) => [canonicalUrlKey(w.url), w])); // the row I already hold for each page: the reading it carries, and what stopped me last time
      /** WHAT THE EVIDENCE ON FILE NAMES RIGHT NOW, under the same top-ten rule the ranking applies and BEFORE any window cuts it: every page this account's own results pages and answers still point at, with the appearances that say so. */ const still = new Map<string, ResearchWinningAppearance[]>();
      for (const a of resolved) { if (a.kind === "serp_organic" && (a.rank == null || a.rank > 20)) continue; /* the twenty rows a look buys, the same cutoff the ranking applies */ const k = canonicalUrlKey(a.citedUrl); if (k) still.set(k, [...(still.get(k) ?? []), a]); }
      /** HOW MANY READINGS THE RESEARCH ROW CARRIES ACROSS RANKINGS: the results pages on file times the reserve each of them gets, because that is the arithmetic ceiling of what this pass itself ever reserves to read, so inside it a reading is dropped for the evidence and never for room. Never below the window the rule before this one kept. */ const readingsBound = Math.min(WINNER_READ_BUDGET * 4, Math.max(WINNER_READ_BUDGET * 2, state.serps.queries.filter((q) => q.status === "done").length * PRIORITY_WINNERS_PER_QUERY)); // AND NEVER MORE THAN FOUR WINDOWS OF READINGS ON THE ROW (integrator, 2026-09-06): the done searches times the reserve allowed 306 on the acceptance account, and every reading is up to 12,000 characters the due-work projection carries on every drive
      const robots: Parameters<ResolvedDeps["fetchPage"]>[1] = new Map(), readPublishers = new Set<string>(); // ONE robots.txt read per origin
      const bank = async (url: string, x: ResearchPageExtract) => { await d.writePageExtract(url, x as unknown as Record<string, unknown>, extractHash(x)).catch(() => {}); };
      // A SEARCH THIS ACCOUNT PAID FOR WHOSE PAGES NOTHING HAS EVER RANKED TAKES ITS OWN RESERVE, newest search first and at most three a pass, off THE one selection rule in funnel/normalize. The global order is by ACCUMULATED appearances, so the ten pages of a results page bought this morning carry one each and lose every slot to pages that have been winning for weeks (proved on this file's own starvation pin): the search is paid for, nothing off it is ever read, and the row that owed that reading asks for the same results page again tomorrow. runtime/ops/due-work counts the pages of exactly these searches to make the read due, so a pass opened for that reason discharges what opened it and the receipt can never promise a search this pass will not take. The ORDER is that rule's too: appended behind the focused cases, an owed search fell off the far side of the reserve's own ceiling the moment this account carried forty of them, and the receipt named three pages nobody would open.
      const priority = owedWinnerReads(state.serps.queries, state.winningPages.map((w) => w.url), ownDomain, priorityQueries).queries;
      const requested = competitorUrl ? rankWinningPages(resolved.filter((a) => [a.citedUrl, a.viaUrl].some((u) => !!u && canonicalUrlKey(u) === canonicalUrlKey(competitorUrl)) && priorityQueries.some((q) => canonicalQueryKey(q) === canonicalQueryKey(a.query ?? a.promptText ?? ""))), ownDomain, 1)[0] : null;
      if (competitorUrl && !requested) return { status: "failed", cursor, progress: {}, detail: "The requested competitor page is not backed by this query's stored search or citation evidence; nothing was fetched." };
      // EVERY RANKED CANDIDATE IS RANKED, and the cache is consulted for all of them (Stage 2, 2026-09-14): only the first WINNER_READ_BUDGET of the queue may be fetched, but a page past that slot whose extract sits in the cache is a winner with its reading, not a page the projection drops.
      const normal = rankWinningPages(resolved, ownDomain, readingsBound, priority), same = (c: typeof normal[number]) => !!requested && canonicalUrlKey(c.url) === canonicalUrlKey(requested.url);
      const ranked = requested ? [{ ...requested, ownerQuery: canonicalQueryKey(requested.appearances[0]?.query ?? requested.appearances[0]?.promptText ?? "") }, ...normal.filter((c) => !same(c))] : normal, bench = new Map<string, typeof ranked>(), substituted = new Set<string>();
      for (const c of ranked) if (c.standby && c.ownerQuery) bench.set(c.ownerQuery, [...(bench.get(c.ownerQuery) ?? []), c]);
      // Interleave focused cases before substitutes and global fill; all share the same attempt/spend ceilings.
      const focus = ranked.filter((c) => !c.standby && c.ownerQuery), queue = [...focus, ...ranked.filter((c) => !c.standby && !c.ownerQuery)]; let focusEnd = focus.length, paidReads = 0, processed = queue.length;
      for (let i = 0; i < queue.length; i += 1) { const c = queue[i]!, fetchable = i < WINNER_READ_BUDGET + substituted.size; // the fetch window is the read budget plus every substitute admitted into it
        // A short turn reads at most one public page, leaving time to save and no paid fallback; the candidates it never reached keep the rows they had.
        if (shortRead && (attempts > 0 || deadline - d.now() < 25_000)) { processed = i; break; }
        const was = prior.get(canonicalUrlKey(c.url)) ?? null;
        let extract: ResearchPageExtract | null = null, outcome: WinnerReadOutcome | null = was?.readOutcome ?? null;
        // Reuse a cached public extract before any read; never re-read in freshness. Keep the CACHE ROW'S date when the extract predates the field: an undated winner never counts toward a comparison.
        const cached = await d.readPageExtract(c.url).catch(() => null);
        const rec = cached ? pageExtractFromRecord(cached.extract) : null, legacy = rec && cached ? { ...rec, fetchedAt: rec.fetchedAt ?? cached.fetchedAt ?? null } : null;
        // Legacy metadata alone is not a reading. An explicitly completed empty reading is reusable, not useful copy evidence.
        if (carriesReading(legacy) && !(fetchable && prefixOnly(legacy))) { extract = legacy; outcome = null; }
        // A URL whose last read failed keeps that answer until retryAfter and spends no attempt before it.
        else if (fetchable && attempts < MAX_PAGE_ATTEMPTS && d.now() <= deadline && !(outcome && d.now() < Date.parse(outcome.retryAfter))) {
          attempts += 1;
          try {
            const res = await d.fetchPage(c.url, robots, shortRead ? { timeoutMs: 10_000 } : {});
            if (res.ok) { outcome = null;
              extract = pageExtractFrom(extractPageSnapshot(res.html, c.url, `winpage-${sha16(c.url)}`, tenantId, res.status, profile));
              await bank(c.url, extract);
            // The publisher's OWN answer is final: a robots denial is NEVER sent through a provider.
            } else if (res.reason === "robots_blocked") outcome = readOutcomeAt("robots_blocked", d.now());
            // An ordinary refusal or timeout earns exactly ONE paid read of the body, US/English, on the same money core, cache identity and cap as every other call, and only while this cycle's own paid ceiling is unspent.
            else if (shortRead || paidReads >= MAX_PAID_BODY_READS) outcome = readOutcomeAt("temporarily_unavailable", d.now());
            else {
              paidReads += 1;
              const r = interp(await d.callProvider("onpage_content_parsing", { url: c.url }, ids)); track(state, r);
              const got = r.kind === "evidence" ? (d.parse("onpage_content_parsing", r.payload as never) as ResearchPageExtract | null) : null;
              // Preserve provider freshness and the WHOLE parsed reading in the cache (the row re-holds it below); an empty parse remains evidence debt.
              if (got && got.wordCount > 0) { extract = { ...got, mainText: got.mainText ?? null, truncated: got.truncated ?? false, fetchedAt: got.fetchedAt ?? nowIso }; outcome = null; await bank(c.url, extract); }
              // A CAP OR A DAILY LIMIT IS NOT THE PAGE'S FAULT. Those cost nothing and read nothing, so stamping the 7 day hold on them froze pages the provider never even looked at, and one cap event stamped every remaining winner. They wait a day.
              else outcome = readOutcomeAt(r.kind === "evidence" ? "provider_unavailable" : "temporarily_unavailable", d.now());
            }
          } catch { outcome = readOutcomeAt("temporarily_unavailable", d.now()); }
        }
        // Failed re-reads preserve banked words alongside their failure hold.
        if (!extract) extract = [legacy, was?.extract ?? null].find(carriesReading) ?? legacy;
        // An unreadable ranked page earns one same-query substitute, never unrelated acquisition. A candidate past the fetch slots with nothing on file was never read and is no row.
        if (extract) readPublishers.add(publisherHost(c.url));
        else if (!fetchable) continue;
        else if (c.ownerQuery && !substituted.has(c.ownerQuery)) { const sub = (bench.get(c.ownerQuery) ?? []).find((b) => !readPublishers.has(publisherHost(b.url)));
          if (sub) { substituted.add(c.ownerQuery); queue.splice(focusEnd, 0, sub); focusEnd += 1; } }
        pages.push({ url: c.url, domain: c.domain, ...facetsOf(c.appearances), appearances: c.appearances, extract: extract && heldInRow(extract), readOutcome: outcome });
      }
      for (const c of queue.slice(processed)) { const was = prior.get(canonicalUrlKey(c.url)); if (was) pages.push({ ...was, ...facetsOf(c.appearances), appearances: c.appearances, extract: was.extract && heldInRow(was.extract) }); }
      // Preserve live readings outside the ranked window and unexpired failure holds.
      const banked = new Set(pages.map((p) => canonicalUrlKey(p.url))), rest = state.winningPages.filter((w) => !banked.has(canonicalUrlKey(w.url)));
      const agenda = new Set([...state.serps.queries.map((q) => q.query), ...priorityQueries].map((q) => canonicalQueryKey(q)).filter(Boolean)); // A SEARCH BEING RE-BOUGHT IS STILL ON THE AGENDA: its results row carries no organic rows while it is pending, so a winner with a fresh reading for it keeps its row rather than vanishing until the look lands again.
      const kept = rest.flatMap((w) => { const live = still.get(canonicalUrlKey(w.url)); if (live && carriesReading(w.extract)) return [{ ...w, ...facetsOf(live), appearances: live }];
        return carriesReading(w.extract) && isCurrent("winner_extract", w.extract?.fetchedAt, d.now()) && (w.appearances ?? []).some((a) => agenda.has(canonicalQueryKey(a.query ?? a.promptText ?? ""))) ? [w] : []; })
        .sort((a, b) => (b.extract?.fetchedAt ?? "").localeCompare(a.extract?.fetchedAt ?? "")).slice(0, readingsBound), keptKeys = new Set(kept.map((w) => canonicalUrlKey(w.url)));
      state.winningPages = [...pages, ...kept, ...rest.filter((w) => !keptKeys.has(canonicalUrlKey(w.url)) && w.readOutcome
        && d.now() < Date.parse(w.readOutcome.retryAfter)).map((w) => ({ ...w, extract: null, appearances: [] })).slice(0, WINNER_READ_BUDGET * 2)];
      const owned = ownedUrl && !shortRead ? await readOwnedPage(d, tenantId, state.ownedReads ?? [], ownedUrl, deadline, profile, ownedBustedAt, state) : null;
      if (owned) state.ownedReads = owned.held;
      // Optimistic funnel persistence is separate from the caller's renewed ResearchRun lease.
      await save(d, tenantId, basis, state, ctx);
      log.info("[research-funnel] page read budget", { tenantId, attempts, paidReads, ceilings: [MAX_PAGE_ATTEMPTS, MAX_PAID_BODY_READS] }); // internal progress truth: both ceilings, never silent
      const counters = { pageReadsAttempted: attempts, cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) };
      if (owned?.pause) return { status: "failed", cursor: null, progress: counters, detail: owned.pause };
      return { status: "advanced", cursor: { stage: shortRead && attempts > 0 ? "read" : "compare" }, progress: counters };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor, progress: { pageReadsAttempted: attempts }, detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
