-- Phone calls from Callyzer (migrations 20261120100000_meeting_type_vendor.sql and 20261120100100_callyzer_calls.sql):
-- the schema, every function (F1-F23 in the design) and the grants. Local stack only:
--   npx supabase db reset && npx supabase test db
-- Everything runs in one transaction that is rolled back, so now() is one fixed instant: "older" rows are
-- written with timestamps in the past instead of waiting.
begin;
create extension if not exists pgtap with schema extensions;
select plan(189);

-- Fixtures --------------------------------------------------------------------------------------------------
insert into people (id, full_name, email, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Ashwini Bhambani', 'ashwini.test@dnyhospitality.com', 'member'),
  ('00000000-0000-4000-8000-0000000000a2', 'Keyur Shah', 'keyur.test@dnyhospitality.com', 'member'),
  ('00000000-0000-4000-8000-0000000000a3', 'Asha Admin', 'admin.test@dnyhospitality.com', 'admin'),
  ('00000000-0000-4000-8000-0000000000a4', 'Om Member', 'member.test@dnyhospitality.com', 'member');
insert into clients (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Cafe 89');
-- Line 1 is analysed from a fixed date (the storage path test uses a call of 19 Nov 2026); line 2 from a week ago.
insert into phone_lines (id, phone, callyzer_name, label, enabled, enabled_at, analyse_from) values
  ('00000000-0000-4000-8000-0000000000d1', '+919811100001', 'Line One', null, true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d2', '+919811100002', 'Line Two', 'Two', true, now() - interval '7 days', now() - interval '7 days'),
  ('00000000-0000-4000-8000-0000000000d3', '+919811100003', 'Line Off', null, false, null, null);
insert into phone_line_members (line_id, person_id) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1');

create function pg_temp.line(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000000d' || n)::uuid
$$;

-- A candidate as upsert_call_log takes it.
create function pg_temp.ledger(p_id text, p_line uuid, p_started timestamptz, p_url text default null,
                               p_name text default 'Rakesh Cafe 89', p_duration integer default 120)
returns jsonb language sql as $$
  select jsonb_build_object('callyzer_id', p_id, 'line_id', p_line, 'direction', 'incoming', 'call_started_at', p_started,
                            'duration_sec', p_duration, 'counterpart_e164', '+919876543210',
                            'counterpart_masked', '+91 98••• ••210', 'counterpart_name', p_name, 'recording_url', p_url)
$$;

-- A call as promote_call leaves it (promoted ledger row, meetings row, phone_calls row), in any state.
create function pg_temp.new_call(p_id text, p_line uuid, p_status process_status default 'ready', p_type meeting_type default 'unknown',
                             p_started timestamptz default now() - interval '1 hour', p_stt text default 'done',
                             p_name text default 'Rakesh Cafe 89', p_updated_ago interval default '0 seconds')
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_e164, counterpart_masked,
                        counterpart_name, status, storage_path)
  values (p_id, p_line, 'incoming', p_started, 120, '+919876543210', '+91 98••• ••210', p_name, 'promoted', 'calls/test/' || p_id);
  insert into meetings (kind, callyzer_call_id, happened_at, duration_sec, type, type_source, process_status, source, raw,
                        transcript_ready, updated_at)
  values ('call', p_id, p_started, 120, p_type, case when p_type = 'unknown' then null else 'llm'::type_source end, p_status,
          'poll', '{"source":"callyzer"}', p_status in ('ready', 'processing', 'needs_decision', 'done'), now() - p_updated_ago)
  returning id into v;
  update call_log set meeting_id = v where callyzer_id = p_id;
  insert into phone_calls (meeting_id, callyzer_call_id, line_id, direction, counterpart_masked, recording_path, recording_mime,
                           recording_bytes, stt_status, call_ended_at, seen_at)
  values (v, p_id, p_line, 'incoming', '+91 98••• ••210', 'calls/test/' || p_id, 'audio/mpeg', 200000, p_stt,
          p_started + interval '2 minutes', p_started);
  return v;
end $$;

create function pg_temp.mid(p_id text) returns uuid language sql stable as $$
  select id from meetings where callyzer_call_id = p_id
$$;

create function pg_temp.turns(p_words integer) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('speaker', 'Speaker 1', 'startSec', 0.5, 'endSec', 140.5,
                                              'text', btrim(repeat('shabd ', p_words))))
$$;

-- 1. Schema ---------------------------------------------------------------------------------------------------
select throws_ok($$insert into meetings (kind, happened_at) values ('call', now())$$, '23514', null,
  'Schema: a call needs its Callyzer id');
select throws_ok($$insert into meetings (kind, tldv_meeting_id, callyzer_call_id, happened_at) values ('meeting', 'tl-1', 'cz-1', now())$$,
  '23514', null, 'Schema: a tl;dv meeting cannot carry a Callyzer id');
select is(enum_range(null::meeting_type)::text, '{client,sales,internal,vendor,other,unknown}', 'Schema: vendor sits after internal');
select is(has_column_privilege('authenticated', 'public.phone_lines', 'phone', 'select'), false, 'Schema: members never read a line''s number');
select is(has_column_privilege('authenticated', 'public.phone_lines', 'label', 'select'), true, 'Schema: members read a line''s label');
select is((select public from storage.buckets where id = 'call-recordings'), false, 'Schema: the audio bucket is private');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and ((coalesce(qual, '') || coalesce(with_check, '')) like '%call-recordings%'
                  or (coalesce(qual, '') || coalesce(with_check, '')) not like '%bucket_id%')), 0,
  'Schema: no storage policy opens the audio bucket or every bucket');

-- 2. F3 register_phone_lines ----------------------------------------------------------------------------------
select lives_ok($$create temp table t_lines as select * from register_phone_lines(jsonb_build_array(
    jsonb_build_object('phone', '+919820000001', 'name', '  ashwini   BHAMBANI ', 'last_call_at', '2026-11-19T08:36:00Z'),
    jsonb_build_object('phone', '+919820000003', 'name', 'support', 'last_call_at', '2026-11-19T09:40:00Z'),
    jsonb_build_object('phone', '+919820000003', 'name', 'support', 'last_call_at', '2026-11-19T09:00:00Z'),
    jsonb_build_object('phone', '+919820000002', 'name', 'keyur dny supply chain', 'last_call_at', null),
    jsonb_build_object('phone', '1503', 'name', 'short code')))$$,
  'F3: a number twice in one batch does not error');
select is((select count(*)::int from t_lines where created), 3, 'F3: three new lines; a number that is not E.164 is ignored');
select ok((select enabled and enabled_at = analyse_from and analyse_from between now() - interval '1 second' and now() + interval '1 second'
           from phone_lines where phone = '+919820000001'),
  'F3: an initial line (case and spacing ignored) starts on, analysed from this moment');
select ok((select enabled from phone_lines where phone = '+919820000002'), 'F3: keyur dny supply chain starts on');
select is((select enabled from phone_lines where phone = '+919820000003'), false, 'F3: support stays off');
select is((select last_call_at from phone_lines where phone = '+919820000003'), '2026-11-19T09:40:00Z'::timestamptz,
  'F3: the latest call of a number given twice wins');
update phone_lines set enabled = false where phone = '+919820000002';
-- now() is fixed in this transaction: move the switch-on into the past, so a rewrite of it would show.
update phone_lines set analyse_from = now() - interval '2 days', enabled_at = now() - interval '2 days'
where phone = '+919820000001';
select results_eq(
  $$select phone, created, enabled from register_phone_lines(jsonb_build_array(
      jsonb_build_object('phone', '+919820000001', 'name', 'Ashwini B', 'last_call_at', '2026-11-19T10:00:00Z'),
      jsonb_build_object('phone', '+919820000002', 'name', 'keyur dny supply chain', 'last_call_at', '2026-11-19T10:05:00Z')))
    order by phone$$,
  $$values ('+919820000001'::text, false, true), ('+919820000002'::text, false, false)$$,
  'F3: known lines are not created again, and an admin''s off switch survives');
select ok((select callyzer_name = 'Ashwini B' and last_call_at = '2026-11-19T10:00:00Z' and enabled
                  and analyse_from = now() - interval '2 days' and enabled_at = now() - interval '2 days'
           from phone_lines where phone = '+919820000001'),
  'F3: a known line only gets its new name and later call');
select is((select count(*)::int from register_phone_lines(jsonb_build_array(
             jsonb_build_object('phone', '+919820000001', 'name', 'Ashwini B', 'last_call_at', '2026-11-19T09:00:00Z')))), 0,
  'F3: nothing new, nothing written');
select is((select callyzer_name from register_phone_lines(jsonb_build_array(
             jsonb_build_object('phone', '+919820000009', 'name', '  ', 'last_call_at', '2026-11-19T09:00:00Z')))),
  'Phone ending 009', 'F3: a line sent without a name is named by its last digits, never by its number');
do $$ begin
  perform register_phone_lines(jsonb_build_array(
    jsonb_build_object('phone', '+919820000001', 'name', 'Ashwini B', 'last_call_at', '2026-11-19T10:10:00Z'),
    jsonb_build_object('phone', '+919820000001', 'name', '', 'last_call_at', '2026-11-19T10:20:00Z')));
end $$;
select ok((select callyzer_name = 'Ashwini B' and last_call_at = '2026-11-19T10:20:00Z' from phone_lines where phone = '+919820000001'),
  'F3: a nameless latest row keeps the line''s name and moves its last call');
do $$ begin
  perform register_phone_lines(jsonb_build_array(
    jsonb_build_object('phone', '+919820000001', 'name', '+91 98200 00001', 'last_call_at', '2026-11-19T10:30:00Z')));
end $$;
select ok((select callyzer_name = 'Ashwini B' and last_call_at = '2026-11-19T10:30:00Z' from phone_lines where phone = '+919820000001'),
  'F3: a batch without a real name never replaces the name a line has');
