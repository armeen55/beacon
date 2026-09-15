-- 2026-09-15: delete the legacy substrate (operator-approved 2026-09-14, "delete anything"). Every table below is
-- named by no production source string (checked over src on commit 44bce0a4) and by no live RPC the app calls.
-- Profound, SEMrush, Wix, page surgeon, push, daily experiment, outreach, retrieval, the pre-canonical AI answer
-- projection, the v1 outcomes and the two audit snapshots leave with their dead functions. Data is not preserved.
drop function if exists public.push_cap_reserve(text, date, int, text, text, text, text);
drop function if exists public.accept_daily_experiment_plan(text, text, text, text, jsonb, timestamptz);
drop function if exists public.activate_daily_experiment_item(text, text, text, jsonb, jsonb, text, timestamptz);
drop function if exists public.skip_daily_experiment_item(text, text, text, text, text, timestamptz);
drop function if exists public.refresh_gsc_month(text, date);
drop function if exists public.ga4_monthly_sessions_v1(text, date);
drop function if exists public.gsc_cannibalization_v1(text, date, int);
drop function if exists public.stamp_change_queue(text, text, text[], text[]);
drop table if exists
  public._bundlefix_snapshot, public._fable_ready_snapshot,
  public.profound_answer_rows, public.profound_bot_rows, public.profound_citation_rows, public.profound_prompt_rows,
  public.profound_query_fanout_rows, public.profound_referral_rows, public.profound_visibility_rows,
  public.semrush_domain_metrics, public.semrush_keyword_expansions, public.semrush_keyword_gaps,
  public.semrush_organic_keywords, public.semrush_pull_receipts,
  public.wix_collection_config, public.wix_publishing_mode, public.wix_url_map,
  public.page_surgeon_brief_history, public.page_surgeon_briefs, public.page_surgeon_review_decisions,
  public.cron_runs, public.outreach_pipeline, public.daily_experiment_plans, public.control_reservations,
  public.retrieval_chunks, public.push_ledger, public.push_snapshots, public.opportunity_dismissals,
  public.competitor_page_audit, public.global_patterns, public.raw_poll_chunks, public.prompt_answer_observations,
  public.attribution_decisions, public.candidate_links, public.change_outcomes, public.change_outcomes_v2,
  public.competitor_config, public.guardrail_alerts, public.page_issues, public.page_visibility,
  public.url_change_outcomes, public.call_url_attribution, public.ga4_ai_referral_daily, public.ga4_daily_totals,
  public.ga4_monthly_reconciliation, public.gsc_monthly_archive
  cascade;
