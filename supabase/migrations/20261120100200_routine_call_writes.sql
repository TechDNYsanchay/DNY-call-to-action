-- Phone calls (2026-11-20), part 3: the routine's writes that end its work on a call it claimed, checked in the
-- transaction that makes them. purge_call (part 2, F10) also serves people, the no-speech rule and the expiry,
-- which hold no claim, so the routine's purge goes through purge_claimed_call. What the routine checked before
-- deleting or handing a call to a person must still hold when it writes: the call is 'processing' under the
-- routine's claim and nobody has marked it a client or vendor call (and, for a purge, it has no sheet).
-- mark_call_business (and so decide_call) locks the same meetings row, so a person's label and the routine's
-- purge or hold never both win. Also F25, the earlier business call with the same number, looked up in the
-- database so the number never leaves it.

-- F24. Raises call_not_found, claim_mismatch, human_label or has_sheet; otherwise returns what purge_call
--      returns (the storage path to remove, or null when no audio was stored).
create or replace function purge_claimed_call(p_meeting_id uuid, p_claim uuid, p_code text, p_reason text,
                                              p_summary text default null)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
begin
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call_not_found'; end if;
  if p_claim is null or v.process_status <> 'processing' or v.claim_token is distinct from p_claim then
    raise exception 'claim_mismatch';
  end if;
  if v.type_source = 'human' and v.type in ('client', 'vendor') then raise exception 'human_label'; end if;
  if exists (select 1 from sheets s where s.meeting_id = p_meeting_id) then raise exception 'has_sheet'; end if;
  return purge_call(p_meeting_id, p_code, p_reason, 'routine', p_summary);
end $$;

-- F14 (replaces part 2's): as before, and a call a person has marked client or vendor is never handed back to
--      a person by the routine (raises human_label); the person's label stands and the routine writes the sheet.
--      A client or vendor label the routine itself gave on an earlier run (and no sheet came of it) is undone:
--      the call is undecided again, as when it arrived (type unknown, no client, guess, title or saved name on
--      the team-readable rows, its turns back in the secret store), so only admins and the line's people see it
--      until someone decides, and it no longer counts as an earlier business call for this number (F25).
create or replace function hold_call(p_meeting_id uuid, p_claim uuid, p_kind text, p_reason text, p_confidence numeric)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
  v_undo boolean;
begin
  if p_kind not in ('unsure', 'held') then raise exception 'unknown hold kind %', p_kind; end if;
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call_not_found'; end if;
  if v.process_status <> 'processing' or v.claim_token is distinct from p_claim then raise exception 'claim_mismatch'; end if;
  if v.type_source = 'human' and v.type in ('client', 'vendor') then raise exception 'human_label'; end if;
  v_undo := v.type in ('client', 'vendor') and not exists (select 1 from sheets s where s.meeting_id = p_meeting_id);
  update meetings
  set process_status = 'needs_decision', claimed_at = null, claim_token = null,
      type_source = case when type_source = 'human' then type_source else 'llm'::type_source end,
      type_confidence = case when type_source = 'human' then type_confidence
                             else round(least(greatest(p_confidence, 0), 1), 2) end,
      type_reason = left(p_reason, 300),
      type = case when v_undo then 'unknown'::meeting_type else type end,
      client_id = case when v_undo then null else client_id end,
      client_name_guess = case when v_undo then null else client_name_guess end,
      title = case when v_undo then null else title end
  where id = p_meeting_id;
  update phone_calls
  set decision_reason = p_kind, decision_since = now(),
      counterpart_name = case when v_undo then null else counterpart_name end
  where meeting_id = p_meeting_id;
  if v_undo then
    insert into call_transcripts (meeting_id, turns, sentence_count, word_count, fetched_at)
    select t.meeting_id, t.turns, t.sentence_count, t.word_count, t.fetched_at
    from transcripts t where t.meeting_id = p_meeting_id
    on conflict (meeting_id) do update set turns = excluded.turns, sentence_count = excluded.sentence_count,
      word_count = excluded.word_count, fetched_at = excluded.fetched_at;
    delete from transcripts where meeting_id = p_meeting_id;
  end if;
  insert into agent_runs (meeting_id, kind, status, attempt, summary)
  values (p_meeting_id, 'classify', 'ok', greatest(v.process_attempts, 1), left(p_reason, 300));
  return 'needs_decision';
end $$;

-- F25. The newest other call with the same number that is still a client or vendor call (not purged), for the
--      routine's package (counterpart.previouslyBusiness) and its holds (known_number). The caller sends only the
--      call's id: a lookup by number through the API would put the full number in the gateway's request log.
--      No row when the number is hidden or no earlier call with it is a client or vendor call still kept.
create or replace function previous_business_call(p_meeting_id uuid)
returns table (type meeting_type, client text)
language sql stable security invoker set search_path = public as $$
  select m.type, case when m.type = 'client' then c.name end
  from call_log mine
  join call_log other on other.counterpart_e164 = mine.counterpart_e164 and other.meeting_id <> mine.meeting_id
  join meetings m on m.id = other.meeting_id and m.type in ('client', 'vendor')
  join phone_calls pc on pc.meeting_id = m.id and pc.purged_at is null
  left join clients c on c.id = m.client_id
  where mine.meeting_id = p_meeting_id
  order by other.call_started_at desc
  limit 1
$$;

-- Pipeline functions: secret key only, like every function of part 2 (CREATE OR REPLACE keeps hold_call's
-- grants; they are restated so this file reads on its own).
revoke all on function purge_claimed_call(uuid, uuid, text, text, text), hold_call(uuid, uuid, text, text, numeric),
  previous_business_call(uuid)
  from public, anon, authenticated;
grant execute on function purge_claimed_call(uuid, uuid, text, text, text), hold_call(uuid, uuid, text, text, numeric),
  previous_business_call(uuid)
  to service_role;
