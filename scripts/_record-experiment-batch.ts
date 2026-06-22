/**
 * One-off: record the 2026-06-21 Iranopedia experiment batch into the GSC proof
 * ledger as PENDING experiments (verified_live=false). Mirrors
 * recordShippedChangeAction but callable from a script with an explicit tenantId
 * and EXPLICIT untreated control pages (so a page changed in this same batch is
 * never used as another change's control).
 *
 * No publish. No paid APIs (GSC is already synced; baseline reads Supabase).
 * Idempotent-ish: skips a (path, ship-date) that already exists.
 *
 * Run: npx tsx --require ./scripts/mock-server-only.cjs scripts/_record-experiment-batch.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Force the tenant BEFORE the .env.local load (which uses ??=) and before any
// module import. upsertShippedChange persists under currentTenantId(), which in
// a script resolves from BEACON_TENANT_ID — the repo default is the Ritz tenant,
// so without this the Iranopedia rows would be misfiled cross-tenant.
process.env.BEACON_TENANT_ID = "tenant-iranopedia";

// ── Load .env.local ───────────────────────────────────────────────────────
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}

const TENANT = "tenant-iranopedia";
const SHIPPED_AT = "2026-06-21T17:00:00Z"; // today; adjust per change if pasted later
const ORIGIN = "https://iranopedia.com";
const NOTE_BASE =
  "Manual Wix edit by Armeen. Beacon-recommended experiment batch. Title/H1/body unchanged unless stated.";

// Untreated, reasonably-stable page-1 pages — NONE are in this batch.
const CONTROLS = [
  `${ORIGIN}/persian-male-names`,
  `${ORIGIN}/famous-iranian-entrepreneurs`,
  `${ORIGIN}/famous-iranian-scientists`,
  `${ORIGIN}/famous-iranian-athletes`,
];

type Change = {
  path: string;
  actionType: string;
  before: string;
  after: string;
  targetQueries: string[];
  noteExtra: string;
};

const CHANGES: Change[] = [
  {
    path: "/farsi-numbers",
    actionType: "intro_answer_block",
    before:
      "No numbers table on the page (table_count = 0). Counting is explained in prose with no scannable 1-10 list near the top.",
    after:
      "Added a 3-column table (Number | Persian | Pronunciation) for 1-10 directly under the H1, plus a one-line lead: 'Persian numbers 1 to 10 are: yek (1), do (2), se (3), chahar (4), panj (5), shesh (6), haft (7), hasht (8), noh (9), dah (10).'",
    targetQueries: [
      "farsi numbers 1-10",
      "farsi counting 1 to 10",
      "persian numbers",
      "4 in farsi",
      "iran numbers",
      "iranian numbers",
    ],
    noteExtra:
      "Added an intro numbers table (1-10) to target the featured snippet the page is ranked #1-3 for but gets 0 clicks on. Additive content only.",
  },
  {
    path: "/iran-animals/asiatic-cheetah",
    actionType: "intro_answer_block",
    before:
      "No direct one-sentence answer to 'what is the national animal of Iran' at the top. Intro does not lead with the national-animal statement.",
    after:
      "Added a 2-sentence answer block under the H1: 'Iran's national animal is the Asiatic cheetah (Acinonyx jubatus venaticus), a critically endangered wild cat that today survives only in Iran. It is one of the rarest big cats in the world, and conservation programs in Iran's central deserts work to protect the small remaining population.'",
    targetQueries: [
      "national animal of iran",
      "iran national animal",
      "iran's national animal",
      "what is the national animal of iran",
      "persian cheetah",
    ],
    noteExtra:
      "Added a direct national-animal answer block to target the definitional featured snippet (ranks ~#4, ~0% CTR). Additive content only.",
  },
  {
    path: "/persian-female-first-names",
    actionType: "faq",
    before: "No FAQ / visible Q&A section on the page (faq_count = 0).",
    after:
      "Added a 'Frequently Asked Questions' H2 at the bottom with 4 visible Q&As (common Persian girl names + meanings; Persian vs Iranian names; what the names mean; how to choose). Freshness + People-Also-Ask capture in response to a 34% click decline.",
    targetQueries: [
      "persian girl names",
      "persian female names",
      "persian names for girls",
      "female persian names",
    ],
    noteExtra:
      "Decay response (clicks 358 -> 235 over 2 weeks; CTR already healthy so NOT a title change). Added a visible Q&A for freshness + PAA. Additive content only.",
  },
  {
    path: "/famous-iranian-singers",
    actionType: "section_add",
    before: "Thin page: 402 words, only 2 H2 sections for a 'Top 20' list.",
    after:
      "Added an H2 'Persian Singers by Era and Style' grouping real, well-known artists: classical (Shajarian, Nazeri), pre-revolution pop (Googoosh, Dariush), diaspora pop (Ebi, Moein), and a contemporary note. Adds depth for the singers cluster.",
    targetQueries: [
      "iranian singers",
      "persian singers",
      "famous iranian singers",
      "famous persian singers",
      "persian singer",
    ],
    noteExtra:
      "Section-depth expansion on a thin (402-word) page that is growing. Factual artist entries only. Additive content only.",
  },
  {
    path: "/famous-iranian-comedians",
    actionType: "meta",
    before:
      "Discover the best Persian and Iranian comedians like Maz Jobrani, Max Amini, and Enissa Amani. Explore their impact on stand-up comedy, film, and entertainment, from Iran to international stages. Learn about the top Iranian-American comedians!",
    after:
      "Meet the most famous Iranian and Persian comedians, from stand-up stars like Maz Jobrani and Max Amini to Enissa Amani, and what each is best known for.",
    targetQueries: [
      "iranian stand up comedian",
      "persian comedian",
      "iranian comedian",
      "persian stand up comedian",
      "famous iranian comedians",
    ],
    noteExtra:
      "Meta-only CTR test (page 1, list intent, no dominant SERP feature). Leads with 'famous Iranian and Persian comedians' + 'stand-up'. Trivial rollback.",
  },
  {
    path: "/iranian-actors-actresses",
    actionType: "title",
    before:
      "TITLE: Top 20 Famous Persian Actresses and Actors | Iranopedia || META: Discover some of the most famous Iranian actors and actresses with a list of the best Persian movie stars like Shahab Hosseini and Leila Hatami. Explore their award-winning roles in films like A Separation and The Salesman.",
    after:
      "TITLE: Famous Iranian and Persian Actors, Actresses and Celebrities | Iranopedia || META: Meet famous Iranian and Persian actors, actresses and celebrities, from Shahab Hosseini to Leila Hatami, with the films and roles each is best known for.",
    targetQueries: [
      "iranian actors",
      "persian actors",
      "persian actress",
      "iranian actress",
      "persian celebrities",
    ],
    noteExtra:
      "Title + meta: closes a token gap (adds 'Iranian' + 'Celebrities'). MEDIUM confidence - actor SERPs can show a faces carousel that caps CTR; trivial rollback. Title AND meta changed (stated).",
  },
  {
    path: "/iran-flags",
    actionType: "internal_links",
    before:
      "Flag images on the hub are not linked (Clarity: 67 dead clicks + 10 rage clicks over 21 sessions = visitors clicking flag images that do not respond).",
    after:
      "Linked each flag image/card on the hub to its dedicated sub-page (e.g. Achaemenid flag image -> /iran-flags/achaemenid-empire-flag). Removes the dead-click frustration and passes internal links to high-ranking sub-pages.",
    targetQueries: ["historical flags of iran", "iran flag history", "iran flags"],
    noteExtra:
      "UX + internal-link fix (NOT title/meta - core flag queries are image-pack owned). PRIMARY metric is Clarity dead-click rate; GSC CTR is secondary and may be inconclusive.",
  },
];

async function main() {
  const { recordShippedChange } = await import("@/domains/proof-gsc/run-measurement");
  const { loadShippedChanges, upsertShippedChange } = await import(
    "@/domains/proof-gsc/shipped-change-store"
  );

  const existing = await loadShippedChanges();
  const dateOnly = (s: string) => (s.length > 10 ? s.slice(0, 10) : s);
  const shipDate = dateOnly(SHIPPED_AT);

  for (const c of CHANGES) {
    const clash = existing.find(
      (r) => r.path === c.path && dateOnly(r.shippedAt) === shipDate,
    );
    if (clash) {
      console.log(`SKIP  ${c.path} (already recorded for ${shipDate})`);
      continue;
    }
    try {
      const record = await recordShippedChange({
        tenantId: TENANT,
        page: `${ORIGIN}${c.path}`,
        path: c.path,
        actionType: c.actionType,
        before: c.before,
        after: c.after,
        targetQueries: c.targetQueries,
        controlPages: CONTROLS,
        shippedAt: SHIPPED_AT,
        notes: `${NOTE_BASE} ${c.noteExtra} PENDING: recorded ${shipDate}, not yet confirmed live - mark verified-live after pasting.`,
        verifiedLive: false,
      });
      await upsertShippedChange(record);
      console.log(
        `OK    ${c.path}  [${c.actionType}]  verdict=${record.verdict ?? "n/a"} controls=${record.controlPages.length}`,
      );
    } catch (err) {
      console.error(`FAIL  ${c.path}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("done.");
}

main().then(() => process.exit(0));
