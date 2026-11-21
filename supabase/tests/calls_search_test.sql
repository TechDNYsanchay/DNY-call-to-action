-- The Calls list's search by number (migration 20261121100000_call_number_search.sql, F26): only client and
-- vendor calls that are not deleted, newest first, at most 100 ids, and only for the secret key. Local stack only:
--   npx supabase db reset && npx supabase test db
-- One transaction, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into phone_lines (id, phone, callyzer_name, enabled, enabled_at, analyse_from) values
  ('00000000-0000-4000-8000-0000000005d1', '+919811100051', 'Search Line', true, now() - interval '30 days', now() - interval '30 days');

-- A promoted call with this number, type and state; returns its meeting id.
create function pg_temp.search_call(p_id text, p_number text, p_type meeting_type, p_ago interval,
                                    p_purged boolean default false) returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_e164, counterpart_masked, status)
  values (p_id, '00000000-0000-4000-8000-0000000005d1', 'incoming', now() - p_ago, 120, p_number, '+91 98••• ••456', 'promoted');
  insert into meetings (kind, callyzer_call_id, happened_at, duration_sec, type, type_source, process_status, source, raw)
  values ('call', p_id, now() - p_ago, 120, p_type, case when p_type = 'unknown' then null else 'llm'::type_source end,
          case when p_purged then 'skipped'::process_status when p_type = 'unknown' then 'ready'::process_status
               else 'done'::process_status end, 'poll', '{"source":"callyzer"}')
  returning id into v;
  update call_log set meeting_id = v where callyzer_id = p_id;
  insert into phone_calls (meeting_id, callyzer_call_id, line_id, direction, counterpart_masked, call_ended_at, seen_at,
                           purged_at, purged_by, skip_code)
  values (v, p_id, '00000000-0000-4000-8000-0000000005d1', 'incoming', '+91 98••• ••456', now() - p_ago + interval '2 minutes',
          now() - p_ago, case when p_purged then now() end, case when p_purged then 'routine' end,
          case when p_purged then 'personal' end);
  return v;
end $$;

select pg_temp.search_call('search-client-old', '+919820123456', 'client', interval '3 days');
select pg_temp.search_call('search-vendor-new', '+919820123456', 'vendor', interval '1 hour');
select pg_temp.search_call('search-undecided', '+919820123456', 'unknown', interval '2 hours');
select pg_temp.search_call('search-purged', '+919820123456', 'client', interval '4 hours', true);
select pg_temp.search_call('search-other', '+919900011122', 'client', interval '5 hours');
-- A regular vendor: more calls with one number than a search returns.
select pg_temp.search_call('search-bulk-' || g, '+919811122233', 'vendor', g * interval '1 minute') from generate_series(1, 105) g;

create function pg_temp.found(p_digits text, p_limit integer default 100) returns text[] language sql as $$
  select coalesce(array_agg(m.callyzer_call_id order by r.ord), '{}')
  from call_ids_by_digits(p_digits, p_limit) with ordinality as r(meeting_id, ord)
  join meetings m on m.id = r.meeting_id
$$;

select is(pg_temp.found('9820123456'), array['search-vendor-new', 'search-client-old'],
  'Number search: client and vendor calls only, newest first');
select is(pg_temp.found('0123456'), array['search-vendor-new', 'search-client-old'], 'Number search: 7 digits match inside the number');
select is(pg_temp.found('919820123456'), array['search-vendor-new', 'search-client-old'], 'Number search: the country code matches too');
select is(pg_temp.found('123456'), '{}'::text[], 'Number search: fewer than 7 digits find nothing');
select is(pg_temp.found('98201-23456'), '{}'::text[], 'Number search: anything but digits finds nothing');
select is(pg_temp.found('9820123456', 1), array['search-vendor-new'], 'Number search: the limit holds');
select is((select count(*)::int from call_ids_by_digits('9820123456', 5000)), 2, 'Number search: a large limit is accepted');
select is((select count(*)::int from call_ids_by_digits('9811122233', 5000)), 100, 'Number search: at most 100 ids, so the list''s URL stays short');
select is(has_function_privilege('authenticated', 'call_ids_by_digits(text, integer)', 'execute'), false,
  'Number search: signed-in people cannot call it (the ledger is secret)');
select is(has_function_privilege('anon', 'call_ids_by_digits(text, integer)', 'execute'), false, 'Number search: anon cannot call it');
select is(has_function_privilege('service_role', 'call_ids_by_digits(text, integer)', 'execute'), true, 'Number search: the secret key can');

select * from finish();
rollback;
