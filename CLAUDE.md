# Call to Action (DNY Hospitality)

Client meetings recorded by tl;dv become one clear "sheet" each: the outcome in one line, who owes
what by when (DNY vs client), decisions, facts, risks, open questions, next meeting, every item backed
by a timestamped quote. Sales meetings are labelled and left to the sales agent (dny-call-qa).
Phone calls on DNY's client-work lines (Callyzer, transcribed by Deepgram) become sheets too: client and
vendor calls get one; any other call is deleted from this app, or held for the line's person when unsure.

## Accounts: DNY only

This is a DNY work project. Vercel: the DNY team (`team_OlIlw1Oi3U81fSrgeQnvcZaq`, the same team as
dny-call-qa), project `dny-call-to-action`. GitHub: `TechDNYsanchay/DNY-call-to-action`, plus a private mirror on Tarique's account,
`tariquescript/dny-call-to-action` (the same setup as dny-call-qa, at Tarique's request). Every push goes to both:
`git push dny main && git push personal main` (`dny` uses the SSH host `github-dny`; `personal` uses plain
`github.com`, which is the tariquescript key). The `origin` remote is the plain HTTPS URL kept only so the Vercel CLI
can read it.
The Vercel project is connected to the DNY repo only: every push to its `main` deploys production, so push only green builds. Supabase: project `dny-agents` (ref `iaxjxefipmdumfukttvv`, Mumbai; named `dny-call-to-action` until 26 Nov 2026, shared with Sales QA since then, see below) in
tech@dnyhospitality.com's organisation. Apart from that GitHub mirror, never use the personal tariquescript accounts (no personal Vercel or Supabase). The machine's global Vercel login is the personal one and
must stay that way: run every Vercel command through `bash scripts/vc.sh ...` (it uses the DNY login kept in
`~/.config/vercel-dny`); `bash scripts/vc.sh whoami` must print the DNY identity (tech-5297). `.vercel/project.json`
pins the project.

## Separation from the sales agent

This app is separate from dny-call-qa (Sales QA): its own Google Cloud project, its own Vercel project, its own
tl;dv webhook. Since 26 Nov 2026 the two apps share one Supabase project (`dny-agents`) to save the cost of a second:

- Schemas: this app owns `public`; Sales QA owns `qa` (its clients set `db.schema = "qa"`). Never read or change `qa`
  from here; never add Sales QA objects to `public`.
- Logins (`auth.users`) are shared: someone on both team lists has one login, and each app lets a login in only if its
  own `people` table lists the person as active. Removing a person here bans their login (people-admin), which also
  stops them signing in to Sales QA until they are re-added here. Sales QA creates logins with find-or-create and never
  bans or deletes them (except its `@sample.invalid` sample accounts).
- Auth settings are one set for both apps: Sales QA's callback URLs are in `additional_redirect_urls`, the Google
  provider is this app's OAuth client, and `supabase/templates/magic_link.html` sends Sales QA's own email when the link
  returns to Sales QA (subject likewise). dny-call-qa's `supabase/config.toml` and template are kept identical to this
  repo's (only `project_id` differs): change both together, and push config from either repo only with them in sync.
  The magic-link email rate limit (`auth.rate_limit.email_sent`) is shared by both apps.
- Migration history is shared: `supabase/migrations/*_qa_*.sql` are placeholders for Sales QA's migrations so
  `npx supabase db push --remote` here sees the whole history (the first one creates the empty `qa` schema locally so
  the API starts). When Sales QA adds a migration, add a `<version>_qa_<name>.sql` placeholder here before the next push;
  each migration added here needs a `<version>_cta_<name>.sql` placeholder in dny-call-qa.
- Storage: this app's bucket is `call-recordings`; Sales QA's are `recordings` and `references`.

Sales QA's old project `dny-call-qa` (ref `jlqppprkvlwhtbvhgiik`) was renamed `trs` for future TRS work.
Shared with it: the company tl;dv account (and its API key),
and the Callyzer and Deepgram keys (copied from Sales QA, below).
The ERP it will integrate with later is GitHub repo TechDNYsanchay/dny-erp.

Coupling with Sales QA's Callyzer schedule: both apps use one Callyzer key, rate-limited to one request a
second. Sales QA polls at :00, :15, :30 and :45 (UTC); this app's calls job never sends a Callyzer request
from 10 s before until 90 s after those minutes. If Sales QA's schedule changes, change
`SALES_QA_CALLYZER_MINUTES` in `src/lib/calls/schedule.ts` too.

## How Claude is used

There is no Anthropic API key. The analysis runs as a Claude Code cloud routine on DNY's Claude Max plan
(same pattern as dny-call-qa): the routine calls `/api/agent/*` on Vercel with `AGENT_TOKEN` as a
Bearer token, gets the next ready meeting or call as a package (metadata, participants, transcript lines,
result format, a claim token it echoes as `&claim=`), writes the sheet JSON, checks it with `?dryRun=1`,
then saves. The server validates everything (schema, quotes present in the transcript, owners and dates)
before anything is stored. The routine never holds database keys. Its prompt is `agent/routine-prompt.md`
and its guide `agent/guide.md`.
The routine environment's Custom network must stay limited to `dny-call-to-action.vercel.app`: it is what
stops an injected transcript or contact name from sending call content anywhere else.

## Production steps (main session only)

Pushing a migration, copying env values (`bash scripts/copy-shared-keys.sh`), pushing them to Vercel
(`bash scripts/push-env.sh NAME...`), deploys, and routine prompt updates (RemoteTrigger) are done by the main
session after review, never by an implementer or a subagent. Implementers write code, migrations, tests and
docs, and check database work on the local Supabase stack only (`npx supabase db reset`, `npx supabase test db`,
`npm run test:e2e`). `npm run test:e2e` clears every call, phone line, ledger row and stored recording in the local
database (not only its own) before and after it runs: never run it while someone else uses the local stack's calls.
Order for the phone-calls launch: push the migrations before the code (every push to `main` deploys, and the code
reads `meetings.kind`, so a deploy on the old schema breaks the meetings screens), and give the routine its new prompt
before unpausing calls (the old prompt sends no claim, so it cannot finish a call).

## Stack and conventions

- Next.js 16 App Router (read `AGENTS.md` and `node_modules/next/dist/docs/` before touching pages or
  routes; `proxy.ts` not middleware), React 19, TypeScript strict, Tailwind v4 with the tokens in
  `src/app/globals.css` (Shift Sheet design: bottle = DNY owes, sienna = client owes, signal = risk,
  slate = questions and facts, steel = ERP). Fonts in `src/app/fonts.ts`.
- Supabase: `supabaseServer()` for reads as the signed-in person (RLS), `supabaseAdmin()` only in
  webhook/cron/agent routes and in server actions after `requireUser()`. Types in
  `src/lib/supabase/database.types.ts` (regenerate with `npm run db:types` after a migration).
- Times: store UTC, show and compute in Asia/Kolkata (`src/lib/format.ts`).
- Secrets live in `.env.local` (save with `bash scripts/save-key.sh NAME`); never print them, never
  commit them, never put them on a command line. `.env.example` lists every name with no value.
- Tests: Vitest (`npm test`), pure modules get a `*.test.ts` next to them. `npm run typecheck`,
  `npm run lint`, `npm run build` must pass before a push.
- Dev server: `npm run dev` on port 3200 (3000 and 3100 are used by other apps on this machine).

## Environment

| Name | What |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Supabase |
| `NEXT_PUBLIC_SITE_URL` | The app's own URL |
| `CRON_SECRET` | Bearer token of the Vercel crons |
| `AGENT_TOKEN` | Bearer token of the routine's work API |
| `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` | Starts the routine at once when work is ready |
| `TLDV_API_KEY`, `TLDV_API_BASE`, `TLDV_WEBHOOK_SECRET`, `TLDV_TIMESTAMP_PARAM` | tl;dv |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `RECORDING_ACCOUNT_EMAIL` | Bookings on the recording calendar |
| `REPLAY_URL` | `npm run replay` |
| `CALLYZER_API_BASE`, `CALLYZER_API_KEY`, `DEEPGRAM_API_KEY` | Phone calls. Copied from Sales QA's `.env.local` with `bash scripts/copy-shared-keys.sh` (never press "Generate API Access Key" in Callyzer) and pushed to Vercel Production as Sensitive with `bash scripts/push-env.sh`. A later `vercel env pull` cannot read Sensitive values and blanks them locally: run `copy-shared-keys.sh` again afterwards |

## Crons (`vercel.json`)

| Path | When | What |
| --- | --- | --- |
| `/api/cron/tick` | every 10 min | tl;dv sync, transcripts, stale claims |
| `/api/cron/calls` | every 2 min | Callyzer poll (outside Sales QA's minutes), recording copies, Deepgram, routine start; ships paused (`calls_paused`) |
| `/api/cron/retention` | 03:00 IST | log trims, 12-month transcript trim; calls: undecided calls past their time, business recordings after 30 days, old ledger rows, orphaned recordings, the deletion queue |

## Where things are

| Path | What |
| --- | --- |
| `supabase/migrations/` | Schema, RLS, the claim/release functions for the routine |
| `src/lib/tldv/` | tl;dv API client and parsers |
| `src/lib/ingest/` | Webhook and cron intake, transcript fetch, rule-based classification |
| `src/lib/sheet/` | The sheet result schema, transcript formatting, validation and saving; `call-agent.ts` for a call's classify, skip and release |
| `src/lib/callyzer/` | Callyzer API client and row parsing |
| `src/lib/calls/` | Phone calls: intake rules, the calls job (poll, copy, Deepgram), purge, holds, retention |
| `src/app/api/cron/calls/` | The calls job's route |
| `src/app/api/agent/` | The routine's work API |
| `src/app/api/erp/` | Sync's API: book and cancel client meetings, read their DNY-owed items (`ERP_INTEGRATION_SECRET`; `docs/erp-integration.md`) |
| `src/app/(app)/` | Signed-in screens |
| `agent/` | The guide the routine reads and the routine prompt |
| `PLAN.md` | The plan this was built from |
