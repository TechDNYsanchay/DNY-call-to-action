-- Phone calls from Callyzer (2026-11-20), part 2 of 2.
-- A connected call of 45 s to 90 min on one of DNY's client-work phone lines, with someone outside DNY and a
-- real recording, becomes a meetings row (kind = 'call') plus a phone_calls row, so the routine, sheets,
-- action items and My actions work unchanged. The Claude routine decides client, vendor or not a work call.
-- Visibility: existing RLS policies are not changed. Business calls are readable by every active person, like
-- meetings. Until a call is business its turns live in call_transcripts (secret key only) and the app shows
-- its audio only to admins and the line's people. Full numbers, saved contact names of undecided calls and the
-- recording links (bearer URLs that never expire) live only in call_log (secret key only). Audio sits in the
-- private bucket call-recordings, which has no storage policies.

-- 1. Meetings: what a row is, its source id, the routine's claim token ----------------------------------------
alter table meetings add column kind text not null default 'meeting';
alter table meetings add constraint meetings_kind_check check (kind in ('meeting', 'call'));
alter table meetings alter column tldv_meeting_id drop not null;
alter table meetings add column callyzer_call_id text;
alter table meetings add constraint meetings_callyzer_call_id_key unique (callyzer_call_id);
alter table meetings add constraint meetings_source_id_by_kind check (
  (kind = 'meeting' and tldv_meeting_id is not null and callyzer_call_id is null)
  or (kind = 'call' and callyzer_call_id is not null and tldv_meeting_id is null));
-- Set at every claim; the routine echoes it so a run only writes the call it claimed.
alter table meetings add column claim_token uuid;
create index meetings_kind_happened_idx on meetings (kind, happened_at desc);

-- 2. Phone lines: DNY phones Callyzer tracks. The number is a natural key that members never read
--    (column grants below); every other table points at the surrogate id.
create table phone_lines (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  callyzer_name text not null check (char_length(callyzer_name) between 1 and 120),
  label text check (label is null or char_length(label) between 1 and 60),
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references people (id) on delete set null,
  -- Calls that started before this instant are never analysed: the moment the line was switched on.
  analyse_from timestamptz,
  first_seen_at timestamptz not null default now(),
  last_call_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint phone_lines_enabled_has_start check (not enabled or analyse_from is not null)
);
create trigger phone_lines_updated_at before update on phone_lines for each row execute function set_updated_at();

create table phone_line_members (
  line_id uuid not null references phone_lines (id) on delete cascade,
  person_id uuid not null references people (id) on delete cascade,
  primary key (line_id, person_id)
);
create index phone_line_members_person_idx on phone_line_members (person_id);

