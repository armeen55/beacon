/**
 * One publisher-vote rule for competitor comparisons. A publisher gets one seat,
 * a pattern needs at least three readable publishers, and "common" means a strict
 * majority of that readable set. Unread or partial captures never vote no.
 */

import { rootDomain } from "./readers/serp-provider";

const MULTI_SUFFIX = /\.(co|com|net|org|gov|edu|ac|or|ne)\.[a-z]{2}$/, MINIMUM = 3, MAXIMUM = 5;
const identity = (value: string): string => {
  const host = rootDomain(value).toLowerCase();
  const labels = host.split(".");
  const keep = MULTI_SUFFIX.test(host) ? 3 : 2;
  return labels.length > keep ? labels.slice(-keep).join(".") : host;
};

function matrix<T>(
  candidates: readonly T[],
  publisherOf: (candidate: T) => string,
  readable: (candidate: T) => boolean,
  max = MAXIMUM,
) {
  const seats: T[] = [], seen = new Set<string>();
  for (const candidate of candidates) {
    // An unread or partial page is unknown evidence, not a publisher's vote and
    // not one of the finite comparison seats. Keep scanning for the first
    // complete result from this publisher and for later complete publishers.
    if (!readable(candidate)) continue;
    const publisher = identity(publisherOf(candidate));
    if (!publisher || seen.has(publisher) || seats.length >= max) continue;
    seen.add(publisher); seats.push(candidate);
  }
  const complete = seats, denominator = complete.length;
  const threshold = denominator >= MINIMUM ? Math.floor(denominator / 2) + 1 : null;
  return {
    seats, readable: complete, denominator, threshold,
    support(indexes: readonly number[]) {
      if (threshold == null) return { state: "unknown", publishers: 0, denominator, threshold };
      const supporters = new Set(indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < complete.length)
        .map((i) => identity(publisherOf(complete[i]!))).filter(Boolean));
      return { state: supporters.size >= threshold ? "common" : "not_common", publishers: supporters.size, denominator, threshold };
    },
  };
}

/** Single internal Evidence seam; consumers cannot invent another publisher or majority rule. */
export const COMPETITIVE_PATTERN = { minimum: MINIMUM, maximum: MAXIMUM, publisherIdentity: identity, matrix } as const;
