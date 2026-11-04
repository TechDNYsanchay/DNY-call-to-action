# Call to Action, build plan (v1)

DNY Hospitality internal tool. Plan written 2026-11-04. Owner: Tarique (tech@dnyhospitality.com).
Status: PLAN ONLY. Nothing has been created in any account yet.

## 1. What we are building

Every client meeting recorded by tl;dv becomes, within minutes of the transcript being ready, a one-page
"call to action" sheet that anyone at DNY can read in ten seconds:

- the outcome in one sentence,
- who owes what by when, split into "DNY owes" and "Client owes",
- decisions, key facts and numbers, risks, open questions, next meeting,
- every item backed by a timestamped quote from the recording, verified against the transcript.

Pipeline: tl;dv -> (webhook + 10-minute cron) -> Supabase -> classify (rules, then Claude Sonnet 5.5)
-> client meetings only -> extract (Claude Opus 5.5, structured JSON) -> verify evidence -> store -> notify
-> Next.js app on Vercel. Later: push action items into the DNY ERP.

Out of scope for v1: processing sales meetings (they are labelled and exposed to the sales agent through a
database view), ERP push, automatic rule learning, Slack and WhatsApp, historical backfill beyond 14 days.

Not tl;dv but Fireflies is what is connected to Claude in this session (account zoho@dnyhospitality.com,
zero meetings). It is unused and not part of this plan; the app talks to tl;dv's own API.

## 2. Decisions locked in

| Area | Decision | Why |
|---|---|---|
| LLM access | Anthropic API key in a DNY Console organisation, with a monthly spend cap. Not the Claude Max subscription. | Max covers Claude.ai and Claude Code only; a server app needs the API. Cost is about $0.25 to $0.35 per client meeting. |
| Extraction model | `claude-opus-5-5`, effort `medium`, streaming, structured outputs, max_tokens 32000. Raise to `high` only if the first 20 reviewed pages show misses. | The sheet is the product; Opus 5.5 is the least likely to invent owners, dates or amounts. |
| Classification model | Deterministic rules first, then `claude-sonnet-5-5` at effort `low` (about $0.02 per call). | Needs to read Hinglish and judge "existing client vs prospect"; Haiku saving is not worth the risk. |
| Orchestration | Vercel Workflow SDK, steps written as plain functions. Fallback: plain route + cron re-drive, decided in the day-0 spike. | Per-step retries and a dashboard trace; free at this volume. |
| Webhook trust | tl;dv webhooks are hints only; the app always re-fetches meeting and transcript through the API. | tl;dv has no webhook signature; TranscriptReady can arrive before MeetingReady. |
| Schedules | One cron tick every 10 minutes (sync, transcript retries, stale-run re-drive, enqueue up to 5). | One lock, one log, one secret. Requires Vercel Pro. |
| Auth | Supabase Auth + Google only. Google OAuth client with audience Internal (dnyhospitality.com Workspace). Domain and provider re-checked in the callback. Admin = row in `team_members`. | Simple, instant revocation, nothing a stray Gmail can do. |
| Hosting plans | Vercel Pro (mandatory), Supabase Pro for production ($25/month), tl;dv Pro or Business (Business if Hinglish calls are common). | Hobby is non-commercial only; 800 s functions; Free Supabase pauses after 7 idle days. |
| Region | Supabase `ap-south-1` (Mumbai) + Vercel functions `bom1`. | Users are in India; no cross-continent hops. |
| Timezone | Asia/Kolkata everywhere (stored UTC, displayed and computed in IST). | "By Friday" must land on the right date. |
| Realtime | Supabase Realtime on `processing_runs` and `meetings` only, subscribed from the meeting page while processing. | Sub-second swap-in without shipping large rows. |
| Speed promise | Static shell < 300 ms from CDN, data < 1 s in India, first-load JS < 120 kB gzip, no layout shift. | Honest, measurable targets for an auth-gated app. |
| Design | "Shift Sheet": the duty-manager handover log as a design language. | Premium through typography and rhythm, not decoration. |
| ERP | Only `erp_task_id` and `erp_sync_status` columns now; a one-page contract after reading the ERP repo; manual "Push to ERP" dialog first. | ERP stack and task model are unknown. |
| Sales hand-off | Meetings labelled `sales` are exposed through the view `v_sales_meetings_ready`; the sales agent reads it. | No HTTP coupling, no double processing. |
| Notifications | In-app queue + one email per sheet to DNY attendees (headline, counts, link; no item text), opt-out per person, plus a "needs your decision" email. | Avoids the inbox flood that makes people filter the tool out. |
| Environments | Two Supabase projects: `cta-dev` (Free, local + previews) and `cta-prod` (Pro). Additive migrations; production `db push` is manual. | Previews must never touch client transcripts. |

## 3. Day-0 spike (half a day, before any code)

Each item changes the design if the answer is "no". Stop and re-plan where marked.

1. tl;dv plan and seats: which plan DNY is on, and that the accounts that record client meetings are on paid
   seats. API and webhooks need Pro or Business. STOP if the recording accounts are on Free.
2. Generate a tl;dv API key as the recording account (tech@ if it records; keys are personal). Call
   `GET https://pasta.tldv.io/v1alpha1/meetings?from=<30 days ago>&limit=100` with `x-api-key` and a custom
   `User-Agent` (default library agents get 403). Compare the count with the web library. Check that a meeting
   recorded by a colleague and one organised by a client are listed. API visibility is gated by the meeting
   organiser's plan and by what the key holder can see in the team library.
3. `GET /v1alpha1/meetings/{id}/transcript` on a meeting still processing: record the status code.
4. Settings > Webhooks: screenshot the scope options (User / Team / Organization). Org scope may need Enterprise.
5. Open a recording, copy a "moment" link, record the URL format (the timestamp parameter is undocumented).
6. Transcript language preference: set the multi-language (Whisper) model if available; record a 10-minute
   Hinglish test call and read the transcript quality.
7. Vercel: `vercel whoami` must show the DNY login; `vercel teams ls`; confirm the DNY team is on Pro.
8. Supabase: confirm the DNY organisation and whether a Pro project may be created; check Authentication > Hooks
   offers "Before User Created" on the plan.
9. Anthropic: confirm a DNY Console organisation with billing exists, note the usage tier, set a spend cap ($50).
10. Google: confirm tech@ can create a Google Cloud project inside the dnyhospitality.com Workspace.
11. DNS: who administers dnyhospitality.com (Zoho-hosted) for the `notify.` subdomain and the app domain.
12. Decide the recording policy: DNY sends every client-meeting invite from a paid seat, auto-share to the
    team library on.

## 4. Accounts, environments, setup order

Account rule (from CLAUDE.md): never mix personal and DNY accounts. Today both CLIs are on the personal
accounts (`gh` = tariquescript, `vercel` = tariquescript-9943). Order of operations:

1. `gh auth login` as the DNY GitHub user, `gh auth switch --user <dny-user>`, confirm with `gh auth status`.
2. `vercel logout`, `vercel login` as the DNY account (seen before as tech-5297), `vercel whoami`,
   `vercel switch <dny-team>`.
3. `supabase login` as the DNY Supabase account; `supabase projects list` must show only DNY projects.
4. Create Supabase projects `cta-dev` (Free) and `cta-prod` (Pro) in the DNY organisation, region Mumbai.
5. Google Cloud project in the Workspace: OAuth consent screen audience Internal; Web client with redirect
   `https://<ref>.supabase.co/auth/v1/callback` for both projects; paste into Supabase > Auth > Providers >
   Google; disable every other provider.
6. Scaffold the repo locally (Next.js 16 App Router, TypeScript, Tailwind v4, pnpm), then
   `gh repo create <dny-org>/call-to-action --private --source . --push`.
7. `vercel link` in the repo: pick the DNY team, create project `call-to-action`. Verify `.vercel/project.json`
   orgId is the DNY team id and `.vercel/` is git-ignored. Connect the GitHub repo in the Vercel project.
8. Vercel project settings: Node 22, function region bom1, Speed Insights + Web Analytics on, previews
   protected by Vercel Authentication.