-- 3. Intake ledger: one row per candidate call. Secret key only.
--    waiting (no link yet) · pending (link, to copy) · running (copy leased) · promoted (meetings row exists)
--    empty (stub file) · no_recording (no link 36 h after the call) · failed (copy kept failing)
--    dropped (line switched off, or the call predates the line's switch-on)
create table call_log (
  callyzer_id text primary key check (char_length(callyzer_id) between 1 and 200),
  line_id uuid not null references phone_lines (id),
  direction text not null check (direction in ('incoming', 'outgoing')),
  call_started_at timestamptz not null,
  duration_sec integer not null check (duration_sec >= 0),
  counterpart_e164 text check (counterpart_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  counterpart_masked text not null,
  counterpart_name text,
  recording_url text check (recording_url ~ '^https://'),
  -- Where the copy goes; set by the copy claim before any upload, so a crash never orphans an object.
  storage_path text,
  status text not null default 'waiting'
    check (status in ('waiting', 'pending', 'running', 'promoted', 'empty', 'no_recording', 'failed', 'dropped')),
  attempts integer not null default 0,
  started_at timestamptz,
  next_try_at timestamptz,
  first_error_at timestamptz,
  error text,
  error_kind text,
  bytes integer,
  recording_seen_at timestamptz,
  meeting_id uuid references meetings (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index call_log_work_idx on call_log (status, call_started_at desc) where status in ('waiting', 'pending', 'running');
create index call_log_counterpart_idx on call_log (counterpart_e164) where counterpart_e164 is not null;
create index call_log_started_idx on call_log (call_started_at);
create index call_log_line_idx on call_log (line_id, call_started_at desc);
create unique index call_log_meeting_idx on call_log (meeting_id) where meeting_id is not null;
create trigger call_log_updated_at before update on call_log for each row execute function set_updated_at();

-- 4. Call facts, one row per promoted call; every active person reads them, like meetings.
create table phone_calls (
  meeting_id uuid primary key references meetings (id) on delete cascade,
  callyzer_call_id text not null unique,
  line_id uuid not null references phone_lines (id),
  direction text not null check (direction in ('incoming', 'outgoing')),
  counterpart_masked text not null,
  -- The contact name saved on the DNY phone; filled only once the routine or a person says it is business.
  counterpart_name text,
  recording_path text,
  recording_mime text,
  recording_bytes integer,
  recording_playable boolean not null default true,
  recording_status text not null default 'stored' check (recording_status in ('stored', 'deleted')),
  recording_duration_sec numeric(8, 2),
  speaker_count integer,
  stt_status text not null default 'pending' check (stt_status in ('pending', 'running', 'done', 'failed')),
  stt_attempts integer not null default 0,
  stt_started_at timestamptz,
  stt_next_try_at timestamptz,
  stt_first_error_at timestamptz,
  stt_error text,
  stt_error_kind text,
  stt_provider text,
  stt_audio_sec numeric(8, 2),
  -- needs_decision for calls: 'unsure' (deleted after calls_decision_hours) or 'held' (a person must decide).
  decision_reason text check (decision_reason in ('unsure', 'held')),
  decision_since timestamptz,
  skip_code text check (skip_code in ('no_speech', 'personal', 'internal', 'sales', 'wrong_number', 'no_content',
                                      'not_business', 'undecided', 'line_off')),
  purged_at timestamptz,
  purged_by text check (purged_by in ('routine', 'person', 'system')),
  call_ended_at timestamptz not null,
  seen_at timestamptz not null,
  recording_seen_at timestamptz,
  stored_at timestamptz not null default now(),
  transcribed_at timestamptz,
  ready_at timestamptz,
  first_claimed_at timestamptz,
  first_sheet_at timestamptz,
  media_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index phone_calls_line_idx on phone_calls (line_id);
create index phone_calls_stt_work_idx on phone_calls (stt_status, stt_next_try_at) where stt_status in ('pending', 'running');
create index phone_calls_stored_idx on phone_calls (stored_at) where recording_status = 'stored';
create index phone_calls_purged_idx on phone_calls (purged_at desc) where purged_at is not null;
create trigger phone_calls_updated_at before update on phone_calls for each row execute function set_updated_at();

-- 5. Secret-only helpers ------------------------------------------------------------------------------------
-- Turns of a call that is not yet known to be business. mark_call_business moves them into transcripts.
create table call_transcripts (
  meeting_id uuid primary key references meetings (id) on delete cascade,
  turns jsonb not null,
  sentence_count integer not null default 0,
  word_count integer not null default 0,
  fetched_at timestamptz not null default now()
);
-- One row per transcription attempt: seconds reserved against the daily cap (actual seconds once done,
-- 0 when the provider refused before billing).
create table call_stt_usage (
  id bigint generated always as identity primary key,
  meeting_id uuid references meetings (id) on delete set null,
  reserved_sec numeric(8, 2) not null check (reserved_sec >= 0),
  outcome text not null default 'running' check (outcome in ('running', 'done', 'not_billed', 'failed')),
  created_at timestamptz not null default now()
);
create index call_stt_usage_created_idx on call_stt_usage (created_at);
create index call_stt_usage_meeting_idx on call_stt_usage (meeting_id, id desc);
-- Storage objects to remove (purges, retention, abandoned copies, orphans). Drained by every calls run.
create table storage_deletions (
  path text primary key,
  reason text not null check (reason in ('purge', 'retention', 'copy_abandoned', 'line_off', 'orphan')),
  last_error text,
  last_tried_at timestamptz,
  created_at timestamptz not null default now()
);
-- An admin's "Re-read a day from Callyzer"; the job sets done_at after that day polled successfully.
create table call_reread_requests (
  day date primary key,
  requested_by uuid references people (id) on delete set null,
  requested_at timestamptz not null default now(),
  done_at timestamptz
);

-- 6. Settings, bookkeeping, the sales view ----------------------------------------------------------------
insert into settings (key, value) values
  ('calls_paused', 'true'),                       -- ships paused; unpaused by the main session after launch steps
  ('calls_min_duration_sec', '45'),
  ('calls_max_minutes', '90'),                    -- longer calls are counted, never analysed
  ('calls_initial_lines', '["Ashwini Bhambani", "keyur dny supply chain"]'),
  ('calls_dny_numbers', '[]'),
  ('calls_max_audio_minutes_per_day', '240'),
  ('calls_audio_retention_days', '30'),
  ('calls_claim_timeout_minutes', '20'),
  ('calls_decision_hours', '24'),
  ('calls_undecided_failed_days', '3'),
  ('calls_routine_purges_per_hour', '4'),
  ('calls_deepgram_mip_opt_out', 'true'),
  ('calls_night_poll_minutes', '2')               -- D6; Tarique may choose 10 for 23:30-08:30 IST
on conflict (key) do nothing;
-- The routine now takes up to 8 items per run (meetings and calls); the API does not enforce it.
update settings set value = '8' where key = 'max_per_run' and value = '5'::jsonb;
insert into sync_state (key) values ('callyzer') on conflict (key) do nothing;

-- The hand-off view lists tl;dv meetings only (same columns, so CREATE OR REPLACE is allowed).
create or replace view v_sales_meetings_ready with (security_invoker = true) as
  select tldv_meeting_id, title, happened_at, tldv_url, transcript_ready, type_source, type_confidence
  from meetings where type = 'sales' and kind = 'meeting';

-- 7. Private audio bucket, 50 MB per file (a 90-minute call at 32 kbps is about 21 MB) ----------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-recordings', 'call-recordings', false, 52428800,
        array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/amr', 'audio/3gpp',
              'application/octet-stream'])
on conflict (id) do nothing;

-- 8. Row-level security and grants for the NEW tables only (no existing policy changes) ------------------
alter table phone_lines enable row level security;
alter table phone_line_members enable row level security;
alter table phone_calls enable row level security;
alter table call_log enable row level security;              -- no policies: secret key only
alter table call_transcripts enable row level security;      -- no policies: secret key only
alter table call_stt_usage enable row level security;        -- no policies: secret key only
alter table storage_deletions enable row level security;     -- no policies: secret key only
alter table call_reread_requests enable row level security;  -- no policies: secret key only
create policy phone_lines_read on phone_lines for select to authenticated using (is_active_person());
create policy phone_line_members_read on phone_line_members for select to authenticated using (is_active_person());
create policy phone_calls_read on phone_calls for select to authenticated using (is_active_person());
revoke all on phone_lines, phone_line_members, phone_calls, call_log, call_transcripts, call_stt_usage,
  storage_deletions, call_reread_requests from anon, authenticated;
-- Members read every line column except the number.
grant select (id, callyzer_name, label, enabled, enabled_at, analyse_from, first_seen_at, last_call_at, updated_at)
  on phone_lines to authenticated;
grant select on phone_line_members, phone_calls to authenticated;
grant all on phone_lines, phone_line_members, phone_calls, call_log, call_transcripts, call_stt_usage,
  storage_deletions, call_reread_requests to service_role;

-- 9. Functions ---------------------------------------------------------------------------------------------

-- F1. The routine's queue: meetings first, in exactly today's order (oldest first); then calls, newest first.
--     Each claim gets a fresh token that the routine echoes on classify, save, skip and release.
create or replace function claim_next_meeting(p_exclude uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id
  from meetings
  where process_status = 'ready'
    and transcript_ready
    and not (id = any (p_exclude))
  order by (kind = 'call'), case when kind = 'meeting' then happened_at end, happened_at desc
  limit 1
  for update skip locked;
  if v_id is null then
    return null;
  end if;
  update meetings
  set process_status = 'processing', claimed_at = now(), process_attempts = process_attempts + 1,
      claim_token = gen_random_uuid()
  where id = v_id;
  update phone_calls set first_claimed_at = coalesce(first_claimed_at, now()) where meeting_id = v_id;
  return v_id;
end $$;

-- F2. Call claims older than p_minutes go back to 'ready' (or 'failed' once attempts are used up). The token is
--     cleared, so a late write from that run fails. Meetings keep release_stale_claims (90 min, unchanged).
create or replace function release_stale_call_claims(p_minutes integer, p_max_attempts integer) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_count integer;
begin
  with released as (
    update meetings m
    set process_status = case when m.process_attempts >= p_max_attempts then 'failed'::process_status
                              else 'ready'::process_status end,
        failure_reason = case when m.process_attempts >= p_max_attempts
                              then 'The routine did not finish this call after ' || m.process_attempts || ' attempts.'
                              else m.failure_reason end,
        claimed_at = null, claim_token = null
    where m.kind = 'call' and m.process_status = 'processing'
      and m.claimed_at < now() - make_interval(mins => p_minutes)
    returning m.id, m.process_attempts, m.process_status
  )
  insert into agent_runs (meeting_id, kind, status, attempt, summary)
  select r.id, case when r.process_status = 'failed' then 'fail' else 'release' end, 'ok', greatest(r.process_attempts, 1),
         'The claim timed out after ' || p_minutes || ' minutes.'
  from released r;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- F3. Lines seen in a poll. New lines are added; a line whose Callyzer name is in calls_initial_lines (case and
--     spacing ignored) is created ON with analyse_from = now(). Known lines only get a new name or a later call.
--     Members read callyzer_name, so a phone number in a name is removed (as nameWithoutNumber() in
--     src/lib/phone.ts); a line left without a name is "Phone ending NNN", and a row without a name never
--     replaces the name a line already has.
create or replace function register_phone_lines(p_lines jsonb)
returns table (line_id uuid, phone text, callyzer_name text, created boolean, enabled boolean)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with initial as (
    select lower(regexp_replace(btrim(e.raw_name), '\s+', ' ', 'g')) as name
    from settings s
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(s.value) = 'array' then s.value
                                                      else '[]'::jsonb end) as e(raw_name)
    where s.key = 'calls_initial_lines'
  ), sent as (
    select l.phone, l.name, l.last_call_at,
           btrim(regexp_replace(regexp_replace(coalesce(l.name, ''), '\+?\d[\d\s().-]{5,}\d', ' ', 'g'), '\s+', ' ', 'g'))
             as clean
    from jsonb_to_recordset(p_lines) as l(phone text, name text, last_call_at timestamptz)
    where l.phone ~ '^\+[1-9][0-9]{7,14}$'
  ), incoming as (
    -- One row per number: its latest call, and the latest name with a letter in it (the preset match reads that
    -- row's name as sent).
    select distinct on (s.phone)
           s.phone as ph,
           left(coalesce(case when s.clean ~ '[[:alpha:]]' then s.clean end, 'Phone ending ' || right(s.phone, 3)), 120)
             as nm,
           max(s.last_call_at) over (partition by s.phone) as last_at,
           exists (select 1 from initial i
                   where i.name = lower(regexp_replace(btrim(coalesce(s.name, '')), '\s+', ' ', 'g'))) as preset
    from sent s
    order by s.phone, s.clean ~ '[[:alpha:]]' desc, s.last_call_at desc nulls last
  ), written as (
    insert into phone_lines as pl (phone, callyzer_name, last_call_at, enabled, enabled_at, analyse_from)
    select i.ph, i.nm, i.last_at, i.preset, case when i.preset then now() end, case when i.preset then now() end
    from incoming i
    on conflict (phone) do update
      -- "Phone ending NNN" means no name was sent: the line keeps its name and only its last call moves.
      set callyzer_name = case when excluded.callyzer_name = 'Phone ending ' || right(excluded.phone, 3)
                               then pl.callyzer_name else excluded.callyzer_name end,
          last_call_at = greatest(pl.last_call_at, excluded.last_call_at)
      where (excluded.callyzer_name <> 'Phone ending ' || right(excluded.phone, 3)
             and pl.callyzer_name is distinct from excluded.callyzer_name)
         or pl.last_call_at is null
         or pl.last_call_at < excluded.last_call_at
    returning pl.id as lid, pl.phone as lph, pl.callyzer_name as lnm, (pl.xmax = 0) as is_new, pl.enabled as en
  )
  select w.lid, w.lph, w.lnm, w.is_new, w.en from written w;
end $$;

-- F4. Candidate calls from a poll. New ones are inserted ('waiting' without a link, 'pending' with one). A known
--     call not yet copied takes a new link, contact name or duration; a link revives 'waiting' and 'no_recording';
--     a 'failed' call reopens only on a different link. A call with a meetings row is never ingested again.
create or replace function upsert_call_log(p_rows jsonb)
returns table (callyzer_id text, status text, inserted boolean)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with incoming as (
    select distinct on (r.callyzer_id) r.*
    from jsonb_to_recordset(p_rows) as r(callyzer_id text, line_id uuid, direction text, call_started_at timestamptz,
         duration_sec integer, counterpart_e164 text, counterpart_masked text, counterpart_name text, recording_url text)
    where not exists (select 1 from meetings m where m.callyzer_call_id = r.callyzer_id)
    order by r.callyzer_id
  ), written as (
    insert into call_log as c (callyzer_id, line_id, direction, call_started_at, duration_sec, counterpart_e164,
                               counterpart_masked, counterpart_name, recording_url, status, recording_seen_at)
    select i.callyzer_id, i.line_id, i.direction, i.call_started_at, i.duration_sec, i.counterpart_e164,
           i.counterpart_masked, i.counterpart_name, i.recording_url,
           case when i.recording_url is null then 'waiting' else 'pending' end,
           case when i.recording_url is not null then now() end
    from incoming i
    on conflict (callyzer_id) do update set
      recording_url = coalesce(excluded.recording_url, c.recording_url),
      status = case
        when excluded.recording_url is not null and c.status in ('waiting', 'no_recording') then 'pending'
        when excluded.recording_url is not null and c.status = 'failed'
             and excluded.recording_url is distinct from c.recording_url then 'pending'
        else c.status end,
      attempts = case when c.status = 'failed' and excluded.recording_url is not null
                           and excluded.recording_url is distinct from c.recording_url then 0 else c.attempts end,
      first_error_at = case when c.status = 'failed' and excluded.recording_url is not null
                                 and excluded.recording_url is distinct from c.recording_url then null
                            else c.first_error_at end,
      next_try_at = case when c.status in ('waiting', 'no_recording', 'failed') and excluded.recording_url is not null
                         then null else c.next_try_at end,
      recording_seen_at = coalesce(c.recording_seen_at, case when excluded.recording_url is not null then now() end),
      counterpart_name = excluded.counterpart_name,
      duration_sec = excluded.duration_sec
    where c.status in ('waiting', 'pending', 'failed', 'no_recording')
      and ((excluded.recording_url is not null and excluded.recording_url is distinct from c.recording_url)
           or (excluded.recording_url is not null and c.status in ('waiting', 'no_recording'))
           or excluded.counterpart_name is distinct from c.counterpart_name
           or excluded.duration_sec is distinct from c.duration_sec)
    returning c.callyzer_id as cid, c.status as st, (c.xmax = 0) as is_new
  )
  select w.cid, w.st, w.is_new from written w;
end $$;

-- F5. Reserve transcription seconds against today's cap (IST day). Serialised by an advisory lock, so two
--     workers cannot both pass the check. The first reservation of a day is always allowed.
create or replace function reserve_call_stt(p_meeting_id uuid, p_expected_sec numeric, p_cap_minutes integer)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  v_used numeric;
  v_need numeric := greatest(coalesce(p_expected_sec, 0), 0);
begin
  perform pg_advisory_xact_lock(hashtext('call_stt_cap'));
  select coalesce(sum(u.reserved_sec), 0) into v_used
  from call_stt_usage u
  where u.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  if v_used > 0 and v_used + v_need > greatest(p_cap_minutes, 1) * 60 then
    return false;
  end if;
  insert into call_stt_usage (meeting_id, reserved_sec) values (p_meeting_id, v_need);
  return true;
end $$;

-- F6. Media lease. Frees leases a stopped run left behind, drops queued rows whose line is off or that predate
--     its switch-on, then takes the newest recording to copy, otherwise (when p_transcribe) the newest stored
--     recording still waiting for its transcript, reserving its minutes first ('cap' when the cap is reached).
--     Every copy lease gets a NEW storage path (fixed prefix + 8 random hex), recorded before any upload; the
--     previous lease's path, if any, is queued for deletion. A queued path is therefore never reused, so the
--     drain can never remove a live recording.
create or replace function claim_call_work(p_stale_minutes integer, p_max_attempts integer, p_cap_minutes integer,
                                           p_transcribe boolean)
returns table (work text, callyzer_id text, meeting_id uuid, recording_url text, storage_path text,
               duration_sec integer, attempt integer)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  v_id text;
  v_meeting uuid;
  v_expected numeric;
begin
  with stale as (
    update call_log c
    set status = case when c.attempts >= p_max_attempts then 'failed' else 'pending' end,
        started_at = null,
        error = case when c.attempts >= p_max_attempts then 'Copying the recording stopped responding' else c.error end,
        error_kind = case when c.attempts >= p_max_attempts then 'stalled' else c.error_kind end
    where c.status = 'running' and c.started_at < now() - make_interval(mins => p_stale_minutes)
    returning c.storage_path as path, c.status as next_status
  )
  insert into storage_deletions (path, reason)
  select s.path, 'copy_abandoned' from stale s where s.next_status = 'failed' and s.path is not null
  on conflict (path) do nothing;

  with stale as (
    update phone_calls pc
    set stt_status = case when pc.stt_attempts >= p_max_attempts then 'failed' else 'pending' end,
        stt_started_at = null,
        stt_error = case when pc.stt_attempts >= p_max_attempts then 'Transcription stopped responding' else pc.stt_error end,
        stt_error_kind = case when pc.stt_attempts >= p_max_attempts then 'stalled' else pc.stt_error_kind end
    where pc.stt_status = 'running' and pc.stt_started_at < now() - make_interval(mins => p_stale_minutes)
    returning pc.meeting_id as id, pc.stt_status as next_status
  )
  update meetings m
  set process_status = 'failed', failure_reason = 'Transcription stopped responding after ' || p_max_attempts || ' attempts.'
  from stale
  where stale.id = m.id and stale.next_status = 'failed' and m.process_status = 'waiting_transcript';

  with gone as (
    update call_log c
    set status = 'dropped', recording_url = null
    from phone_lines pl
    where pl.id = c.line_id and c.status in ('waiting', 'pending')
      and (not pl.enabled or pl.analyse_from is null or c.call_started_at < pl.analyse_from)
    returning c.storage_path as path
  )
  insert into storage_deletions (path, reason)
  select g.path, 'line_off' from gone g where g.path is not null
  on conflict (path) do nothing;

  select c.callyzer_id into v_id
  from call_log c
  join phone_lines pl on pl.id = c.line_id
  where c.status = 'pending' and pl.enabled and c.call_started_at >= pl.analyse_from
    and c.attempts < p_max_attempts and (c.next_try_at is null or c.next_try_at <= now())
  order by c.call_started_at desc
  limit 1
  for update of c skip locked;
  if v_id is not null then
    insert into storage_deletions (path, reason)
    select c.storage_path, 'copy_abandoned' from call_log c where c.callyzer_id = v_id and c.storage_path is not null
    on conflict (path) do nothing;
    return query
      with leased as (
        update call_log c
        set status = 'running', started_at = now(), attempts = c.attempts + 1,
            storage_path = 'calls/' || to_char(c.call_started_at at time zone 'Asia/Kolkata', 'YYYY/MM') || '/'
              || substr(encode(sha256(convert_to(c.callyzer_id, 'UTF8')), 'hex'), 1, 32)
              || '-' || substr(md5(gen_random_uuid()::text), 1, 8)
        where c.callyzer_id = v_id
        returning c.callyzer_id as cid, c.recording_url as url, c.storage_path as path, c.duration_sec as dur,
                  c.attempts as att
      )
      select 'copy'::text, l.cid, null::uuid, l.url, l.path, l.dur, l.att from leased l;
    return;
  end if;

  if not p_transcribe then
    return;
  end if;
  select pc.meeting_id, coalesce(pc.recording_duration_sec, m.duration_sec) into v_meeting, v_expected
  from phone_calls pc
  join meetings m on m.id = pc.meeting_id
  join phone_lines pl on pl.id = pc.line_id
  where m.process_status = 'waiting_transcript' and not m.transcript_ready and pl.enabled
    and pc.stt_status = 'pending' and pc.stt_attempts < p_max_attempts and pc.recording_path is not null
    and pc.purged_at is null and (pc.stt_next_try_at is null or pc.stt_next_try_at <= now())
  order by m.happened_at desc
  limit 1
  for update of pc skip locked;
  if v_meeting is null then
    return;
  end if;
  if not reserve_call_stt(v_meeting, v_expected, p_cap_minutes) then
    return query select 'cap'::text, null::text, v_meeting, null::text, null::text, null::integer, null::integer;
    return;
  end if;
  return query
    with leased as (
      update phone_calls pc set stt_status = 'running', stt_started_at = now(), stt_attempts = pc.stt_attempts + 1
      where pc.meeting_id = v_meeting
      returning pc.callyzer_call_id as cid, pc.meeting_id as mid, pc.recording_path as path, pc.stt_attempts as att
    )
    select 'transcribe'::text, l.cid, l.mid, null::text, l.path, m.duration_sec, l.att
    from leased l join meetings m on m.id = l.mid;
end $$;

-- F7. How one copy attempt ended.
--     empty: stub file, final. transient (host 5xx, timeout, network, storage 5xx): attempt given back, retried
--     with a backoff of 5-60 min, failed after 24 h. content (4xx, redirect, wrong type or format, host not
--     allowed): counts, retried in 10 min, failed after p_max_attempts. too_large: final. A failed row queues its
--     object (an upload may already have happened).
create or replace function finish_call_copy(p_callyzer_id text, p_outcome text, p_error text default null,
                                            p_error_kind text default null, p_bytes integer default null,
                                            p_max_attempts integer default 3)
returns text language plpgsql security invoker set search_path = public as $$
declare
  c call_log%rowtype;
begin
  if p_outcome not in ('empty', 'transient', 'content', 'too_large') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  select * into c from call_log where callyzer_id = p_callyzer_id for update;
  if not found then return 'missing'; end if;
  if c.status <> 'running' then return c.status; end if;
  if p_outcome = 'empty' then
    update call_log set status = 'empty', recording_url = null, bytes = p_bytes, started_at = null,
           error = null, error_kind = null
    where callyzer_id = p_callyzer_id;
    return 'empty';
  end if;
  if p_outcome = 'transient' and (c.first_error_at is null or c.first_error_at > now() - interval '24 hours') then
    update call_log
    set status = 'pending', started_at = null, attempts = greatest(c.attempts - 1, 0),
        next_try_at = now() + least(interval '60 minutes',
                                    greatest(interval '5 minutes', (now() - coalesce(c.first_error_at, now())) / 4)),
        error = left(p_error, 300), error_kind = p_error_kind, first_error_at = coalesce(c.first_error_at, now())
    where callyzer_id = p_callyzer_id;
    return 'retry';
  end if;
  if p_outcome = 'content' and c.attempts < p_max_attempts then
    update call_log set status = 'pending', started_at = null, next_try_at = now() + interval '10 minutes',
           error = left(p_error, 300), error_kind = p_error_kind
    where callyzer_id = p_callyzer_id;
    return 'retry';
  end if;
  update call_log
  set status = 'failed', started_at = null, bytes = coalesce(p_bytes, c.bytes),
      error = left(coalesce(p_error, 'The recording host kept failing for 24 hours'), 300), error_kind = p_error_kind
  where callyzer_id = p_callyzer_id;
  if c.storage_path is not null then
    insert into storage_deletions (path, reason) values (c.storage_path, 'copy_abandoned') on conflict (path) do nothing;
  end if;
  return 'failed';
end $$;

-- F8. A real recording was uploaded: create the call (meetings + phone_calls) in one transaction, clear the
--     bearer link, and keep the transcription lease with the worker when minutes are left today
--     ('transcribe'), else leave it pending ('wait'). A line that is off by now gets 'dropped'. Idempotent.
create or replace function promote_call(p_callyzer_id text, p_recording_path text, p_mime text, p_bytes integer,
                                        p_playable boolean, p_cap_minutes integer, p_transcribe boolean)
returns table (meeting_id uuid, outcome text)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  c call_log%rowtype;
  v_line phone_lines%rowtype;
  v_member people%rowtype;
  v_members integer;
  v_id uuid;
  v_go boolean := false;
begin
  select * into c from call_log where callyzer_id = p_callyzer_id for update;
  if not found then raise exception 'call is not in call_log'; end if;
  if c.meeting_id is not null then
    return query select c.meeting_id, 'wait'::text;
    return;
  end if;
  select * into v_line from phone_lines where id = c.line_id for share;
  if not v_line.enabled or v_line.analyse_from is null or c.call_started_at < v_line.analyse_from then
    update call_log set status = 'dropped', recording_url = null, started_at = null where callyzer_id = c.callyzer_id;
    insert into storage_deletions (path, reason) values (p_recording_path, 'line_off') on conflict (path) do nothing;
    return query select null::uuid, 'dropped'::text;
    return;
  end if;
  select count(*) into v_members
  from phone_line_members lm join people p on p.id = lm.person_id
  where lm.line_id = c.line_id and p.active;
  if v_members = 1 then
    select p.* into v_member from people p join phone_line_members lm on lm.person_id = p.id
    where lm.line_id = c.line_id and p.active;
  end if;
  insert into meetings (kind, callyzer_call_id, title, happened_at, duration_sec, organizer_email, organizer_name,
                        type, process_status, source, raw)
  values ('call', c.callyzer_id, null, c.call_started_at, c.duration_sec, v_member.email,
          coalesce(v_member.full_name, v_line.label, v_line.callyzer_name), 'unknown', 'waiting_transcript', 'poll',
          jsonb_build_object('source', 'callyzer'))
  on conflict (callyzer_call_id) do nothing
  returning id into v_id;
  if v_id is null then
    -- A meetings row exists but the ledger lost its link: re-link it, never create a second call.
    select id into v_id from meetings where callyzer_call_id = c.callyzer_id;
    update call_log set status = 'promoted', meeting_id = v_id, recording_url = null, started_at = null
    where callyzer_id = c.callyzer_id;
    insert into storage_deletions (path, reason) values (p_recording_path, 'copy_abandoned') on conflict (path) do nothing;
    return query select v_id, 'wait'::text;
    return;
  end if;
  if p_transcribe then
    v_go := reserve_call_stt(v_id, c.duration_sec, p_cap_minutes);
  end if;
  insert into phone_calls (meeting_id, callyzer_call_id, line_id, direction, counterpart_masked, recording_path,
                           recording_mime, recording_bytes, recording_playable, stt_status, stt_attempts,
                           stt_started_at, call_ended_at, seen_at, recording_seen_at)
  values (v_id, c.callyzer_id, c.line_id, c.direction, c.counterpart_masked, p_recording_path, p_mime, p_bytes,
          p_playable, case when v_go then 'running' else 'pending' end, case when v_go then 1 else 0 end,
          case when v_go then now() end, c.call_started_at + make_interval(secs => c.duration_sec),
          c.first_seen_at, c.recording_seen_at);
  update call_log set status = 'promoted', meeting_id = v_id, recording_url = null, bytes = p_bytes,
         started_at = null, error = null, error_kind = null
  where callyzer_id = c.callyzer_id;
  return query select v_id, case when v_go then 'transcribe' else 'wait' end;
end $$;

-- F9. How one transcription attempt ended (a transcript itself goes through save_call_transcript).
--     not_billed (401/402/403 'auth'|'credit', 429 'rate'): reservation released, attempt given back; auth and
--     credit never fail by themselves, rate fails after 24 h. transient (5xx, timeout, network) and content
--     (400, other 4xx, no words): counted, retried in 5 / 10 min, failed after p_max_attempts. final: fails now.
--     A retry touches meetings.updated_at so Realtime shows "Retrying" at once.
create or replace function finish_call_transcription(p_meeting_id uuid, p_outcome text, p_error text default null,
                                                     p_error_kind text default null, p_max_attempts integer default 3)
returns text language plpgsql security invoker set search_path = public as $$
declare
  pc phone_calls%rowtype;
begin
  if p_outcome not in ('not_billed', 'transient', 'content', 'final') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  select * into pc from phone_calls where meeting_id = p_meeting_id for update;
  if not found then return 'missing'; end if;
  if pc.stt_status <> 'running' then return pc.stt_status; end if;
  update call_stt_usage
  set outcome = case when p_outcome = 'not_billed' then 'not_billed' else 'failed' end,
      reserved_sec = case when p_outcome = 'not_billed' then 0 else reserved_sec end
  where id = (select max(u.id) from call_stt_usage u where u.meeting_id = p_meeting_id and u.outcome = 'running');
  if p_outcome = 'not_billed'
     and (p_error_kind in ('auth', 'credit')
          or pc.stt_first_error_at is null or pc.stt_first_error_at > now() - interval '24 hours') then
    update phone_calls
    set stt_status = 'pending', stt_started_at = null, stt_attempts = greatest(pc.stt_attempts - 1, 0),
        stt_next_try_at = now() + case when p_error_kind = 'rate' then interval '5 minutes' else interval '10 minutes' end,
        stt_error = left(p_error, 300), stt_error_kind = p_error_kind,
        stt_first_error_at = case when p_error_kind = 'rate' then coalesce(pc.stt_first_error_at, now())
                                  else pc.stt_first_error_at end
    where meeting_id = p_meeting_id;
    update meetings set updated_at = now() where id = p_meeting_id and process_status = 'waiting_transcript';
    return 'retry';
  end if;
  if p_outcome in ('transient', 'content') and pc.stt_attempts < p_max_attempts then
    update phone_calls
    set stt_status = 'pending', stt_started_at = null,
        stt_next_try_at = now() + case when p_outcome = 'transient' then interval '5 minutes' else interval '10 minutes' end,
        stt_error = left(p_error, 300), stt_error_kind = p_error_kind
    where meeting_id = p_meeting_id;
    update meetings set updated_at = now() where id = p_meeting_id and process_status = 'waiting_transcript';
    return 'retry';
  end if;
  update phone_calls set stt_status = 'failed', stt_started_at = null, stt_error = left(p_error, 300),
         stt_error_kind = p_error_kind
  where meeting_id = p_meeting_id;
  update meetings
  set process_status = 'failed',
      failure_reason = case
        when p_outcome = 'not_billed' then 'The transcription service refused requests for 24 hours.'
        when p_outcome = 'transient' then 'Transcription failed ' || pc.stt_attempts || ' times: the service timed out or had an error.'
        when p_outcome = 'content' then 'Transcription failed ' || pc.stt_attempts || ' times: ' || left(coalesce(p_error, 'unknown error'), 200)
        else 'Transcription failed: ' || left(coalesce(p_error, 'unknown error'), 200) end
  where id = p_meeting_id and process_status = 'waiting_transcript';
  return 'failed';
end $$;

-- F10. Purge: a call is not a work call (routine, person, line switch-off) or has no speech, or nobody decided in
--      time. Deletes the transcript (both stores), sheets, items, feedback and the routine's notes; marks the
--      audio deleted at once and queues the object; clears the ledger's number, name and link; keeps a stub
--      (masked number, line, time, fixed reason) and one fixed agent_runs row. Idempotent: returns null when
--      already purged, else the storage path to remove.
create or replace function purge_call(p_meeting_id uuid, p_code text, p_reason text, p_by text,
                                      p_summary text default null)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
  pc phone_calls%rowtype;
begin
  if p_code not in ('no_speech', 'personal', 'internal', 'sales', 'wrong_number', 'no_content', 'not_business',
                    'undecided', 'line_off') then
    raise exception 'unknown skip code %', p_code;
  end if;
  if p_by not in ('routine', 'person', 'system') then raise exception 'unknown purger %', p_by; end if;
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call_not_found'; end if;
  select * into pc from phone_calls where meeting_id = p_meeting_id for update;
  if pc.purged_at is not null then return null; end if;
  delete from action_items where meeting_id = p_meeting_id;
  delete from sheets where meeting_id = p_meeting_id;
  delete from transcripts where meeting_id = p_meeting_id;
  delete from call_transcripts where meeting_id = p_meeting_id;
  delete from classification_feedback where meeting_id = p_meeting_id;
  delete from agent_runs where meeting_id = p_meeting_id;
  update meetings
  set process_status = 'skipped',
      type = case p_code when 'internal' then 'internal'::meeting_type when 'sales' then 'sales'::meeting_type
                         else 'other'::meeting_type end,
      type_source = case p_by when 'person' then 'human'::type_source when 'system' then 'rule'::type_source
                              else 'llm'::type_source end,
      type_confidence = case when p_by = 'person' then 1 else type_confidence end,
      type_reason = left(p_reason, 300), title = null, client_id = null, client_name_guess = null,
      transcript_ready = false, claimed_at = null, claim_token = null, failure_reason = null
  where id = p_meeting_id;
  update phone_calls
  set skip_code = p_code, purged_at = now(), purged_by = p_by, counterpart_name = null, speaker_count = null,
      stt_error = null, stt_error_kind = null, decision_reason = null, decision_since = null,
      stt_status = case when stt_status in ('pending', 'running') then 'done' else stt_status end,
      recording_status = 'deleted', recording_path = null, media_deleted_at = now()
  where meeting_id = p_meeting_id;
  update call_log set counterpart_name = null, counterpart_e164 = null, recording_url = null
  where meeting_id = p_meeting_id;
  if pc.recording_path is not null then
    insert into storage_deletions (path, reason) values (pc.recording_path, 'purge') on conflict (path) do nothing;
  end if;
  insert into agent_runs (meeting_id, kind, status, attempt, summary)
  values (p_meeting_id, 'skip', 'ok', greatest(v.process_attempts, 1), left(coalesce(p_summary, p_reason), 300));
  return pc.recording_path;
end $$;

-- F11. Store a call's transcript while it waits for one. Fewer than p_min_words words: purge in this same
--      transaction ('no_speech'), unless a person marked it a client or vendor call (a person's business label is
--      never deleted automatically): then the audio stays and the call fails with a fixed reason, so a person can
--      listen to it. Otherwise the turns go to call_transcripts (or transcripts when a person already made it
--      business), the call becomes 'ready', and duration_sec is raised to the recording's real length so
--      evidence after Callyzer's talk time passes the timestamp check (verify.ts:96).
create or replace function save_call_transcript(p_meeting_id uuid, p_turns jsonb, p_sentences integer, p_words integer,
                                                p_speakers integer, p_audio_sec numeric, p_provider text,
                                                p_min_words integer default 8)
returns table (status text, purge_path text)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  v meetings%rowtype;
  v_purged timestamptz;
  v_last_end numeric;
  v_audio numeric;
  v_path text;
begin
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call % not found', p_meeting_id; end if;
  select max((t.turn ->> 'endSec')::numeric) into v_last_end from jsonb_array_elements(p_turns) as t(turn);
  v_audio := coalesce(p_audio_sec, v_last_end, v.duration_sec);
  update call_stt_usage set outcome = 'done', reserved_sec = coalesce(v_audio, reserved_sec)
  where id = (select max(u.id) from call_stt_usage u where u.meeting_id = p_meeting_id and u.outcome = 'running');
  select pc.purged_at into v_purged from phone_calls pc where pc.meeting_id = p_meeting_id;
  if v_purged is not null then
    return query select 'skipped'::text, null::text;
    return;
  end if;
  update phone_calls
  set stt_status = 'done', stt_started_at = null, stt_error = null, stt_error_kind = null, stt_provider = p_provider,
      stt_audio_sec = v_audio, speaker_count = p_speakers, transcribed_at = now(),
      recording_duration_sec = coalesce(p_audio_sec, recording_duration_sec)
  where meeting_id = p_meeting_id;
  if v.process_status <> 'waiting_transcript' then
    return query select v.process_status::text, null::text;
    return;
  end if;
  if p_words < p_min_words then
    if v.type in ('client', 'vendor') and v.type_source = 'human' then
      update meetings set process_status = 'failed', failure_reason = 'No speech in the recording.'
      where id = p_meeting_id;
      return query select 'failed'::text, null::text;
      return;
    end if;
    v_path := purge_call(p_meeting_id, 'no_speech', 'No speech in the recording. The recording was deleted.', 'system', null);
    return query select 'no_speech'::text, v_path;
    return;
  end if;
  if v.type in ('client', 'vendor') then
    insert into transcripts (meeting_id, tldv_transcript_id, turns, sentence_count, word_count,
                             speaker_labels_reliable, fetched_at)
    values (p_meeting_id, null, p_turns, p_sentences, p_words, false, now())
    on conflict (meeting_id) do update set turns = excluded.turns, sentence_count = excluded.sentence_count,
      word_count = excluded.word_count, speaker_labels_reliable = false, fetched_at = now();
  else
    insert into call_transcripts (meeting_id, turns, sentence_count, word_count, fetched_at)
    values (p_meeting_id, p_turns, p_sentences, p_words, now())
    on conflict (meeting_id) do update set turns = excluded.turns, sentence_count = excluded.sentence_count,
      word_count = excluded.word_count, fetched_at = now();
  end if;
  update meetings
  set transcript_ready = true, process_status = 'ready', failure_reason = null,
      duration_sec = greatest(duration_sec, ceil(coalesce(p_audio_sec, 0))::integer, ceil(coalesce(v_last_end, 0))::integer)
  where id = p_meeting_id;
  update phone_calls set ready_at = now() where meeting_id = p_meeting_id;
  return query select 'ready'::text, null::text;
end $$;

-- F12. The routine (llm, with its claim) or a person (human) says the call is business. Sets type, reason and
--      client, builds the title, copies the saved contact name to the team-readable row, and moves the turns
--      from the secret store into transcripts. Never on a purged call; the routine never overwrites a person.
create or replace function mark_call_business(p_meeting_id uuid, p_type meeting_type, p_source type_source,
                                              p_confidence numeric, p_reason text, p_client_id uuid,
                                              p_client_name_guess text, p_claim uuid default null)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
  v_purged timestamptz;
  v_name text;
  v_client text;
  v_title text;
begin
  if p_type not in ('client', 'vendor') then raise exception 'not a business type: %', p_type; end if;
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call_not_found'; end if;
  select pc.purged_at into v_purged from phone_calls pc where pc.meeting_id = p_meeting_id;
  if v_purged is not null then raise exception 'call_purged'; end if;
  if p_source = 'llm' then
    if v.process_status <> 'processing' or v.claim_token is distinct from p_claim then
      raise exception 'claim_mismatch';
    end if;
    if v.type_source = 'human' then raise exception 'human_label'; end if;
  end if;
  select c.counterpart_name into v_name from call_log c where c.meeting_id = p_meeting_id;
  if p_type = 'client' and p_client_id is not null then
    select name into v_client from clients where id = p_client_id;
  end if;
  v_title := case
    when p_type = 'vendor' then 'Vendor call' || coalesce(' with ' || coalesce(v_name, nullif(btrim(p_client_name_guess), '')), '')
    -- The saved name already contains the client's name ("Rakesh Cafe 89" for "Cafe 89"): show it alone.
    when v_name is not null and v_client is not null and position(lower(v_client) in lower(v_name)) > 0
      then 'Call with ' || v_name
    when v_name is not null and v_client is not null then 'Call with ' || v_name || ' (' || v_client || ')'
    else 'Call with ' || coalesce(v_client, v_name, nullif(btrim(p_client_name_guess), ''), 'a client') end;
  update meetings
  set type = p_type, type_source = p_source, type_confidence = round(least(greatest(p_confidence, 0), 1), 2),
      type_reason = left(p_reason, 400),
      client_id = case when p_type = 'client' then p_client_id end,
      client_name_guess = left(nullif(btrim(p_client_name_guess), ''), 120),
      title = left(v_title, 160)
  where id = p_meeting_id;
  update phone_calls set counterpart_name = v_name, decision_reason = null, decision_since = null
  where meeting_id = p_meeting_id;
  insert into transcripts (meeting_id, tldv_transcript_id, turns, sentence_count, word_count, speaker_labels_reliable, fetched_at)
  select ct.meeting_id, null, ct.turns, ct.sentence_count, ct.word_count, false, ct.fetched_at
  from call_transcripts ct where ct.meeting_id = p_meeting_id
  on conflict (meeting_id) do update set turns = excluded.turns, sentence_count = excluded.sentence_count,
    word_count = excluded.word_count, speaker_labels_reliable = false, fetched_at = excluded.fetched_at;
  delete from call_transcripts where meeting_id = p_meeting_id;
  return v_title;
end $$;

-- F13. A person (admin or line member; checked by the server action) decides an undecided call is business.
--      The status follows: sheet -> done; transcript -> ready (attempts reset when it was failed or held);
--      otherwise it stays where it is (a failed transcription is retried separately).
create or replace function decide_call(p_meeting_id uuid, p_type meeting_type, p_client_id uuid, p_by_name text)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
  v_sheets integer;
  v_status process_status;
begin
  perform mark_call_business(p_meeting_id, p_type, 'human', 1,
    'Marked as a ' || case when p_type = 'vendor' then 'vendor' else 'client' end || ' call by ' || left(p_by_name, 120),
    p_client_id, null, null);
  select * into v from meetings where id = p_meeting_id for update;
  select count(*) into v_sheets from sheets where meeting_id = p_meeting_id;
  v_status := case
    when v.process_status = 'processing' then 'processing'::process_status
    when v_sheets > 0 then 'done'::process_status
    when v.transcript_ready then 'ready'::process_status
    else v.process_status end;
  update meetings
  set process_status = v_status,
      process_attempts = case when v.process_status in ('failed', 'needs_decision') and v_status = 'ready' then 0
                              else process_attempts end,
      failure_reason = case when v_status in ('ready', 'done') then null else failure_reason end,
      claimed_at = case when v_status = 'ready' then null else claimed_at end,
      claim_token = case when v_status = 'ready' then null else claim_token end
  where id = p_meeting_id;
  return v_status::text;
end $$;

-- F14. The routine's claimed call goes to a person: 'unsure' (deleted after calls_decision_hours if nobody
--      decides) or 'held' (purge budget, known business number or name; never deleted automatically before
--      30 days). Only fixed text is stored.
create or replace function hold_call(p_meeting_id uuid, p_claim uuid, p_kind text, p_reason text, p_confidence numeric)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
begin
  if p_kind not in ('unsure', 'held') then raise exception 'unknown hold kind %', p_kind; end if;
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call_not_found'; end if;
  if v.process_status <> 'processing' or v.claim_token is distinct from p_claim then raise exception 'claim_mismatch'; end if;
  update meetings
  set process_status = 'needs_decision', claimed_at = null, claim_token = null,
      type_source = case when type_source = 'human' then type_source else 'llm'::type_source end,
      type_confidence = case when type_source = 'human' then type_confidence
                             else round(least(greatest(p_confidence, 0), 1), 2) end,
      type_reason = left(p_reason, 300)
  where id = p_meeting_id;
  update phone_calls set decision_reason = p_kind, decision_since = now() where meeting_id = p_meeting_id;
  insert into agent_runs (meeting_id, kind, status, attempt, summary)
  values (p_meeting_id, 'classify', 'ok', greatest(v.process_attempts, 1), left(p_reason, 300));
  return 'needs_decision';
end $$;

-- F15. Save a call's sheet atomically, only for the run that holds the claim on a live business call.
--      p_items: rows shaped like action_items without meeting_id/sheet_id; p_reused: [{id, position}] of
--      person-edited rows kept as they are; p_superseded: rows the new version no longer contains.
create or replace function save_call_sheet(p_meeting_id uuid, p_claim uuid, p_headline text, p_result jsonb,
                                           p_model text, p_prompt_version text, p_items jsonb, p_reused jsonb,
                                           p_superseded uuid[])
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v meetings%rowtype;
  v_purged timestamptz;
  v_version integer;
  v_sheet uuid;
begin
  select * into v from meetings where id = p_meeting_id and kind = 'call' for update;
  if not found then raise exception 'call_not_found'; end if;
  select pc.purged_at into v_purged from phone_calls pc where pc.meeting_id = p_meeting_id;
  if v_purged is not null then raise exception 'call_purged'; end if;
  if v.process_status <> 'processing' then raise exception 'call_not_processing:%', v.process_status; end if;
  if v.claim_token is distinct from p_claim then raise exception 'claim_mismatch'; end if;
  if v.type not in ('client', 'vendor') then raise exception 'call_not_business'; end if;
  select coalesce(max(version), 0) + 1 into v_version from sheets where meeting_id = p_meeting_id;
  insert into sheets (meeting_id, version, status, headline, result, model, prompt_version)
  values (p_meeting_id, v_version, 'ready', p_headline, p_result, p_model, p_prompt_version)
  returning id into v_sheet;
  insert into action_items as a (meeting_id, sheet_id, item_key, position, title, details, owed_by, owner_name,
                                 owner_email, owner_basis, due_date, due_kind, due_phrase, priority, status,
                                 evidence_ts_sec, evidence_speaker, evidence_quote, evidence_verified, confidence,
                                 linked_decision)
  select p_meeting_id, v_sheet, r.item_key, r.position, r.title, r.details, r.owed_by, r.owner_name, r.owner_email,
         r.owner_basis, r.due_date, r.due_kind, r.due_phrase, r.priority, r.status, r.evidence_ts_sec,
         r.evidence_speaker, r.evidence_quote, r.evidence_verified, r.confidence, r.linked_decision
  from jsonb_to_recordset(p_items) as r(item_key text, position integer, title text, details text, owed_by owner_side,
       owner_name text, owner_email text, owner_basis text, due_date date, due_kind text, due_phrase text,
       priority priority, status item_status, evidence_ts_sec integer, evidence_speaker text, evidence_quote text,
       evidence_verified boolean, confidence numeric, linked_decision text)
  on conflict (meeting_id, item_key) do update set
    sheet_id = excluded.sheet_id, position = excluded.position, title = excluded.title, details = excluded.details,
    owed_by = excluded.owed_by, owner_name = excluded.owner_name, owner_email = excluded.owner_email,
    owner_basis = excluded.owner_basis, due_date = excluded.due_date, due_kind = excluded.due_kind,
    due_phrase = excluded.due_phrase, priority = excluded.priority, status = excluded.status,
    evidence_ts_sec = excluded.evidence_ts_sec, evidence_speaker = excluded.evidence_speaker,
    evidence_quote = excluded.evidence_quote, evidence_verified = excluded.evidence_verified,
    confidence = excluded.confidence, linked_decision = excluded.linked_decision;
  update action_items ai set sheet_id = v_sheet, position = r.position
  from jsonb_to_recordset(p_reused) as r(id uuid, position integer)
  where ai.id = r.id and ai.meeting_id = p_meeting_id;
  if coalesce(array_length(p_superseded, 1), 0) > 0 then
    update action_items set status = 'superseded' where meeting_id = p_meeting_id and id = any (p_superseded);
  end if;
  update sheets set status = 'superseded' where meeting_id = p_meeting_id and version < v_version;
  update meetings set process_status = 'done', claimed_at = null, claim_token = null, failure_reason = null
  where id = p_meeting_id;
  update phone_calls set first_sheet_at = coalesce(first_sheet_at, now()) where meeting_id = p_meeting_id;
  return v_version;
end $$;

-- F16. "Retry transcription": only a failed transcription with stored audio and no transcript.
create or replace function retry_call_transcription(p_meeting_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  update phone_calls pc
  set stt_status = 'pending', stt_attempts = 0, stt_next_try_at = null, stt_first_error_at = null,
      stt_error = null, stt_error_kind = null, stt_started_at = null
  from meetings m
  where m.id = pc.meeting_id and pc.meeting_id = p_meeting_id and pc.stt_status = 'failed'
    and pc.purged_at is null and pc.recording_status = 'stored' and not m.transcript_ready;
  if not found then return false; end if;
  update meetings set process_status = 'waiting_transcript', failure_reason = null
  where id = p_meeting_id and process_status = 'failed';
  return true;
end $$;

-- F17. No recording link 36 hours after the call ended, or after the row was first seen if later.
create or replace function expire_call_recordings(p_hours integer default 36) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_count integer;
begin
  update call_log set status = 'no_recording'
  where status = 'waiting'
    and greatest(call_started_at + make_interval(secs => duration_sec), first_seen_at)
        + make_interval(hours => p_hours) < now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- F18. Undecided calls nobody confirmed in time are deleted (code 'undecided'): unsure for p_decision_hours,
--      failed for p_failed_days, or stored for p_max_days in any state but 'processing'. At most 50 per invocation.
create or replace function expire_undecided_calls(p_decision_hours integer, p_failed_days integer, p_max_days integer)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select m.id
    from meetings m join phone_calls pc on pc.meeting_id = m.id
    where m.kind = 'call' and pc.purged_at is null and m.type not in ('client', 'vendor')
      and ((m.process_status = 'needs_decision' and pc.decision_reason = 'unsure'
            and pc.decision_since < now() - make_interval(hours => p_decision_hours))
        or (m.process_status = 'failed' and m.updated_at < now() - make_interval(days => p_failed_days))
        or (m.process_status <> 'processing' and pc.stored_at < now() - make_interval(days => p_max_days)))
    order by m.happened_at
    limit 50
  loop
    perform purge_call(r.id, 'undecided',
      'Not confirmed as a work call in time. The recording and transcript were deleted.', 'system', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- F19. Audio of business calls older than p_days: queued for removal and marked deleted (sheets stay).
create or replace function expire_call_audio(p_days integer) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_count integer;
begin
  with due as (
    select pc.meeting_id, pc.recording_path
    from phone_calls pc join meetings m on m.id = pc.meeting_id
    where m.type in ('client', 'vendor') and pc.purged_at is null and pc.recording_status = 'stored'
      and pc.recording_path is not null and pc.stored_at < now() - make_interval(days => p_days)
    for update of pc
  ), queued as (
    insert into storage_deletions (path, reason) select d.recording_path, 'retention' from due d
    on conflict (path) do nothing
  )
  update phone_calls pc set recording_status = 'deleted', recording_path = null, media_deleted_at = now()
  from due where due.meeting_id = pc.meeting_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- F20. Ledger rows that never became calls, older than p_days: deleted; any object they may have left is queued.
create or replace function cleanup_call_log(p_days integer default 14) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_count integer;
begin
  with old as (
    delete from call_log
    where meeting_id is null and status in ('waiting', 'no_recording', 'empty', 'failed', 'dropped')
      and call_started_at < now() - make_interval(days => p_days)
    returning storage_path
  ), queued as (
    insert into storage_deletions (path, reason)
    select o.storage_path, 'copy_abandoned' from old o where o.storage_path is not null
    on conflict (path) do nothing
  )
  select count(*) into v_count from old;
  return v_count;
end $$;

-- F21. Switch a line off: queued ledger rows are dropped and the line's undecided calls are purged, in one
--      transaction (promote_call takes the line row FOR SHARE, so an in-flight copy then drops itself).
create or replace function switch_line_off(p_line_id uuid) returns table (dropped integer, purged integer)
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_dropped integer;
  v_purged integer := 0;
begin
  perform 1 from phone_lines where id = p_line_id for update;
  if not found then raise exception 'line_not_found'; end if;
  update phone_lines set enabled = false where id = p_line_id;
  with gone as (
    update call_log c set status = 'dropped', recording_url = null
    where c.line_id = p_line_id and c.status in ('waiting', 'pending')
    returning c.storage_path
  ), queued as (
    insert into storage_deletions (path, reason)
    select g.storage_path, 'line_off' from gone g where g.storage_path is not null
    on conflict (path) do nothing
  )
  select count(*) into v_dropped from gone;
  for r in
    select m.id from meetings m join phone_calls pc on pc.meeting_id = m.id
    where pc.line_id = p_line_id and m.kind = 'call' and pc.purged_at is null and m.type not in ('client', 'vendor')
  loop
    perform purge_call(r.id, 'line_off',
      'The phone line was switched off before this call was confirmed as a work call. The recording and transcript were deleted.',
      'person', null);
    v_purged := v_purged + 1;
  end loop;
  return query select v_dropped, v_purged;
end $$;

-- F22. What every signed-in person may know about the feed: switches, the last poll, error kinds, and today's
--      breakdown (the poll's counts plus the ledger's statuses on lines that are on). No numbers, names or links.
create or replace function calls_feed_status() returns jsonb
language sql stable security definer set search_path = public as $$
  with day as (
    select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as start,
           to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as ymd
  ), today_ledger as (
    select c.status, m.process_status, pc.skip_code
    from call_log c
    join phone_lines pl on pl.id = c.line_id and pl.enabled
    left join meetings m on m.id = c.meeting_id
    left join phone_calls pc on pc.meeting_id = c.meeting_id
    cross join day
    where c.call_started_at >= day.start
  )
  select case when not is_active_person() then null else jsonb_build_object(
    'paused', coalesce((select s.value in ('true'::jsonb, '"true"'::jsonb) from settings s where s.key = 'calls_paused'), true),
    'pipelinePaused', coalesce((select s.value in ('true'::jsonb, '"true"'::jsonb) from settings s where s.key = 'pipeline_paused'), false),
    'linesOn', (select count(*) from phone_lines where enabled),
    'lastRunAt', st.value ->> 'lastRunAt',
    'lastPollOkAt', st.value ->> 'lastPollOkAt',
    'off', st.value ->> 'off',
    'pollError', st.value ->> 'pollError',
    'sttError', st.value ->> 'sttError',
    'copyError', st.value -> 'copyError',
    'poll', case when st.value -> 'today' ->> 'day' = (select ymd from day) then st.value -> 'today' end,
    'ledger', (select jsonb_build_object(
        'waitingRecording', count(*) filter (where t.status = 'waiting'),
        'copying', count(*) filter (where t.status in ('pending', 'running')),
        'noRecording', count(*) filter (where t.status in ('no_recording', 'empty')),
        'copyFailed', count(*) filter (where t.status = 'failed'),
        'inProgress', count(*) filter (where t.status = 'promoted' and t.process_status in ('waiting_transcript', 'ready', 'processing')),
        'sheets', count(*) filter (where t.status = 'promoted' and t.process_status = 'done'),
        'needsDecision', count(*) filter (where t.status = 'promoted' and t.process_status = 'needs_decision'),
        'failed', count(*) filter (where t.status = 'promoted' and t.process_status = 'failed'),
        'notWork', count(*) filter (where t.status = 'promoted' and t.process_status = 'skipped' and t.skip_code is distinct from 'no_speech'),
        'noSpeech', count(*) filter (where t.status = 'promoted' and t.process_status = 'skipped' and t.skip_code = 'no_speech'))
      from today_ledger t),
    'minutesToday', (select coalesce(round(sum(u.reserved_sec) / 60), 0) from call_stt_usage u cross join day
                     where u.created_at >= day.start)
  ) end
  from sync_state st
  where st.key = 'callyzer'
$$;

-- F23. The nav: whether Calls shows, and how many calls wait for this person's decision.
create or replace function calls_nav() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_active_person() then jsonb_build_object('visible', false, 'decisions', 0)
  else jsonb_build_object(
    'visible', exists (select 1 from phone_lines where enabled) or exists (select 1 from meetings where kind = 'call'),
    'decisions', (select count(*) from meetings m join phone_calls pc on pc.meeting_id = m.id
                  where m.kind = 'call' and m.process_status = 'needs_decision'
                    and (is_admin() or exists (select 1 from phone_line_members lm
                                                where lm.line_id = pc.line_id and lm.person_id = current_person_id()))))
  end
$$;

-- 10. Function grants. Pipeline functions run only with the secret key (service_role), including the two
--     existing ones that any signed-in person could execute through PUBLIC today; the app already calls both
--     with the secret key (src/lib/sheet/package.ts:36, src/lib/ingest/sync.ts:185). Grants, not RLS policies.
revoke all on function
  claim_next_meeting(uuid[]), release_stale_claims(integer, integer), release_stale_call_claims(integer, integer),
  register_phone_lines(jsonb), upsert_call_log(jsonb), reserve_call_stt(uuid, numeric, integer),
  claim_call_work(integer, integer, integer, boolean), finish_call_copy(text, text, text, text, integer, integer),
  promote_call(text, text, text, integer, boolean, integer, boolean), finish_call_transcription(uuid, text, text, text, integer),
  purge_call(uuid, text, text, text, text), save_call_transcript(uuid, jsonb, integer, integer, integer, numeric, text, integer),
  mark_call_business(uuid, meeting_type, type_source, numeric, text, uuid, text, uuid),
  decide_call(uuid, meeting_type, uuid, text), hold_call(uuid, uuid, text, text, numeric),
  save_call_sheet(uuid, uuid, text, jsonb, text, text, jsonb, jsonb, uuid[]), retry_call_transcription(uuid),
  expire_call_recordings(integer), expire_undecided_calls(integer, integer, integer), expire_call_audio(integer),
  cleanup_call_log(integer), switch_line_off(uuid)
  from public, anon, authenticated;
grant execute on function
  claim_next_meeting(uuid[]), release_stale_claims(integer, integer), release_stale_call_claims(integer, integer),
  register_phone_lines(jsonb), upsert_call_log(jsonb), reserve_call_stt(uuid, numeric, integer),
  claim_call_work(integer, integer, integer, boolean), finish_call_copy(text, text, text, text, integer, integer),
  promote_call(text, text, text, integer, boolean, integer, boolean), finish_call_transcription(uuid, text, text, text, integer),
  purge_call(uuid, text, text, text, text), save_call_transcript(uuid, jsonb, integer, integer, integer, numeric, text, integer),
  mark_call_business(uuid, meeting_type, type_source, numeric, text, uuid, text, uuid),
  decide_call(uuid, meeting_type, uuid, text), hold_call(uuid, uuid, text, text, numeric),
  save_call_sheet(uuid, uuid, text, jsonb, text, text, jsonb, jsonb, uuid[]), retry_call_transcription(uuid),
  expire_call_recordings(integer), expire_undecided_calls(integer, integer, integer), expire_call_audio(integer),
  cleanup_call_log(integer), switch_line_off(uuid)
  to service_role;
revoke all on function calls_feed_status(), calls_nav() from public, anon;
grant execute on function calls_feed_status(), calls_nav() to authenticated, service_role;
