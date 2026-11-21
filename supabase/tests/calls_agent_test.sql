-- The routine's writes on the call it claimed (migration 20261120100200_routine_call_writes.sql): the purge (F24)
-- and the hold (F14 as replaced there, which also undoes the routine's own earlier client or vendor label); and the
-- earlier business call with the same number (F25). Local stack only:
--   npx supabase db reset && npx supabase test db
-- One transaction, rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Fixtures --------------------------------------------------------------------------------------------------
insert into phone_lines (id, phone, callyzer_name, enabled, enabled_at, analyse_from) values
  ('00000000-0000-4000-8000-0000000000e1', '+919811100091', 'Agent Line', true, now() - interval '7 days', now() - interval '7 days');

-- A call the routine has claimed with p_claim (status, type and type source as given), with stored audio.
create function pg_temp.claimed_call(p_id text, p_claim uuid, p_status process_status default 'processing',
                                     p_type meeting_type default 'unknown', p_source type_source default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into meetings (kind, callyzer_call_id, happened_at, duration_sec, type, type_source, process_status, source, raw,
                        transcript_ready, claim_token, claimed_at, process_attempts)
  values ('call', p_id, now() - interval '1 hour', 120, p_type, p_source, p_status, 'poll', '{"source":"callyzer"}', true,
          p_claim, now(), 1)
  returning id into v;
  insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_masked, counterpart_name,
                        status, storage_path, meeting_id)
  values (p_id, '00000000-0000-4000-8000-0000000000e1', 'incoming', now() - interval '1 hour', 120, '+91 98••• ••210',
          'Rakesh Cafe 89', 'promoted', 'calls/agent/' || p_id, v);
  insert into phone_calls (meeting_id, callyzer_call_id, line_id, direction, counterpart_masked, recording_path, recording_mime,
                           recording_bytes, stt_status, call_ended_at, seen_at)
  values (v, p_id, '00000000-0000-4000-8000-0000000000e1', 'incoming', '+91 98••• ••210', 'calls/agent/' || p_id,
          'audio/mpeg', 200000, 'done', now() - interval '58 minutes', now() - interval '1 hour');
  insert into call_transcripts (meeting_id, turns, sentence_count, word_count)
  values (v, '[{"speaker":"Speaker 1","startSec":0,"endSec":9,"text":"Hello ji, kaise ho aap?"}]', 1, 5);
  insert into agent_runs (meeting_id, kind, status, attempt, summary) values (v, 'claim', 'ok', 1, 'Claimed by the routine');
  return v;
end $$;

create function pg_temp.mid(p_id text) returns uuid language sql stable as $$
  select id from meetings where callyzer_call_id = p_id
$$;

select pg_temp.claimed_call('agent-ok', '10000000-0000-4000-8000-000000000001');
select pg_temp.claimed_call('agent-ready', '10000000-0000-4000-8000-000000000002', 'ready');
select pg_temp.claimed_call('agent-human', '10000000-0000-4000-8000-000000000003', 'processing', 'client', 'human');
select pg_temp.claimed_call('agent-human-other', '10000000-0000-4000-8000-000000000004', 'processing', 'unknown', 'human');
select pg_temp.claimed_call('agent-sheet', '10000000-0000-4000-8000-000000000005', 'processing', 'client', 'llm');
insert into sheets (meeting_id, version, status, headline, result, prompt_version)
values (pg_temp.mid('agent-sheet'), 1, 'ready', 'A saved sheet', '{}', '1.1.0');
insert into meetings (id, kind, tldv_meeting_id, happened_at, process_status, claim_token)
values ('20000000-0000-4000-8000-000000000001', 'meeting', 'tl-agent-1', now(), 'processing', '10000000-0000-4000-8000-000000000006');

-- Grants ----------------------------------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.purge_claimed_call(uuid,uuid,text,text,text)', 'execute'), false,
  'F24: members cannot run it');
select is(has_function_privilege('anon', 'public.purge_claimed_call(uuid,uuid,text,text,text)', 'execute'), false,
  'F24: anon cannot run it');
select is(has_function_privilege('service_role', 'public.purge_claimed_call(uuid,uuid,text,text,text)', 'execute'), true,
  'F24: the secret key runs it');

