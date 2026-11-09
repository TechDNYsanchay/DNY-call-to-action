-- Client meetings booked from the app (2026-11-09), the same way Sales QA books vision calls. The app
-- creates the Google Calendar event on the recording account's calendar (tech@ organises; the
-- client's contacts and DNY's people are guests), so tl;dv's bot records it. tl;dv sends the Meet
-- code back with the recording (extraProperties.conferenceId); that code ties the recording to its
-- booking and its client, so a booked meeting needs no classifying.

-- The Meet code ("abc-defg-hij") tl;dv sent with a recording, when it sent one.
alter table meetings add column meet_code text;
create index meetings_meet_code on meetings (meet_code) where meet_code is not null;

create table client_meeting_bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients (id) on delete set null,
  -- The client's name when booked, kept if the client row is ever removed.
  client_name text not null,
  -- The client's people invited (at least one address outside DNY, or tl;dv does not record).
  client_emails text[] not null check (cardinality(client_emails) between 1 and 10),
  starts_at timestamptz not null,
  duration_min integer not null check (duration_min between 15 and 180),
  notes text,
  -- DNY's people invited (people.id); the recording account itself organises and is not listed.
  attendee_ids uuid[] not null default '{}',
  booked_by uuid references people (id) on delete set null,
  calendar_event_id text,
  meet_url text,
  meet_code text unique,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  -- The recorded meeting, once tl;dv has sent it.
  meeting_id uuid references meetings (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index client_meeting_bookings_starts on client_meeting_bookings (starts_at desc);

-- The app writes with the secret key after its own checks; everyone on the team list reads, as with meetings.
alter table client_meeting_bookings enable row level security;
create policy client_meeting_bookings_read on client_meeting_bookings for select to authenticated using (is_active_person());

-- The Google account the app creates meetings with (one row). Its refresh token is a secret: no
-- policies, so only the secret key reads it.
create table google_connection (
  id boolean primary key default true check (id),
  email text not null,
  refresh_token text not null,
  connected_by uuid references people (id) on delete set null,
  connected_at timestamptz not null default now()
);

alter table google_connection enable row level security;
