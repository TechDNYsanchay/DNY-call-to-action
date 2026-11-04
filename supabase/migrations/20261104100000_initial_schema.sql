-- Call to Action: initial schema.
-- People (team list), clients, meetings from tl;dv, transcripts, sheets (one call-to-action per
-- meeting version), action items, feedback, routine runs, webhook and cron bookkeeping.
--
-- Access:
--   * Every active person on the team list reads the meeting data (one company, one tool).
--     Admins also read the operational tables (settings, sync state, webhook and pipeline events).
--   * The app writes with the service role after checking the signed-in person (server actions).
--   * The Claude Code routine never touches the database; it works through /api/agent/* on Vercel.

create type person_role as enum ('admin', 'member');
create type meeting_type as enum ('client', 'sales', 'internal', 'other', 'unknown');
create type type_source as enum ('rule', 'llm', 'human');
create type process_status as enum (
  'new',                -- seen from tl;dv, transcript not fetched yet
  'waiting_transcript', -- tl;dv has not finished the transcript; the cron retries
  'ready',              -- transcript stored; waiting for the routine
  'processing',         -- claimed by a routine run
  'needs_decision',     -- the model was unsure; a person decides the type
  'done',               -- sheet saved
  'failed',             -- gave up; an admin can re-run
  'skipped'             -- not a client meeting (or no usable content)
);
create type owner_side as enum ('dny', 'client', 'both', 'unclear');
create type item_status as enum ('open', 'in_progress', 'done', 'dropped', 'superseded');
create type priority as enum ('high', 'medium', 'low');
create type sync_status as enum ('not_applicable', 'pending', 'sent', 'failed');

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- People and clients
-- ---------------------------------------------------------------------------

create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  email text not null unique check (email = lower(email)),
  role person_role not null default 'member',
  dept text,
  active boolean not null default true,
  email_notifications boolean not null default true,
  erp_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger people_updated_at before update on people for each row execute function set_updated_at();

-- When a person signs in for the first time, link the auth user to their team-list row.
create function link_person_to_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update people set auth_user_id = new.id where email = lower(new.email) and auth_user_id is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function link_person_to_auth_user();

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domains text[] not null default '{}',
  contact_emails text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'onboarding', 'churned')),
  erp_client_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_domains_idx on clients using gin (domains);
create index clients_contact_emails_idx on clients using gin (contact_emails);
create trigger clients_updated_at before update on clients for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Meetings, participants, transcripts
-- ---------------------------------------------------------------------------

create table meetings (
  id uuid primary key default gen_random_uuid(),
  tldv_meeting_id text not null unique,
  title text,
  happened_at timestamptz not null,
  duration_sec integer not null default 0 check (duration_sec >= 0),
  organizer_email text,
  organizer_name text,
  tldv_url text,
  type meeting_type not null default 'unknown',
  type_source type_source,
  type_confidence numeric(3, 2) check (type_confidence between 0 and 1),
  type_reason text,
  client_id uuid references clients (id) on delete set null,
  client_name_guess text,
  transcript_ready boolean not null default false,
  process_status process_status not null default 'new',
  process_attempts integer not null default 0,
  claimed_at timestamptz,
  failure_reason text,
  source text not null default 'webhook' check (source in ('webhook', 'poll', 'backfill', 'manual', 'seed')),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meetings_happened_idx on meetings (happened_at desc);
create index meetings_type_happened_idx on meetings (type, happened_at desc);
create index meetings_client_idx on meetings (client_id, happened_at desc);
create index meetings_active_idx on meetings (process_status, happened_at)
  where process_status in ('new', 'waiting_transcript', 'ready', 'processing', 'needs_decision', 'failed');
create trigger meetings_updated_at before update on meetings for each row execute function set_updated_at();

create table participants (
  meeting_id uuid not null references meetings (id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  domain text generated always as (split_part(email, '@', 2)) stored,
  is_dny boolean not null default false,
  is_organizer boolean not null default false,
  primary key (meeting_id, email)
);
create index participants_domain_idx on participants (domain);
create index participants_email_idx on participants (email);

create table transcripts (
  meeting_id uuid primary key references meetings (id) on delete cascade,
  tldv_transcript_id text,
  -- Speaker turns: [{ "speaker": "Priya Nair", "startSec": 12.4, "endSec": 31.0, "text": "..." }]
  turns jsonb not null,
  sentence_count integer not null default 0,
  word_count integer not null default 0,
  speaker_labels_reliable boolean,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sheets (the call to action) and action items
-- ---------------------------------------------------------------------------

create table sheets (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  version integer not null,
  status text not null default 'ready' check (status in ('ready', 'superseded')),
  headline text not null,
  -- The validated model output in full (summary, decisions, facts, risks, questions, next meeting, ...).
  result jsonb not null,
  model text,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, version)
);
create index sheets_meeting_version_idx on sheets (meeting_id, version desc);

create table action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  sheet_id uuid references sheets (id) on delete set null,
  -- Stable identity across re-runs (the model's item id plus a hash of the lane and title stem).
  item_key text not null,
  position integer not null default 0,
  title text not null,
  details text not null default '',
  owed_by owner_side not null default 'unclear',
  owner_name text,
  owner_email text,
  owner_basis text,
  due_date date,
  due_kind text,
  due_phrase text,
  priority priority not null default 'medium',
  status item_status not null default 'open',
  evidence_ts_sec integer,
  evidence_speaker text,
  evidence_quote text,
  evidence_verified boolean not null default false,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  linked_decision text,
  edited_by uuid references people (id),
  edited_at timestamptz,
  done_at timestamptz,
  done_by uuid references people (id),
  erp_task_id text,
  erp_sync_status sync_status not null default 'not_applicable',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, item_key)
);
create index action_items_meeting_idx on action_items (meeting_id, position);
create index action_items_owner_open_idx on action_items (owner_email, due_date) where status in ('open', 'in_progress');
create index action_items_due_open_idx on action_items (due_date) where status in ('open', 'in_progress');
create trigger action_items_updated_at before update on action_items for each row execute function set_updated_at();

create table item_feedback (
  id uuid primary key default gen_random_uuid(),
  action_item_id uuid not null references action_items (id) on delete cascade,
  verdict text not null check (verdict in ('approve', 'edit', 'dismiss')),
  reason_code text,
  edited jsonb,
  person_id uuid references people (id),
  created_at timestamptz not null default now()
);

create table classification_feedback (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  from_type meeting_type not null,
  to_type meeting_type not null,
  client_id uuid references clients (id) on delete set null,
  note text,
  person_id uuid references people (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operations: routine runs, webhooks, cron state, settings, notifications, event log
-- ---------------------------------------------------------------------------

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  kind text not null check (kind in ('claim', 'classify', 'extract', 'skip', 'fail', 'release')),
  status text not null check (status in ('ok', 'rejected', 'error')),
  attempt integer not null default 1,
  errors jsonb,
  summary text,
  created_at timestamptz not null default now()
);
create index agent_runs_meeting_idx on agent_runs (meeting_id, created_at desc);

create table webhook_events (
  id text primary key,
  event text not null,
  tldv_meeting_id text,
  received_at timestamptz not null default now()
);
create index webhook_events_meeting_idx on webhook_events (tldv_meeting_id);

create table pipeline_events (
  id bigint generated always as identity primary key,
  meeting_id uuid references meetings (id) on delete set null,
  level text not null check (level in ('info', 'warn', 'error')),
  step text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index pipeline_events_created_idx on pipeline_events (created_at desc);

create table sync_state (
  key text primary key,
  last_synced_at timestamptz,
  locked_until timestamptz,
  value jsonb
);
insert into sync_state (key) values ('tldv');

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into settings (key, value) values
  ('pipeline_paused', 'false'),
  ('max_per_run', '5'),
  ('confidence_threshold', '0.8'),
  ('retention_months', '12'),
  ('claim_timeout_minutes', '90'),
  ('max_attempts', '3');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references sheets (id) on delete cascade,
  channel text not null,
  recipient text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sheet_id, channel, recipient)
);

-- The hand-off to the sales agent: it reads this view instead of receiving calls from us.
create view v_sales_meetings_ready with (security_invoker = true) as
  select tldv_meeting_id, title, happened_at, tldv_url, transcript_ready, type_source, type_confidence
  from meetings where type = 'sales';

-- ---------------------------------------------------------------------------
-- Claiming work for the routine (atomic; two runs can never take the same meeting)
-- ---------------------------------------------------------------------------

create function claim_next_meeting(p_exclude uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id
  from meetings
  where process_status = 'ready'
    and transcript_ready
    and not (id = any (p_exclude))
  order by happened_at
  limit 1
  for update skip locked;
  if v_id is null then
    return null;
  end if;
  update meetings
  set process_status = 'processing', claimed_at = now(), process_attempts = process_attempts + 1
  where id = v_id;
  return v_id;
end $$;

-- Claims older than the timeout go back to 'ready' (or 'failed' once attempts run out).
create function release_stale_claims(p_timeout_minutes integer, p_max_attempts integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update meetings
  set process_status = case when process_attempts >= p_max_attempts then 'failed'::process_status else 'ready'::process_status end,
      failure_reason = case when process_attempts >= p_max_attempts then 'The routine did not finish this meeting after ' || process_attempts || ' attempts' else failure_reason end,
      claimed_at = null
  where process_status = 'processing'
    and claimed_at < now() - make_interval(mins => p_timeout_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

create function current_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from people where auth_user_id = auth.uid() and active
$$;

create function is_active_person() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where auth_user_id = auth.uid() and active)
$$;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where auth_user_id = auth.uid() and active and role = 'admin')
$$;

alter table people enable row level security;
alter table clients enable row level security;
alter table meetings enable row level security;
alter table participants enable row level security;
alter table transcripts enable row level security;
alter table sheets enable row level security;
alter table action_items enable row level security;
alter table item_feedback enable row level security;
alter table classification_feedback enable row level security;
alter table agent_runs enable row level security;
alter table webhook_events enable row level security;
alter table pipeline_events enable row level security;
alter table sync_state enable row level security;
alter table settings enable row level security;
alter table notifications enable row level security;

create policy people_read on people for select to authenticated using (is_active_person());
create policy clients_read on clients for select to authenticated using (is_active_person());
create policy meetings_read on meetings for select to authenticated using (is_active_person());
create policy participants_read on participants for select to authenticated using (is_active_person());
create policy transcripts_read on transcripts for select to authenticated using (is_active_person());
create policy sheets_read on sheets for select to authenticated using (is_active_person());
create policy action_items_read on action_items for select to authenticated using (is_active_person());
create policy item_feedback_read on item_feedback for select to authenticated using (is_active_person());
create policy classification_feedback_read on classification_feedback for select to authenticated using (is_active_person());
create policy agent_runs_read on agent_runs for select to authenticated using (is_active_person());
create policy notifications_read on notifications for select to authenticated using (is_active_person());
create policy webhook_events_read on webhook_events for select to authenticated using (is_admin());
create policy pipeline_events_read on pipeline_events for select to authenticated using (is_admin());
create policy sync_state_read on sync_state for select to authenticated using (is_admin());
create policy settings_read on settings for select to authenticated using (is_admin());

-- No insert/update/delete policies for signed-in users: every write goes through a server action
-- that checks the person first and then uses the service role.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Live updates: the meeting page listens for its meeting's status changes.
alter publication supabase_realtime add table meetings;

-- ---------------------------------------------------------------------------
-- Seed: the first admin
-- ---------------------------------------------------------------------------

insert into people (full_name, email, role, dept) values ('Tech DNY', 'tech@dnyhospitality.com', 'admin', 'tech');
