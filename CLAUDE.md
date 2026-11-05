# Call to Action (DNY Hospitality)

Client meetings recorded by tl;dv become one clear "sheet" each: the outcome in one line, who owes
what by when (DNY vs client), decisions, facts, risks, open questions, next meeting, every item backed
by a timestamped quote. Sales meetings are labelled and left to the sales agent (dny-call-qa).

## Accounts: DNY only

This is a DNY work project. Vercel: the DNY team (`team_OlIlw1Oi3U81fSrgeQnvcZaq`, the same team as
dny-call-qa), project `dny-call-to-action`. GitHub: `TechDNYsanchay/dny-call-to-action`; push with `git push dny main` (the `dny` remote uses
the SSH host `github-dny`); the `origin` remote is the plain HTTPS URL kept only so the Vercel CLI can read it.
The Vercel project is connected to this repo: every push to `main` deploys production, so push only green builds. Supabase: project `dny-call-to-action` (ref `iaxjxefipmdumfukttvv`, Mumbai) in
tech@dnyhospitality.com's organisation. Never use the personal tariquescript accounts. The machine's global Vercel login is the personal one and
must stay that way: run every Vercel command through `bash scripts/vc.sh ...` (it uses the DNY login kept in
`~/.config/vercel-dny`); `bash scripts/vc.sh whoami` must print the DNY identity (tech-5297). `.vercel/project.json`
pins the project.

## Separation from the sales agent

This app is fully separate from dny-call-qa: its own Google Cloud project and OAuth client, its own Supabase
project, its own Vercel project, its own tl;dv webhook. Only the company tl;dv account (and its API key) is shared.
The ERP it will integrate with later is GitHub repo TechDNYsanchay/dny-erp.

## How Claude is used

There is no Anthropic API key. The analysis runs as a Claude Code cloud routine on DNY's Claude Max plan
(same pattern as dny-call-qa): the routine calls `/api/agent/*` on Vercel with `AGENT_TOKEN` as a
Bearer token, gets the next ready meeting as a package (metadata, participants, transcript lines,
result format), writes the sheet JSON, checks it with `?dryRun=1`, then saves. The server validates
everything (schema, quotes present in the transcript, owners and dates) before anything is stored.
The routine never holds database keys.

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
  commit them, never put them on a command line.
- Tests: Vitest (`npm test`), pure modules get a `*.test.ts` next to them. `npm run typecheck`,
  `npm run lint`, `npm run build` must pass before a push.
- Dev server: `npm run dev` on port 3200 (3000 and 3100 are used by other apps on this machine).

## Where things are

| Path | What |
| --- | --- |
| `supabase/migrations/` | Schema, RLS, the claim/release functions for the routine |
| `src/lib/tldv/` | tl;dv API client and parsers |
| `src/lib/ingest/` | Webhook and cron intake, transcript fetch, rule-based classification |
| `src/lib/sheet/` | The sheet result schema, transcript formatting, validation and saving |
| `src/app/api/agent/` | The routine's work API |
| `src/app/(app)/` | Signed-in screens |
| `agent/` | The guide the routine reads and the routine prompt |
| `PLAN.md` | The plan this was built from |