do $$ begin
  perform register_phone_lines(jsonb_build_array(
    jsonb_build_object('phone', '+919820000004', 'name', 'Ashwini Bhambani', 'last_call_at', '2026-11-19T09:00:00Z'),
    jsonb_build_object('phone', '+919820000004', 'name', null, 'last_call_at', '2026-11-19T09:30:00Z')));
end $$;
select ok((select callyzer_name = 'Ashwini Bhambani' and enabled and last_call_at = '2026-11-19T09:30:00Z'
           from phone_lines where phone = '+919820000004'),
  'F3: a new line takes the latest name sent for it, so an initial line still starts on');
select results_eq(
  $$select phone, callyzer_name from register_phone_lines(jsonb_build_array(
      jsonb_build_object('phone', '+919811100010', 'name', '+91 98111 00010', 'last_call_at', '2026-11-19T09:00:00Z'),
      jsonb_build_object('phone', '+919820000006', 'name', 'keyur 9820000002', 'last_call_at', '2026-11-19T09:00:00Z'),
      jsonb_build_object('phone', '+919820000007', 'name', '9820000007', 'last_call_at', '2026-11-19T09:00:00Z')))
    order by phone$$,
  $$values ('+919811100010'::text, 'Phone ending 010'::text), ('+919820000006', 'keyur'), ('+919820000007', 'Phone ending 007')$$,
  'F3: a phone number in a line''s name is removed; a name that is only a number becomes the last digits');

-- 3. F4 upsert_call_log -----------------------------------------------------------------------------------
select results_eq(
  $$select callyzer_id, status, inserted from upsert_call_log(jsonb_build_array(
      pg_temp.ledger('s3-wait', pg_temp.line(1), now() - interval '2 hours'),
      pg_temp.ledger('s3-pend', pg_temp.line(1), now() - interval '2 hours', 'https://media1.callyzer.co/s3-pend.mp3'),
      pg_temp.ledger('s3-pend', pg_temp.line(1), now() - interval '2 hours', 'https://media1.callyzer.co/s3-pend.mp3')))
    order by 1$$,
  $$values ('s3-pend'::text, 'pending'::text, true), ('s3-wait', 'waiting', true)$$,
  'F4: new calls are waiting without a link and pending with one');
select results_eq(
  $$select callyzer_id, status, inserted from upsert_call_log(jsonb_build_array(
      pg_temp.ledger('s3-wait', pg_temp.line(1), now() - interval '2 hours', 'https://media1.callyzer.co/s3-wait.mp3')))$$,
  $$values ('s3-wait'::text, 'pending'::text, false)$$,
  'F4: a link moves a waiting call to pending');
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, status)
values ('s3-norec', pg_temp.line(1), 'incoming', now() - interval '40 hours', 120, 'Hidden number', 'no_recording');
do $$ begin
  perform upsert_call_log(jsonb_build_array(pg_temp.ledger('s3-norec', pg_temp.line(1), now() - interval '40 hours', 'https://media1.callyzer.co/s3-norec.mp3')));
end $$;
select is((select status from call_log where callyzer_id = 's3-norec'), 'pending', 'F4: a link revives a call that had none');
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, counterpart_name, status)
values ('s3-prom', pg_temp.line(1), 'incoming', now() - interval '3 hours', 120, '+91 98••• ••210', 'Old Name', 'promoted');
select is((select count(*)::int from upsert_call_log(jsonb_build_array(
             pg_temp.ledger('s3-prom', pg_temp.line(1), now() - interval '3 hours', 'https://media1.callyzer.co/new.mp3', 'New Name')))), 0,
  'F4: nothing is returned for a promoted call');
select ok((select status = 'promoted' and counterpart_name = 'Old Name' and recording_url is null from call_log where callyzer_id = 's3-prom'),
  'F4: a promoted call is never touched');
insert into meetings (kind, callyzer_call_id, happened_at, process_status, source) values ('call', 's3-known', now() - interval '1 day', 'done', 'poll');
select ok((select count(*) = 0 from upsert_call_log(jsonb_build_array(
             pg_temp.ledger('s3-known', pg_temp.line(1), now() - interval '1 day', 'https://media1.callyzer.co/known.mp3'))))
          and not exists (select 1 from call_log where callyzer_id = 's3-known'),
  'F4: a call that already has a meetings row is never ingested again');
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, counterpart_name, recording_url,
                      status, attempts, first_error_at)
values ('s3-fail', pg_temp.line(1), 'incoming', now() - interval '5 hours', 120, '+91 98••• ••210', 'Rakesh Cafe 89',
        'https://media1.callyzer.co/f1.mp3', 'failed', 3, now() - interval '25 hours');
do $$ begin
  perform upsert_call_log(jsonb_build_array(pg_temp.ledger('s3-fail', pg_temp.line(1), now() - interval '5 hours', 'https://media1.callyzer.co/f1.mp3')));
end $$;
select is((select status from call_log where callyzer_id = 's3-fail'), 'failed', 'F4: a failed call stays failed on the same link');
do $$ begin
  perform upsert_call_log(jsonb_build_array(pg_temp.ledger('s3-fail', pg_temp.line(1), now() - interval '5 hours', 'https://media1.callyzer.co/f2.mp3')));
end $$;
select ok((select status = 'pending' and attempts = 0 and first_error_at is null and recording_url = 'https://media1.callyzer.co/f2.mp3'
           from call_log where callyzer_id = 's3-fail'),
  'F4: a failed call reopens on a different link, its attempts reset');

-- 4. F6 claim_call_work (and F7 between two leases) -------------------------------------------------------------
delete from call_log where meeting_id is null;
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, recording_url, status) values
  ('s4-old', pg_temp.line(1), 'incoming', now() - interval '3 hours', 120, 'x', 'https://media1.callyzer.co/s4-old.mp3', 'pending'),
  ('s4-new', pg_temp.line(1), 'incoming', now() - interval '1 hour', 120, 'x', 'https://media1.callyzer.co/s4-new.mp3', 'pending'),
  ('s4-off', pg_temp.line(3), 'incoming', now() - interval '30 minutes', 120, 'x', 'https://media1.callyzer.co/s4-off.mp3', 'pending'),
  ('s4-before', pg_temp.line(2), 'incoming', now() - interval '8 days', 120, 'x', 'https://media1.callyzer.co/s4-before.mp3', 'pending');
select pg_temp.new_call('s4-stt', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '20 minutes', 'pending');
create temp table t_claim1 as select * from claim_call_work(15, 3, 240, true);
select results_eq($$select work, callyzer_id from t_claim1$$, $$values ('copy'::text, 's4-new'::text)$$,
  'F6: copies come before transcriptions, newest first');
select ok((select storage_path ~ '^calls/\d{4}/\d{2}/[0-9a-f]{32}-[0-9a-f]{8}$' and attempt = 1
                  and recording_url = 'https://media1.callyzer.co/s4-new.mp3' and meeting_id is null from t_claim1),
  'F6: a copy lease gives the link, a fresh storage path and the attempt');
select ok((select bool_and(status = 'dropped' and recording_url is null) from call_log where callyzer_id in ('s4-off', 's4-before')),
  'F6: calls on a line that is off, or from before its switch-on, are dropped and never copied');
create temp table t_claim2 as select * from claim_call_work(15, 3, 240, false);
select results_eq($$select work, callyzer_id from t_claim2$$, $$values ('copy'::text, 's4-old'::text)$$, 'F6: then the older copy');
select is((select count(*)::int from claim_call_work(15, 3, 240, false)), 0, 'F6: with transcription off, nothing else is handed out');
create temp table t_claim3 as select * from claim_call_work(15, 3, 240, true);
select results_eq($$select work, meeting_id from t_claim3$$, $$select 'transcribe'::text, pg_temp.mid('s4-stt')$$,
  'F6: then a stored recording waiting for its transcript');
select ok((select stt_status = 'running' and stt_attempts = 1 and stt_started_at = now() from phone_calls where meeting_id = pg_temp.mid('s4-stt'))
          and (select count(*) = 1 from call_stt_usage where meeting_id = pg_temp.mid('s4-stt') and outcome = 'running' and reserved_sec = 120),
  'F6: the transcription lease reserves the call''s minutes');
select pg_temp.new_call('s4-cap', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '25 minutes', 'pending');
insert into call_stt_usage (meeting_id, reserved_sec) values (null, 240 * 60);
select results_eq($$select work, meeting_id from claim_call_work(15, 3, 240, true)$$, $$select 'cap'::text, pg_temp.mid('s4-cap')$$,
  'F6: past the daily cap it answers cap instead of a transcription');
select is((select stt_status from phone_calls where meeting_id = pg_temp.mid('s4-cap')), 'pending', 'F6: a call over the cap stays pending');
delete from call_stt_usage;

insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, recording_url, status)
values ('test-call-1', pg_temp.line(1), 'incoming', '2026-11-19T14:06:00+05:30', 120, 'x', 'https://media1.callyzer.co/t1.mp3', 'pending');
create temp table t_path1 as select * from claim_call_work(15, 3, 240, false);
select ok((select callyzer_id = 'test-call-1' and storage_path ~ '^calls/2026/11/788f87f29c369a08e4490c0c165666df-[0-9a-f]{8}$' from t_path1),
  'F6: the path is the IST month and the hash storagePathPrefix() computes, plus 8 random hex digits');
select is(finish_call_copy('test-call-1', 'content', 'HTTP 404', 'http'), 'retry', 'F7: a content error is retried later');
update call_log set next_try_at = null where callyzer_id = 'test-call-1';
create temp table t_path2 as select * from claim_call_work(15, 3, 240, false);
select ok((select t2.callyzer_id = 'test-call-1' and t2.storage_path <> t1.storage_path and t2.attempt = 2 from t_path1 t1, t_path2 t2),
  'F6: a second lease gets a new path');
