/**
 * teardown-state (2026-06-25) — ONE honest mapping from a packet's competitor
 * object to a clear, truthful "what wins" state + copy. Kills the trust-killing
 * bare "—" / vague "not_audited" on the Rank-&-Revenue cards: every state now
 * says exactly what's true (real teardown / off-topic citation / competitor
 * blocks crawlers / page errored / not analyzed yet / no competitor). Pure.
 */

import type { EvidencePacket } from "./evidence-packet";

export type TeardownState =
  | "torn_down" // real competitor facts extracted
  | "loosely_matched" // AI cited the page but it's off-topic for the query
  | "blocked" // robots/crawler-blocked — will never auto-audit
  | "errored" // fetched but http error / moved / gone
  | "not_audited" // never fetched yet
  | "none"; // no competitor cited at all

export type TeardownView = {
  state: TeardownState;
  /** Short status word for a badge. */
  badge: string;
  /** Plain-English line for the card. */
  text: string;
};

type CompetitorView = EvidencePacket["competitor"];

export function teardownView(competitor: CompetitorView | null | undefined): TeardownView {
  const domain = competitor?.domain ?? null;
  if (!competitor || !domain) {
    return { state: "none", badge: "no competitor", text: "No single strong competitor cited yet — you can own this topic." };
  }
  if (competitor.looselyMatched) {
    return {
      state: "loosely_matched",
      badge: "off-topic citation",
      text: `AI cited ${domain}, but that page is off-topic for this query — confirm the real winner with live search.`,
    };
  }
  if (competitor.facts) {
    return { state: "torn_down", badge: "torn down", text: competitor.whatWins };
  }
  // No facts → why not?
  const status = competitor.fetchStatus ?? "not_audited";
  if (status === "blocked_robots") {
    return { state: "blocked", badge: "blocks crawlers", text: `${domain} blocks crawlers — open it and verify what wins manually.` };
  }
  if (status === "not_audited") {
    return { state: "not_audited", badge: "not analyzed yet", text: `${domain} cited here — not analyzed yet (Refresh teardowns to fetch it).` };
  }
  // http_error / fetch_failed / empty / anything else that was attempted
  return { state: "errored", badge: "page didn't load", text: `${domain}'s page didn't load (moved, gone, or blocked) — verify manually.` };
}
