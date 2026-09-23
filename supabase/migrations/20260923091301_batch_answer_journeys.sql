-- One read returns each selected question's newest 40 stored answers. The lateral
-- limit is per prompt: a heavily sampled question cannot crowd out later cards.
create function public.read_answer_journeys_batch(
  p_tenant_id text, p_site text, p_prompt_ids text[]
)
returns table (
  prompt_id text, prompt_version integer, engine text, completed_at timestamptz,
  reporting_day date, answer_text text, journey jsonb
)
language plpgsql stable security invoker set search_path = ''
as $$
declare normalized_site text;
begin
  if p_tenant_id is null or btrim(p_tenant_id) = ''
    or p_site is null or btrim(p_site) = ''
    or p_prompt_ids is null or cardinality(p_prompt_ids) < 1 or cardinality(p_prompt_ids) > 20
    or exists (select 1 from unnest(p_prompt_ids) as x(id) where x.id is null or btrim(x.id) = '')
  then raise exception 'invalid answer journey batch scope or bounds' using errcode = '22023'; end if;
  normalized_site := lower(regexp_replace(p_site, '^www[.]', '', 'i'));
  return query
    select a.prompt_id, a.prompt_version, a.engine, a.completed_at,
      a.reporting_day, left(a.answer_text, 4000), a.journey
    from (select distinct x.id from unnest(p_prompt_ids) as x(id)) as selected
    cross join lateral (
      select o.prompt_id, o.prompt_version, o.engine, o.completed_at,
        o.reporting_day, o.answer_text, o.journey, o.id
      from public.ai_observations as o
      where o.tenant_id = p_tenant_id and lower(o.site) in (normalized_site, 'www.' || normalized_site)
        and o.prompt_id = selected.id and o.status = 'observed'
        and o.answer_text is not null and btrim(o.answer_text) <> ''
      order by o.completed_at desc nulls last, o.id desc
      limit 40
    ) as a
    order by a.prompt_id, a.completed_at desc nulls last, a.id desc;
end;
$$;

revoke execute on function public.read_answer_journeys_batch(text, text, text[]) from public, anon, authenticated;
grant execute on function public.read_answer_journeys_batch(text, text, text[]) to service_role;