select ok(exists (select 1 from storage_deletions d join t_path1 t on t.storage_path = d.path where d.reason = 'copy_abandoned'),
  'F6: the first lease''s path is queued for deletion and never reused');

insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, recording_url, status, attempts,
                      started_at, storage_path) values
  ('s4-stale1', pg_temp.line(1), 'incoming', now() - interval '6 hours', 120, 'x', 'https://media1.callyzer.co/st1.mp3', 'running', 1,
   now() - interval '20 minutes', 'calls/2026/11/stale-1'),
  ('s4-stale3', pg_temp.line(1), 'incoming', now() - interval '7 hours', 120, 'x', 'https://media1.callyzer.co/st3.mp3', 'running', 3,
   now() - interval '20 minutes', 'calls/2026/11/stale-3');
select pg_temp.new_call('s4-stt3', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '2 hours', 'running');
update phone_calls set stt_attempts = 3, stt_started_at = now() - interval '20 minutes' where meeting_id = pg_temp.mid('s4-stt3');
create temp table t_stale as select * from claim_call_work(15, 3, 240, false);
select ok((select status = 'failed' and error_kind = 'stalled' and started_at is null from call_log where callyzer_id = 's4-stale3')
          and exists (select 1 from storage_deletions where path = 'calls/2026/11/stale-3' and reason = 'copy_abandoned'),
  'F6: a copy lease a stopped run left at 3 attempts fails, and its object is queued');
select ok((select callyzer_id = 's4-stale1' and attempt = 2 and storage_path <> 'calls/2026/11/stale-1' from t_stale)
          and exists (select 1 from storage_deletions where path = 'calls/2026/11/stale-1'),
  'F6: a lease a stopped run left with attempts to spare is freed and leased again on a new path');
select ok((select stt_status = 'failed' and stt_error_kind = 'stalled' from phone_calls where meeting_id = pg_temp.mid('s4-stt3'))
          and (select process_status = 'failed' and failure_reason = 'Transcription stopped responding after 3 attempts.'
               from meetings where id = pg_temp.mid('s4-stt3')),
  'F6: a transcription left running at 3 attempts fails the call');

-- 5. F7 finish_call_copy --------------------------------------------------------------------------------------
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, recording_url, status, attempts,
                      started_at, storage_path) values
  ('s5-empty', pg_temp.line(1), 'incoming', now() - interval '9 hours', 60, 'x', 'https://media1.callyzer.co/e.mp3', 'running', 1, now(), 'calls/2026/11/s5-empty'),
  ('s5-trans', pg_temp.line(1), 'incoming', now() - interval '9 hours', 60, 'x', 'https://media1.callyzer.co/t.mp3', 'running', 1, now(), 'calls/2026/11/s5-trans'),
  ('s5-content', pg_temp.line(1), 'incoming', now() - interval '9 hours', 60, 'x', 'https://media1.callyzer.co/c.mp3', 'running', 1, now(), 'calls/2026/11/s5-content'),
  ('s5-large', pg_temp.line(1), 'incoming', now() - interval '9 hours', 60, 'x', 'https://media1.callyzer.co/l.mp3', 'running', 1, now(), 'calls/2026/11/s5-large'),
  ('s5-pending', pg_temp.line(1), 'incoming', now() - interval '9 hours', 60, 'x', 'https://media1.callyzer.co/p.mp3', 'pending', 0, null, null);
select is(finish_call_copy('s5-empty', 'empty', null, null, 3000), 'empty', 'F7: a stub ends as empty');
select ok((select status = 'empty' and recording_url is null and bytes = 3000 and started_at is null from call_log where callyzer_id = 's5-empty'),
  'F7: an empty recording loses its link and keeps its size');
select is(finish_call_copy('s5-trans', 'transient', 'timeout', 'timeout'), 'retry', 'F7: a host error is retried');
select ok((select status = 'pending' and attempts = 0 and next_try_at >= now() + interval '5 minutes' and first_error_at = now()
           from call_log where callyzer_id = 's5-trans'),
  'F7: a transient error gives the attempt back and waits at least 5 minutes');
select is(finish_call_copy('s5-content', 'content', 'HTTP 404', 'http'), 'retry', 'F7: the first content error is retried in 10 minutes');
update call_log set status = 'running', attempts = 2 where callyzer_id = 's5-content';
do $$ begin perform finish_call_copy('s5-content', 'content', 'HTTP 404', 'http'); end $$;
update call_log set status = 'running', attempts = 3 where callyzer_id = 's5-content';
select is(finish_call_copy('s5-content', 'content', 'HTTP 404', 'http'), 'failed', 'F7: the third content error fails the copy');
select ok(exists (select 1 from storage_deletions where path = 'calls/2026/11/s5-content' and reason = 'copy_abandoned'),
  'F7: a failed copy queues its object (an upload may have happened)');
select is(finish_call_copy('s5-large', 'too_large', 'over 50 MB', 'too_large'), 'failed', 'F7: a file over 50 MB fails at once');
select is(finish_call_copy('s5-pending', 'transient'), 'pending', 'F7: a row that is not running is left alone');
select throws_ok($$select finish_call_copy('s5-pending', 'oops')$$, 'P0001', 'unknown outcome oops', 'F7: unknown outcomes are refused');

-- 6. F8 promote_call ------------------------------------------------------------------------------------------
delete from call_stt_usage;
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, recording_url, status, attempts,
                      started_at, storage_path) values
  ('s6-one', pg_temp.line(1), 'incoming', now() - interval '1 hour', 125, '+91 98••• ••210', 'https://media1.callyzer.co/s6-one.mp3', 'running', 1, now(), 'calls/2026/11/s6-one-aaaaaaaa'),
  ('s6-two', pg_temp.line(2), 'outgoing', now() - interval '1 hour', 125, '+91 98••• ••210', 'https://media1.callyzer.co/s6-two.mp3', 'running', 1, now(), 'calls/2026/11/s6-two-aaaaaaaa'),
  ('s6-off', pg_temp.line(3), 'incoming', now() - interval '1 hour', 125, '+91 98••• ••210', 'https://media1.callyzer.co/s6-off.mp3', 'running', 1, now(), 'calls/2026/11/s6-off-aaaaaaaa');
create temp table t_promote as select * from promote_call('s6-one', 'calls/2026/11/s6-one-aaaaaaaa', 'audio/mpeg', 200000, true, 240, true);
select results_eq($$select outcome from t_promote$$, $$values ('transcribe'::text)$$, 'F8: under the cap the worker transcribes at once');
select ok((select kind = 'call' and process_status = 'waiting_transcript' and type = 'unknown' and tldv_meeting_id is null
                  and organizer_name = 'Ashwini Bhambani' and organizer_email = 'ashwini.test@dnyhospitality.com' and duration_sec = 125
                  and raw = '{"source":"callyzer"}'::jsonb
           from meetings where id = (select meeting_id from t_promote)),
  'F8: the call is a meetings row, organised by the line''s sole person');
select ok((select stt_status = 'running' and stt_attempts = 1 and recording_path = 'calls/2026/11/s6-one-aaaaaaaa'
                  and recording_status = 'stored' and direction = 'incoming' and counterpart_masked = '+91 98••• ••210'
           from phone_calls where meeting_id = (select meeting_id from t_promote))
          and (select count(*) = 1 from call_stt_usage where meeting_id = (select meeting_id from t_promote)),
  'F8: phone_calls holds the transcription lease, with one reservation');
select ok((select status = 'promoted' and recording_url is null and meeting_id = (select meeting_id from t_promote)
           from call_log where callyzer_id = 's6-one'),
  'F8: the ledger row is promoted and loses its link');
insert into call_stt_usage (meeting_id, reserved_sec) values (null, 240 * 60);
select results_eq($$select outcome from promote_call('s6-two', 'calls/2026/11/s6-two-aaaaaaaa', 'audio/mpeg', 200000, true, 240, true)$$,
  $$values ('wait'::text)$$, 'F8: over the cap the call waits');
select ok((select p.stt_status = 'pending' and p.stt_attempts = 0 and m.organizer_name = 'Two' and m.organizer_email is null
           from phone_calls p join meetings m on m.id = p.meeting_id where p.callyzer_call_id = 's6-two'),
  'F8: a waiting call is pending, organised by the line''s label when nobody is set');
select results_eq($$select meeting_id, outcome from promote_call('s6-off', 'calls/2026/11/s6-off-aaaaaaaa', 'audio/mpeg', 200000, true, 240, true)$$,
  $$values (null::uuid, 'dropped'::text)$$, 'F8: a line switched off meanwhile drops the copy');
select ok((select status = 'dropped' and recording_url is null from call_log where callyzer_id = 's6-off')
          and not exists (select 1 from meetings where callyzer_call_id = 's6-off')
          and exists (select 1 from storage_deletions where path = 'calls/2026/11/s6-off-aaaaaaaa' and reason = 'line_off'),
  'F8: no call is created and the uploaded object is queued');
select results_eq($$select meeting_id, outcome from promote_call('s6-one', 'calls/2026/11/s6-one-aaaaaaaa', 'audio/mpeg', 200000, true, 240, true)$$,
  $$select meeting_id, 'wait'::text from t_promote$$, 'F8: promoting twice returns the same call');
delete from call_stt_usage;