9. Environment variables (values from files, per environment):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TLDV_API_KEY`,
   `TLDV_WEBHOOK_SECRET`, `TLDV_USER_AGENT`, `TLDV_TIMESTAMP_PARAM` (empty until verified), `CRON_SECRET`,
   `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_EXTRACT=claude-opus-5-5`, `ANTHROPIC_MODEL_CLASSIFY=claude-sonnet-5-5`,
   `ANTHROPIC_MOCK` (dev only), `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`,
   `ALLOWED_EMAIL_DOMAIN=dnyhospitality.com`, `PROMPT_VERSION`, `SENTRY_DSN`. Later: `ERP_BASE_URL`, `ERP_API_KEY`.
10. Apply migrations to `cta-dev` from CI, to `cta-prod` by hand after review.
11. Supabase Auth URL configuration: Site URL = production domain; redirects for production, previews
    (`https://*-<team>.vercel.app/**`) and localhost.
12. tl;dv: after the first production deploy, register a webhook (widest scope available) for `MeetingReady`
    and `TranscriptReady` to `https://<app>/api/webhooks/tldv` with custom header `x-tldv-secret`.
13. Resend: domain `notify.dnyhospitality.com` with SPF, DKIM and DMARC; send a test to a Zoho inbox first.
14. Document the account rules in the repo README and CLAUDE.md.

## 5. tl;dv integration (verified against doc.tldv.io and the help centre, June 2026)

- Base URL `https://pasta.tldv.io`, paths under `/v1alpha1` (alpha; expect changes; one client module,
  response schemas validated with zod). Auth header `x-api-key`; a custom `User-Agent` is required.
- `GET /meetings`: `query`, `page` (1-based), `limit` (max 100), `from`, `to`, `onlyParticipated`,
  `meetingType=internal|external`. Hard cap 10,000 results, so always pass a date window.
- Meeting object: `id`, `name`, `happenedAt` (ISO, UTC), `url` (`https://app.tldv.io/meetings/<id>`),
  `duration` (seconds), `organizer {name,email}`, `invitees [{name,email}]` (invited or participated),
  `template`, `extraProperties`. No meeting type, no platform, no transcript status on the object.
- `GET /meetings/{id}/transcript`: `{ id, meetingId, data: [{ speaker, text, startTime, endTime }] }`, one
  sentence per item, seconds from recording start, speaker is a display name (no email).
  Returned only once complete.
- `GET /meetings/{id}/notes`: tl;dv's own AI notes (`structuredNotes`, `markdownContent`, `topics`). Stored
  for reference, not used for extraction.
- Webhooks: `MeetingReady` (metadata, optional transcript section) and `TranscriptReady` (transcript only, no
  organiser/invitees). Envelope `{ id, event, executedAt, data }`. Dashboard-registered only, HTTPS only,
  custom headers supported, no signature, tl;dv waits 10 s then retries (schedule undocumented).
- Processing order at tl;dv: video -> transcript -> notes, "up to 2 hours". So TranscriptReady often lands
  before MeetingReady.
- Internal vs external: computed locally from invitee domains; tl;dv's filter uses the same rule.
- API access depends on the meeting ORGANISER's plan, and the key lists what its owner can see.
- Hindi is supported; code-switched Hinglish needs the multi-language model (Business/Enterprise).
- Paid plans keep recordings indefinitely; transcripts are copied into Supabase so analysis survives deletion.

## 6. Ingestion

One intake function, three triggers, all idempotent on `tldv_meeting_id`.

- `POST /api/webhooks/tldv`: timing-safe check of `x-tldv-secret`; reject bodies over 2 MB and events with
  `executedAt` older than 24 h; `insert into webhook_events (id, event, tldv_meeting_id, received_at) on conflict
  do nothing` (no payload stored); enqueue a `sync(tldv_meeting_id)` job; return 200 within a second.
- `sync(id)`: `GET /meetings/{id}` -> upsert `meetings` + `participants` (stub row first if only the
  transcript event arrived); `GET /transcript` -> on 200 store `transcripts` and set `transcript_ready`;
  otherwise leave for the cron. Then `maybeEnqueue(meeting)`.
