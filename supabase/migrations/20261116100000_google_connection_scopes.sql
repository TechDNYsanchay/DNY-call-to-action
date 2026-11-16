-- Which Google permissions the recording account granted (2026-11-16). Booked meetings are opened to
-- anyone with the link (Google Meet access "Open") so tl;dv's recorder joins without being admitted;
-- that needs the meetings.space.settings permission, which connections made before today lack. The
-- app reads this list to ask an admin to reconnect once.
alter table google_connection add column scopes text[] not null default '{}';
