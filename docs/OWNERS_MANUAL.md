# BEACON OWNER'S MANUAL

You run this alone. No developers. This page is everything you need. If a screen ever disagrees
with this manual, trust the screen and its fix hint; the app self-diagnoses.

---

## ONE-TIME SETUP (do these once; the app tells you which are still missing)

1. **Map your Wix pages.** Go to Diagnostics > Wix and run the collection mapping. Right now the
   connection works but the page map is empty, so nothing can publish. This is the single biggest
   unlock. The nightly publish check will confirm with "Publishing is ready" once done.
2. **Publish the Google OAuth app.** In Google Cloud Console, move the OAuth consent screen from
   Testing to Published. Until then, Google sign-ins die every 7 days and you must reconnect
   Search Console and Analytics weekly. As of 2026-07-02 the Search Console connection is already
   past its window: reconnect it on Settings > Connections first.
3. **Set the warning email.** Add BEACON_DIGEST_TO (your email) and RESEND_API_KEY in Vercel env.
   With those set, Beacon emails you 2 days before a Google connection expires and sends the
   morning digest. Without them it can only show warnings in the app.
4. **Tell Bing about your changes.** On Settings > Connections, the Bing card gives you a key:
   create a text file named that key with the key inside, upload it to your site root, paste the
   key back. After that Beacon pings Bing automatically the moment any change goes live, which is
   what ChatGPT reads.
5. **Load your full search history.** On Settings > Connections, click "Load my full Search
   Console history." It pulls up to 16 months so seasonal patterns and year-over-year comparisons
   are real. It resumes by itself if interrupted.
6. **Set your revenue model.** In Settings, tell Beacon what a visit or conversion is worth so
   results read in dollars instead of clicks.

---

## DAILY (about 20 minutes)

1. Open the home page. Read the top: if there is a red "I paused myself" card, read why before
   anything else. If there is a connection warning, fix it first; everything else depends on data.
2. Read the standup: what changed overnight, any AI answers gained or lost, anything bleeding.
3. Review tonight's picks. Each card says what to change, why, what the team argued, and what it
   expects. Accept the ones you agree with. Skip freely; Beacon learns from your skips too.
4. If publishing is armed and mapped, accepted changes apply themselves and get verified. If not,
   each card gives you exact paste-ready text and where to put it.
5. Done. Beacon measures everything it shipped, on its own clock, and reports verdicts when the
   data has actually matured. Do not judge a change in its first week; Beacon will not either.

## WEEKLY (10 minutes, any day)

- Open Results. Read Wins, Learning, and In flight. The "we got this wrong" lines are honest;
  they are how the system improves.
- Open Competitors once a week: the "sources AI already trusts" list and any displacement cards
  tell you where the outside world moved.
- Glance at Settings > Connections: every job should say it ran. Three failed nights in a row
  files a fix card automatically.

## MONTHLY (15 minutes)

- Read the monthly report page when it exists (until then, Results is the report).
- Check spend: every paid call is capped and logged; the caps fail closed, so a surprise bill is
  not possible, but the ledgers are yours to read.
- Skim the proof ledger and pick one win to double down on and one loser to let the system retire.

---

## THE SCREENS

- **Today (home):** the war room. Standup, tonight's picks, the scoreboard, alerts. Start here.
- **Worklist:** every prepared move ranked, with evidence, drafts, and one-click apply where
  publishing is mapped.
- **Results (Proof):** every shipped change with its honest verdict: won, lost, mixed, or still
  measuring, and the math behind it if you want it.
- **Competitors:** who beats you on Google and in AI answers, the exact passages that beat you,
  and who AI already trusts.
- **AI Answers (Prompts):** how ChatGPT, Perplexity, Gemini and friends answer your buyers'
  questions, whether you are mentioned, and your weekly share per engine.
- **Settings > Connections:** every data source, every nightly job, publishing readiness, and the
  one-click reconnects.
- **Diagnostics:** the deep tools: Wix mapping, page quotability, crawl checks. Visit when a fix
  hint sends you there.

---

## WHEN SOMETHING LOOKS WRONG

- Every failure Beacon knows about becomes a card with the exact fix and a link. Check Today and
  Settings > Connections before assuming the worst.
- A quiet dashboard usually means a dead Google connection. Reconnect on Settings > Connections;
  data resumes the next night and backfills the gap.
- If a shipped change made things worse, Beacon proposes the revert; two bad batches in a row and
  it pauses itself and tells you.
- Nothing Beacon does is irreversible: every publish snapshots the page first and can be rolled
  back from the change's card.

## WHAT BEACON WILL NOT DO

- It never publishes without your approval unless you armed a lever class yourself, and even then
  only proven levers, capped per week, all reversible.
- It never invents numbers: every figure on every card traces to a real source you can click.
- It says "I do not know enough yet" instead of guessing. Trust that sentence; it is the product
  working, not failing.