-- Refusals: nothing changes -----------------------------------------------------------------------------------
select throws_ok($$select purge_claimed_call(pg_temp.mid('agent-ok'), '10000000-0000-4000-8000-0000000000ff', 'personal', 'r')$$,
  'P0001', 'claim_mismatch', 'F24: another claim is refused');
select throws_ok($$select purge_claimed_call(pg_temp.mid('agent-ok'), null, 'personal', 'r')$$,
  'P0001', 'claim_mismatch', 'F24: no claim is refused');
select throws_ok($$select purge_claimed_call(pg_temp.mid('agent-ready'), '10000000-0000-4000-8000-000000000002', 'personal', 'r')$$,
  'P0001', 'claim_mismatch', 'F24: a call that is not processing is refused, even with its token');
select throws_ok($$select purge_claimed_call(pg_temp.mid('agent-human'), '10000000-0000-4000-8000-000000000003', 'personal', 'r')$$,
  'P0001', 'human_label', 'F24: a person''s client label is never purged by the routine');
select throws_ok($$select purge_claimed_call(pg_temp.mid('agent-sheet'), '10000000-0000-4000-8000-000000000005', 'personal', 'r')$$,
  'P0001', 'has_sheet', 'F24: a call with a sheet is never purged by the routine');
select throws_ok($$select purge_claimed_call('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'personal', 'r')$$,
  'P0001', 'call_not_found', 'F24: a tl;dv meeting is never purged');
select is((select count(*)::int from phone_calls where purged_at is not null), 0, 'F24: no refusal purged anything');
select is((select process_status::text from meetings where id = pg_temp.mid('agent-human')), 'processing',
  'F24: the labelled call is untouched');

-- A person's label that is not business (unreachable in practice) does not block the purge ----------------------
select is(purge_claimed_call(pg_temp.mid('agent-human-other'), '10000000-0000-4000-8000-000000000004', 'personal',
  'Personal call. The recording and transcript were deleted.'), 'calls/agent/agent-human-other',
  'F24: only a business label blocks it');

-- The purge itself ----------------------------------------------------------------------------------------------
select is(purge_claimed_call(pg_temp.mid('agent-ok'), '10000000-0000-4000-8000-000000000001', 'personal',
  'Personal call. The recording and transcript were deleted.', 'Classified as personal (90%) by the routine'),
  'calls/agent/agent-ok', 'F24: returns the path to remove');
select is((select process_status::text from meetings where id = pg_temp.mid('agent-ok')), 'skipped', 'F24: the call is skipped');
select is((select type_source::text from meetings where id = pg_temp.mid('agent-ok')), 'llm', 'F24: labelled by the routine');
select is((select claim_token from meetings where id = pg_temp.mid('agent-ok')), null, 'F24: the claim is cleared');
select is((select purged_by from phone_calls where meeting_id = pg_temp.mid('agent-ok')), 'routine', 'F24: purged by the routine');
select is((select skip_code from phone_calls where meeting_id = pg_temp.mid('agent-ok')), 'personal', 'F24: with its code');
select is((select count(*)::int from call_transcripts where meeting_id = pg_temp.mid('agent-ok')), 0, 'F24: the turns are gone');
select is((select reason from storage_deletions where path = 'calls/agent/agent-ok'), 'purge', 'F24: the object is queued');
select results_eq($$select kind, summary from agent_runs where meeting_id = pg_temp.mid('agent-ok')$$,
  $$values ('skip'::text, 'Classified as personal (90%) by the routine'::text)$$,
  'F24: one fixed agent_runs row is all that is left');
select throws_ok($$select purge_claimed_call(pg_temp.mid('agent-ok'), '10000000-0000-4000-8000-000000000001', 'personal', 'r')$$,
  'P0001', 'claim_mismatch', 'F24: a second purge with the old claim is refused');

-- F14 as replaced: the hold refuses a person's business label, and is otherwise unchanged ---------------------
select pg_temp.claimed_call('agent-hold', '10000000-0000-4000-8000-000000000007');
select throws_ok($$select hold_call(pg_temp.mid('agent-human'), '10000000-0000-4000-8000-000000000003', 'held',
  'Held for a person: this number had a client or vendor call before', 0.9)$$,
  'P0001', 'human_label', 'F14: a person''s client label is never handed back to a person by the routine');
select is((select process_status::text from meetings where id = pg_temp.mid('agent-human')), 'processing',
  'F14: the labelled call is still the routine''s to finish');
select throws_ok($$select hold_call(pg_temp.mid('agent-hold'), '10000000-0000-4000-8000-0000000000ff', 'unsure', 'x', 0.6)$$,
  'P0001', 'claim_mismatch', 'F14: another claim is refused');
select is(hold_call(pg_temp.mid('agent-hold'), '10000000-0000-4000-8000-000000000007', 'unsure',
  'The routine was not sure this is a work call (60%).', 0.6), 'needs_decision', 'F14: otherwise the call goes to a person');
select results_eq($$select m.process_status::text, m.claim_token::text, pc.decision_reason, m.type_confidence::text
                    from meetings m join phone_calls pc on pc.meeting_id = m.id where m.id = pg_temp.mid('agent-hold')$$,
  $$values ('needs_decision'::text, null::text, 'unsure'::text, '0.60'::text)$$,
  'F14: needs_decision, the claim cleared, unsure, the routine''s confidence');
select is((select count(*)::int from call_transcripts where meeting_id = pg_temp.mid('agent-hold')), 1,
  'F14: a held call keeps its turns in the secret store');
select is(has_function_privilege('authenticated', 'public.hold_call(uuid,uuid,text,text,numeric)', 'execute'), false,
  'F14: members cannot run it');

-- F25: the earlier business call with the same number, found from the call's id alone --------------------------
insert into clients (id, name) values ('30000000-0000-4000-8000-000000000001', 'Cafe 89 Agent');

-- A call with the other party's number (null when hidden), p_hours_ago hours old, as the routine left it.
create function pg_temp.numbered_call(p_id text, p_number text, p_type meeting_type, p_hours_ago integer,
                                      p_client uuid default null, p_purged boolean default false)
returns uuid language plpgsql as $$
declare
  v uuid;
  v_at timestamptz := now() - make_interval(hours => p_hours_ago);
begin
  insert into meetings (kind, callyzer_call_id, happened_at, duration_sec, type, type_source, process_status, source, raw,
                        client_id)
  values ('call', p_id, v_at, 120, p_type, 'llm', 'done', 'poll', '{"source":"callyzer"}', p_client)
  returning id into v;
  insert into call_log (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_e164,
                        counterpart_masked, status, meeting_id)
  values (p_id, '00000000-0000-4000-8000-0000000000e1', 'incoming', v_at, 120, p_number, '+91 98••• ••210', 'promoted', v);
  insert into phone_calls (meeting_id, callyzer_call_id, line_id, direction, counterpart_masked, stt_status, call_ended_at,
                           seen_at, purged_at, purged_by)
  values (v, p_id, '00000000-0000-4000-8000-0000000000e1', 'incoming', '+91 98••• ••210', 'done',
          v_at + interval '2 minutes', v_at, case when p_purged then now() end, case when p_purged then 'person' end);
  return v;
end $$;

-- One number: a client call two days ago, a vendor call yesterday, and the call being read now.
select pg_temp.numbered_call('f25-client', '+919811100101', 'client', 48, '30000000-0000-4000-8000-000000000001');
select pg_temp.numbered_call('f25-vendor', '+919811100101', 'vendor', 24);
select pg_temp.numbered_call('f25-now', '+919811100101', 'unknown', 0);
-- Another: a client call that was purged (its number kept here, so only the purge stands in the way).
select pg_temp.numbered_call('f25-purged', '+919811100102', 'client', 24, '30000000-0000-4000-8000-000000000001', true);
select pg_temp.numbered_call('f25-after-purge', '+919811100102', 'unknown', 0);
-- Hidden numbers: a client call and a new call, both without a number.
select pg_temp.numbered_call('f25-hidden-client', null, 'client', 24, '30000000-0000-4000-8000-000000000001');
select pg_temp.numbered_call('f25-hidden-now', null, 'unknown', 0);

select results_eq($$select type::text, client from previous_business_call(pg_temp.mid('f25-now'))$$,
  $$values ('vendor'::text, null::text)$$,
  'F25: the newest earlier client or vendor call with the number; a vendor call names no client');
select results_eq($$select type::text, client from previous_business_call(pg_temp.mid('f25-vendor'))$$,
  $$values ('client'::text, 'Cafe 89 Agent'::text)$$,
  'F25: never the call itself, and a call that is not business does not count; a client call names its client');
select is_empty($$select * from previous_business_call(pg_temp.mid('f25-after-purge'))$$,
  'F25: a purged call does not count');
select is_empty($$select * from previous_business_call(pg_temp.mid('f25-hidden-now'))$$,
  'F25: a hidden number matches nothing');
select is_empty($$select * from previous_business_call('20000000-0000-4000-8000-000000000001')$$,
  'F25: a tl;dv meeting has no number, so no earlier call');
select is(has_function_privilege('authenticated', 'public.previous_business_call(uuid)', 'execute'), false,
  'F25: members cannot run it');
select is(has_function_privilege('anon', 'public.previous_business_call(uuid)', 'execute'), false,
  'F25: anon cannot run it');
select is(has_function_privilege('service_role', 'public.previous_business_call(uuid)', 'execute'), true,
  'F25: the secret key runs it');

-- F14: a client label the routine gave on an earlier run (no sheet came of it) is undone by its hold ------------
select pg_temp.claimed_call('agent-undo', '10000000-0000-4000-8000-000000000008');
update call_log set counterpart_e164 = '+919811100103' where callyzer_id = 'agent-undo';
select pg_temp.numbered_call('agent-undo-later', '+919811100103', 'unknown', 0);
select lives_ok($$select mark_call_business(pg_temp.mid('agent-undo'), 'client', 'llm', 0.92, 'Menu costing follow-up.',
  '30000000-0000-4000-8000-000000000001', 'Cafe 89', '10000000-0000-4000-8000-000000000008')$$,
  'F14 setup: the routine said client on its first run');
select results_eq($$select m.type::text, m.client_id is not null, m.title is not null, pc.counterpart_name,
                           (select count(*)::int from transcripts t where t.meeting_id = m.id)
                    from meetings m join phone_calls pc on pc.meeting_id = m.id where m.id = pg_temp.mid('agent-undo')$$,
  $$values ('client'::text, true, true, 'Rakesh Cafe 89'::text, 1)$$,
  'F14 setup: client, linked and titled, its saved name and turns open to the team');
select results_eq($$select type::text, client from previous_business_call(pg_temp.mid('agent-undo-later'))$$,
  $$values ('client'::text, 'Cafe 89 Agent'::text)$$,
  'F14 setup: it counts as an earlier business call for its number');
select is(hold_call(pg_temp.mid('agent-undo'), '10000000-0000-4000-8000-000000000008', 'unsure',
  'The routine was not sure this is a work call (60%).', 0.6), 'needs_decision',
  'F14: on a re-run the routine''s own client label goes to a person');
select results_eq($$select m.type::text, m.type_source::text, m.client_id::text, m.client_name_guess, m.title,
                           pc.counterpart_name, pc.decision_reason
                    from meetings m join phone_calls pc on pc.meeting_id = m.id where m.id = pg_temp.mid('agent-undo')$$,
  $$values ('unknown'::text, 'llm'::text, null::text, null::text, null::text, null::text, 'unsure'::text)$$,
  'F14: undecided again: no type, client, guess, title or saved name on the team-readable rows');
select is((select count(*)::int from transcripts where meeting_id = pg_temp.mid('agent-undo')), 0,
  'F14: no turns are left where the team reads them');
select is((select count(*)::int from call_transcripts where meeting_id = pg_temp.mid('agent-undo')), 1,
  'F14: the turns are back in the secret store, once');
select is_empty($$select * from previous_business_call(pg_temp.mid('agent-undo-later'))$$,
  'F14: it no longer counts as an earlier business call for its number');
select is((select counterpart_name from call_log where callyzer_id = 'agent-undo'), 'Rakesh Cafe 89',
  'F14: the secret ledger keeps the saved name, for the holds and a person''s decision');
-- A call with a sheet keeps its label: the sheet is open to the team already (the routine keeps the sheet instead).
select is(hold_call(pg_temp.mid('agent-sheet'), '10000000-0000-4000-8000-000000000005', 'unsure', 'x', 0.6),
  'needs_decision', 'F14: a call with a sheet can still be handed to a person');
select is((select type::text from meetings where id = pg_temp.mid('agent-sheet')), 'client',
  'F14: and keeps the client label its sheet was written under');

select * from finish();
rollback;
