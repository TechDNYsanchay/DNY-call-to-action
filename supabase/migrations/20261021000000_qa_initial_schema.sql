-- Placeholder: migration 20261021000000 (initial_schema) belongs to Sales QA (repo dny-call-qa, schema qa), which
-- shares this Supabase project. It is applied from that repo; this file only lets `supabase db push`
-- here see the shared migration history.
-- Locally it creates the empty schema so the API (config.toml exposes qa) starts cleanly; on the
-- hosted project the version is already applied and this never runs.
create schema if not exists qa;
