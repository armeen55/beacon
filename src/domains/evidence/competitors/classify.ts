/**
 * evidence/competitors/classify - WHAT a recurring domain actually is to this account, decided from signals the snapshot already holds plus, for the one
 * group that needs it, a verdict somebody else inspected. PURE: no I/O, no clock, no model.
 *
 * A domain that keeps appearing beside you is not automatically a rival. Google's own results mix shops, encyclopedias, city halls, forums and marketplaces,
 * and telling the operator to "beat" a .gov page or "outrank" a Reddit thread is advice that cannot be taken. So every recurring domain is placed in exactly
 * one of eight groups, and the group carries the sentence that explains it, built from the same numbers the decision was made on.
 *
 * RULE ORDER (first match wins; the order is the argument, not an accident):
 *   1 owned                  - it is your own site. Nothing it does counts against you.
 *   2 government_educational - a .gov/.edu/.mil style address. No ranking makes a city hall a rival.
 *   3 social_community       - a known social platform. A place to be present, never one to outrank.
 *   4 marketplace_directory  - a known marketplace or directory. A listing to be on, not a rival.
 *   5 publisher / citation_authority for the KNOWN encyclopedias and publications. Rules 1 to 5 are facts about the DOMAIN, so no amount of ranking can
 *     overturn them: Wikipedia and Britannica rank for everything, and calling them a competitor because of it told an operator to go and beat an
 *     encyclopedia. Which of the two they land in is decided by what they DO here: cited and not ranking is a source, ranking beside you is a publication
 *     covering your topics.
 *   6 ROLE EVIDENCE decides everything else, never recurrence on its own. A domain the engines keep QUOTING is a source. A domain that keeps RANKING against
 *     you is only NOMINATED: ranking proves it is worth understanding, never that it sells a comparable product or service to the same customers, which is
 *     the whole of what makes somebody a competitor. Two of your searches used to be the entire proof, so any stranger who ranked twice was handed to the
 *     operator as somebody to go and beat.
 *   7 commercial_competitor therefore needs `overlap`: the verdict of an INSPECTION of that domain's own pages, settled and durably cached by landscape.ts
 *     off page evidence the research run already read. Nothing in this file ever calls a model or touches a store.
 *   8 UNRESOLVED. A nominated domain nobody has inspected yet comes back as what the evidence really supports (a source when it is quoted, otherwise
 *     irrelevant_unknown) AND `ambiguous`, which is the caller's cue to settle it. Saying "I have not worked it out" is cheaper than a wrong rival.
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

/** What is already known about one domain. Counts, nothing inferred, plus the one verdict counts cannot supply. */
export type DomainSignals = {
  /** Organic rows this domain holds across the exact result pages I looked at. */
  serpAppearances: number;
  /** Times an engine cited this domain in an answer or an AI result block. */
  aiCitations: number;
  /** DISTINCT searches of yours it holds an organic ranking for. Recurrence lives here. */
  competingQueries: number;
  /** True when this domain is the account's own site. */
  isOwned: boolean;
  /** WHAT AN INSPECTION OF ITS OWN PAGES CONCLUDED: it sells a comparable product or service to the same customers, or it plainly does not. Absent or null
   *  means nobody has been able to look yet, and no amount of recurrence substitutes for looking (landscape.ts settles this and caches the answer). */
  overlap?: "same_business" | "not_a_business" | null;
};

export type ClassifiedDomain = {
  domain: string;
  kind: CompetitorKind;
  /** Why I put it in that group, in the same numbers the rule used. */
  why: string;
  evidence: { serpAppearances: number; aiCitations: number; competingQueries: number };
  /** TRUE when this row is my best reading rather than a decided one: the counts point both ways, or the domain is NOMINATED and nobody has inspected it
   *  yet. These are the only rows an inspection is ever spent on. Absent means decided. */
  ambiguous?: boolean;
};

/** Recurrence: this many of your searches before a domain is worth inspecting, or this many citations before a domain is called a source. One appearance
 *  proves nothing either way, and on its own recurrence never proves a business. */
const RECURS = 2;

/** Bounded well-known-host set. Deliberately small and platform-level: it names the places no operator can "beat", never a guess about somebody's business.
 *  Matched on the host or any subdomain of it. */
const SOCIAL = "facebook.com instagram.com x.com twitter.com linkedin.com reddit.com youtube.com tiktok.com pinterest.com quora.com threads.net discord.com";
const MARKETPLACE = "amazon.com ebay.com etsy.com walmart.com yelp.com tripadvisor.com booking.com expedia.com airbnb.com alibaba.com aliexpress.com g2.com capterra.com trustpilot.com angi.com thumbtack.com houzz.com indeed.com glassdoor.com";
/** Encyclopedias, references and publications. They rank for everything and sell nothing against anybody, so recurrence may never call one a competitor. */
const PUBLISHER = "wikipedia.org wikimedia.org britannica.com merriam-webster.com dictionary.com medium.com substack.com nytimes.com bbc.com bbc.co.uk cnn.com theguardian.com forbes.com bloomberg.com reuters.com wsj.com washingtonpost.com businessinsider.com techcrunch.com wired.com nationalgeographic.com smithsonianmag.com npr.org pbs.org";