- `GET /api/cron/tick` every 10 minutes (Bearer `CRON_SECRET`, soft lock in `sync_state` held for the
  function's max duration): list tl;dv meetings from `last_synced_at - 2 h`; upsert; retry `GET /transcript`
  for meetings without one (schedule 1/2/5/10/20/30 min up to 3 h, give up at 48 h -> `skipped`); mark runs
  stuck over 30 min as failed; enqueue up to 5; later drain the ERP outbox; log one line of counts.
- Admin action "Replay tl;dv meeting id": runs `sync(id)` + the pipeline for one meeting. This is how ingestion
  is tested on previews and locally, where webhooks and crons never arrive.
- Backfill: admin action for the last 14 days only, drained by the cron at 5 per tick, after the clients table is
  seeded. Backfilled sheets send no emails.
- `maybeEnqueue` is one atomic UPDATE: `process_status in ('new','failed')`, `transcript_ready`,
  `process_attempts < 3`, organiser and invitees known, fewer than `settings.max_concurrent` (2) runs
  processing, `pipeline_paused = false`, today's cost below `daily_cost_cap_usd`. Only a returned row starts a run.

## 7. Classification v1

Labels: `client | sales | internal | other`, with `type_source = rule | llm | human`, confidence and reason.

1. Rule A: duration under 5 minutes or transcript under 40 sentences -> `other` (no content), never extracted.
2. Rule B: any participant email in `clients.contact_emails` or domain in `clients.domains` -> `client` (0.95).
3. Rule C: everything else, including meetings where every invitee is @dnyhospitality.com (clients often join
   from forwarded links or by phone and are not on the invite) -> one `claude-sonnet-5-5` call at effort `low`,
   max_tokens 1500, structured output `{ type, confidence, reason, evidence[], client_name_guess, language }`.
   Input: title, date, duration, participants tagged (DNY role / known client / unknown domain / personal
   email), the first 15 minutes and the last 3 minutes of the transcript in speaker-turn format.
4. Confidence >= 0.80 -> auto-label. Below -> `needs_decision`, pinned in the inbox under "Needs your decision"
   and listed in the Review queue with two buttons: "Client meeting" (extract) and "Sales meeting" (hand off).
5. Human override dialog on every meeting: pick the type, pick or create the client, and a checkbox
   "Also treat hotelabc.com / rakesh@gmail.com as Hotel ABC from now on" which writes to `clients`. A human
   label is final; re-runs never overwrite it. Every change is a `classification_feedback` row.
6. Sales meetings: stored, hidden from the inbox, shown in Review as a quiet row with "Actually a client meeting".
   The view `v_sales_meetings_ready` (tldv id, title, date, url, transcript_ready) is the hand-off; only the
   system whose label says so processes a meeting. Agree this with the sales-agent owner.
7. Phase 2 (after 30 real meetings): prospect/vendor domain lists, title keyword priors, nightly promotion of
   domains after repeated confirmations, roster suggestions, accuracy tiles.

## 8. Extraction (the call to action)

Request (TypeScript, `@anthropic-ai/sdk`):

- model `claude-opus-5-5`; `output_config: { effort: "medium", format: zodOutputFormat(CallToActionSchema) }`;
  thinking left adaptive and hidden; `max_tokens` 32000; `client.beta.messages.stream(...)` then
  `finalMessage()`; `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`; no tools, no prefill.
- System prompt (Appendix A) is a frozen versioned file with `cache_control: { type: "ephemeral" }` on its last
  block; the meeting date lives in the user message so the cache prefix never changes. A unit test asserts the
  rendered system prompt is byte-identical across two meetings.
- SDK `timeout` 780 000 ms, `maxRetries` 1 inside the step; the Workflow step `maxRetries` 1; timeouts and
  refusals are `FatalError` (no re-billing loops). Route `maxDuration` 800 (Vercel Pro).
- Check `stop_reason` first: `refusal` -> mark "needs manual look", store the category; `max_tokens` -> retry once
  at 64000; `end_turn` -> parse and `safeParse` with zod.
- Transcript formatting: normalise, drop filler-only lines, group consecutive sentences by speaker into turns
  (split at 60 s or 600 chars), map speaker names to invitees by fuzzy match (>= 0.8) and tag `(DNY)` or
  `(Client)`, line format `[mm:ss] Name (DNY): text` (`[h:mm:ss]` past one hour). If fewer than half the labels
  map, the user message says speaker labels are unreliable and owners may not be marked "explicitly assigned"
  unless the name is spoken.
- User message: `## Meeting` (title, "Tuesday 4 November 2026, 10:30 IST", duration, client, link),
  `## Participants`, `## Transcript language`, `## Transcript`, `## End of transcript`.
- Size: a 60-minute English meeting is about 18K input tokens, a 3-hour Hinglish meeting about 110K; everything
  fits the 1M context in one call. Fail loudly above 300K (never truncate silently).
- Hindi/Hinglish: output prose in plain English; quotes verbatim in the original script with
  `quote_english`; lakh/crore kept as said with a normalised value; "kal"/"parso" are ambiguous and lower the
  due-date confidence instead of being guessed.
- Server-side verification after the call:
  - evidence: parse the timestamp, find the turn, token overlap of the quote >= 0.6 -> `evidence_verified`,
    else confidence x0.7 and an "approx." badge;
  - owner: the name must match a participant or appear in the transcript, else cleared and `basis = not_stated`;
  - due date: between meeting date - 1 day and + 365 days, weekday phrases computed in IST;
  - money/quantity facts: the evidence must contain a digit or a number word, including Hindi ones
    (ek, do, teen, dhai, sau, hazaar, lakh, crore, Devanagari digits);
  - duplicates collapsed; items with no verified evidence and confidence < 0.5 go to the "Needs review" tray.
- Stored: full result JSON, `model`, `prompt_version`, `effort`, usage, cost, `stop_reason`; action items as
  rows with a stable `model_item_key` so re-runs upsert and never delete rows that were edited, rated, or
  pushed to the ERP.
- Output contract (schema in Appendix B): `headline`, `executive_summary` (3 bullets), `meeting_purpose`,
  `language_profile`, `action_items[]` (verb-first title, details, owed_by, owner {name, side, basis},
  due {kind, date, raw_phrase, basis}, priority, linked_decision_id, evidence[], confidence), `decisions[]`,
  `key_facts[]`, `risks[]`, `open_questions[]`, `next_meeting`, `client_sentiment`, `participants[]`, `quality`,
  `overall_confidence`.

## 9. Data model (one schema, Postgres on Supabase)

Enums: `meeting_type (client, sales, internal, other, unknown)`, `type_source (rule, llm, human)`,
`process_status (new, queued, processing, done, failed, skipped, needs_decision)`,
`owner_side (dny, client, both, unclear)`, `item_status (open, in_progress, done, dropped, superseded)`,
`priority (high, medium, low)`, `sync_status (not_applicable, pending, sent, failed)`, `app_role (admin, member)`.

- `team_members (email pk, user_id uuid unique, display_name, role app_role, dept text, active bool, erp_user_id,
  email_notifications bool default true)`. Seed: tech@dnyhospitality.com as admin. Trigger on `auth.users`
  insert fills `user_id`.
- `clients (id, name, domains text[], contact_emails text[], status, erp_client_id, created_at, updated_at)`,
  GIN indexes on both arrays. CSV import in Settings.
- `meetings (id, tldv_meeting_id unique, title, happened_at timestamptz, duration_sec, organizer_email,
  organizer_name, tldv_url, type, type_source, type_confidence, type_reason, client_id, transcript_ready,
  process_status, process_attempts, source, raw jsonb, created_at, updated_at)`; indexes on
  `happened_at desc`, `(type, happened_at desc)`, partial on active `process_status`, `(client_id, happened_at)`.
- `participants (meeting_id, email, name, domain generated, is_dny, is_organizer, pk (meeting_id, email))`.
- `transcripts (meeting_id pk, tldv_transcript_id, segments jsonb, text, word_count, speaker_labels_reliable,
  fetched_at)`.
- `call_to_actions (id, meeting_id, version, status (ready | superseded), headline, result jsonb, model,
  prompt_version, effort, input_tokens, output_tokens, cost_usd, created_at, unique (meeting_id, version))`.
- `action_items (id, meeting_id, cta_id, model_item_key, position, title, details, owed_by, owner_name,
  owner_email, owner_basis, due_date, due_kind, due_phrase, priority, status, evidence_ts_sec, evidence_quote,
  evidence_verified, confidence, edited_by, edited_at, erp_task_id, erp_sync_status, created_at, updated_at)`;
  unique `(meeting_id, model_item_key)`; partial index on open items by `owner_email, due_date`.
- `item_feedback (id, action_item_id, verdict (approve | edit | dismiss), reason_code, edited_json, user_id,
  created_at)`.
- `classification_feedback (id, meeting_id, from_type, to_type, client_id, note, user_id, created_at)`.
- `processing_runs (id, meeting_id, attempt, workflow_run_id, trigger, status, current_step, steps jsonb,
  error, total_cost_usd, started_at, finished_at)`.
- `webhook_events (id text pk, event, tldv_meeting_id, received_at)`; `pipeline_events (id, meeting_id, step,
  level, message, created_at)` (no transcript text, ever).
- `sync_state (key pk, last_synced_at, locked_until, backfill_paused)`; `settings (key pk, value jsonb)` holding
  `pipeline_paused`, `max_concurrent`, `daily_cost_cap_usd`, `max_extractions_per_day`, `retention_months`.
- `notifications (id, cta_id, channel, recipient, status, provider_id, sent_at, unique (cta_id, channel,
  recipient))`.
- Views: `v_sales_meetings_ready`, `v_cta_latest`.
- Search: generated `tsvector` on meetings (title, headline, client name) and action_items (title), GIN index.
- Realtime publication: `meetings`, `processing_runs`.

Auth and RLS:

- RLS on every table, policies `to authenticated` using `public.is_dny_user()` (email domain check on the JWT
  plus an active `team_members` row). `is_admin()` = active admin row. `anon` gets nothing.
- Reads: domain users read everything except `webhook_events`, `pipeline_events`, `settings` (admin only).
- Writes: all mutations are server actions that call `requireUser()` first and then write with the service-role
  client and explicit column lists; the pipeline uses the service role from workflow steps and route handlers
  only. No write policies for `authenticated`.
- Google OAuth client audience Internal; callback route checks `email` ends with `@dnyhospitality.com` and
  `provider = google`, otherwise signs out and deletes the stray user. "Before User Created" hook added as an
  extra gate if the plan offers it. Project switched to asymmetric (ECC) JWT keys so `getClaims()` in `proxy.ts`
  verifies locally. Admin "Deactivate" sets `active = false` and deletes the auth user.
- Visibility question for DNY management (open): whether escalation, payroll or HR meetings must be restricted
  to account owners and management. The policies live in one helper so tightening later is one change.

## 10. Processing and guards

`workflows/process-meeting.ts` ('use workflow'): `markRun` -> `fetchTranscript` -> `classify` -> (client only)
`extract` -> `verifyAndStore` -> `notify` -> `finishRun`. Every step reads and writes Postgres itself and
returns only ids, booleans and token counts, so transcripts never enter Workflow storage. Each step writes its
status, timings, tokens and cost into `processing_runs.steps`, which Realtime pushes to the page.

- `fetchTranscript`: two quick attempts, then `FatalError('not_ready')`; the cron owns the long retry.
- `classify`: rules then Sonnet; writes type fields; `needs_decision` stops the run.
- `extract`: step `maxRetries` 1; SDK `maxRetries` 1; timeout and refusal are fatal.
- `notify`: never fails the run; dedup by the unique notifications key.
- Guards in `settings`: `pipeline_paused` (kill switch), `max_concurrent` 2, `daily_cost_cap_usd`,
  `max_extractions_per_day`; Anthropic Console spend cap; the backfill dialog shows count x estimated cost.
- Re-run (admin): new `call_to_actions` version, previous marked superseded, items upserted by `model_item_key`;
  rows with `edited_by`, feedback or `erp_task_id` are kept and flagged "not in latest run".
- Fallback if the Workflow SDK misbehaves on the pinned Next.js 16 version during the spike: the same five step
  functions called in sequence from `POST /api/process/[meetingId]` with a `processing_runs` lease, and the cron
  re-driving failures.
- Dev mode: `ANTHROPIC_MOCK=1` returns a stored extraction so the whole chain runs for free; `scripts/seed.ts`
  creates clients, team members and meetings in every state; `scripts/replay-webhook.ts` posts saved events.

## 11. Realtime and performance

- Meeting page: a client component subscribes to `processing_runs` updates for that meeting while
  `process_status` is queued or processing, renders the five-step timeline from `steps`, and calls
  `router.refresh()` when the meeting flips to done or failed; then unsubscribes. supabase-js loads lazily in
  that one component. No list-page subscription (refresh on focus and navigation), no SWR fallback.
- Rendering: React Server Components with the RLS'd server client; `loading.tsx` skeletons that match final
  heights; `next/link` prefetch on hover and viewport; server actions with `useOptimistic` for done, owner, due
  and type changes; `revalidatePath` after writes.
- Queries: explicit select lists (never `*` on tables with jsonb); the inbox is one query with keyset pagination
  (50 rows); the transcript tab loads on demand; indexes listed above, checked with `explain analyze` on 2k rows.
- Bundle: client components limited to the timeline, action rows, override dialog, filter bar and sheets; icons
  tree-shaken; no chart, date or animation libraries; `@next/bundle-analyzer` check in CI (fail over 120 kB).
- Fonts via `next/font`: IBM Plex Sans (variable), IBM Plex Mono (400, 500), Newsreader (one weight, headline
  only), IBM Plex Sans Devanagari (unicode-range, downloaded only when a Hindi quote is on the page).
- Measured with Vercel Speed Insights on a mid-range Android: shell < 300 ms, data < 1 s, INP < 200 ms, CLS 0.
- End-to-end latency to set expectations with: tl;dv takes minutes (up to 2 h) to produce a transcript; the app
  then needs about 3 to 5 minutes (Sonnet classification 5 s, Opus extraction 2 to 4 min for a one-hour meeting).

## 12. UI and UX: "Shift Sheet"

Idea: the duty-manager handover log every hospitality manager already trusts. Each meeting is one calm white
sheet on a deeper neutral canvas: a serif one-line outcome ("the minute"), a three-number scoreboard, then two
ownership lanes of verb-first lines with hairline rules. Colour is semantic only: bottle green = DNY owes,
sienna = client owes, red = risk, slate = questions and facts. No gradients, no glass, no illustration; 4 px
rhythm, tabular numerals, monospace timestamps as the only technical texture, motion only on state changes.

Ten-second read of a meeting page: the minute (serif, 28 to 40 px) -> meta line (client, type chip, date, duration,
avatars, confidence dot only when < 80%) -> scoreboard "4 for DNY / 2 for client / 3 decisions" (+ "1 risk") ->
"DNY owes" lane -> "Client owes" lane -> decisions numbered -> facts grid -> risks -> open questions -> next meeting.
A sticky section strip keeps every section one tap away.

Typography: Newsreader 500 for the minute only; IBM Plex Sans for everything else (15/22 on phone, 14/20 in
desktop lists; section labels 12 px 600, sentence case, never all caps); IBM Plex Mono for timestamps, the
scoreboard numerals, due chips and confidence.

Palette (light): canvas #E8EBE7, sheet #FFFFFF, raised #F4F6F3, inset #EEF1ED, hairline #D3D8D1, ink #14201A,
ink-2 #4F5B54, ink-3 #7B867F, bottle #1A5A44 on tint #E2F1EA, sienna #9E4418 on #F8E9DF, signal #B42318 on
#FBE9E7, slate #3B5578 on #E7EDF5, steel #475569 (ERP), focus ring #1F6FE5. Dark: canvas #0F1412, sheet #171D1A,
ink #E8ECE8, bottle #6FD1A6, sienna #F0A071, signal #F97066, slate #9DB6DA. Hues appear only as text, icon, a
3 px bar or a chip tint, never a filled card. One shadow token; 6/10 px radii; pills 999 px.

Action row anatomy: checkbox, verb-first title (inline editable), owner pill (dashed "Unassigned" is the assign
button), due chip (mono date + relative text, overdue in signal), priority dot, evidence pill "12:34" (hover or
long-press shows the quote; tap opens the recording, at the second once the URL parameter is verified),
confidence shown only below 0.8 (dashed underline; below 0.6 the row sits in the "Check" tray and is excluded
from ERP push). States: open, done (green check, strikethrough, slides into "Done · n" after 600 ms, undo 6 s),
edited (pencil glyph, original kept), needs check, pushed to ERP (steel chip, read-only here), superseded.

Layouts: desktop 1280+ = 240 px left rail, 880 px sheet, 300 px context rail (recording, attendees, processing
log, override and re-run); tablet = icon rail, context rail folds into a Details sheet, rows wrap to two lines;
phone 375 = single column, 56 px top bar that hides on scroll, bottom tab bar (Meetings, Review, Mine, Clients),
scoreboard as a scrolling strip, 56 px rows with 44 px targets, row tap opens a bottom sheet, sticky bottom
action bar only when a decision is needed ("Client meeting / Sales meeting", "Retry").

v1 pages: Sign in; Inbox (grouped list, "Needs your decision" pinned, filters, search box); Needs review queue;
Meeting page (sheet, timeline while processing, override, re-run); My actions (overdue / today / this week);
Settings: Team, Clients (table + CSV import), Integrations and status (last webhook, last cron tick, failures,
cost today, pipeline pause).
Phase 2: Client history page with sparkline, Audit log page, command palette and keyboard scheme, swipe
gestures, onboarding checklist, classification-rules editor with dry run, ICS export, dark-mode toggle polish.

States: loading skeletons matching final heights; processing timeline ("Transcript received -> Classified as
client meeting (94%) -> Extracting actions (usually ~3 min) -> Writing the sheet -> Ready") with a 200 ms fade
on completion; empty states in plain words ("Nothing owed by the client" is shown, never hidden); errors show the
real reason and an idempotent Retry; low-confidence banner with two equal buttons; sales-detected quiet row.

Accessibility: 4.5:1 text contrast in both modes, colour never the only signal, visible focus ring, full keyboard
operation, aria-live timeline, 44 px touch targets, reduced-motion respected, 15 px minimum body on phone.

Implementation: Tailwind v4 tokens in `@theme`, shadcn/ui only for Radix primitives (Dialog, Sheet, Popover,
DropdownMenu, Tooltip, Checkbox, Select, Toast) restyled hard, Phosphor icons (one set, about 25 icons),
custom components for the sheet, scoreboard, rows, timeline; a dev-only `/design` route rendering every
component in every state in both themes.

## 13. Notifications (v1)

- In-app: "Needs your decision" group and the Review badge update live; My actions shows new items.
- Email (Resend, free tier): one email per sheet to DNY attendees with the headline, the three counts and a link
  (no action-item text), plus "A meeting needs your decision" to DNY attendees when a meeting enters Review.
  Per-person opt-out (`team_members.email_notifications`). Backfilled meetings send nothing.
- Deliverability: `notify.dnyhospitality.com` with SPF, DKIM, DMARC; test against Zoho inboxes before enabling.
- Phase 2: Slack channel feed (only if DNY uses Slack), daily overdue digest, WhatsApp reminders.

## 14. Operations: observability, alerts, retention, security

- Sentry (free tier) for server and client errors with `beforeSend` scrubbing of `text`, `segments`, `payload`.
- `pipeline_events` rows from every step; `/api/health` returning `last_sync_at`, `last_webhook_at`,
  `failed_24h`, `processing_now`, `cost_today`; a free external uptime monitor on it; the same data on
  Settings > Integrations.
- Alert emails to tech@ from the cron: no tick in 20 min, a run failed 3 times, daily cost cap reached, no webhook
  for 3 business days, a meeting stuck over 3 h.
- Retention: monthly cron purges `webhook_events` after 30 days and transcripts plus `meetings.raw` after
  `retention_months` (default 12, to confirm); sheets are kept. Admin "Delete meeting data" action with an audit
  row (the tl;dv recording must be deleted by hand).
- Third-party processors to confirm with DNY: Anthropic (API default retention 30 days), Resend (30-day logs).
- Security: webhook secret in a custom header, replay window 24 h, Vercel WAF rate limit on `/api/webhooks/*`,
  service-role key only in server code paths never reachable from a page render, secrets added from files, never
  on the command line, `.env.example` committed with empty values.
- Testing and CI: Vitest for rules, transcript formatter, speaker mapping, evidence/owner/date/number guards,
  cost calculator, prompt byte-stability; msw fixtures for the tl;dv client; Playwright smoke (domain allow and
  deny, inbox, meeting page, mark done); GitHub Actions on PR: typecheck, lint, tests, build with bundle check.
- Rollback: additive migrations only in v1; `vercel rollback`; `PROMPT_VERSION` selectable by env;
  `pipeline_paused` before a rollback; "supersede latest sheet and re-run" admin action.

## 15. ERP integration (phase 2)

Now: `erp_task_id` and `erp_sync_status` on `action_items`, `erp_client_id` on `clients`, `erp_user_id` on
`team_members`.
First step later: read the ERP repo on DNY GitHub (the current `gh` login cannot see it) and write a one-page
contract: stack and hosting, machine auth, staging availability, the task model (required fields, status and
priority enums, external reference field), assignee and client identifier formats, webhooks or polling for
status, who approves endpoint changes, whether client-owed items go to the ERP at all.
Then: `ErpAdapter` interface (`upsertTask`, `updateTaskStatus`, `healthcheck`), a canonical DTO with a version
field and idempotency key, a manual "Push to ERP" dialog previewing exactly which rows go (needs-check rows
excluded), per-row results, retries; later an outbox drained by the cron tick and a status callback route.

## 16. Costs (one table)

Prices: Opus 5.5 $4 / $20 per million input / output tokens; Sonnet 5.5 $2 / $10; cache reads $0.20.

| Item | Opus 5.5 (default) | Sonnet 5.5 (option) |
|---|---|---|
| Extraction, 60-min English meeting | about $0.25 (range $0.18 to $0.35) | about $0.12 |
| Extraction, 60-min Hinglish-heavy | about $0.30 | about $0.15 |
| Extraction, 3-hour meeting | $0.50 to $0.90 | $0.25 to $0.45 |
| Classification call (Sonnet, effort low) | $0.02 | $0.02 |
| 50 meetings/month, 60% client | about $10 | about $5 |
| 200 meetings/month, 60% client | about $40 | about $20 |
| 500 meetings/month, 60% client | about $100 | about $50 |

Effort `medium` figures; `high` adds roughly 30 to 50% on output. Platform: Vercel Pro $20 per seat, Supabase
Pro $25, Resend free, Sentry free, tl;dv seats as today. Workflow usage is inside the included quota.

## 17. Build plan

Week 1: day-0 spike and account switches; repo and Vercel link; Supabase projects and migrations; auth with the
domain gate; tl;dv client with zod schemas; webhook route, cron tick, replay action; pipeline running end to end
with `ANTHROPIC_MOCK`; seed data; inbox and meeting page on seed data in the Shift Sheet design.
Week 2: real Claude runs on 5 recorded meetings (one Hinglish, one escalation, one poor audio); prompt and
verification tuning; Needs review, My actions, Settings (Team, Clients with CSV import, Integrations/status);
emails; health endpoint and alerts; 14-day backfill after seeding clients; pilot with 3 users and per-item
approve/edit/dismiss feedback.
Weeks 3 to 4 (phase 2): ERP contract and manual push; client history page; classification learning; Slack;
digest; eval script over the first 20 approved sheets; effort and model sweeps.

## 18. Open questions for Tarique

P0 (block the build)
1. tl;dv: plan, which accounts record client meetings and whether they are on paid seats, whether tech@ has a
   seat that sees colleagues' recordings, webhook scope options, transcript language setting.
2. Vercel DNY team on Pro? Supabase: may a Pro project be created? App domain (e.g. actions.dnyhospitality.com)
   and who controls DNS.
3. Anthropic: does a DNY Console organisation exist, who administers billing, monthly cap, Opus (quality) or
   Sonnet (half cost) as the default.
4. Google: can tech@ create a Google Cloud project inside the Workspace.
5. Scope: confirm the v1 cut in section 12 and name the 2 to 3 pilot users.

P1 (needed in week 1)
6. Who sends client-meeting invites in practice (DNY, client, both) and how clients join (company email,
   personal Gmail, forwarded link, phone).
7. Share of Hindi/Hinglish calls, typical and maximum meeting length, meetings per month, number of clients
   and of DNY users.
8. A CSV of clients (name, domains, contact emails including personal ones, status), and whether the ERP is the
   long-term owner of the client list.
9. Who may see what (all staff vs restricted escalation/payroll meetings), transcript retention period, any
   client contracts restricting AI processing, whether a human must approve a sheet before emails go out.
10. ERP: repo link and access, stack, task model, staging, maintainer.
11. Sales agent: where it lives, whether it shares this Supabase project, and whether its owner accepts the view
    hand-off.
12. Slack or WhatsApp in use? Who receives the sheet email?
13. 3 to 5 real transcripts (one Hinglish, one escalation, one poor audio) for prompt work in week 1.

P2
14. Backfill depth (default 14 days), cron 24/7 vs business hours, alert recipients besides tech@, PWA install.

## Appendix A: extraction system prompt (draft v1, frozen as a versioned file)
Adjustments applied when implementing: the meeting date is passed in the user message as an IST date with weekday; the user message states when speaker labels are unreliable; nothing volatile goes into this prompt so the cache prefix stays stable.
```text
You are the meeting analyst for DNY Hospitality, an Indian hospitality management and consulting company. DNY runs hotels, restaurants and food-service operations for its clients (owners and operators) and advises them. After every client meeting, DNY's account team and the client need one clear page that anyone can understand at a glance: what the meeting achieved, who has to do what by when, what was decided, the facts and numbers that matter, what could go wrong, what is still unanswered, and when everyone meets next.

You receive the meeting metadata (date with weekday, duration, participants with their side and role, the client record when known) and the full transcript. Each transcript line starts with a timestamp marker such as [12:34] or [1:02:10], then the speaker's name as tl;dv labelled it, with (DNY) or (Client) appended when we could identify the side. Your reply is a single JSON object; the API enforces the schema.

What good looks like
- The headline is the one sentence a busy owner reads first: the outcome, not the agenda ("Hotel Sunrise agreed to the new F&B costing model; DNY to share the revised menu by 10 November").
- The three executive-summary bullets cover the most consequential points, in order of importance, each self-contained.
- Action items are things someone has to do. Title them verb-first ("Send revised duty roster", "Approve the vendor quote"), one item per task, specific enough to be ticked off. Put how/why in details. Record whether DNY or the client owes it. Mark priority from how the participants treated it (urgent, repeated, tied to money or a deadline), not from your own view.
- Decisions are conclusions the participants reached, stated as facts ("Weekly MIS will move to Mondays"). Agreements to act go in action items, not here; link them if one caused the other.
- Key facts are the numbers, dates, amounts, names, contract terms and operational facts that someone will want to look up later. Keep the value exactly as said and add a normalised form when useful (lakh/crore to digits, relative dates to calendar dates).
- Risks are things that could hurt the client's operation or the DNY relationship, including complaints and escalations. Open questions are things that were asked or raised and not resolved in the meeting.
- Client sentiment reflects how the client side sounded about DNY and the engagement, with the drivers behind it.

Grounding
- Everything you output must come from this transcript. If it is not said, it is not in the output. Do not fill gaps with what a hospitality meeting would typically contain.
- Owners: name a person only when the transcript shows them accepting the task or being assigned it on the record. "We will send it" from a DNY speaker means owed by DNY, owner name null. Use the canonical spellings from the participants list.
- Dates: compute a calendar date only when the transcript gives one explicitly or gives an unambiguous relative phrase ("by Friday", "within two days", "before the 15th"), computed from the meeting date you were given. "Soon", "ASAP", "this week sometime" are not dates; record the phrase and leave the date null. Hindi "kal" and "parso" are ambiguous in direction; resolve from context or leave the date null with lower confidence.
- Every item carries evidence: copy the timestamp marker of the line you rely on exactly as it appears, the speaker label verbatim, and a short verbatim quote (at most 30 words) in its original language and script, with an English rendering when it is not English. Choose the line where the commitment, decision or fact is actually stated, not where it is first hinted at. One strong piece of evidence beats three weak ones.
- Confidence is your honest estimate that a careful reader of the recording would agree with the item as written, including the owner and date. Use the low end freely; the interface shows low-confidence items separately, so an honest 0.4 is more useful than an inflated 0.8.

Language
- Participants may speak English, Hindi or Hinglish, switching mid-sentence. All of your prose fields are in clear, plain English that a client owner or a new DNY employee can read without context. Keep hospitality terms precise (ARR, RevPAR, occupancy, OTA, F&B, banquet, SOP, MIS, GST, FSSAI, payroll, duty roster). Do not translate names.

Transcript quality
- Speaker labels can be wrong or generic, and sentences can be garbled. Where attribution is unreliable, say so in participants/quality and lower the confidence of items that depend on who said what. Ignore small talk, connection problems and anything unrelated to the client's business unless it changes a commitment.
- If large parts of the transcript are unusable, still produce what you can and describe the gap in quality.issues rather than inventing a complete-looking result.

Scope and restraint
- Do not pad. A short meeting with two real action items yields two action items. Do not repeat one point across several lists. Do not list the next meeting as an action item unless someone has to arrange it.
- Prefer the participants' own words and priorities over your interpretation; where you interpret (e.g. inferring a side from role), make the basis field say so.
```

## Appendix B: call-to-action output schema (JSON Schema, used through zodOutputFormat)
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "headline",
    "executive_summary",
    "meeting_purpose",
    "language_profile",
    "action_items",
    "decisions",
    "key_facts",
    "risks",
    "open_questions",
    "next_meeting",
    "client_sentiment",
    "participants",
    "quality",
    "overall_confidence"
  ],
  "$defs": {
    "Evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "timestamp",
        "speaker",
        "quote",
        "quote_english"
      ],
      "properties": {
        "timestamp": {
          "type": "string",
          "description": "The marker of the transcript line relied on, copied exactly, e.g. 12:34 or 1:02:10"
        },
        "speaker": {
          "type": "string",
          "description": "Speaker label exactly as it appears on that line, without the (DNY)/(Client) tag"
        },
        "quote": {
          "type": "string",
          "description": "Verbatim words from that line, original language and script, at most 30 words"
        },
        "quote_english": {
          "type": [
            "string",
            "null"
          ],
          "description": "Plain-English rendering when the quote is not already English; null otherwise"
        }
      }
    },
    "Side": {
      "type": "string",
      "enum": [
        "dny",
        "client",
        "both",
        "unclear"
      ]
    },
    "ActionItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "title",
        "details",
        "owed_by",
        "owner",
        "due",
        "priority",
        "linked_decision_id",
        "evidence",
        "confidence"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "A1, A2, ..."
        },
        "title": {
          "type": "string",
          "description": "Verb-first, at most 12 words, e.g. 'Share revised duty roster with owner'"
        },
        "details": {
          "type": "string",
          "description": "What exactly, why, any conditions; one to three sentences; empty string if the title says it all"
        },
        "owed_by": {
          "$ref": "#/$defs/Side",
          "description": "Who owes this task: dny or client (both when it is genuinely joint)"
        },
        "owner": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "name",
            "side",
            "basis"
          ],
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ],
              "description": "Canonical participant name only when the transcript supports it; null otherwise"
            },
            "side": {
              "type": "string",
              "enum": [
                "dny",
                "client",
                "unknown"
              ]
            },
            "basis": {
              "type": "string",
              "enum": [
                "explicitly_assigned",
                "volunteered",
                "implied_by_role",
                "not_stated"
              ]
            }
          }
        },
        "due": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "date",
            "raw_phrase",
            "basis"
          ],
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "explicit_date",
                "relative_phrase",
                "asap",
                "none_stated"
              ]
            },
            "date": {
              "type": [
                "string",
                "null"
              ],
              "format": "date",
              "description": "YYYY-MM-DD, only when explicit or unambiguously derivable from the meeting date"
            },
            "raw_phrase": {
              "type": [
                "string",
                "null"
              ],
              "description": "The words used, e.g. 'by Friday', 'agle hafte tak'"
            },
            "basis": {
              "type": [
                "string",
                "null"
              ],
              "description": "How the date was derived, e.g. 'meeting on Tue 4 Nov; next Friday = 7 Nov'"
            }
          }
        },
        "priority": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ]
        },
        "linked_decision_id": {
          "type": [
            "string",
            "null"
          ],
          "description": "Decision id this task implements, if any"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          },
          "description": "1 to 3 items"
        },
        "confidence": {
          "type": "number",
          "description": "0 to 1"
        }
      }
    },
    "Decision": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "statement",
        "decided_by",
        "evidence",
        "confidence"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "D1, D2, ..."
        },
        "statement": {
          "type": "string",
          "description": "The decision as a plain statement of fact"
        },
        "decided_by": {
          "type": "string",
          "enum": [
            "dny",
            "client",
            "joint",
            "unclear"
          ]
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          }
        },
        "confidence": {
          "type": "number"
        }
      }
    },
    "KeyFact": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "fact",
        "category",
        "normalized_value",
        "evidence",
        "confidence"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "F1, F2, ..."
        },
        "fact": {
          "type": "string",
          "description": "One sentence, value as said"
        },
        "category": {
          "type": "string",
          "enum": [
            "money",
            "date",
            "quantity",
            "metric",
            "contract",
            "staffing",
            "property",
            "process",
            "other"
          ]
        },
        "normalized_value": {
          "type": [
            "string",
            "null"
          ],
          "description": "Machine-friendly form, e.g. 'INR 250000', '2026-11-15', '72%'"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          }
        },
        "confidence": {
          "type": "number"
        }
      }
    },
    "Risk": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "description",
        "severity",
        "affects",
        "mitigation_discussed",
        "evidence",
        "confidence"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "R1, R2, ..."
        },
        "description": {
          "type": "string"
        },
        "severity": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ]
        },
        "affects": {
          "$ref": "#/$defs/Side"
        },
        "mitigation_discussed": {
          "type": [
            "string",
            "null"
          ],
          "description": "What the participants said they would do about it, if anything"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          }
        },
        "confidence": {
          "type": "number"
        }
      }
    },
    "OpenQuestion": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "question",
        "raised_by",
        "needs_answer_from",
        "evidence",
        "confidence"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "Q1, Q2, ..."
        },
        "question": {
          "type": "string"
        },
        "raised_by": {
          "type": "string",
          "enum": [
            "dny",
            "client",
            "unclear"
          ]
        },
        "needs_answer_from": {
          "type": "string",
          "enum": [
            "dny",
            "client",
            "unclear"
          ]
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          }
        },
        "confidence": {
          "type": "number"
        }
      }
    }
  },
  "properties": {
    "headline": {
      "type": "string",
      "description": "One sentence, at most 140 characters, stating the outcome of the meeting"
    },
    "executive_summary": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Exactly 3 bullets, most important first, each self-contained"
    },
    "meeting_purpose": {
      "type": "string",
      "enum": [
        "review",
        "onboarding",
        "operations",
        "escalation",
        "training",
        "planning",
        "renewal_or_commercial",
        "other"
      ]
    },
    "language_profile": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "primary",
        "mixed",
        "notes"
      ],
      "properties": {
        "primary": {
          "type": "string",
          "enum": [
            "english",
            "hindi",
            "hinglish",
            "other"
          ]
        },
        "mixed": {
          "type": "boolean"
        },
        "notes": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "action_items": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/ActionItem"
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/Decision"
      }
    },
    "key_facts": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/KeyFact"
      }
    },
    "risks": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/Risk"
      }
    },
    "open_questions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/OpenQuestion"
      }
    },
    "next_meeting": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mentioned",
        "date",
        "raw_phrase",
        "purpose",
        "evidence",
        "confidence"
      ],
      "properties": {
        "mentioned": {
          "type": "boolean"
        },
        "date": {
          "type": [
            "string",
            "null"
          ],
          "format": "date"
        },
        "raw_phrase": {
          "type": [
            "string",
            "null"
          ]
        },
        "purpose": {
          "type": [
            "string",
            "null"
          ]
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          }
        },
        "confidence": {
          "type": "number"
        }
      }
    },
    "client_sentiment": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "label",
        "summary",
        "drivers",
        "evidence",
        "confidence"
      ],
      "properties": {
        "label": {
          "type": "string",
          "enum": [
            "very_positive",
            "positive",
            "neutral",
            "concerned",
            "frustrated",
            "mixed"
          ]
        },
        "summary": {
          "type": "string",
          "description": "One sentence on how the client side sounded about DNY and the engagement"
        },
        "drivers": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Short phrases, e.g. 'praised the new chef', 'unhappy about delayed MIS'"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Evidence"
          }
        },
        "confidence": {
          "type": "number"
        }
      }
    },
    "participants": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "speaker_label",
          "name",
          "side",
          "role_guess",
          "confidence"
        ],
        "properties": {
          "speaker_label": {
            "type": "string",
            "description": "Exactly as it appears in the transcript"
          },
          "name": {
            "type": [
              "string",
              "null"
            ],
            "description": "Canonical name from the participants list, if matched"
          },
          "side": {
            "type": "string",
            "enum": [
              "dny",
              "client",
              "third_party",
              "unknown"
            ]
          },
          "role_guess": {
            "type": [
              "string",
              "null"
            ],
            "description": "e.g. 'owner', 'GM', 'DNY account manager', only if evident"
          },
          "confidence": {
            "type": "number"
          }
        }
      }
    },
    "quality": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "transcript_quality",
        "speaker_labels_reliable",
        "issues",
        "unresolved_references"
      ],
      "properties": {
        "transcript_quality": {
          "type": "string",
          "enum": [
            "good",
            "fair",
            "poor"
          ]
        },
        "speaker_labels_reliable": {
          "type": "boolean"
        },
        "issues": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "e.g. 'audio drops 22:10-24:40', 'two speakers both labelled Speaker 1'"
        },
        "unresolved_references": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Things referred to that the transcript never explains, e.g. 'the Pune proposal'"
        }
      }
    },
    "overall_confidence": {
      "type": "number",
      "description": "0 to 1, your confidence that this page faithfully represents the meeting"
    }
  }
}
```

## Appendix C: classification output schema
v1 uses the fields `type`, `confidence`, `reason`, `evidence[]`, `client_name_guess`, `language`; the rest is phase 2.
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "type",
    "confidence",
    "reason",
    "evidence",
    "client_name_guess",
    "relationship_signals",
    "language",
    "suggested_rule_updates"
  ],
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "client",
        "sales",
        "internal",
        "other"
      ],
      "description": "client = DNY already serves this party (review, onboarding, operations, escalation). sales = DNY is trying to win or quote a new engagement. internal = only DNY staff. other = vendor, recruitment, personal, or no usable content."
    },
    "confidence": {
      "type": "number",
      "description": "0 to 1. 0.9+ only when the transcript explicitly shows an existing engagement (client) or a first-contact/pitch (sales)."
    },
    "reason": {
      "type": "string",
      "description": "One or two plain-English sentences a non-technical reviewer can read on the card."
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "timestamp",
          "speaker",
          "quote"
        ],
        "properties": {
          "timestamp": {
            "type": "string",
            "description": "Copied exactly from the transcript line marker, e.g. 03:12 or 1:02:10"
          },
          "speaker": {
            "type": "string"
          },
          "quote": {
            "type": "string",
            "description": "Verbatim, original language, at most 25 words"
          }
        }
      }
    },
    "client_name_guess": {
      "type": [
        "string",
        "null"
      ],
      "description": "Name of the hotel/restaurant/company on the other side if it is said in the meeting; null if not said."
    },
    "relationship_signals": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "existing_engagement_cues",
        "prospecting_cues"
      ],
      "properties": {
        "existing_engagement_cues": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "prospecting_cues": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "language": {
      "type": "string",
      "enum": [
        "english",
        "hindi",
        "hinglish",
        "other"
      ]
    },
    "suggested_rule_updates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "value",
          "reason"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "add_client_domain",
              "add_client_contact",
              "add_prospect_domain",
              "add_prospect_contact",
              "add_vendor_domain",
              "add_sales_person"
            ]
          },
          "value": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

## Appendix D: sources

tl;dv (verified on official pages unless marked):
- https://doc.tldv.io (tl;dv API v1alpha1 reference, Redoc page with embedded OpenAPI spec — endpoints, schemas, webhook schemas, permission table, User-Agent rule, 10 s webhook timeout)
- https://intercom.help/tldv/en/articles/11583137-api-and-webhooks (help centre: API — plan requirement 'Pro or Business', key location, base URL, permissions, endpoint list)
- https://intercom.help/tldv/en/articles/15416775-webhooks (help centre: Webhooks — plan, dashboard registration steps, scopes, payload examples, HTTPS only, custom headers, no metadata in TranscriptReady)
- https://tldv.io/app/settings/personal-settings/api-keys (API key page, login required)
- https://intercom.help/tldv/en/articles/6231678-how-to-change-transcript-language (40 supported languages incl. Hindi; default vs Whisper model; multi-language auto-detect)
- https://intercom.help/tldv/en/articles/8925840-understanding-and-setting-your-preferences (auto-record internal/external definitions, auto-share rules, transcript language doesn't translate, Whisper multi-language on Business/Enterprise)
- https://intercom.help/tldv/en/articles/8460994-my-video-transcript-is-still-processing (processing order; up to 2 h)
- https://intercom.help/tldv/en/articles/10494368-who-recorded-and-who-owns-a-recording (ownership, one bot per meeting)
- https://intercom.help/tldv/en/articles/8460883-who-will-see-my-recordings (visibility/auto-share)
- https://intercom.help/tldv/en/articles/8460967-how-long-do-you-keep-my-recordings and https://intercom.help/tldv/en/articles/8919450-what-are-the-limits-of-the-free-plan (retention, free-plan limits, 20 integration credits)
- https://intercom.help/tldv/en/articles/8155030-zapier-integration (integration credits, unlimited on Pro)
- https://intercom.help/tldv/en/articles/14434461-recording-meetings-with-google-meet (calendar connection, bot admission)
- https://zapier.com/apps/tldv/integrations (official Zapier listing: triggers Note Added / Recording Added / Transcript Added, isHook/Instant; action Upload Recording)
- https://apps.make.com/tldv-yb98ap (Make community app by Codex Solutions: action modules only, Business plan per listing)
- https://www.activepieces.com/pieces/tl-dv (Activepieces piece: Meeting Ready / Transcript Ready triggers)
- https://github.com/tldv-public/tldv-mcp-server and https://glama.ai/mcp/servers/tldv-public/tldv-mcp-server/tools/list-meetings (official MCP server: Pro plan and above; list-meetings meetingType rule)
- https://tldv.io/pricing/ (plan prices; feature matrix not readable server-side)
- https://tldv.io/features/languages/ (marketing: 30+ languages)

Unverified tl;dv points (check in the day-0 spike):
- Timestamp deep-link URL parameter for https://app.tldv.io/meetings/{id} (e.g. ?t=<seconds>) — not in any official doc; must be checked by copying a moment link from the app.
- Exact HTTP status returned by GET /transcript before the transcript is complete (404 vs 403 vs 200-empty) — docs only say 'returned only if it is complete'.
- Webhook retry count/backoff schedule and whether failed deliveries are visible in the dashboard — only the 10 s timeout is documented.
- Whether Team/Organization webhook scope and org-wide API listing work on Pro/Business or need Enterprise ('Organization-wide automation requires an Enterprise plan (more to come soon)' is ambiguous).
- Third-party claims that API/webhooks are 'Business plan only' and that Pro is $18 / Business $29-59 per seat — vendor help centre currently says Pro or Business; confirm on the live pricing page / DNY admin.
- Typical processing latency of 5-20 min after a meeting (a third-party source); the official figure is only the 'up to 2h' ceiling.
- Sort order of GET /meetings results and whether `from`/`to` filter on happenedAt — not stated in the spec.
- How unrecognised speakers are labelled in transcript.data[].speaker (e.g. 'Speaker 1' vs guest display name) and how reliable diarization is for Hindi/Hinglish audio — no official statement found.
- Existence of undocumented API rate limits (a third-party API report claims the official MCP server retries on 429 with exponential backoff) — treat as likely, unconfirmed.
- Whether the official MCP server's 'Pro plan and above' statement supersedes the Make listing's 'Business plan' requirement.
- Behaviour when the client (external domain) is the calendar organizer: recording may be visible in the UI yet blocked for API export — inferred from the organizer-plan rule, not explicitly documented.

Supabase, Vercel, Google, Resend, Slack, Anthropic:
- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook — hook runs before insert for all sign-up methods incl. OAuth; payload has user.email and app_metadata.provider; reject with {error:{http_code,message}} — verified=true
- https://supabase.com/docs/guides/auth/auth-hooks — hook list, Postgres vs HTTP hooks, Free/Pro availability of Before User Created and Custom Access Token, grants to supabase_auth_admin, 2 s Postgres / 5 s HTTP budgets — verified=true
- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook — adding app_metadata claims, grants, claims refresh only on token refresh — verified=true
- https://developers.google.com/identity/openid-connect/openid-connect — hd parameter is UI-only and must not be relied on; ID-token hd claim is trusted and must be checked to restrict to domains — verified=true
- https://supabase.com/docs/guides/auth/social-login/auth-google — Google Cloud redirect URI https://<ref>.supabase.co/auth/v1/callback, client id/secret in dashboard, /auth/callback route with exchangeCodeForSession, queryParams option — verified=true
- https://supabase.com/docs/reference/javascript/auth-signinwithoauth — signInWithOAuth options (provider, redirectTo, scopes, queryParams, skipBrowserRedirect) — verified=true
- https://supabase.com/docs/guides/auth/redirect-urls — redirectTo must match the allow list; Vercel preview wildcard https://*-<slug>.vercel.app/**; use exact URL in production — verified=true
- https://supabase.com/docs/guides/auth/server-side/nextjs — @supabase/ssr browser/server clients, proxy.ts on Next 16 (middleware.ts before), getClaims() for refresh, never trust getSession() on the server, cookie name sb-<ref>-auth-token, cache-control headers — verified=true
- https://supabase.com/docs/guides/database/postgres/row-level-security — auth.uid()/auth.jwt() patterns incl. email-domain policy, wrap in select, index policy columns, security definer helpers, service_role has bypassrls — verified=true
- https://supabase.com/docs/guides/realtime/postgres-changes — alter publication supabase_realtime add table; RLS evaluated per subscriber per event; filter syntax eq/in; single-threaded; REPLICA IDENTITY FULL for DELETE filters; Broadcast recommended above ~3,000 concurrent subscribers — verified=true
- https://supabase.com/docs/guides/realtime/broadcast — realtime.broadcast_changes/realtime.send trigger pattern, realtime.messages policy, setAuth() before subscribing — verified=true
- https://supabase.com/pricing — Free $0: 500 MB DB, 200 Realtime connections, 2M messages, 50k MAU, paused after 1 week inactivity; Pro from $25: 8 GB, 500 connections, 5M messages, never paused; Free Auth hooks listed as Custom Access Token + custom email/SMS — verified=true
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy — middleware renamed to proxy in v16, Node runtime default, matcher config, Server Functions are POSTs to the page route so verify auth inside each Server Function — verified=true
- https://vercel.com/docs/cron-jobs/usage-and-pricing — 100 crons per project; Hobby once per day with ±59 min precision; Pro/Enterprise per minute; billed as function invocations — verified=true
- https://vercel.com/docs/cron-jobs/manage-cron-jobs — CRON_SECRET sent as Authorization: Bearer; no retries on failure; best-effort delivery with possible duplicates/misses; overlap guidance (locks, idempotency); crons do not follow redirects — verified=true
- https://vercel.com/docs/functions/configuring-functions/duration — Fluid Compute defaults 300 s on all plans; Pro/Enterprise up to 800 s, extended 1800 s beta; export const maxDuration in App Router — verified=true
- https://vercel.com/docs/workflows — durable runs, steps execute as Vercel Functions, Queues underneath, region pinning, observability, team owners can read decrypted run data — verified=true
- https://vercel.com/docs/workflows/pricing — Hobby 50,000 events/month + 1 GB written included; $0.02/1k events, $0.50/GB written, $0.50/GB-month retained; limits (25k events/run, 10k steps/run, 50 MB payload, 240 s replay, no max run/sleep duration, step runtime = function limits) — verified=true
- https://workflow-sdk.dev/docs/foundations/errors-and-retries — steps retry up to 3 times by default; maxRetries per step; RetryableError retryAfter; FatalError; exhausted retries fail the run — verified=true
- https://workflow-sdk.dev/docs/getting-started/next — npm i workflow, withWorkflow(nextConfig), workflows/ dir, start() from workflow/api, no special config on Vercel, Next 16.1+ note — verified=true
- https://vercel.com/docs/queues/pricing — per-operation billing, 1,000,000 included on Hobby, limits (TTL 60 s–7 d, delay up to 7 d, visibility timeout up to 60 min, 100 MB message) — verified=true
- https://vercel.com/docs/background-workers — decision table: Queues for event-driven jobs with retries, Workflows for multiple steps/checkpoints/waits, Cron for schedules, waitUntil/after() for short post-response work — verified=true
- https://vercel.com/docs/plans/hobby — Hobby restricted to non-commercial personal use; 300 s function max; Pro 800 s / 1800 s beta; Pro developer seats $20/user/month — verified=true
- https://doc.tldv.io/ — base https://pasta.tldv.io; x-api-key + custom User-Agent; GET /v1alpha1/meetings (query, page, limit 1–100, from, to, onlyParticipated, meetingType), /meetings/{id}, /meetings/{id}/transcript (data[{speaker,text,startTime,endTime}]), /meetings/{id}/notes, /meetings/{id}/download; webhooks MeetingReady/TranscriptReady payload {id,event,data,executedAt}, 10 s timeout then retry; API on Pro/Business/Enterprise, exportability depends on organizer's plan — verified=true
- https://intercom.help/tldv/en/articles/15416775-webhooks — webhooks on Pro/Business only; configure in Settings > Webhooks; custom headers (Authorization / x-api-key) supported; HTTPS required; no signature/HMAC documented — verified=true
- https://resend.com/pricing — Free: 3,000 emails/month, 100/day, 3 domains, 30-day retention; Pro $20/mo 50k — verified=true
- https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks — create app, activate Incoming Webhooks, pick channel; POST JSON text/blocks; URL contains a secret, do not commit — verified=true
- https://developers.google.com/workspace/guides/configure-oauth-consent — Audience selection; apps used only internally by your Workspace org skip further Google review; exact Internal-only-org-members wording not fetched — verified=false (partial)
- Anthropic bundled claude-api skill (vendor-authored, cached 2026-09-25) — Opus 5.5 $4/$20 per MTok, Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5; structured outputs via messages.parse + zodOutputFormat; prompt caching cache_control ephemeral; Batches API at 50% price within 24 h; effort default medium on Opus 5.5; server-side fallbacks beta — verified=true (vendor-authored skill, not a fetched web page)
- Supabase publishable/secret key naming (sb_publishable_…/sb_secret_…) replacing anon/service_role labels — not fetched this session — verified=false
- Meta WhatsApp Cloud API requiring approved templates and per-conversation pricing — not fetched this session — verified=false