-- 7. F9 finish_call_transcription ------------------------------------------------------------------------------
select pg_temp.new_call('s7-auth', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running', 'Rakesh Cafe 89', interval '1 hour');
update phone_calls set stt_attempts = 1, stt_started_at = now() where meeting_id = pg_temp.mid('s7-auth');
insert into call_stt_usage (meeting_id, reserved_sec) values (pg_temp.mid('s7-auth'), 120);
select is(finish_call_transcription(pg_temp.mid('s7-auth'), 'not_billed', 'HTTP 401', 'auth'), 'retry', 'F9: a refused key is retried');
select ok((select stt_status = 'pending' and stt_attempts = 0 and stt_error_kind = 'auth' and stt_next_try_at = now() + interval '10 minutes'
           from phone_calls where meeting_id = pg_temp.mid('s7-auth')),
  'F9: a refusal that was not billed gives the attempt back');
select ok((select outcome = 'not_billed' and reserved_sec = 0 from call_stt_usage where meeting_id = pg_temp.mid('s7-auth')),
  'F9: and releases the reserved minutes');
select is((select updated_at from meetings where id = pg_temp.mid('s7-auth')), now(), 'F9: a retry touches the call, so the page updates');
select pg_temp.new_call('s7-trans', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running');
update phone_calls set stt_attempts = 1 where meeting_id = pg_temp.mid('s7-trans');
select is(finish_call_transcription(pg_temp.mid('s7-trans'), 'transient', 'timeout', 'timeout'), 'retry', 'F9: a timeout is retried');
select ok((select stt_attempts = 1 and stt_next_try_at = now() + interval '5 minutes' from phone_calls where meeting_id = pg_temp.mid('s7-trans')),
  'F9: a timeout counts as an attempt and waits 5 minutes');
update phone_calls set stt_status = 'running', stt_attempts = 3 where meeting_id = pg_temp.mid('s7-trans');
select is(finish_call_transcription(pg_temp.mid('s7-trans'), 'transient', 'timeout', 'timeout'), 'failed', 'F9: the third timeout fails');
select ok((select process_status = 'failed' and failure_reason like '%timed out%' from meetings where id = pg_temp.mid('s7-trans')),
  'F9: the call fails with the "timed out" reason');
select pg_temp.new_call('s7-content', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running');
update phone_calls set stt_attempts = 1 where meeting_id = pg_temp.mid('s7-content');
select is(finish_call_transcription(pg_temp.mid('s7-content'), 'content', 'HTTP 400 bad audio', 'bad_audio'), 'retry', 'F9: bad audio is retried');
select ok((select stt_status = 'pending' and stt_next_try_at = now() + interval '10 minutes' and stt_error_kind = 'bad_audio'
           from phone_calls where meeting_id = pg_temp.mid('s7-content')),
  'F9: a content error waits 10 minutes');
select pg_temp.new_call('s7-final', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running');
select is(finish_call_transcription(pg_temp.mid('s7-final'), 'final', 'unsupported audio', 'internal'), 'failed', 'F9: a final error fails at once');
select ok((select process_status = 'failed' and failure_reason = 'Transcription failed: unsupported audio' from meetings where id = pg_temp.mid('s7-final')),
  'F9: with its reason');

-- 8. F11 save_call_transcript ----------------------------------------------------------------------------------
select pg_temp.new_call('s8-five', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running');
select results_eq(
  $$select status, purge_path from save_call_transcript(pg_temp.mid('s8-five'),
      '[{"speaker":"Speaker 1","startSec":0.5,"endSec":3.2,"text":"Hello? Hello? Haan, boliye. Hello?"}]', 1, 5, 2, 48.5, 'deepgram:nova-3', 8)$$,
  $$values ('no_speech'::text, 'calls/test/s8-five'::text)$$,
  'F11: under 8 words the call is purged in the same transaction');
select ok((select m.process_status = 'skipped' and p.skip_code = 'no_speech' and p.recording_status = 'deleted' and p.recording_path is null
           from meetings m join phone_calls p on p.meeting_id = m.id where m.id = pg_temp.mid('s8-five')),
  'F11: a no-speech stub, its audio marked deleted');
select ok(exists (select 1 from storage_deletions where path = 'calls/test/s8-five' and reason = 'purge')
          and not exists (select 1 from transcripts where meeting_id = pg_temp.mid('s8-five'))
          and not exists (select 1 from call_transcripts where meeting_id = pg_temp.mid('s8-five')),
  'F11: the object is queued and no transcript is kept');
select pg_temp.new_call('s8-words', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running');
insert into call_stt_usage (meeting_id, reserved_sec) values (pg_temp.mid('s8-words'), 120);
select results_eq(
  $$select status, purge_path from save_call_transcript(pg_temp.mid('s8-words'), pg_temp.turns(100), 1, 100, 1, 147.2, 'deepgram:nova-3', 8)$$,
  $$values ('ready'::text, null::text)$$,
  'F11: a real transcript makes the call ready');
select ok(exists (select 1 from call_transcripts where meeting_id = pg_temp.mid('s8-words') and word_count = 100 and sentence_count = 1)
          and not exists (select 1 from transcripts where meeting_id = pg_temp.mid('s8-words')),
  'F11: an undecided call''s turns go to the secret store only');
select ok((select transcript_ready and process_status = 'ready' and duration_sec = 148 from meetings where id = pg_temp.mid('s8-words'))
          and (select ready_at = now() and stt_status = 'done' and recording_duration_sec = 147.2 and speaker_count = 1
                      and stt_provider = 'deepgram:nova-3' from phone_calls where meeting_id = pg_temp.mid('s8-words')),
  'F11: the length is raised to the recording''s, and ready_at is set');
select ok((select outcome = 'done' and reserved_sec = 147.2 from call_stt_usage where meeting_id = pg_temp.mid('s8-words')),
  'F11: the reservation becomes the real seconds');
select pg_temp.new_call('s8-biz', pg_temp.line(1), 'waiting_transcript', 'client', now() - interval '1 hour', 'running');
do $$ begin perform save_call_transcript(pg_temp.mid('s8-biz'), pg_temp.turns(100), 1, 100, 1, 147.2, 'deepgram:nova-3', 8); end $$;
select ok(exists (select 1 from transcripts where meeting_id = pg_temp.mid('s8-biz') and speaker_labels_reliable = false)
          and not exists (select 1 from call_transcripts where meeting_id = pg_temp.mid('s8-biz')),
  'F11: a call a person already marked business stores its turns where the team reads them');
select pg_temp.new_call('s8-purged', pg_temp.line(1), 'waiting_transcript', 'unknown', now() - interval '1 hour', 'running');
do $$ begin perform purge_call(pg_temp.mid('s8-purged'), 'personal', 'Personal call. The recording and transcript were deleted.', 'person'); end $$;
select results_eq(
  $$select status, purge_path from save_call_transcript(pg_temp.mid('s8-purged'), pg_temp.turns(100), 1, 100, 1, 147.2, 'deepgram:nova-3', 8)$$,
  $$values ('skipped'::text, null::text)$$, 'F11: a purged call stays purged');
select ok(not exists (select 1 from call_transcripts where meeting_id = pg_temp.mid('s8-purged'))
          and not exists (select 1 from transcripts where meeting_id = pg_temp.mid('s8-purged')),
  'F11: no transcript is stored for a purged call');
select pg_temp.new_call('s8-labelled', pg_temp.line(1), 'failed', 'unknown', now() - interval '1 hour', 'failed');
select is(decide_call(pg_temp.mid('s8-labelled'), 'client', '00000000-0000-4000-8000-0000000000c1', 'Ashwini Bhambani'), 'failed',
  'F11 fixture: a person marks a call whose transcription failed as a client call');
select is(retry_call_transcription(pg_temp.mid('s8-labelled')), true, 'F11 fixture: and retries its transcription');
update phone_calls set stt_status = 'running', stt_attempts = 1, stt_started_at = now() where meeting_id = pg_temp.mid('s8-labelled');
select results_eq(
  $$select status, purge_path from save_call_transcript(pg_temp.mid('s8-labelled'),
      '[{"speaker":"Speaker 1","startSec":0.5,"endSec":3.2,"text":"Hello? Hello? Haan, boliye. Hello?"}]', 1, 5, 2, 48.5, 'deepgram:nova-3', 8)$$,
  $$values ('failed'::text, null::text)$$,
  'F11: a call a person marked business is never deleted for having no speech');
select ok((select m.type = 'client' and m.type_source = 'human' and m.process_status = 'failed' and not m.transcript_ready
                  and m.failure_reason = 'No speech in the recording.'
                  and p.recording_status = 'stored' and p.recording_path = 'calls/test/s8-labelled' and p.purged_at is null
                  and p.skip_code is null and p.stt_status = 'done'
           from meetings m join phone_calls p on p.meeting_id = m.id where m.id = pg_temp.mid('s8-labelled'))
          and not exists (select 1 from storage_deletions where path = 'calls/test/s8-labelled'),
  'F11: it keeps its label and its audio, and fails with a fixed reason for a person to look at');

-- 9. F12 mark_call_business ------------------------------------------------------------------------------------
select pg_temp.new_call('s9-a', pg_temp.line(1), 'needs_decision', 'unknown', now() - interval '1 hour', 'done', 'Rakesh Cafe 89');
select pg_temp.new_call('s9-b', pg_temp.line(1), 'needs_decision', 'unknown', now() - interval '1 hour', 'done', 'Rakesh');
select pg_temp.new_call('s9-c', pg_temp.line(1), 'needs_decision', 'unknown', now() - interval '1 hour', 'done', 'Sharma Traders');
select pg_temp.new_call('s9-d', pg_temp.line(1), 'needs_decision', 'unknown', now() - interval '1 hour', 'done', null);
select pg_temp.new_call('s9-e', pg_temp.line(1), 'needs_decision', 'unknown', now() - interval '1 hour', 'done', null);
insert into call_transcripts (meeting_id, turns, sentence_count, word_count)
values (pg_temp.mid('s9-a'), '[{"speaker":"Speaker 1","startSec":0,"endSec":5,"text":"Namaste Rakesh ji"}]', 1, 3);
select is(mark_call_business(pg_temp.mid('s9-a'), 'client', 'human', 1, 'Marked as a client call by Asha Admin', '00000000-0000-4000-8000-0000000000c1', null),
  'Call with Rakesh Cafe 89', 'F12: a saved name that contains the client''s stands alone');
select is(mark_call_business(pg_temp.mid('s9-b'), 'client', 'human', 1, 'Marked as a client call by Asha Admin', '00000000-0000-4000-8000-0000000000c1', null),
  'Call with Rakesh (Cafe 89)', 'F12: otherwise the client follows the saved name');
select is(mark_call_business(pg_temp.mid('s9-c'), 'vendor', 'human', 1, 'Marked as a vendor call by Asha Admin', '00000000-0000-4000-8000-0000000000c1', 'Sharma'),
  'Vendor call with Sharma Traders', 'F12: a vendor call is titled by its saved name');
select is(mark_call_business(pg_temp.mid('s9-d'), 'client', 'human', 1, 'Marked as a client call by Asha Admin', '00000000-0000-4000-8000-0000000000c1', null),
  'Call with Cafe 89', 'F12: without a saved name, the client');
select is(mark_call_business(pg_temp.mid('s9-e'), 'client', 'human', 1, 'Marked as a client call by Asha Admin', null, '  '),
  'Call with a client', 'F12: and without either, a plain title');
select ok(exists (select 1 from transcripts where meeting_id = pg_temp.mid('s9-a') and speaker_labels_reliable = false)
          and not exists (select 1 from call_transcripts where meeting_id = pg_temp.mid('s9-a')),
  'F12: the turns move from the secret store into transcripts');
select ok((select counterpart_name = 'Rakesh Cafe 89' and decision_reason is null from phone_calls where meeting_id = pg_temp.mid('s9-a'))
          and (select type = 'client' and type_source = 'human' and type_confidence = 1 and client_id = '00000000-0000-4000-8000-0000000000c1'
               from meetings where id = pg_temp.mid('s9-a')),
  'F12: the saved name becomes team-readable, with the type and client');
select ok((select type = 'vendor' and client_id is null and client_name_guess = 'Sharma' from meetings where id = pg_temp.mid('s9-c')),
  'F12: a vendor call has no client');
select pg_temp.new_call('s9-f', pg_temp.line(1), 'processing', 'unknown');
update meetings set claim_token = '00000000-0000-4000-8000-00000000f001' where id = pg_temp.mid('s9-f');
select throws_ok($$select mark_call_business(pg_temp.mid('s9-f'), 'client', 'llm', 0.9, 'Client call', null, null, '00000000-0000-4000-8000-00000000f002')$$,
  'P0001', 'claim_mismatch', 'F12: the routine writes only the call it claimed');
select is(mark_call_business(pg_temp.mid('s9-f'), 'client', 'llm', 0.934, 'Client call', null, 'Cafe 89', '00000000-0000-4000-8000-00000000f001'),
  'Call with Rakesh Cafe 89', 'F12: with its claim the routine marks the call business');
select pg_temp.new_call('s9-g', pg_temp.line(1), 'processing', 'vendor');
update meetings set claim_token = '00000000-0000-4000-8000-00000000f003', type_source = 'human' where id = pg_temp.mid('s9-g');
select throws_ok($$select mark_call_business(pg_temp.mid('s9-g'), 'client', 'llm', 0.9, 'Client call', null, null, '00000000-0000-4000-8000-00000000f003')$$,
  'P0001', 'human_label', 'F12: the routine never overwrites a person''s label');
select throws_ok($$select mark_call_business(pg_temp.mid('s8-purged'), 'client', 'human', 1, 'x', null, null)$$,
  'P0001', 'call_purged', 'F12: a deleted call cannot become business');
select throws_ok($$select mark_call_business(pg_temp.mid('s9-e'), 'other', 'human', 1, 'x', null, null)$$,
  'P0001', 'not a business type: other', 'F12: only client and vendor are business types');

-- 10. F13 decide_call ------------------------------------------------------------------------------------------
select pg_temp.new_call('s10-nd', pg_temp.line(1), 'needs_decision', 'unknown');
update meetings set process_attempts = 2 where id = pg_temp.mid('s10-nd');
update phone_calls set decision_reason = 'unsure', decision_since = now() where meeting_id = pg_temp.mid('s10-nd');
insert into call_transcripts (meeting_id, turns) values (pg_temp.mid('s10-nd'), '[{"speaker":"Speaker 1","startSec":0,"endSec":5,"text":"Namaste"}]');
select is(decide_call(pg_temp.mid('s10-nd'), 'client', '00000000-0000-4000-8000-0000000000c1', 'Ashwini Bhambani'), 'ready',
  'F13: a person''s decision sends an undecided call with a transcript to the routine');
select ok((select process_attempts = 0 and type = 'client' and type_source = 'human' and claim_token is null
                  and type_reason = 'Marked as a client call by Ashwini Bhambani' from meetings where id = pg_temp.mid('s10-nd'))
          and (select decision_reason is null from phone_calls where meeting_id = pg_temp.mid('s10-nd')),
  'F13: its attempts start again and the hold is cleared');
select pg_temp.new_call('s10-failed', pg_temp.line(1), 'failed', 'unknown', now() - interval '1 hour', 'failed');
select is(decide_call(pg_temp.mid('s10-failed'), 'vendor', null, 'Ashwini Bhambani'), 'failed',
  'F13: without a transcript a failed call stays failed (its transcription is retried separately)');
select pg_temp.new_call('s10-sheet', pg_temp.line(1), 'needs_decision', 'unknown');
insert into sheets (meeting_id, version, headline, result, prompt_version) values (pg_temp.mid('s10-sheet'), 1, 'A headline for the test', '{}', '1.1.0');
select is(decide_call(pg_temp.mid('s10-sheet'), 'client', null, 'Ashwini Bhambani'), 'done', 'F13: a call that has a sheet is done');

-- 11. F14 hold_call --------------------------------------------------------------------------------------------
select pg_temp.new_call('s11', pg_temp.line(1), 'processing', 'unknown');
update meetings set claim_token = '00000000-0000-4000-8000-00000000f011', claimed_at = now(), process_attempts = 1 where id = pg_temp.mid('s11');
select throws_ok($$select hold_call(pg_temp.mid('s11'), '00000000-0000-4000-8000-00000000f012', 'unsure', 'x', 0.6)$$,
  'P0001', 'claim_mismatch', 'F14: only the run holding the claim can hand the call to a person');
select throws_ok($$select hold_call(pg_temp.mid('s11'), '00000000-0000-4000-8000-00000000f011', 'later', 'x', 0.6)$$,
  'P0001', 'unknown hold kind later', 'F14: unknown hold kinds are refused');
select is(hold_call(pg_temp.mid('s11'), '00000000-0000-4000-8000-00000000f011', 'unsure', 'The routine was not sure this is a work call.', 0.6),
  'needs_decision', 'F14: an unsure answer goes to a person');
select ok((select process_status = 'needs_decision' and claim_token is null and claimed_at is null and type_source = 'llm' and type_confidence = 0.6
           from meetings where id = pg_temp.mid('s11'))
          and (select decision_reason = 'unsure' and decision_since = now() from phone_calls where meeting_id = pg_temp.mid('s11'))
          and (select count(*) = 1 from agent_runs where meeting_id = pg_temp.mid('s11') and kind = 'classify'),
  'F14: the hold is recorded with fixed text only');

-- 12. F10 purge_call -------------------------------------------------------------------------------------------
select pg_temp.new_call('s12', pg_temp.line(1), 'done', 'client');
update meetings set title = 'Call with Rakesh Cafe 89', client_id = '00000000-0000-4000-8000-0000000000c1', client_name_guess = 'Cafe 89',
                    process_attempts = 1 where id = pg_temp.mid('s12');
update call_log set recording_url = 'https://media1.callyzer.co/s12.mp3' where callyzer_id = 's12';
insert into transcripts (meeting_id, turns) values (pg_temp.mid('s12'), '[{"speaker":"Speaker 1","startSec":0,"endSec":5,"text":"Namaste"}]');
insert into call_transcripts (meeting_id, turns) values (pg_temp.mid('s12'), '[{"speaker":"Speaker 1","startSec":0,"endSec":5,"text":"Namaste"}]');
insert into sheets (id, meeting_id, version, headline, result, prompt_version)
values ('00000000-0000-4000-8000-00000000e012', pg_temp.mid('s12'), 1, 'Headline of the purge test', '{}', '1.1.0');
insert into action_items (meeting_id, sheet_id, item_key, title) values (pg_temp.mid('s12'), '00000000-0000-4000-8000-00000000e012', 'A1-k', 'Send the menu');
insert into item_feedback (action_item_id, verdict) select id, 'approve' from action_items where meeting_id = pg_temp.mid('s12');
insert into classification_feedback (meeting_id, from_type, to_type) values (pg_temp.mid('s12'), 'unknown', 'client');
insert into agent_runs (meeting_id, kind, status, summary) values
  (pg_temp.mid('s12'), 'classify', 'ok', 'Classified as a client call (93%)'),
  (pg_temp.mid('s12'), 'extract', 'ok', 'Saved version 1');
select is(purge_call(pg_temp.mid('s12'), 'personal', 'Personal call. The recording and transcript were deleted.', 'routine',
                     'Classified as personal (90%) by the routine'),
  'calls/test/s12', 'F10: the purge returns the object to remove');
select ok(not exists (select 1 from transcripts where meeting_id = pg_temp.mid('s12'))
          and not exists (select 1 from call_transcripts where meeting_id = pg_temp.mid('s12'))
          and not exists (select 1 from sheets where meeting_id = pg_temp.mid('s12'))
          and not exists (select 1 from action_items where meeting_id = pg_temp.mid('s12'))
          and not exists (select 1 from classification_feedback where meeting_id = pg_temp.mid('s12')),
  'F10: both transcript stores, sheets, items and feedback are deleted');
select results_eq($$select kind, status, summary from agent_runs where meeting_id = pg_temp.mid('s12')$$,
  $$values ('skip'::text, 'ok'::text, 'Classified as personal (90%) by the routine'::text)$$,
  'F10: one fixed agent_runs row is all that is left of the routine''s notes');
select ok((select process_status = 'skipped' and type = 'other' and type_source = 'llm' and title is null and client_id is null
                  and client_name_guess is null and not transcript_ready and claim_token is null
                  and type_reason = 'Personal call. The recording and transcript were deleted.'
           from meetings where id = pg_temp.mid('s12')),
  'F10: the meetings stub keeps the time, the length and fixed text only');
select ok((select skip_code = 'personal' and purged_at = now() and purged_by = 'routine' and counterpart_name is null
                  and counterpart_masked = '+91 98••• ••210' and recording_status = 'deleted' and recording_path is null and media_deleted_at = now()
           from phone_calls where meeting_id = pg_temp.mid('s12')),
  'F10: the phone_calls stub keeps the masked number and marks the audio deleted');
select ok(exists (select 1 from storage_deletions where path = 'calls/test/s12' and reason = 'purge'), 'F10: the object is queued for removal');
select ok((select counterpart_e164 is null and counterpart_name is null and recording_url is null from call_log where callyzer_id = 's12'),
  'F10: the ledger forgets the number, the name and the link');
select is(purge_call(pg_temp.mid('s12'), 'personal', 'again', 'routine'), null, 'F10: a second purge does nothing');
select pg_temp.new_call('s12-sales', pg_temp.line(1), 'ready', 'unknown');
do $$ begin perform purge_call(pg_temp.mid('s12-sales'), 'sales', 'Sales lead, which Sales QA handles. The recording and transcript were deleted.', 'person'); end $$;
select ok((select type = 'sales' and type_source = 'human' and type_confidence = 1 from meetings where id = pg_temp.mid('s12-sales')),
  'F10: a person''s purge is a human label, and a sales call keeps the sales type');
select throws_ok($$select purge_call(pg_temp.mid('s12-sales'), 'oops', 'x', 'person')$$, 'P0001', 'unknown skip code oops',
  'F10: unknown codes are refused');

-- 13. F15 save_call_sheet --------------------------------------------------------------------------------------
create function pg_temp.item(p_key text, p_position integer, p_title text, p_owed owner_side) returns jsonb language sql immutable as $$
  select jsonb_build_object('item_key', p_key, 'position', p_position, 'title', p_title, 'details', '', 'owed_by', p_owed,
    'owner_name', null, 'owner_email', null, 'owner_basis', 'not_stated', 'due_date', null, 'due_kind', 'none_stated',
    'due_phrase', null, 'priority', 'medium', 'status', 'open', 'evidence_ts_sec', 8, 'evidence_speaker', 'Speaker 1',
    'evidence_quote', 'Revised menu costing main Friday tak bhej dungi.', 'evidence_verified', true, 'confidence', 0.9,
    'linked_decision', null)
$$;
select pg_temp.new_call('s13', pg_temp.line(1), 'processing', 'client');
update meetings set claim_token = '00000000-0000-4000-8000-00000000f131', claimed_at = now() where id = pg_temp.mid('s13');
select throws_ok($$select save_call_sheet(pg_temp.mid('s13'), '00000000-0000-4000-8000-00000000f999', 'A headline for the call', '{}',
                    'claude', '1.1.0', '[]', '[]', '{}')$$,
  'P0001', 'claim_mismatch', 'F15: a save needs the run''s own claim');
update meetings set process_status = 'ready' where id = pg_temp.mid('s13');
select throws_ok($$select save_call_sheet(pg_temp.mid('s13'), '00000000-0000-4000-8000-00000000f131', 'A headline for the call', '{}',
                    'claude', '1.1.0', '[]', '[]', '{}')$$,
  'P0001', 'call_not_processing:ready', 'F15: a call that is not being processed cannot be saved');
update meetings set process_status = 'processing' where id = pg_temp.mid('s13');
select throws_ok($$select save_call_sheet(pg_temp.mid('s12'), null, 'A headline for the call', '{}', 'claude', '1.1.0', '[]', '[]', '{}')$$,
  'P0001', 'call_purged', 'F15: a deleted call cannot get a sheet');
select pg_temp.new_call('s13-unknown', pg_temp.line(1), 'processing', 'unknown');
update meetings set claim_token = '00000000-0000-4000-8000-00000000f133' where id = pg_temp.mid('s13-unknown');
select throws_ok($$select save_call_sheet(pg_temp.mid('s13-unknown'), '00000000-0000-4000-8000-00000000f133', 'A headline for the call',
                    '{}', 'claude', '1.1.0', '[]', '[]', '{}')$$,
  'P0001', 'call_not_business', 'F15: only client and vendor calls get a sheet');
select is(save_call_sheet(pg_temp.mid('s13'), '00000000-0000-4000-8000-00000000f131', 'Ashwini sends the revised menu costing by Friday',
                          '{"executive_summary":["Menu costing by Friday"]}', 'claude', '1.1.0',
                          jsonb_build_array(pg_temp.item('A1-k', 0, 'Send the revised menu costing', 'dny'),
                                            pg_temp.item('A2-k', 1, 'Share the vendor bills', 'client'),
                                            pg_temp.item('A3-k', 2, 'Call back next week', 'dny')),
                          '[]', '{}'),
  1, 'F15: the first sheet is version 1');
select ok((select process_status = 'done' and claim_token is null and claimed_at is null from meetings where id = pg_temp.mid('s13'))
          and (select first_sheet_at = now() from phone_calls where meeting_id = pg_temp.mid('s13')),
  'F15: the call is done, its claim cleared, first_sheet_at set');
select is((select count(*)::int from action_items a join sheets s on s.id = a.sheet_id where a.meeting_id = pg_temp.mid('s13') and s.version = 1), 3,
  'F15: the items belong to the new sheet');
update action_items set title = 'Share the vendor bills (edited)', edited_by = '00000000-0000-4000-8000-0000000000a1', edited_at = now()
where meeting_id = pg_temp.mid('s13') and item_key = 'A2-k';
update meetings set process_status = 'processing', claim_token = '00000000-0000-4000-8000-00000000f134' where id = pg_temp.mid('s13');
select is(save_call_sheet(pg_temp.mid('s13'), '00000000-0000-4000-8000-00000000f134', 'Ashwini sends the menu costing and photos by Friday',
                          '{}', 'claude', '1.1.0',
                          jsonb_build_array(pg_temp.item('A1-k', 0, 'Send the revised menu costing and photos', 'dny')),
                          (select jsonb_build_array(jsonb_build_object('id', id, 'position', 1)) from action_items
                           where meeting_id = pg_temp.mid('s13') and item_key = 'A2-k'),
                          (select array_agg(id) from action_items where meeting_id = pg_temp.mid('s13') and item_key = 'A3-k')),
  2, 'F15: a re-run saves version 2');
select ok((select status = 'superseded' from sheets where meeting_id = pg_temp.mid('s13') and version = 1)
          and (select status = 'ready' from sheets where meeting_id = pg_temp.mid('s13') and version = 2),
  'F15: the old sheet is superseded');
select ok((select title = 'Share the vendor bills (edited)' and position = 1
                  and sheet_id = (select id from sheets where meeting_id = pg_temp.mid('s13') and version = 2)
           from action_items where meeting_id = pg_temp.mid('s13') and item_key = 'A2-k')
          and (select status = 'superseded' from action_items where meeting_id = pg_temp.mid('s13') and item_key = 'A3-k')
          and (select title = 'Send the revised menu costing and photos' from action_items where meeting_id = pg_temp.mid('s13') and item_key = 'A1-k'),
  'F15: a person''s edit is kept, a dropped item superseded, the rest rewritten');

-- 14. F1 claim_next_meeting ------------------------------------------------------------------------------------
update meetings set process_status = 'done' where process_status = 'ready';
insert into meetings (id, kind, tldv_meeting_id, happened_at, process_status, transcript_ready, source) values
  ('00000000-0000-4000-8000-00000000e141', 'meeting', 's14-old', now() - interval '3 days', 'ready', true, 'seed'),
  ('00000000-0000-4000-8000-00000000e142', 'meeting', 's14-new', now() - interval '1 hour', 'ready', true, 'seed');
select pg_temp.new_call('s14-call-old', pg_temp.line(1), 'ready', 'unknown', now() - interval '2 days');
select pg_temp.new_call('s14-call-new', pg_temp.line(1), 'ready', 'unknown', now() - interval '2 hours');
select is(claim_next_meeting(), '00000000-0000-4000-8000-00000000e141'::uuid, 'F1: the oldest ready meeting first, as today');
select is(claim_next_meeting(), '00000000-0000-4000-8000-00000000e142'::uuid, 'F1: a newer meeting still comes before any call');
select is(claim_next_meeting(), pg_temp.mid('s14-call-new'), 'F1: then calls, newest first');
select is(claim_next_meeting(), pg_temp.mid('s14-call-old'), 'F1: then the older call');
select is(claim_next_meeting(), null, 'F1: then nothing');
select ok((select count(distinct claim_token) = 4 and bool_and(claim_token is not null and claimed_at = now() and process_status = 'processing')
           from meetings where id in ('00000000-0000-4000-8000-00000000e141', '00000000-0000-4000-8000-00000000e142',
                                      pg_temp.mid('s14-call-new'), pg_temp.mid('s14-call-old'))),
  'F1: every claim gets its own token');
select is((select first_claimed_at from phone_calls where meeting_id = pg_temp.mid('s14-call-old')), now(), 'F1: a call''s first claim is recorded');
create temp table t_token as select claim_token from meetings where id = pg_temp.mid('s14-call-new');
update phone_calls set first_claimed_at = now() - interval '1 hour' where meeting_id = pg_temp.mid('s14-call-new');
update meetings set process_status = 'ready' where id = pg_temp.mid('s14-call-new');
select is(claim_next_meeting(), pg_temp.mid('s14-call-new'), 'F1: a call back in the queue is claimed again');
select ok((select m.claim_token <> t.claim_token from meetings m, t_token t where m.id = pg_temp.mid('s14-call-new')), 'F1: with a new token');
select is((select first_claimed_at from phone_calls where meeting_id = pg_temp.mid('s14-call-new')), now() - interval '1 hour',
  'F1: first_claimed_at is set once');

-- 15. F2 release_stale_call_claims ------------------------------------------------------------------------------
select pg_temp.new_call('s15-a', pg_temp.line(1), 'processing', 'unknown');
select pg_temp.new_call('s15-b', pg_temp.line(1), 'processing', 'unknown');
select pg_temp.new_call('s15-fresh', pg_temp.line(1), 'processing', 'unknown');
update meetings set claimed_at = now() - interval '25 minutes', claim_token = gen_random_uuid(), process_attempts = 1 where id = pg_temp.mid('s15-a');
update meetings set claimed_at = now() - interval '25 minutes', claim_token = gen_random_uuid(), process_attempts = 3 where id = pg_temp.mid('s15-b');
update meetings set claimed_at = now() - interval '5 minutes', claim_token = gen_random_uuid(), process_attempts = 1 where id = pg_temp.mid('s15-fresh');
insert into meetings (id, kind, tldv_meeting_id, happened_at, process_status, transcript_ready, claimed_at, process_attempts, source)
values ('00000000-0000-4000-8000-00000000e151', 'meeting', 's15-meeting', now() - interval '1 day', 'processing', true,
        now() - interval '25 minutes', 1, 'seed');
select is(release_stale_call_claims(20, 3), 2, 'F2: the two call claims older than 20 minutes are released');
select ok((select process_status = 'ready' and claim_token is null and claimed_at is null from meetings where id = pg_temp.mid('s15-a')),
  'F2: a call with attempts left goes back to ready, its token cleared');
select ok((select process_status = 'failed' and failure_reason = 'The routine did not finish this call after 3 attempts.' and claim_token is null
           from meetings where id = pg_temp.mid('s15-b')),
  'F2: a call out of attempts fails');
select ok((select process_status = 'processing' from meetings where id = '00000000-0000-4000-8000-00000000e151')
          and (select process_status = 'processing' from meetings where id = pg_temp.mid('s15-fresh')),
  'F2: meetings (still on the 90 minute rule) and younger claims are untouched');
select results_eq($$select kind, summary from agent_runs where meeting_id in (pg_temp.mid('s15-a'), pg_temp.mid('s15-b')) order by kind$$,
  $$values ('fail'::text, 'The claim timed out after 20 minutes.'::text), ('release', 'The claim timed out after 20 minutes.')$$,
  'F2: each release leaves an agent_runs row');

-- 16. F17 expire_call_recordings -------------------------------------------------------------------------------
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, status, first_seen_at) values
  ('s16-late', pg_temp.line(1), 'incoming', now() - interval '3 days', 60, 'x', 'waiting', now() - interval '2 hours'),
  ('s16-gone', pg_temp.line(1), 'incoming', now() - interval '3 days', 60, 'x', 'waiting', now() - interval '37 hours');
select is(expire_call_recordings(36), 1, 'F17: one call has had no link for 36 hours');
select is((select status from call_log where callyzer_id = 's16-late'), 'waiting',
  'F17: a call first seen 2 hours ago keeps waiting, however old the call');
select is((select status from call_log where callyzer_id = 's16-gone'), 'no_recording', 'F17: 36 hours after first sight it has no recording');

-- 17. F18 expire_undecided_calls -------------------------------------------------------------------------------
select pg_temp.new_call('s17-unsure', pg_temp.line(1), 'needs_decision', 'unknown');
update phone_calls set decision_reason = 'unsure', decision_since = now() - interval '25 hours' where meeting_id = pg_temp.mid('s17-unsure');
select pg_temp.new_call('s17-held', pg_temp.line(1), 'needs_decision', 'unknown');
update phone_calls set decision_reason = 'held', decision_since = now() - interval '25 hours' where meeting_id = pg_temp.mid('s17-held');
select pg_temp.new_call('s17-failed', pg_temp.line(1), 'failed', 'unknown', now() - interval '5 days', 'failed', 'Rakesh Cafe 89', interval '4 days');
select pg_temp.new_call('s17-biz', pg_temp.line(1), 'failed', 'client', now() - interval '5 days', 'failed', 'Rakesh Cafe 89', interval '4 days');
select pg_temp.new_call('s17-old', pg_temp.line(1), 'ready', 'unknown', now() - interval '32 days');
update phone_calls set stored_at = now() - interval '31 days' where meeting_id = pg_temp.mid('s17-old');
select is(expire_undecided_calls(24, 3, 30), 3, 'F18: three undecided calls are past their time');
select ok((select skip_code = 'undecided' and purged_by = 'system' from phone_calls where meeting_id = pg_temp.mid('s17-unsure')),
  'F18: unsure for 25 hours: deleted as undecided');
select ok((select purged_at is null from phone_calls where meeting_id = pg_temp.mid('s17-held')), 'F18: a held call waits for a person');
select ok((select purged_at is not null from phone_calls where meeting_id = pg_temp.mid('s17-failed'))
          and (select purged_at is null from phone_calls where meeting_id = pg_temp.mid('s17-biz')),
  'F18: a failed undecided call goes after 3 days; a failed business call stays');
select ok((select purged_at is not null from phone_calls where meeting_id = pg_temp.mid('s17-old')), 'F18: any undecided call stored 31 days ago goes');

-- 18. F19 expire_call_audio, F20 cleanup_call_log, F21 switch_line_off, F16 retry_call_transcription -----------------
select pg_temp.new_call('s18-old-biz', pg_temp.line(1), 'done', 'client', now() - interval '32 days');
update phone_calls set stored_at = now() - interval '31 days' where meeting_id = pg_temp.mid('s18-old-biz');
select pg_temp.new_call('s18-new-biz', pg_temp.line(1), 'done', 'vendor', now() - interval '10 days');
update phone_calls set stored_at = now() - interval '10 days' where meeting_id = pg_temp.mid('s18-new-biz');
select is(expire_call_audio(30), 1, 'F19: one business recording is past 30 days');
select ok((select recording_status = 'deleted' and recording_path is null and media_deleted_at = now() and purged_at is null
           from phone_calls where meeting_id = pg_temp.mid('s18-old-biz'))
          and exists (select 1 from storage_deletions where path = 'calls/test/s18-old-biz' and reason = 'retention')
          and (select process_status = 'done' from meetings where id = pg_temp.mid('s18-old-biz')),
  'F19: its audio is marked deleted and queued; the call and its sheet stay');
select is((select recording_status from phone_calls where meeting_id = pg_temp.mid('s18-new-biz')), 'stored', 'F19: younger audio stays');

insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, status, storage_path) values
  ('s18-old-empty', pg_temp.line(1), 'incoming', now() - interval '15 days', 60, 'x', 'empty', 'calls/2026/10/old-empty'),
  ('s18-old-pending', pg_temp.line(1), 'incoming', now() - interval '15 days', 60, 'x', 'pending', null),
  ('s18-new-failed', pg_temp.line(1), 'incoming', now() - interval '3 days', 60, 'x', 'failed', null);
select is(cleanup_call_log(14), 1, 'F20: one ledger row that never became a call is older than 14 days');
select ok(not exists (select 1 from call_log where callyzer_id = 's18-old-empty')
          and exists (select 1 from call_log where callyzer_id = 's18-old-pending')
          and exists (select 1 from call_log where callyzer_id = 's18-new-failed')
          and exists (select 1 from storage_deletions where path = 'calls/2026/10/old-empty' and reason = 'copy_abandoned'),
  'F20: it is removed and any object queued; younger rows and rows still queued stay');

insert into phone_lines (id, phone, callyzer_name, enabled, enabled_at, analyse_from)
values ('00000000-0000-4000-8000-0000000000d4', '+919811100004', 'Line Four', true, now() - interval '7 days', now() - interval '7 days');
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, status, storage_path, recording_url) values
  ('s18-w', pg_temp.line(4), 'incoming', now() - interval '1 hour', 60, 'x', 'waiting', null, null),
  ('s18-p', pg_temp.line(4), 'incoming', now() - interval '1 hour', 60, 'x', 'pending', 'calls/2026/11/s18-p-11111111', 'https://media1.callyzer.co/p.mp3');
select pg_temp.new_call('s18-undecided', pg_temp.line(4), 'ready', 'unknown', now() - interval '2 hours');
select pg_temp.new_call('s18-client', pg_temp.line(4), 'done', 'client', now() - interval '3 hours');
select results_eq($$select dropped, purged from switch_line_off('00000000-0000-4000-8000-0000000000d4')$$, $$values (2, 1)$$,
  'F21: switching a line off drops its queued rows and deletes its undecided calls');
select ok((select bool_and(status = 'dropped' and recording_url is null) from call_log where callyzer_id in ('s18-w', 's18-p'))
          and exists (select 1 from storage_deletions where path = 'calls/2026/11/s18-p-11111111' and reason = 'line_off'),
  'F21: queued rows are dropped and any object queued');
select ok((select skip_code = 'line_off' and purged_by = 'person' from phone_calls where meeting_id = pg_temp.mid('s18-undecided'))
          and (select purged_at is null from phone_calls where meeting_id = pg_temp.mid('s18-client'))
          and (select not enabled from phone_lines where id = '00000000-0000-4000-8000-0000000000d4'),
  'F21: client and vendor calls are kept, and the line is off');
select throws_ok($$select * from switch_line_off('00000000-0000-4000-8000-00000000ffff')$$, 'P0001', 'line_not_found', 'F21: an unknown line is refused');

select pg_temp.new_call('s18-retry', pg_temp.line(1), 'failed', 'unknown', now() - interval '1 hour', 'failed');
update phone_calls set stt_attempts = 3, stt_error = 'timeout', stt_error_kind = 'timeout' where meeting_id = pg_temp.mid('s18-retry');
update meetings set failure_reason = 'Transcription failed 3 times: the service timed out or had an error.' where id = pg_temp.mid('s18-retry');
select pg_temp.new_call('s18-has-transcript', pg_temp.line(1), 'failed', 'unknown', now() - interval '1 hour', 'failed');
update meetings set transcript_ready = true where id = pg_temp.mid('s18-has-transcript');
select pg_temp.new_call('s18-stt-done', pg_temp.line(1), 'failed', 'unknown', now() - interval '1 hour', 'done');
select is(retry_call_transcription(pg_temp.mid('s18-retry')), true, 'F16: a failed transcription with stored audio can be retried');
select ok((select stt_status = 'pending' and stt_attempts = 0 and stt_error is null and stt_next_try_at is null
           from phone_calls where meeting_id = pg_temp.mid('s18-retry'))
          and (select process_status = 'waiting_transcript' and failure_reason is null from meetings where id = pg_temp.mid('s18-retry')),
  'F16: it waits for its transcript again with fresh attempts');
select is(retry_call_transcription(pg_temp.mid('s18-has-transcript')), false, 'F16: not when a transcript exists (that is Retry analysis)');
select is(retry_call_transcription(pg_temp.mid('s18-stt-done')), false, 'F16: not when the transcription did not fail');

-- 19. F22 calls_feed_status -------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000b1', 'ashwini.test@dnyhospitality.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b3', 'admin.test@dnyhospitality.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b4', 'member.test@dnyhospitality.com', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b9', 'stranger@example.com', 'authenticated', 'authenticated');
delete from call_log;
insert into phone_lines (id, phone, callyzer_name, enabled, enabled_at, analyse_from)
values ('00000000-0000-4000-8000-0000000000d5', '+919811100005', 'Feed Line', true, now() - interval '7 days', now() - interval '7 days');
create function pg_temp.today() returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' + interval '1 second'
$$;
insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, status) values
  ('s19-waiting', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'waiting'),
  ('s19-pending', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'pending'),
  ('s19-running', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'running'),
  ('s19-norec', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'no_recording'),
  ('s19-empty', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'empty'),
  ('s19-failed', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'failed'),
  ('s19-dropped', pg_temp.line(5), 'incoming', pg_temp.today(), 60, 'x', 'dropped'),
  ('s19-yesterday', pg_temp.line(5), 'incoming', pg_temp.today() - interval '2 seconds', 60, 'x', 'waiting'),
  ('s19-off-line', pg_temp.line(3), 'incoming', pg_temp.today(), 60, 'x', 'waiting');
select pg_temp.new_call('s19-ready', pg_temp.line(5), 'ready', 'unknown', pg_temp.today());
select pg_temp.new_call('s19-done', pg_temp.line(5), 'done', 'client', pg_temp.today());
select pg_temp.new_call('s19-decide', pg_temp.line(5), 'needs_decision', 'unknown', pg_temp.today());
select pg_temp.new_call('s19-fail', pg_temp.line(5), 'failed', 'unknown', pg_temp.today(), 'failed');
select pg_temp.new_call('s19-personal', pg_temp.line(5), 'ready', 'unknown', pg_temp.today());
select pg_temp.new_call('s19-silent', pg_temp.line(5), 'waiting_transcript', 'unknown', pg_temp.today(), 'running');
do $$ begin
  perform purge_call(pg_temp.mid('s19-personal'), 'personal', 'Personal call. The recording and transcript were deleted.', 'routine');
  perform purge_call(pg_temp.mid('s19-silent'), 'no_speech', 'No speech in the recording. The recording was deleted.', 'system');
end $$;
select is(has_function_privilege('anon', 'public.calls_feed_status()', 'execute'), false, 'F22: visitors cannot call it');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}';
select is(calls_feed_status(), null, 'F22: a signed-in account that is not on the team list gets nothing');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}';
select ok(calls_feed_status() ?& array['paused', 'pipelinePaused', 'linesOn', 'lastRunAt', 'lastPollOkAt', 'off', 'pollError', 'sttError',
                                       'copyError', 'poll', 'ledger', 'minutesToday'],
  'F22: a team member gets the documented keys');
