/**
 * product-limits (P21, v1 356 - "what I cannot do yet") - the ONE honest registry of
 * the product's current limits, in plain first person, so the operator trusts the tool
 * instead of discovering a limit the hard way. Rendered read-only by
 * /settings/limits. No I/O, static per deploy.
 *
 * Beacon voice: first person, plain, a concrete boundary stated without hedging, no
 * overpromising, no lab jargon, no em or en dashes. Each entry says what I CAN do next
 * to it, so a limit never reads as a dead end.
 */

export type ProductLimit = {
  /** Stable key (React list key + anchor). */
  id: string;
  /** Short plain label for the limit. */
  label: string;
  /** The honest one or two sentences: what I cannot do yet, and what I do instead. */
  sentence: string;
};

export const PRODUCT_LIMITS: ReadonlyArray<ProductLimit> = [
  {
    id: "full-page-content",
    label: "Publishing full page content",
    sentence:
      "I can push SEO fields like your title and meta description straight to Wix, but for full page content I draft it for you to paste. Publishing whole pages by myself is not something I do yet.",
  },
  {
    id: "email-digests",
    label: "Email digests",
    sentence:
      "I do not send email digests yet. Everything I find waits for you here on Today, and I show you what changed since your last visit when you come back.",
  },
  {
    id: "verdict-timing",
    label: "How long a result takes",
    sentence:
      "I measure results with your Search Console data, so calling a change a win or a miss takes a few weeks. I will not tell you a change worked before I have enough data to mean it.",
  },
  {
    id: "wix-only-publishing",
    label: "Where I can publish",
    sentence:
      "I can push changes to Wix sites today. On other platforms I prepare the exact change and you apply it, and I still measure the result the same way.",
  },
  {
    id: "single-site",
    label: "One business at a time",
    sentence:
      "I am set up to work on one business at a time. I do not manage multiple sites or team members yet.",
  },
];
