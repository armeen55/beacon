/**
 * evidence/competitors/classify - WHAT a recurring domain actually is to this account, decided
 * deterministically from signals the snapshot already holds. PURE: no I/O, no clock, no model.
 *
 * A domain that keeps appearing beside you is not automatically a rival. Google's own results mix
 * shops, encyclopedias, city halls, forums and marketplaces, and telling the operator to "beat"
 * a .gov page or "outrank" a Reddit thread is advice that cannot be taken. So every recurring
 * domain is placed in exactly one of eight groups, and the group carries the sentence that
 * explains it, built from the same numbers the decision was made on.
 *
 * RULE ORDER (first match wins; the order is the argument, not an accident):
 *   1 owned                  - it is your own site. Nothing it does counts against you.
 *   2 government_educational - a .gov/.edu/.mil style address. No ranking makes a city hall a rival.
 *   3 social_community       - a known social platform. A place to be present, never one to outrank.
 *   4 marketplace_directory  - a known marketplace or directory. A listing to be on, not a rival.
 *   Rules 1 to 4 are facts about the DOMAIN, so no amount of ranking can overturn them.
 *   5 commercial_competitor  - it ranks for two or more of the searches you care about. Recurrence
 *                              across your searches is the whole test: one lucky result is not a rival.
 *   6 citation_authority     - engines cite it repeatedly AND it never ranks against you. It is a
 *                              source to be quoted beside, not a business taking your customers.
 *   7 publisher              - a known publisher. It covers your topics rather than selling against you.
 *   8 irrelevant_unknown     - seen, but not often enough to say anything honest about it.
 */

/** The eight groups every recurring domain is placed in. */
export type CompetitorKind =
  | "commercial_competitor"
  | "citation_authority"
  | "publisher"
  | "marketplace_directory"
  | "government_educational"
  | "social_community"
  | "owned"
  | "irrelevant_unknown";

/** What the snapshot already knows about one domain. Counts only; nothing inferred. */
export type DomainSignals = {
  /** Organic rows this domain holds across the exact result pages I looked at. */
  serpAppearances: number;
  /** Times an engine cited this domain in an answer or an AI result block. */
  aiCitations: number;
  /** DISTINCT searches of yours it holds an organic ranking for. Recurrence lives here. */
  competingQueries: number;
  /** True when this domain is the account's own site. */
  isOwned: boolean;
};

export type ClassifiedDomain = {
  domain: string;
  kind: CompetitorKind;
  /** Why I put it in that group, in the same numbers the rule used. */
  why: string;
  evidence: { serpAppearances: number; aiCitations: number; competingQueries: number };
};

/** Recurrence: this many of your searches before a domain is called a rival, or this many
 *  citations before a domain is called a source. One appearance proves nothing either way. */
const RECURS = 2;

/** Bounded well-known-host set. Deliberately small and platform-level: it names the places no
 *  operator can "beat", never a guess about somebody's business. Matched on the host or any
 *  subdomain of it. */
const SOCIAL = "facebook.com instagram.com x.com twitter.com linkedin.com reddit.com youtube.com tiktok.com pinterest.com quora.com threads.net discord.com";
const MARKETPLACE = "amazon.com ebay.com etsy.com walmart.com yelp.com tripadvisor.com booking.com expedia.com airbnb.com alibaba.com aliexpress.com g2.com capterra.com trustpilot.com angi.com thumbtack.com houzz.com indeed.com glassdoor.com";
const PUBLISHER = "wikipedia.org medium.com substack.com nytimes.com bbc.com cnn.com theguardian.com forbes.com bloomberg.com reuters.com wsj.com washingtonpost.com businessinsider.com techcrunch.com wired.com";

const setOf = (s: string): Set<string> => new Set(s.split(" "));
const SOCIAL_HOSTS = setOf(SOCIAL);
const MARKETPLACE_HOSTS = setOf(MARKETPLACE);
const PUBLISHER_HOSTS = setOf(PUBLISHER);

const inSet = (domain: string, hosts: Set<string>): boolean =>
  hosts.has(domain) || [...hosts].some((h) => domain.endsWith(`.${h}`));

/** Public-sector and school addresses, in both the flat US form and the country-suffixed form. */
const PUBLIC_TLD = /\.(gov|edu|mil)$|\.(gov|edu|ac|mil)\.[a-z]{2}$/;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Place ONE domain in ONE group and say why. Pure and total: every domain gets an answer, and
 * "I do not know yet" is one of the eight answers rather than a silent drop.
 */
export function classifyDomain(domain: string, signals: DomainSignals): ClassifiedDomain {
  const d = domain.trim().replace(/^www\./, "").toLowerCase();
  const { serpAppearances: serps, aiCitations: cites, competingQueries: queries } = signals;
  const evidence = { serpAppearances: serps, aiCitations: cites, competingQueries: queries };
  const row = (kind: CompetitorKind, why: string): ClassifiedDomain => ({ domain: d, kind, why, evidence });

  if (signals.isOwned) return row("owned", `I saw this ${serps + cites} ${plural(serps + cites, "time", "times")} in your own evidence, and it is your own site, so I never count it against you.`);
  if (PUBLIC_TLD.test(d)) {
    return row("government_educational", `A government or school publishes this, and I saw it ${serps} ${plural(serps, "time", "times")} in your results. You cannot take customers from it, so treat it as a source to cite rather than a rival.`);
  }
  if (inSet(d, SOCIAL_HOSTS)) {
    return row("social_community", `This is a social platform, and it showed up ${serps} ${plural(serps, "time", "times")} in your results. It is a place to be present on, not a site to outrank.`);
  }
  if (inSet(d, MARKETPLACE_HOSTS)) {
    return row("marketplace_directory", `This is a marketplace or directory, and it showed up ${serps} ${plural(serps, "time", "times")} in your results. Get listed on it rather than trying to beat it.`);
  }
  if (queries >= RECURS) {
    return row("commercial_competitor", `This domain keeps winning the searches you care about: it ranks for ${queries} of them. Read what it does on those pages and answer it better.`);
  }
  if (cites >= RECURS && queries === 0) {
    return row("citation_authority", `Engines cite it ${cites} times as a source and it never ranks against you. Aim to be quoted beside it, not to outrank it.`);
  }
  if (inSet(d, PUBLISHER_HOSTS)) {
    return row("publisher", `This is a publisher covering your topics, seen ${serps + cites} ${plural(serps + cites, "time", "times")}. Getting mentioned there is worth more than competing with it.`);
  }
  return row("irrelevant_unknown", `I have only seen this domain ${serps + cites} ${plural(serps + cites, "time", "times")}, which is not enough to say what it is to you. I will keep watching it.`);
}
