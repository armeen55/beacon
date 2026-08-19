-- 2026-08-19 RECONCILE RUNS STRANDED PAST A PHASE THAT MOVED.
--
-- `fact_check` moved ahead of every paid phase (run-status STEP_ORDER). The executor resumes a run from its
-- persisted `current_phase` and only ever moves FORWARD, so any run already past the phase's new position can
-- never reach it: on 2026-08-19 the live run sat at prompt_observations, and resuming it would have spent the
-- rest of the day on observations and skipped fact checking again (Codex, 2026-08-19).
--
-- This reconciles exactly those runs, ONCE, and nothing else. GENERIC for every tenant, never one run id.
-- NON-DESTRUCTIVE: the original phase and the original plan are preserved under `progress.phaseOrderRecovery`
-- before anything is rewritten, so what the run was doing stays readable. IDEMPOTENT: a run that already
-- carries the marker is skipped, and a reconciled run no longer matches the position filter either.
--
-- The recovery run's plan is SCOPED TO THE FACT CHECK ALONE. Everything else it owed stays owed: due-work
-- reopens the remaining observations on a later pass, on their own evidence, instead of riding this one.
update public.research_runs r
   set progress = jsonb_set(
         jsonb_set(coalesce(r.progress, '{}'::jsonb), '{phaseOrderRecovery}',
           jsonb_build_object(
             'originalPhase', to_jsonb(r.current_phase),
             'originalPlan', coalesce(r.progress -> 'plan', 'null'::jsonb),
             'at', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
             'why', to_jsonb('fact_check moved ahead of the paid phases and a run only moves forward'::text))),
         '{plan}', jsonb_build_object('units', jsonb_build_array('check_page_facts'))),
       current_phase = 'fact_check',
       phase_cursor = null,
       updated_at = now()
 where r.status in ('running', 'paused')
   and r.completed_at is null
   and r.progress -> 'plan' -> 'units' ? 'check_page_facts'   -- the pass was opened to check page facts
   and not (r.progress ? 'factCheck')                          -- and the phase never executed in it
   and not (r.progress ? 'phaseOrderRecovery')                 -- and it has not been reconciled already
   -- ...and it is stranded PAST the phase's new position.
   and r.current_phase = any (array['keyword_discovery', 'prompt_observations', 'serp_analysis',
                                    'winning_pages', 'publish_surface']);