const setOf = (s: string): Set<string> => new Set(s.split(" "));
const SOCIAL_HOSTS = setOf(SOCIAL);
const MARKETPLACE_HOSTS = setOf(MARKETPLACE);
const PUBLISHER_HOSTS = setOf(PUBLISHER);

const inSet = (domain: string, hosts: Set<string>): boolean =>
  hosts.has(domain) || [...hosts].some((h) => domain.endsWith(`.${h}`));

/** Public-sector and school addresses, in both the flat US form and the country-suffixed form. */
const PUBLIC_TLD = /\.(gov|edu|mil)$|\.(gov|edu|ac|mil)\.[a-z]{2}$/;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Place ONE domain in ONE group and say why. Pure and total: every domain gets an answer, and "I do not know yet" is one of the eight rather than a drop. */
export function classifyDomain(domain: string, signals: DomainSignals): ClassifiedDomain {
  const d = domain.trim().replace(/^www\./, "").toLowerCase();
  const { serpAppearances: serps, aiCitations: cites, competingQueries: queries } = signals;
  const evidence = { serpAppearances: serps, aiCitations: cites, competingQueries: queries };
  const row = (kind: CompetitorKind, why: string): ClassifiedDomain => ({ domain: d, kind, why, evidence });

  if (signals.isOwned) return row("owned", `I saw this ${serps + cites} ${plural(serps + cites, "time", "times")} in your own evidence, and it is your own site, so I never count it against you.`);
  if (PUBLIC_TLD.test(d)) return row("government_educational", `A government or school publishes this, and I saw it ${serps} ${plural(serps, "time", "times")} in your results. You cannot take customers from it, so treat it as a source to cite rather than a rival.`);
  if (inSet(d, SOCIAL_HOSTS)) return row("social_community", `This is a social platform, and it showed up ${serps} ${plural(serps, "time", "times")} in your results. It is a place to be present on, not a site to outrank.`);
  if (inSet(d, MARKETPLACE_HOSTS)) return row("marketplace_directory", `This is a marketplace or directory, and it showed up ${serps} ${plural(serps, "time", "times")} in your results. Get listed on it rather than trying to beat it.`);
  // A KNOWN PUBLICATION IS NEVER A RIVAL, however often it ranks. Which non-rival it is depends on what it is doing here: quoted and not ranking is a source,
  // ranking beside you is a publication on your topics.
  if (inSet(d, PUBLISHER_HOSTS)) {
    return cites >= RECURS && cites > queries
      ? row("citation_authority", `Engines quote this ${cites} ${plural(cites, "time", "times")} as a source. It is a reference, not a business taking your customers: aim to be quoted beside it.`)
      : row("publisher", `This is a publisher covering your topics, seen ${serps + cites} ${plural(serps + cites, "time", "times")}. Getting mentioned there is worth more than competing with it.`);
  }
  // ROLE EVIDENCE, both ways, and RECURRENCE NOMINATES BUT NEVER DECIDES. Ranking against you says this domain is worth understanding; it does not say it
  // sells what you sell to the people you sell it to, which is the only thing that makes somebody a competitor. So "competitor" now needs the inspection
  // (`overlap`), and until that lands the row says out loud that I have not worked it out rather than telling an operator to go and beat a stranger.
  const competes = queries >= RECURS, quoted = cites >= RECURS, sells = signals.overlap === "same_business";
  const both = competes && quoted ? ` It is also quoted as a source ${cites} ${plural(cites, "time", "times")}, so it plays both parts here.` : "";
  if (competes && sells) {
    return row("commercial_competitor", `I read its pages: it offers what you offer to the same customers, and it wins ${queries} of the searches you care about.${both} Read what it does on those pages and answer it better.`);
  }
  if (quoted) {
    const settled = row("citation_authority", `Engines quote it ${cites} ${plural(cites, "time", "times")} as a source and it ${queries === 0 ? "never ranks against you" : `ranks for ${queries} of your searches without selling what you sell`}. Aim to be quoted beside it, not to outrank it.`);
    return competes && signals.overlap == null ? { ...settled, ambiguous: true } : settled;
  }
  if (competes && signals.overlap === "not_a_business") {
    return row("publisher", `It ranks for ${queries} of your searches, but its pages sell nothing you sell, so it is a publisher on your topics. Getting mentioned there is worth more than competing with it.`);
  }
  if (competes) {
    // NOMINATED, NOT DECIDED. Two of your searches is the floor that makes this domain worth the look, and the look is exactly what has not happened yet.
    return { ...row("irrelevant_unknown", `It ranks for ${queries} of the searches you care about, so I am reading its pages to see whether it actually sells what you sell. Until I have, I will not call it a competitor.`), ambiguous: true };
  }
  return row("irrelevant_unknown", `I have only seen this domain ${serps + cites} ${plural(serps + cites, "time", "times")}, which is not enough to say what it is to you. I will keep watching it.`);
}
