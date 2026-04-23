import { PageHeader } from "@/components/data/page-header";
import Link from "next/link";

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="How Beacon works"
        description="Reference guide to Beacon's methodology, metrics, and evidence boundaries. Use this page to understand — or defend — any number Beacon shows you."
      />

      {/* ── Section 1: How Beacon works ── */}
      <section id="overview" className="mb-12">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Beacon imports visibility observations from external tools (like Profound), crawls your
          public site HTML, and compares the two over time. From those inputs it computes five things:
        </p>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground leading-relaxed list-decimal pl-5">
          <li>
            <span className="font-medium text-foreground">Findings</span> — what changed on your
            site between consecutive crawls (title, meta, schema, FAQs, content, links).
          </li>
          <li>
            <span className="font-medium text-foreground">Attribution</span> — which site changes
            correlate with visibility shifts, based on timing, topic overlap, URL alignment, and
            platform. This is correlation, not causation — no A/B test or holdout exists.
          </li>
          <li>
            <span className="font-medium text-foreground">Market position</span> — your citation
            share within the imported observation sample, compared to configured competitors. This is
            share-of-sample, not share-of-market.
          </li>
          <li>
            <span className="font-medium text-foreground">Recommendations</span> — the
            highest-leverage next step based on available evidence. A prioritized suggestion, not a
            guarantee of outcomes.
          </li>
          <li>
            <span className="font-medium text-foreground">Local reviews</span> (optional) — enter
            rows via Settings → Import (CSV/JSON) and/or optional{" "}
            <a href="#review-connectors" className="text-accent-primary font-medium hover:underline">
              Google and Yelp connectors
            </a>{" "}
            (on-demand pull in Settings → Connectors).{" "}
            <Link href="/local" className="text-accent-primary font-medium hover:underline">
              Local presence
            </Link>{" "}
            reflects what is in Beacon after those actions — not a continuous mirror of the
            platforms. See{" "}
            <a href="#review-source-timestamps" className="text-accent-primary font-medium hover:underline">
              Review source timestamps
            </a>{" "}
            for per-source freshness.
          </li>
        </ol>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Every metric in Beacon is bounded by the imported sample. When sample size is small,
          coverage is partial, or data is stale, Beacon tells you — through freshness strips,
          coverage tone indicators, and sample quality labels. See{" "}
          <a href="#coverage-states" className="text-accent-primary font-medium hover:underline">
            Coverage states
          </a>{" "}
          for the five-label freshness model (not performance).
        </p>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Surfaces are based on <span className="font-medium text-foreground">imported or synced</span>{" "}
          inputs Beacon has stored — not continuous platform truth. See{" "}
          <a href="#boundaries" className="text-accent-primary font-medium hover:underline">
            What Beacon knows vs. doesn&rsquo;t know
          </a>
          .
        </p>
      </section>

      {/* ── Internal exit gates (sign-off) ── */}
      <section id="exit-gates" className="mb-12">
        <SectionHeading>Internal exit gates</SectionHeading>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Under <span className="font-medium text-foreground">Settings → Sign-offs</span>, Beacon
          stores a lightweight <span className="font-medium text-foreground">readiness review</span>{" "}
          for Daily Ritual, Replication, and the <span className="font-medium text-foreground">Local layer</span>{" "}
          (the Local route, connectors, NAP, listing health, listing completeness, Today/Market local
          strips). These fields record internal operator sign-off state — not performance. They{" "}
          <span className="font-medium text-foreground">do not</span> change scores, findings, attribution,
          recommendations, proof logic, freshness labels, or underlying metrics. They only record a
          readiness judgment you choose to save.
        </p>
        <p className="mt-3 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
        <ul className="mt-1.5 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
          <li>Whether your team actually shipped marketing or ops work — only what you record in Beacon.</li>
          <li>Any automatic effect on scores, findings, freshness, or recommendations from these fields (there is none).</li>
        </ul>
      </section>

      {/* ── Section 2: What the metrics mean ── */}
      <section id="metrics" className="mb-12">
        <SectionHeading>What the metrics mean</SectionHeading>

        <MetricBlock id="citation-share" title="Citation Share">
          <p>
            &ldquo;Your Citation Share&rdquo; is the percentage of citations that mention your domain
            out of all citations in the imported observation set. The denominator is always shown
            (&ldquo;of N observations&rdquo;). It is <em>directional</em> — a useful indicator of
            relative position within your tracked sample, not a census of all AI-generated answers.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">How to read it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use Citation Share to compare yourself to competitors <em>inside the same imported window</em> — not as an absolute market position.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Your share of all AI answers on the internet.</li>
            <li>Whether unobserved prompts would change the ranking order.</li>
            <li>True ranking impact from any single change (attribution is correlational).</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="sample-quality" title="Sample quality">
          <p>
            Beacon classifies your observation count into three tiers:
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Limited</span> (&lt;200 observations) —
              percentages are volatile; treat as an early signal.
            </li>
            <li>
              <span className="font-medium text-foreground">Moderate</span> (200–1,000) — trend data
              is directional.
            </li>
            <li>
              <span className="font-medium text-foreground">Strong</span> (&gt;1,000) — directional
              comparisons are meaningful.
            </li>
          </ul>
          <p className="mt-1.5">
            These thresholds are heuristic, not statistically derived. Beacon has no margin-of-error
            model.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Whether your prompt bank matches real-world demand.</li>
            <li>Statistical confidence intervals — tiers are labels, not proofs.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="coverage-states" title="Coverage states (data freshness)">
          <p>
            On Today and Market, Beacon shows a <span className="font-medium text-foreground">coverage</span>{" "}
            label derived only from crawl age (days since last completed website crawl), visibility
            freshness vs crawl when available, and observation sample tier. States are discrete — no
            blended scores and no predictive logic.
          </p>
          <p className="mt-2 font-medium text-foreground/90">
            Coverage reflects data freshness, not performance.
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Fresh</span> — crawl age is at or below
              70% of the stale threshold (strictly below the aging window lower bound).
            </li>
            <li>
              <span className="font-medium text-foreground">Aging</span> — crawl age is between 70% and
              100% of the stale threshold (inclusive of the threshold day, exclusive of the lower bound).
            </li>
            <li>
              <span className="font-medium text-foreground">Stale</span> — crawl age is past the stale
              threshold, or visibility data is older than the crawl suggests.
            </li>
            <li>
              <span className="font-medium text-foreground">Critical</span> — no crawl timestamp when
              one is expected, or crawl age is more than twice the stale threshold.
            </li>
            <li>
              <span className="font-medium text-foreground">Partial</span> — observation sample is in
              the &ldquo;limited&rdquo; tier; this takes precedence over crawl-age states.
            </li>
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Numeric rule: stale threshold <span className="font-mono">T = 3</span> days (crawl older
            than <span className="font-mono">T</span> days ⇒ stale). Aging uses{" "}
            <span className="font-mono">(0.7×T, T]</span> on crawl age. Critical uses crawl age{" "}
            <span className="font-mono">&gt; 2×T</span> or missing crawl when flagged by the app.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">How to read it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Coverage states describe <span className="font-medium text-foreground">data freshness and sample size</span>{" "}
            for Beacon&rsquo;s inputs — not how well the business is performing.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Search-engine crawl or index timing outside what your Beacon crawl timestamps show.</li>
            <li>Continuous platform state — labels update when imports and crawls complete, not as a continuous feed from Google, Yelp, or AI platforms.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="closest-match" title="&ldquo;Closest match&rdquo;">
          <p>
            When Beacon labels a change as the &ldquo;Closest match&rdquo; for a visibility
            shift, it means the change scored ≥70/100 on a composite of timing, topic, URL, platform,
            and geo alignment. It does <em>not</em> mean the change caused the shift. Other factors —
            algorithm updates, competitor actions, seasonal demand — could be responsible.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Which factor actually caused a visibility shift.</li>
            <li>Whether repeating the same change will reproduce the outcome.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="evidence-quality" title="Evidence quality labels">
          <p>
            Recommendation confidence uses evidence-quality framing, not outcome certainty:
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Strong signal</span> — input signals
              are solid (multiple matches, high evidence tier).
            </li>
            <li>
              <span className="font-medium text-foreground">Signal detected</span> — supporting
              signal exists but is not conclusive.
            </li>
            <li>
              <span className="font-medium text-foreground">Early data</span> — limited data;
              treat as directional.
            </li>
          </ul>
          <p className="mt-1.5">
            &ldquo;Strong signal&rdquo; means the inputs are strong — not that the recommended
            action will definitely work.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Whether a recommendation will produce the business outcome you want.</li>
            <li>Outcome certainty — evidence quality is about inputs, not guarantees.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="listing-health" title="Listing health score">
          <p>
            The listing health score (0–100) is a <em>completeness heuristic</em> based on
            configured business identity fields and stored review rows (manual import or connector
            sync). It is not a competitive audit, not a ranking claim, and not a verified consistency
            check against directory UIs.
          </p>
          <p className="mt-2">The score is a weighted sum of seven components:</p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Domain configured</span> (25 pts) —
              is a website domain set in Settings → Config?
            </li>
            <li>
              <span className="font-medium text-foreground">Business name set</span> (15 pts) —
              is a name present?
            </li>
            <li>
              <span className="font-medium text-foreground">Phone present</span> (10 pts) —
              is a phone number configured?
            </li>
            <li>
              <span className="font-medium text-foreground">Address present</span> (10 pts) —
              is a business address configured?
            </li>
            <li>
              <span className="font-medium text-foreground">Review rows stored</span> (15 pts) —
              has at least one review row in Beacon (manual import or connector sync)?
            </li>
            <li>
              <span className="font-medium text-foreground">Average rating</span> (15 pts) —
              scaled: (rating / 5) × 15 — higher ratings earn more points.
            </li>
            <li>
              <span className="font-medium text-foreground">Review freshness</span> (10 pts) —
              10 if the latest manual import or connector observation is ≤ 30 days old, 5 if ≤ 90 days,
              0 if older or never observed (same clock used for Today/Market local surfacing).
            </li>
          </ul>
          <p className="mt-2">
            The tier label (<em>Weak</em> &lt; 35, <em>OK</em> 35–64,{" "}
            <em>Strong</em> ≥ 65) is derived from the composite score for at-a-glance use.
            These thresholds are heuristic, not empirically validated.
          </p>
          <p className="mt-2">
            NAP (Name, Address, Phone) completeness reflects what you have{" "}
            <em>configured</em> in Beacon — not whether it matches what you see on Google Business Profile,
            Yelp, or other directory listings. Beacon does not scrape or verify directory
            consistency in this phase.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">How to read it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Treat the score as a checklist-style signal for configured identity plus whether review
            rows exist in Beacon — not as proof of local pack rank or directory perfection.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>True ranking impact from the listing health score.</li>
            <li>Complete listing accuracy across every directory on the web.</li>
            <li>Whether your configured NAP matches what consumers see on Google or Yelp without your own verification.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="listing-completeness" title="Listing completeness">
          <p>
            On{" "}
            <Link href="/local" className="text-accent-primary font-medium hover:underline">
              Local presence
            </Link>
            , <span className="font-medium text-foreground">Listing completeness</span> is a
            read-only checklist of whether Beacon has values for a small set of listing-related
            fields — not a score, not an SEO grade, and not a comparison to competitors.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Fields checked (v1)</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Business name</span> — Settings → Config
              name and/or the Google connector&apos;s selected location display name when present.
            </li>
            <li>
              <span className="font-medium text-foreground">Address</span> and{" "}
              <span className="font-medium text-foreground">Phone</span> — from Settings → Config.
            </li>
            <li>
              <span className="font-medium text-foreground">Website (domain)</span> — configured
              website domain in Settings → Config.
            </li>
            <li>
              <span className="font-medium text-foreground">Category (industry)</span> — the
              industry value stored in Settings → Config (used as the only category-like field
              Beacon holds without new imports).
            </li>
          </ul>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Not checked in v1</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Opening hours are not persisted from connectors in this version — Beacon does not show
            an hours row in this audit.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">How to read it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Labels are <span className="font-medium text-foreground">strong</span> (most key fields
            present), <span className="font-medium text-foreground">partial</span> (some missing), or{" "}
            <span className="font-medium text-foreground">limited</span> (many missing). Use it to see
            what is still empty in Beacon — then fill Config or run connector flows as you already
            do today.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Whether values match what consumers see on Google, Yelp, or other directories.</li>
            <li>Whether filling a missing field would change rankings or AI answers.</li>
            <li>Any data Beacon has not stored (including hours until a future read path adds them).</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="nap-consistency" title="NAP consistency">
          <p>
            The NAP (Name, Address, Phone) consistency label on{" "}
            <Link href="/local" className="text-accent-primary font-medium hover:underline">
              Local presence
            </Link>{" "}
            reflects data Beacon has — not a verified check against every external directory.
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Complete</span> — all required identity
              fields (name, domain, phone, address) are present and no conflicts detected between
              configured business name and imported listing records.
            </li>
            <li>
              <span className="font-medium text-foreground">Incomplete</span> — one or more required
              NAP fields are missing from Settings → Config.
            </li>
            <li>
              <span className="font-medium text-foreground">Inconsistent</span> — imported review
              listing names do not match the configured business name. This means stored data
              disagrees on identity — not necessarily that external directories are wrong.
            </li>
            <li>
              <span className="font-medium text-foreground">Unknown</span> — not enough data to
              judge; typically because no website domain is configured.
            </li>
          </ul>
          <p className="mt-2">
            Beacon only judges consistency from imported, synced, or configured data. It does not verify every
            external directory listing. NAP consistency is a data-quality signal, not a ranking claim.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">How to read it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the label to spot internal inconsistency between configured name and listing names on
            review rows — then verify on the platforms yourself if needed.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Whether your real-world directory listings are correct.</li>
            <li>Full NAP consistency across directories Beacon has not ingested.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="local-reviews" title="Local reviews (stored in Beacon)">
          <p>
            Review rows reach Beacon in two ways: manual import (Settings → Import →{" "}
            <span className="font-medium text-foreground">Local reviews</span>, CSV/JSON) and optional
            on-demand pulls via{" "}
            <a href="#review-connectors" className="text-accent-primary font-medium hover:underline">
              Google Business Profile and Yelp connectors
            </a>{" "}
            (Settings → Connectors → Sync now). There is <span className="font-medium text-foreground">no automatic syncing</span>{" "}
            — each source updates only when you trigger import or sync.
          </p>
          <p className="mt-2">
            Counts and averages on{" "}
            <Link href="/local" className="text-accent-primary font-medium hover:underline">
              Local presence
            </Link>{" "}
            reflect rows stored in Beacon — not a claim about your full profile on Google or Yelp.
            Data may be incomplete or outdated relative to the platforms. Beacon does not estimate
            ratings or counts from other signals.
          </p>
          <p className="mt-2">
            Even with connectors, Beacon may not reflect the full set of reviews on a platform (API
            limits, moderation, and timing differ from what you see when browsing).
          </p>
          <p className="mt-2">
            The sentiment line (positive / mixed / concerning) is based <em>solely</em> on average
            star rating across those stored rows — not review text analysis, NLP, or emotion
            detection.
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              No ranking claims: Beacon does not claim that reviews improve local or AI ranking.
            </li>
            <li>
              No competitive review comparison: there is no competitor review dataset in v1.
            </li>
            <li>
              Import-based surfacing (e.g. Today / Market) uses a single age signal derived from the
              latest successful observation across manual import and connector syncs — while{" "}
              <Link href="/local" className="text-accent-primary font-medium hover:underline">
                Local presence
              </Link>{" "}
              also lists each source separately (see{" "}
              <a href="#review-source-timestamps" className="text-accent-primary font-medium hover:underline">
                Review source timestamps
              </a>
              ).
            </li>
          </ul>
          <p className="mt-2">
            For the full <span className="font-medium text-foreground">review monitoring v1</span>{" "}
            scope (sources, coverage, freshness, hard rules), see{" "}
            <a href="#review-monitoring-v1" className="text-accent-primary font-medium hover:underline">
              Review monitoring (v1)
            </a>{" "}
            below. Canonical written spec:{" "}
            <span className="font-mono text-[11px] text-foreground/80">docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md</span>{" "}
            in the repository.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Full review coverage on Google or Yelp — only rows that reached Beacon.</li>
            <li>Whether sentiment from text would differ from the average-rating line.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="review-source-timestamps" title="Review source timestamps">
          <p>
            See{" "}
            <a href="#review-connectors" className="text-accent-primary font-medium hover:underline">
              Review connectors (Google and Yelp)
            </a>{" "}
            for how pulls work. <span className="font-medium text-foreground">Review source timestamps</span>{" "}
            describe how Beacon tracks freshness <em>per source</em> on{" "}
            <Link href="/local" className="text-accent-primary font-medium hover:underline">
              Local presence
            </Link>
            : three independent lines — Google (connector token{" "}
            <span className="font-mono text-[11px]">last_synced_at</span> when present), Yelp (same),
            and manual Local reviews import (latest{" "}
            <span className="font-mono text-[11px]">ImportRun</span> with{" "}
            <span className="font-mono text-[11px]">entity_type: reviews</span> and{" "}
            <span className="font-mono text-[11px]">imported_count {">"} 0</span>, excluding connector
            audit rows). <span className="font-medium text-foreground">Each source updates independently.</span>{" "}
            These values are <em>not</em> merged into one timestamp on that screen and are not a new
            scoring layer.
          </p>
          <p className="mt-2">
            <span className="font-medium text-foreground">Last synced</span> (Google / Yelp) reflects the
            most recent successful pull for that connector after you run Sync now. Manual import shows
            the last successful file import on that path. Data may be incomplete or outdated relative to
            the platform. This is not an always-current copy of Google or Yelp, not a completeness
            guarantee, and not a claim that stored rows match what you see when browsing.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Standard phrases</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Based on imported or synced data.</li>
            <li>May not reflect full platform data.</li>
            <li>No automatic syncing.</li>
            <li>Each source updates independently.</li>
          </ul>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Whether every review visible on Google or Yelp was returned by the API on your last pull.</li>
            <li>Future platform moderation or filtering after your last successful sync or import.</li>
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Today and Market intentionally use one <span className="font-medium text-foreground">combined</span> review-age
            signal for surfacing; only Local presence lists per-source lines above.
          </p>
        </MetricBlock>

        <MetricBlock id="review-monitoring-v1" title="Review monitoring (v1 scope)">
          <p>
            &ldquo;Review monitoring&rdquo; in Beacon means: review rows you placed in Beacon (manual
            import and/or connector pulls) drive counts, averages, import-based surfacing, and simple
            average-rating sentiment. There is <span className="font-medium text-foreground">no automatic syncing</span>{" "}
            and <span className="font-medium text-foreground">no continuous platform mirroring</span>{" "}
            — updates happen when you import a file or run Sync now on a connector.
          </p>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Supported sources (v1)</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Google Business Profile</span> — optional
              connector; read-only review pull when you run Sync now in Settings → Connectors.
            </li>
            <li>
              <span className="font-medium text-foreground">Yelp</span> — optional connector; same on-demand
              model.
            </li>
            <li>
              <span className="font-medium text-foreground">Manual import</span> — CSV/JSON under Settings →
              Import (Local reviews); baseline path; always available.
            </li>
            <li>
              <span className="font-medium text-foreground">Other</span> — manual import only (no dedicated
              connector for other sources in v1).
            </li>
          </ul>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Data collection</p>
          <p className="mt-1">
            <span className="font-medium text-foreground">Current:</span> manual CSV/JSON import plus
            optional Google and Yelp on-demand pulls. Connectors are optional and extend manual import.
            Data is pulled on demand (no automatic syncing). No guarantee that stored rows match your
            full profile when browsing a platform.
          </p>
          <p className="mt-1">
            <span className="font-medium text-foreground">Not in scope for v1:</span> scheduled or
            background connector runs, polling, alerts, or SLAs — no dates or cadence promises until a
            future spec explicitly adds them.
          </p>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Coverage</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Beacon only knows rows that reached it through import or sync.</li>
            <li>Empty data in Beacon does not mean you have no reviews on Google or Yelp.</li>
            <li>Partial imports and partial API responses are partial truth — treat as a snapshot, not a census.</li>
            <li>
              Even with connectors, Beacon may not reflect the full set of reviews on a platform (API
              coverage, moderation, and timing differ from the consumer site).
            </li>
          </ul>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Freshness (import-based)</p>
          <p className="mt-1">
            Today and Market use one import-age signal: the latest successful observation across manual
            review imports and connector syncs (same 30-day threshold as elsewhere). That is a single
            derived age for surfacing — not per-source on those routes. For how Beacon tracks freshness{" "}
            <em>per source</em> on Local presence, see{" "}
            <a href="#review-source-timestamps" className="text-accent-primary font-medium hover:underline">
              Review source timestamps
            </a>
            . No uptime guarantees; no implied SLAs.
          </p>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Operator guidance</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>
              Use Beacon to understand <span className="font-medium text-foreground">stored</span>{" "}
              review presence and configuration-driven listing signals.
            </li>
            <li>
              Use Google, Yelp, or your reputation tool for on-platform review management and public
              responses.
            </li>
          </ul>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Required disclosures</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Based only on imported or synced data held in Beacon.</li>
            <li>No automatic syncing unless you trigger import or Sync now.</li>
            <li>Data may be incomplete or outdated relative to Google, Yelp, or elsewhere.</li>
          </ul>
          <p className="mt-2">
            For connector behavior (auth, mapping, failure modes), see{" "}
            <a href="#review-connectors" className="text-accent-primary font-medium hover:underline">
              Review connectors (Google and Yelp)
            </a>
            . Canonical written spec:{" "}
            <span className="font-mono text-[11px] text-foreground/80">docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md</span>{" "}
            in the repository.
          </p>
        </MetricBlock>

        <MetricBlock id="review-connectors" title="Review connectors (Google and Yelp)">
          <p>
            <span className="font-medium text-foreground">Beacon supports Google Business Profile and Yelp connectors</span>{" "}
            (Settings → Connectors): read-only review pull, operator-initiated. Canonical spec:{" "}
            <span className="font-mono text-[11px] text-foreground/80">docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md</span>.
          </p>
          <p className="mt-2">
            <span className="font-medium text-foreground">Connectors are optional and extend manual import.</span>{" "}
            <span className="font-medium text-foreground">Data is pulled on demand (no automatic syncing).</span>{" "}
            Manual CSV/JSON import under Settings → Import remains available whether or not you use
            connectors.
          </p>
          <p className="mt-2">
            See{" "}
            <a href="#review-source-timestamps" className="text-accent-primary font-medium hover:underline">
              Review source timestamps
            </a>{" "}
            for how Beacon tracks freshness per source on Local presence (&ldquo;Last synced&rdquo; reflects
            the most recent successful pull for that connector; each source updates independently).
          </p>
          <p className="mt-2">
            Even with connectors, Beacon may not reflect the full set of reviews on a platform. Data may
            be incomplete or outdated relative to what you see when browsing.
          </p>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Supported connectors</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Google Business Profile</span>{" "}
              — OAuth 2.0, read-only review pull, Sync now only.
            </li>
            <li>
              <span className="font-medium text-foreground">Yelp</span>{" "}
              — API key, read-only review pull, Sync now only.
            </li>
          </ul>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Key principles</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>
              Connectors are <span className="font-medium text-foreground">additive</span>{" "}
              — manual import remains the baseline and fallback.
            </li>
            <li>
              <span className="font-medium text-foreground">Pull-only</span>{" "}
              — Beacon reads reviews; it never writes, replies, or modifies anything on the platform.
            </li>
            <li>
              <span className="font-medium text-foreground">Snapshot-based</span>{" "}
              — each sync is a point-in-time fetch, not a standing connection to the platform.
            </li>
            <li>
              <span className="font-medium text-foreground">No SLA</span>{" "}
              — no promised sync frequency, no implied cadence, no uptime guarantees.
            </li>
            <li>
              <span className="font-medium text-foreground">Graceful failure</span>{" "}
              — auth expiry, API downtime, or partial fetches preserve the last good snapshot.
            </li>
          </ul>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Still not allowed</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Auto-replies to reviews.</li>
            <li>Sentiment AI / NLP on review text.</li>
            <li>Ranking impact claims from reviews.</li>
            <li>Competitor review comparison.</li>
            <li>Alerts / notifications (email, push, SMS).</li>
          </ul>

          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Operator-facing disclosures</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Based on imported or synced data.</li>
            <li>No automatic syncing — only when you run Sync now.</li>
            <li>May not reflect full platform data; counts can diverge from the consumer site.</li>
            <li>Each source updates independently (see Review source timestamps).</li>
            <li>Last synced reflects the most recent successful pull for that connector after authorization.</li>
          </ul>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>Platform-side moderation or filtering decisions after your last pull.</li>
            <li>Whether your next manual import would match connector IDs row-for-row.</li>
          </ul>
        </MetricBlock>

        <MetricBlock id="verdicts" title="Change verdicts">
          <p>
            Each change in your changelog receives a verdict based on attribution evidence:
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Validated</span> — operator-confirmed or
              strong multi-event evidence. Does not mean proven ROI.
            </li>
            <li>
              <span className="font-medium text-foreground">Partial</span> — some positive signal,
              not conclusive.
            </li>
            <li>
              <span className="font-medium text-foreground">Inconclusive</span> — not enough evidence
              to determine impact.
            </li>
            <li>
              <span className="font-medium text-foreground">Too early</span> — change is recent; still
              building signal.
            </li>
            <li>
              <span className="font-medium text-foreground">No impact</span> — no positive outcome
              events detected within the attribution window.
            </li>
            <li>
              <span className="font-medium text-foreground">Negative</span> — visibility declined in
              the same observation window.
            </li>
          </ul>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">How to read it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Verdicts summarize imported visibility outcomes and timing overlap in Beacon — useful for
            prioritization, not proof of revenue, rank position, or causal impact.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground/90">Beacon does not know</p>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>True causal impact of a shipped change on AI or search rankings.</li>
            <li>Whether a &ldquo;Validated&rdquo; label would repeat under a different sample or time window.</li>
          </ul>
        </MetricBlock>
      </section>

      {/* ── Section 3: What Beacon knows vs doesn't know ── */}
      <section id="boundaries" className="mb-12">
        <SectionHeading>What Beacon knows vs. doesn&rsquo;t know</SectionHeading>

        <div className="grid gap-6 sm:grid-cols-2">
          <BoundaryCard
            title="Observed signals"
            items={[
              "HTML content of your pages at each crawl",
              "Citation frequency per domain in the imported sample",
              "Timing and topic overlap between changes and visibility shifts",
              "Competitor citation frequency within the same sample",
              "Data freshness and sample size",
              "Review rows in Beacon (manual CSV/JSON import and/or on-demand Google or Yelp connector pulls) — as of last import or sync, not a continuous mirror of the platforms",
              "NAP fields (name, domain, phone, address) configured in Settings → Config — not verified against external directory UIs",
            ]}
          />
          <BoundaryCard
            title="Inferred relationships"
            items={[
              "Attribution scores link changes to outcomes by multi-factor correlation",
              "Pattern matching connects validated changes to structural playbooks",
              "Replication targets are flagged by structural and topic similarity",
              "Recommendations combine evidence strength, pattern fit, and priority scoring",
            ]}
          />
          <BoundaryCard
            variant="muted"
            title="What Beacon does not know"
            items={[
              "Whether a change caused a visibility shift (correlation only)",
              "Your actual market share across all AI queries",
              "Whether AI platforms have indexed your latest changes",
              "What AI models will say in future responses",
              "The business revenue impact of any change",
              "How representative your prompt sample is of real demand",
              "Whether a recommendation will produce the expected outcome",
              "Whether stored reviews are complete vs your profile on Google, Yelp, or elsewhere",
              "Platform review counts or ratings as they appear on Google/Yelp without a fresh import or sync into Beacon",
              "Automatic review ingestion, polling, or alert SLAs — v1 is manual import or on-demand Sync now only",
              "Full platform review coverage, even with connectors — APIs may exclude pending or filtered reviews",
            ]}
          />
        </div>
      </section>

      {/* ── Section 4: How to interpret recommendations ── */}
      <section id="recommendations" className="mb-12">
        <SectionHeading>How to interpret recommendations</SectionHeading>

        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p>
            Beacon surfaces the highest-leverage next step based on available evidence. The priority
            score blends impact confidence, evidence strength, pattern strength, replication
            potential, urgency, and recency into a composite. This score reflects input quality — not
            outcome certainty.
          </p>
          <div className="rounded-lg border border-border/50 bg-surface-inset/15 px-4 py-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">Key principles</p>
            <ul className="list-disc pl-5 space-y-1 text-[12px]">
              <li>
                <span className="font-medium text-foreground">Evidence ≠ guarantee.</span>{" "}
                &ldquo;Strong signal&rdquo; means the supporting data is solid. It does not promise
                the action will improve visibility.
              </li>
              <li>
                <span className="font-medium text-foreground">Patterns ≠ predictions.</span> A pattern
                that worked on one page may not work on another. Context, competition, and timing
                differ.
              </li>
              <li>
                <span className="font-medium text-foreground">Operator judgment required.</span> Beacon
                prioritizes based on data. You decide based on business context, feasibility, and
                strategic fit.
              </li>
              <li>
                <span className="font-medium text-foreground">Outcomes are not guaranteed.</span>{" "}
                AI visibility is probabilistic. The same prompt can produce different answers on
                different days.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Section 5: FAQ ── */}
      <section id="faq" className="mb-12">
        <SectionHeading>Frequently asked questions</SectionHeading>
        <div className="space-y-1">
          <FaqEntry
            question="How do you know this change caused anything?"
            answer="Beacon does not know that. It identifies the closest match — the best-fit match between a site change and a visibility shift based on timing, topic overlap, URL alignment, and platform. This is correlation, not causation. No A/B test or holdout exists. The operator can manually confirm a link in Review, which is the strongest trust signal — but is still a correlational judgment."
          />
          <FaqEntry
            question="Is &ldquo;Citation Share&rdquo; my actual market share?"
            answer="No. Citation Share is your share within Beacon's imported observation sample. No AI visibility tool can measure total market share because no one has access to all AI queries. The denominator (observation count) is always shown. The scope line reads: &ldquo;Directional — based on your tracked prompt sample, not a market census.&rdquo;"
          />
          <FaqEntry
            question="Why is Beacon recommending this if it cannot guarantee outcomes?"
            answer="Beacon recommends the highest-leverage next step based on available signals — not a guaranteed outcome. &ldquo;Strong signal&rdquo; means the input data is solid, not that the result is certain. The priority score blends impact confidence, signal strength, and pattern fit. It is a prioritized suggestion, not a guarantee."
          />
          <FaqEntry
            question="What does &ldquo;sample quality: limited&rdquo; mean?"
            answer="It means your observation count is below 200. At this level, percentages are volatile and competitive rankings are unreliable. Treat everything as a directional early signal, not a firm measurement. Import more data to move from limited to moderate or strong."
          />
          <FaqEntry
            question="What do Fresh, Aging, Stale, Critical, and Partial mean?"
            answer="They are coverage labels for Beacon&rsquo;s own inputs (crawl age, visibility freshness vs crawl when available, and observation count tier) — not grades for business performance. Partial means the observation sample is in the limited tier and overrides crawl-age labels. Critical means crawl data is missing when expected or much older than the stale threshold. See methodology → Coverage states (data freshness)."
          />
          <FaqEntry
            question="Does Beacon update continuously from Google, Yelp, or AI platforms?"
            answer="No. Visibility numbers come from imported observation rows and your last indexed crawl. Reviews enter Beacon only via manual import or on-demand connector Sync now. Labels refresh when those jobs complete — Beacon does not stream platform state."
          />
          <FaqEntry
            question="Does Beacon include every review from my Google or Yelp profile?"
            answer="No. Beacon shows review rows stored after import or sync. APIs may omit some reviews; timing differs from the consumer site; manual rows can coexist. Empty or partial data in Beacon does not prove you have no public reviews."
          />
          <FaqEntry
            question="What does &ldquo;Closest match&rdquo; actually mean?"
            answer="It means this change is the best-fit match for this visibility shift based on timing, topic overlap, URL alignment, and platform — scoring ≥70 out of 100. It does not mean Beacon proved causation. Other unmeasured factors could be the actual cause."
          />
          <FaqEntry
            question="How does Local presence get review counts and sentiment?"
            answer="From review rows stored in Beacon: manual CSV/JSON under Settings → Import (Local reviews), and/or optional on-demand pulls via the Google Business Profile and Yelp connectors (Settings → Connectors → Sync now). There is no automatic syncing. The &ldquo;mostly positive / mixed / concerning&rdquo; line uses average star rating across those stored rows only — not NLP on review text. Counts describe what is in Beacon, not a completeness claim against the platforms."
          />
          <FaqEntry
            question="What does the listing health score measure?"
            answer="It is a weighted completeness heuristic (0–100) based on how many identity fields you have configured (name, domain, phone, address) plus whether you have stored review rows, the average rating, and how fresh those observations are (manual import or connector sync). It does not compare you to competitors, does not verify your info against external directory UIs, and does not claim that a higher score improves ranking. The tier label (Weak / OK / Strong) is derived from the composite score."
          />
          <FaqEntry
            question="Why don&rsquo;t review counts match Google or Yelp?"
            answer="Beacon shows the rows stored after your last manual import or connector sync. Platforms change outside Beacon; APIs may omit some reviews; timing differs from what you see when browsing. A mismatch is expected and is not, by itself, a product defect — it reflects partial coverage, export or API limits, and when you last updated Beacon."
          />
          <FaqEntry
            question="Does Beacon sync reviews automatically?"
            answer="No. New or changed reviews enter Beacon only when you import a file (Settings → Import) or run Sync now on a connector (Settings → Connectors). There is no background schedule, polling, or SLA."
          />
          <FaqEntry
            question="Can Beacon respond to reviews for me?"
            answer="No. Beacon does not post replies, draft public responses, or integrate with platform reply APIs. Use Google Business Profile, Yelp, or your reputation tool for responses."
          />
          <FaqEntry
            question="Do reviews affect my rankings in Beacon?"
            answer="Beacon does not model or score &ldquo;review impact on ranking.&rdquo; It does not claim that reviews cause citation or AI visibility changes. Review metrics here are descriptive for stored rows only — not causal attribution."
          />
          <FaqEntry
            question="How often does Beacon sync reviews from Google or Yelp?"
            answer="Only when you press &ldquo;Sync now&rdquo; for that connector in Settings → Connectors. There is no automatic schedule. A future spec may add optional scheduled sync, but no cadence is promised and no SLA is implied."
          />
          <FaqEntry
            question="What does &ldquo;Last synced&rdquo; mean?"
            answer="For Google and Yelp, it is the per-source timestamp of the most recent successful connector pull into Beacon (see Local presence → Data freshness and methodology → Review source timestamps). Each source updates independently. It is not a guarantee that Beacon holds every review on the platform."
          />
          <FaqEntry
            question="Why don&rsquo;t my connector counts match what I see on Google or Yelp?"
            answer="Platform APIs may not expose all reviews. Google may exclude reviews pending moderation. Yelp may exclude &ldquo;not recommended&rdquo; reviews. Your Beacon store may also include manually imported rows from other time periods. Data may be incomplete or outdated. Mismatches are expected and are not a product defect."
          />
          <FaqEntry
            question="What happens if my Google or Yelp connection breaks?"
            answer="Beacon preserves the last successfully synced review rows. Local presence (/local) shows per-source Last synced or Never synced for each connector, and Settings → Connectors shows connection status. The Today local attention strip does not surface connector auth status directly — it uses combined review-age, NAP, and health signals with the standard based-on-imported-or-synced footnote. Reconnect in Settings → Connectors or keep using manual import. No data is lost."
          />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 pt-6 pb-4 text-[11px] text-muted-foreground space-y-2">
        <p>
          This page summarizes Beacon&rsquo;s methodology for the operator who needs to understand or
          defend a number. For daily workflow, see{" "}
          <Link href="/" className="text-accent-primary hover:underline">Today</Link>.
          For raw imported data, see{" "}
          <Link href="/settings/history" className="text-accent-primary hover:underline">Settings → Data</Link>.
          For listing + imported reviews framing, see{" "}
          <Link href="/local" className="text-accent-primary hover:underline">Local presence</Link>.
          For review monitoring boundaries, see{" "}
          <a href="#review-monitoring-v1" className="text-accent-primary hover:underline">
            Review monitoring (v1)
          </a>.
          For connector behavior and limits, see{" "}
          <a href="#review-connectors" className="text-accent-primary hover:underline">
            Review connectors (Google and Yelp)
          </a>
          ; for per-source timestamps, see{" "}
          <a href="#review-source-timestamps" className="text-accent-primary hover:underline">
            Review source timestamps
          </a>.
        </p>
        <p>
          Beacon identifies the strongest correlates, not proven causes — no A/B test or holdout
          exists. All percentages are share-of-sample, not share-of-market. Recommendations are
          prioritized suggestions; outcomes are not guaranteed.
        </p>
      </footer>
    </div>
  );
}

/* ─── Local helper components (page-scoped, no separate file needed) ─── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[15px] font-semibold tracking-tight text-foreground mb-4">
      {children}
    </h3>
  );
}

function MetricBlock({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-6 scroll-mt-20">
      <h4 className="text-[13px] font-semibold text-foreground mb-1">{title}</h4>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

function BoundaryCard({
  title,
  items,
  variant = "default",
}: {
  title: string;
  items: string[];
  variant?: "default" | "muted";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        variant === "muted"
          ? "border-status-warning/30 bg-status-warning/[0.04] sm:col-span-2"
          : "border-border/50 bg-surface-inset/15"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 mb-2">{title}</p>
      <ul className="list-disc pl-4 space-y-1 text-[12px] text-muted-foreground leading-relaxed">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FaqEntry({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-lg border border-border/50 bg-surface-inset/15 text-[12px]">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-foreground hover:bg-surface-inset/30 [&::-webkit-details-marker]:hidden">
        {question}
      </summary>
      <div className="border-t border-border/40 px-4 py-3 text-muted-foreground leading-relaxed">
        {answer}
      </div>
    </details>
  );
}