select is(calls_feed_status() -> 'ledger',
  '{"waitingRecording":1,"copying":2,"noRecording":2,"copyFailed":1,"inProgress":1,"sheets":1,"needsDecision":1,"failed":1,"notWork":1,"noSpeech":1}'::jsonb,
  'F22: today''s calls on lines that are on, by what became of them');
select is((calls_feed_status() ->> 'paused')::boolean, true, 'F22: calls ship paused');
reset role;

-- 20. F23 calls_nav --------------------------------------------------------------------------------------------
create temp table t_nav as select
  (select count(*) from meetings where kind = 'call' and process_status = 'needs_decision')::int as everyone,
  (select count(*) from meetings m join phone_calls pc on pc.meeting_id = m.id
     join phone_line_members lm on lm.line_id = pc.line_id and lm.person_id = '00000000-0000-4000-8000-0000000000a1'
   where m.kind = 'call' and m.process_status = 'needs_decision')::int as ashwini;
grant select on t_nav to authenticated;
select ok((select ashwini > 0 and ashwini < everyone from t_nav), 'F23 fixture: a line member has some, not all, of the decisions');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}';
select is((calls_nav() ->> 'decisions')::int, (select everyone from t_nav), 'F23: an admin counts every call waiting for a decision');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select is((calls_nav() ->> 'decisions')::int, (select ashwini from t_nav), 'F23: a line member counts only their lines'' calls');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}';
select is(calls_nav(), '{"visible": true, "decisions": 0}'::jsonb, 'F23: another member sees Calls with nothing to decide');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}';
select is(calls_nav(), '{"visible": false, "decisions": 0}'::jsonb, 'F23: an account not on the team list sees nothing');
reset role;

