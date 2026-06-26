/**
 * CONNECTOR_CAPABILITY — the plain-English "what does each connection
 * automate vs what do you do?" copy, keyed by connector provider.
 *
 * Source of truth for the in-product clarity blocks rendered by
 * <ConnectorCapability /> (connector-capability.tsx) on the connectors
 * page (and reusable on the Today data-sources strip + onboarding).
 *
 * Copy is taken from the connector-automation research (2026-06-15,
 * `docs/CONNECTOR_AUTOMATION_MAP.md`) so what the owner reads in-product
 * matches the verified per-source capability map.
 *
 * Honesty rules baked into the copy:
 *   • Every source but Wix is READ-ONLY — their `youDo` says Beacon
 *     never changes anything there.
 *   • Wix is the only write path — its `youDo` keeps "you approve each
 *     change" front and centre; there is no auto-publish.
 *
 * White-label rule: the AI-answer source is keyed `profound` to match
 * the connector-store provider, but the COPY never says the vendor name
 * — it is "AI answer tracking" — because this same map is also rendered
 * on the white-label-guarded Today strip.
 */

import type { ConnectorCapabilityCopy } from "./connector-capability";

// HONESTY (crons-off pivot): Beacon runs on-demand — every refresh of your
// connected data is what triggers the read + analysis. There is NO nightly /
// scheduled run, so the copy says "each time you refresh your connected data",
// never "every night" / "nightly" / "runs on its own". (The Today data-sources
// strip pins this with a no-"automatically"/"nightly" guard.)
export const CONNECTOR_CAPABILITY: Record<string, ConnectorCapabilityCopy> = {
  // Google Search Console — read-only.
  google_gsc: {
    automated:
      "Each time you refresh your connected data, Beacon reads your real Google numbers, which pages show up, what people search to find you, how often they click, and where you rank, and turns the weak spots into specific fixes (rewrite this title, refresh this fading page, you're one step from page one on this search).",
    youDo:
      "Click Connect once and approve Google's read-only access. Your site just needs to already be set up in Google Search Console. That's it. Beacon never changes anything in Google, it only reads.",
  },

  // Google Analytics 4 — read-only.
  google_ga4: {
    automated:
      "When you refresh your connected data, Beacon checks your website analytics to see which pages bring in the most visitors and turn them into customers, then focuses its to-do list on improving the pages that matter most to your bottom line.",
    youDo:
      "Sign in with the Google account that has your Analytics, then pick your website from the list. After that, every refresh reads your numbers, and Beacon can never change anything in your Analytics.",
  },

  // AI answer tracking (provider key: profound) — read-only.
  // NOTE: the copy must never name the vendor — this map also renders on
  // the white-label-guarded Today strip.
  profound: {
    automated:
      "When you refresh your connected data, Beacon checks the AI assistants (ChatGPT, Gemini, Perplexity, Google AI and others) and shows you the exact topics where they're recommending a competitor instead of you, then hands you the specific thing to add to your site so the AI starts recommending you.",
    youDo:
      "Turn on AI answer tracking on its top plan, ask their team to switch on API access, then create one access key and paste it into Beacon. If the key ever stops working, just create a new one and paste it again. Beacon only reads this data, it never changes anything there.",
  },

  // Microsoft Clarity — read-only.
  clarity: {
    automated:
      "Beacon checks where visitors get stuck on your pages, errors that break the page, spots people click that don't work, and how far they scroll, and turns the worst ones into fix-it suggestions, each time you refresh your connected data.",
    youDo:
      "One-time setup: in Microsoft Clarity, go to Settings then Data Export, click 'Generate new API token', then paste that token into Beacon's Clarity connection. (You'll need to be an admin on the Clarity project.) After that, Beacon reads it on each refresh, and it never changes anything in Clarity.",
  },

  // Wix — the ONLY write path. Owner approves every change; no auto-publish.
  wix: {
    automated:
      "Beacon writes the fix your page needs, a sharper title, heading, meta description, or the behind-the-scenes code that helps AI assistants quote you, and after you click approve, it publishes that single change to your live Wix site for you (up to 10 a day), then double-checks it actually went live.",
    youDo:
      "Connect Wix once by pasting in a Wix API key plus your Site ID, tell Beacon which part of your site holds your pages, then approve each suggested change with a click, and Beacon never auto-publishes. Brand-new blog posts, images, and any link or menu changes still get handled by you in Wix.",
  },
};
