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
   and r.progress -> 'plan' -> 'units' ? 'check_page_facts'
   and not (r.progress ? 'factCheck')
   and not (r.progress ? 'phaseOrderRecovery')
   and r.current_phase = any (array['keyword_discovery', 'prompt_observations', 'serp_analysis',
                                    'winning_pages', 'publish_surface']);;