-- 21. Grants ---------------------------------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.claim_next_meeting(uuid[])', 'execute'), false,
  'Grants: a signed-in person cannot claim work');
select is(has_function_privilege('anon', 'public.release_stale_claims(integer,integer)', 'execute'), false,
  'Grants: a visitor cannot release claims');
select is(has_function_privilege('authenticated', 'public.purge_call(uuid,text,text,text,text)', 'execute'), false,
  'Grants: a signed-in person cannot purge a call directly');
select is(has_function_privilege('authenticated', 'public.calls_feed_status()', 'execute'), true, 'Grants: members read the feed status');
select is(has_function_privilege('authenticated', 'public.calls_nav()', 'execute'), true, 'Grants: members read the nav counts');
select is(has_table_privilege('authenticated', 'public.call_log', 'select'), false, 'Grants: the ledger is secret-key only');
select is(has_table_privilege('authenticated', 'public.call_transcripts', 'select'), false, 'Grants: undecided turns are secret-key only');
select is(has_table_privilege('authenticated', 'public.phone_calls', 'select'), true, 'Grants: members read call facts');
select is(has_table_privilege('authenticated', 'public.phone_calls', 'insert'), false, 'Grants: members never write call facts');
create temp table t_pipeline (signature text);
insert into t_pipeline values
  ('claim_next_meeting(uuid[])'), ('release_stale_claims(integer,integer)'), ('release_stale_call_claims(integer,integer)'),
  ('register_phone_lines(jsonb)'), ('upsert_call_log(jsonb)'), ('reserve_call_stt(uuid,numeric,integer)'),
  ('claim_call_work(integer,integer,integer,boolean)'), ('finish_call_copy(text,text,text,text,integer,integer)'),
  ('promote_call(text,text,text,integer,boolean,integer,boolean)'), ('finish_call_transcription(uuid,text,text,text,integer)'),
  ('purge_call(uuid,text,text,text,text)'), ('save_call_transcript(uuid,jsonb,integer,integer,integer,numeric,text,integer)'),
  ('mark_call_business(uuid,meeting_type,type_source,numeric,text,uuid,text,uuid)'), ('decide_call(uuid,meeting_type,uuid,text)'),
  ('hold_call(uuid,uuid,text,text,numeric)'), ('save_call_sheet(uuid,uuid,text,jsonb,text,text,jsonb,jsonb,uuid[])'),
  ('retry_call_transcription(uuid)'), ('expire_call_recordings(integer)'), ('expire_undecided_calls(integer,integer,integer)'),
  ('expire_call_audio(integer)'), ('cleanup_call_log(integer)'), ('switch_line_off(uuid)');
select is((select count(*)::int from t_pipeline
           where has_function_privilege('authenticated', 'public.' || signature, 'execute')
              or has_function_privilege('anon', 'public.' || signature, 'execute')), 0,
  'Grants: no pipeline function runs for a signed-in person or a visitor');
select is((select count(*)::int from t_pipeline where not has_function_privilege('service_role', 'public.' || signature, 'execute')), 0,
  'Grants: the secret key runs every pipeline function');
select is((select count(*)::int from unnest(array['call_log', 'call_transcripts', 'call_stt_usage', 'storage_deletions', 'call_reread_requests']) t
           where has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'select')), 0,
  'Grants: the secret-only tables are closed to signed-in people and visitors');

select * from finish();
rollback;
