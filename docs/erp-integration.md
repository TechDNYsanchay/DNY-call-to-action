# ERP integration contract (phase 2)

How Call to Action pushes the action items of a client meeting into DNY's ERP ("Sync",
GitHub `TechDNYsanchay/dny-erp`), and how their status comes back.

Written 2026-11-05 from a read-only shallow clone of dny-erp at commit `5840034` (3 Nov 2026,
140 migrations, `0001`–`0140`). Paths written `dny-erp/...` are relative to that clone; paths written
`ours/...` are relative to this repository. Nothing in the ERP was modified or run. Where a statement
is a conclusion rather than something seen in the code it is marked **inferred**; where the clone does
not contain the evidence either way it is marked **unverified**. Every cited line was re-opened on
2026-11-05 against the same clone and corrected where the first draft was off.

Scope: DNY-owed action items from client meetings. Sales meetings are the sales agent's (dny-call-qa),
and the ERP's CRM is out of scope here (see §2.4).

---

## 1. What the ERP is

| | |
| --- | --- |
| Name | "Sync" (renamed from Sinq, 20 Oct 2026). `dny-erp/CLAUDE.md:3-5, 24` |
| Stack | Next.js 16.3.6 App Router, React 19.2, TypeScript, Tailwind 4, shadcn/ui, Zod 4, supabase-js 2.58 + @supabase/ssr, nodemailer, web-push, @anthropic-ai/sdk 0.132.1; Node 22. `dny-erp/package.json:21-45`, `.nvmrc` |
| Database | Supabase (Postgres 17, Auth, RLS, Realtime, Storage). PostgREST exposes schemas `public` and `graphql_public` only; `max_rows` 1000; the internal `app` schema is not exposed. `dny-erp/supabase/config.toml:13,18,41`; `supabase/migrations/0001_extensions_and_schema.sql:76-83` |
| Hosting | Vercel, region `bom1`, deploys on every push to `main` (`docs/DEPLOYMENT.md:15`; whether PRs are used is **unverified** — the shallow clone holds one commit by one committer, and `CLAUDE.md:14` says CI runs on pull requests too). One cron: `GET /api/cron/automation` at `30 2 * * *` UTC = 08:00 IST. Deployment Protection is off. `dny-erp/vercel.json:1-10`; `docs/DEPLOYMENT.md:10-24, 174-189` |
| Code shape | Modular monolith. Every write is a Next.js server action (Zod → `requirePermission` → write under the caller's RLS session → check affected rows → `revalidatePath`). Four authorisation layers: UI hint, server-action guard, DB constraint, RLS. `dny-erp/docs/ARCHITECTURE.md:67-89`; `src/domains/auth/guards.ts:22-157` |

### 1.1 The two Supabase projects

| Project | Ref | Role |
| --- | --- | --- |
| `dny-erp-dev` | `xyxwcypfmjzxkkloieni` (ap-south-1) | Where every migration lands first. No public deployment in front of it. |
| `dny-erp-staging` | `vcmvengxsrgbiwngsdoo` (ap-south-1) | **The live system.** DNY decided on 26 Sep 2026 that staging is live and holds real client, staff and salary data; it is served by https://dny-erp.vercel.app. There is no project called production and no custom domain. |

Sources: `dny-erp/README.md:73-87`; `DECISIONS.md:98-99`; `docs/DEPLOYMENT.md:26-37, 318-333`. A second
Vercel deployment pointed at dev was offered to DNY and declined (`DECISIONS.md:99`). The organisation
is on Pro: daily backups, no point-in-time recovery (`DECISIONS.md:99`). Note that `README.md:77-78`
and `docs/DEPLOYMENT.md:28-30` still record both projects at "0001–0046 applied (25 Sep 2026)"; the
repo does not say which later migrations reached which project (see §7 Q13).

So in ERP vocabulary "test before production" means **dev before staging**, because staging is production.

### 1.2 Auth and identity

- Supabase Auth with cookies (`@supabase/ssr`). `dny-erp/src/proxy.ts:9-25` runs `updateSession()`
  (`src/lib/supabase/middleware.ts:60-69`) on every request, which redirects to `/sign-in` unless the
  path is in `PUBLIC_PATHS` or `MACHINE_PATHS`
  (`src/lib/supabase/public-paths.ts:2-29`). Any new `/api/*` route must be added to `MACHINE_PATHS`
  or it is redirected to sign-in (this was a live bug for the cron until 21 Oct 2026,
  `docs/TESTING.md:882`).
- Sign-in: email+password, or Google OAuth restricted to `AUTH_ALLOWED_EMAIL_DOMAIN`
  (dnyhospitality.com) with a server-side re-check in `/auth/callback`. Sign-up is closed; admins create
  accounts at `/people/new`. TOTP MFA is mandatory for Super Admin, Founder and Finance.
  `dny-erp/src/domains/auth/actions.ts:27-100`; `src/app/auth/callback/route.ts:22-65`;
  `supabase/config.toml:178`; `src/components/auth/app-gate.tsx:136-146`.
- A user is a `public.user_profiles` row whose `id` equals `auth.users.id`; `lower(email)` is unique
  among non-deleted rows (partial unique index). `dny-erp/supabase/migrations/0002_organizations_and_users.sql:50-104`.
- Roles (`public.roles`): `SUPER_ADMIN`, `FOUNDER_BU_HEAD`, `LEAD_CONSULTANT`, `PROJECT_MANAGER` (0129),
  `TEAM_MEMBER`, `FINANCE_MANAGER`, `TRS_MANAGER`, `CLIENT` (granted to nobody). Permissions are
  `domain.action` strings (103 as of `docs/RBAC.md:82`; 74 seeded in 0003, the rest by later migrations),
  resolved by `app.has_permission()` (`0003_rbac.sql:157`) and mirrored to the UI by
  `public.my_access()`. `dny-erp/supabase/migrations/0003_rbac.sql:280-306, 315-421`;
  `0011_access_context.sql:22-65`; `0129_project_manager_role.sql:38-52`; `docs/RBAC.md`.
- One organisation in practice (`organizations`, slug `dny`); every business row carries
  `organization_id`. The local seed id `00000000-0000-0000-0000-00000000d117` is local only; dev and
  live ids must be read from the database. `dny-erp/supabase/seed.sql:25-31`.

### 1.3 Modules

Navigation (`dny-erp/src/domains/auth/navigation.ts:50-343`): Dashboard, Master view, Clients, Projects,
Templates, My tasks, Approvals, End goals, KPIs, Meetings, **CTAs**, Procurement, Third parties,
Recruitment, Cost bands, My incentives, Sales targets, Client errors, Finance, Reports, Bandwidth, Block
calendar, Search, Settings (People, Teams), Administration, Automation, Deleted items. A separate CRM
lives at `/crm` for people in `crm_members` (`0118_crm_access.sql:51`; `docs/CRM.md`). No HR/payroll
(Zoho People keeps that), no client portal, no Zoho integration of any kind (`dny-erp/CLAUDE.md:100-101`).

### 1.4 Machine-facing surface today

Exactly two HTTP routes take machine calls, both using the service-role key server-side:

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/cron/automation` | `Authorization: Bearer $CRON_SECRET`, constant-time compare, refuses when the variable is unset | Daily automation, email/push outbox drain. `dny-erp/src/app/api/cron/automation/route.ts:34-128` |
| `GET/POST /api/crm/meta` | Meta `hub.verify_token` / HMAC-SHA256 `x-hub-signature-256` over the raw body | Meta lead-form intake; idempotent upsert on `(organization_id, leadgen_id)`; 503 until configured. `dny-erp/src/app/api/crm/meta/route.ts:30-154` |

There is no REST API for tasks, CTAs, clients or people; no API-key table; no outbound webhooks; no
rate limiting in app code (`grep` over `dny-erp/src`). The only precedent for an outside writer is
one-off Node scripts using the service-role key (`dny-erp/scripts/import_zoho_tasks.mjs:1-75`). The
roadmap lists "AI assistant and external integrations" as Phase 12, after Phases 1–11, which
`CLAUDE.md:24` says are built (`dny-erp/docs/DEVELOPMENT_ROADMAP.md:233-235`).

---

## 2. Where meeting action items land

### 2.1 The entity: `public.meeting_ctas`, as a standalone CTA

The ERP already has a first-class "call to action" object. A CTA is one line of "what has to happen",
one owner, a due date, an optional project and an optional approver. Since migration 0078 a CTA may
exist without a meeting (`instance_id null`), which is exactly the shape of our action items. The ERP's
own documentation says "CTAs are not tasks" and that the standalone CTA "is the same `meeting_ctas` row
a meeting raises, not a second list" (`dny-erp/docs/DOMAIN_MODEL.md:103-114`; `0078_standalone_ctas.sql:20-24`).

Why not `public.tasks`: a task needs a `project_id` (NOT NULL, `dny-erp/supabase/migrations/0018_project_execution.sql:112-116`),
a milestone-ordered `seq`, and creating one adds the owner to the project (`src/domains/tasks/actions.ts:737-828`).
That is project execution work, not a meeting commitment. A CTA can later be promoted to a task through
`meeting_ctas.created_task_id` if DNY wants.

Why not attach to an ERP meeting: `meeting_templates`/`meeting_instances` model recurring internal
"critical meetings" (`app.meeting_frequency`: WEEKLY / FORTNIGHTLY / MONTHLY / QUARTERLY in 0032, DAILY
added by 0050 for the standup; one instance per template per date). An ad-hoc tl;dv client call has no
row there, so `instance_id` stays null (`dny-erp/supabase/migrations/0032_meetings_and_ctas.sql:47-240`;
`0050:56`). **Inferred.**

### 2.2 Columns, enums and constraints of `meeting_ctas`

Source: `dny-erp/supabase/migrations/0032_meetings_and_ctas.sql:53-54, 250-321`, `0018_project_execution.sql:35`
(`app.task_priority`), `0078_standalone_ctas.sql:43-50`, `0087_cta_reporting_and_confidentiality.sql:38-60`,
`0097_cta_status_pending_approval.sql:12`, `0098_cta_approval.sql:38-48`.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | default `gen_random_uuid()`; this becomes our `erp_task_id` |
| `organization_id` | uuid NOT NULL | DNY's single org |
| `instance_id` | uuid NULL | null for us (standalone) |
| `cta` | text NOT NULL | 1–2000 chars after trim; the one-line commitment |
| `observation` | text | free context; no length check in the DB (the UI form caps at 2000, `src/domains/meetings/schemas.ts:98`) |
| `owner_id` | uuid → `user_profiles` | the DNY person; `on delete restrict` |
| `deadline` | date | **required** for a standalone CTA |
| `priority` | `app.task_priority` | `LOW` / `NORMAL` / `HIGH` / `URGENT`, default `NORMAL` |
| `project_id` | uuid NULL | composite FK to `projects(id, organization_id)`; null shows as "General CTA" (`src/domains/reports/export-rows.ts:46`; `src/domains/meetings/schemas.ts:103`) |
| `status` | `app.cta_status` | `OPEN` / `IN_PROGRESS` / `PENDING_APPROVAL` / `DONE` / `CARRIED_FORWARD` / `CANCELLED`, default `OPEN` |
| `audience` | `app.cta_audience` | `PERSON` / `TEAM` / `COMMON`, default `TEAM`; `PERSON` iff `report_to_user_id` is set |
| `report_to_user_id` | uuid → `user_profiles` | the approver; must be an ACTIVE, INTERNAL, non-deleted user of the same org (trigger `app.tg_cta_report_to_guard`, `0087:104-140`) |
| `approval_requested_at`, `approval_note` | | approval workflow (0098) |
| `escalation_note`, `carried_from_cta_id`, `created_task_id` | | not used by us |
| `closed_at`, `closed_by` | | stamped by trigger; check `(status in DONE,CANCELLED) = (closed_at is not null)` |
| `created_by`, `updated_by`, `created_at`, `updated_at`, `version` | | standard triggers attached by `app.attach_standard_triggers('public.meeting_ctas')` (`0032:601`): `created_by := coalesce(auth.uid(), payload)` (`0001:127-136`); `version` for optimistic concurrency (`0001:103-118`) |

Constraints that bite us:

- `meeting_ctas_standalone_has_owner_and_deadline`: `instance_id is not null or (deadline is not null and (owner_id is not null or audience = 'COMMON'))` (`0087:55-60`, replacing the 0078 version). **An item with no due date cannot be pushed as-is.**
- `meeting_ctas_report_to_matches_audience`: `(audience = 'PERSON') = (report_to_user_id is not null)` (`0087:49-51`).
- `meeting_ctas_pending_has_approver`: `status <> 'PENDING_APPROVAL' or report_to_user_id is not null` (`0098:43-44`).
- No `deleted_at` (no migration adds one to `meeting_ctas`): CTAs are `CANCELLED`, never soft-deleted.
- **No external-reference, source or idempotency column on `meeting_ctas`.** The columns of that kind elsewhere in the schema are `projects.import_ref`, `notifications.idempotency_key`, `approvals.idempotency_key`, `crm_meta_leads.leadgen_id` and `finance_rules.source_ref` (`0092:56-78`, `0039:120`, `0025:120`, `0128:103-121`, `0007:163`). The name `source_ref` is therefore already in use on `finance_rules` with a different meaning ("where the rule comes from"); reusing it on `meeting_ctas` (§2.5) is a naming choice, not a conflict.

### 2.3 Who sees a pushed CTA, and what happens around it

- Readers: everyone with `ctas.view` (every internal role), on `/ctas` under "Everybody else, by team",
  on the owner's dashboard tile "Open CTAs", in global search, in the weekly report's open-CTA count and
  in the slippage report when late. The approver sees it under "Waiting on your approval" once handed in.
  `dny-erp/src/app/(app)/ctas/page.tsx:117-128`; `src/app/(app)/page.tsx:120-141`; `0078:23-24`; `0044:37-41`.
- Exception: when owner **and** approver are both Finance/Founder the row is confidential to those two
  roles (`app.cta_confidential`, `0087:71-98`; policies `0087:181-212`). We avoid that pairing.
- Writers under RLS: `ctas.create` (SUPER_ADMIN — every permission, `0003:435-443`; FOUNDER_BU_HEAD
  `0003:467`; LEAD_CONSULTANT `0003:496`; TRS_MANAGER `0003:561`; FINANCE_MANAGER since `0106:25-30`;
  PROJECT_MANAGER since `0129:38-52`, which copies LEAD_CONSULTANT's grants) may record for anybody;
  everyone else only for themselves (`ctas.create_self`, every role, `0078:56-61`). Insert policy
  `0087:196-212`.
- Lifecycle: `OPEN`/`IN_PROGRESS` are "live"; "late" = `deadline < today` while live. With an approver,
  the owner cannot write `DONE` directly: they set `PENDING_APPROVAL`, the approver calls
  `public.decide_cta(id, approve, note)`. A Founder approver forces a file attachment before hand-in
  (`0116:145-166`). Anybody without `ctas.assign` (in practice the Team Member) cannot move `deadline`
  on a CTA that has an approver; they file a `cta_deadline_changes` request that the approver decides
  (`0113:1-45`). This is a session-side rule: the trigger reads `auth.uid()`, so the service-role route
  is not stopped by it and must decide for itself whether a pushed date change is allowed (§4.2).
- Triggers on insert (`0032:600-639`, `0087:104-177`, `0098:51-171`, `0101:175-209`, `0116:145-166`):
  attribution, closure stamp, approver guard, approval guard (**skipped when `auth.uid()` is null**,
  `0098:67`), audit log, approver notification (fires regardless, `0087:147-177`), owner notification
  (**fires only when `auth.uid()` is not null**, `0101:184-187`). So a service-role insert does not ring
  the owner's bell; the route in §4 calls `app.notify()` itself. The assignment guard (`0032:766-790`)
  and the report-to guard's permission half (`0087:125-131`) also skip when `auth.uid()` is null, so the
  route must enforce "owner and approver only change under `ctas.assign`" itself (§4.2).
- Nothing escalates a late standalone CTA automatically; it shows a "Late" badge and appears in the
  slippage report (`0042`; `src/domains/meetings/meeting-state.ts:55-77`).

### 2.4 Items that have no home in the ERP

- **Client-owed items.** `owner_id` and `report_to_user_id` must be `user_profiles` rows; the `CLIENT`
  role is granted to nobody and there is no client portal (`dny-erp/CLAUDE.md:101`;
  `0003:305-306`; `docs/DEVELOPMENT_ROADMAP.md:235`). Options: do not push; push as `audience='COMMON'` (no owner, deadline required); or
  push owned by the DNY person who will chase it, with the client's commitment in `observation`.
  Default in §7: do not push.
- **Sales meetings.** Their natural ERP object is `crm_tasks` (`kind 'CTA'`, `source 'MEETING_CTA'`,
  needs a deal or lead; `0121:104-141`, `0127:164-196`). That belongs to dny-call-qa, not here.

### 2.5 The smallest addition the ERP needs

Two things, both in dny-erp, both small enough for one PR (which in that repo is a push to `main`):

1. **Migration `0141_call_to_action_integration.sql`** (forward-only, one concern):
   ```sql
   alter table public.meeting_ctas
     add column source text,
     add column source_ref text;
   alter table public.meeting_ctas
     add constraint meeting_ctas_source_pair
       check ((source is null) = (source_ref is null));
   create unique index meeting_ctas_source_ref_key
     on public.meeting_ctas (organization_id, source, source_ref)
     where source_ref is not null;
   comment on column public.meeting_ctas.source is
     'Outside system that recorded this CTA (e.g. call-to-action). Null for CTAs recorded in Sync.';
   comment on column public.meeting_ctas.source_ref is
     'That system''s own id for the item, unique per source. Makes re-delivery idempotent.';
   ```
   Then regenerate `src/lib/supabase/database.types.ts` so it carries the columns, add a permit/deny
   suite `supabase/tests/58_cta_integration.sql`, and the four digests re-checked (`dny-erp/docs/TESTING.md:537-546`).
   This mirrors `projects.import_ref` (0092) and `crm_meta_leads.leadgen_id` (0128).

2. **Route `src/app/api/integrations/call-to-action/route.ts`** plus a `directory` sibling, specified
   in §4, with the path prefix added to `MACHINE_PATHS` and `public-paths.test.ts`, a new Vercel env var
   `CALL_TO_ACTION_SECRET`, a line in `docs/DEPLOYMENT.md` §4 next to `CRON_SECRET`, and an entry in
   `DECISIONS.md` (`dny-erp/CLAUDE.md:72, 110-116` — "ask before assuming" on security, schema and permissions).

---

## 3. Field mapping

### 3.1 Identifiers

| Ours | ERP | How it is resolved |
| --- | --- | --- |
| `people.erp_user_id` (text) — note: the migration puts it on `people`, PLAN §15 still says `team_members` | `user_profiles.id` (uuid = `auth.users.id`) | by `lower(people.email) = lower(user_profiles.email)`; only `status='ACTIVE'`, `user_type='INTERNAL'`, `deleted_at is null` rows are assignable (`dny-erp/src/domains/tasks/queries.ts:585-610`) |
| `clients.erp_client_id` (text) | `clients.id` (uuid) | by `lower(name)` (unique per org among non-deleted rows, `0012:67-69`) or by a contact email in `client_contacts.email` (`0012:92-108`); the ERP has no domain/website column, so a human confirms the link (§5) |
| `meetings.erp_project_id` (text, **new** in step 2 of §6) | `projects.id` (uuid) | a CTA points at a **project**, not a client; a client can have several projects. Chosen in the Push dialog from the client's projects (ACTIVE first, then ON_HOLD). **Inferred need.** |
| `action_items.erp_task_id` (text) | `meeting_ctas.id` (uuid) | returned by the push; written back with `erp_sync_status='sent'` |
| `action_items.id` (uuid) | `meeting_ctas.source_ref` with `source='call-to-action'` (**new** in ERP migration 0141, §2.5) | the idempotency key, see §3.6 |

Columns in these tables that exist today: ours in `ours/supabase/migrations/20261104100000_initial_schema.sql`
(`people.erp_user_id` :48, `clients.erp_client_id` :69, `action_items.erp_task_id` :184,
`action_items.erp_sync_status` :185); the ERP's in `0002:50-104`, `0012:37-59`, `0009:53-60`, `0032:250-321`.

Our validators should accept ERP ids with Zod `guid()` rather than strict RFC `uuid()`; the ERP does the
same because Postgres accepts non-RFC uuids (`dny-erp/src/domains/auth/access.ts:26-39`).

### 3.2 Action item → CTA

| Ours (`action_items` unless stated) | ERP `meeting_ctas` | Rule |
| --- | --- | --- |
| `title` | `cta` | trimmed; 1–2000 chars; if `title` + `details` fit in 2000 chars and `details` is short (≤ 200 chars) they are joined as `"<title> — <details>"`, otherwise `details` goes to `observation` |
| `details`, `evidence_*`, `meetings.tldv_url`, `linked_decision` | `observation` | the block in §3.5, capped at 2000 chars to match the ERP form |
| `owner_email` → `people.erp_user_id` | `owner_id` | required; items whose owner is not a mapped ACTIVE ERP user are "needs-check" and excluded from the push |
| `owed_by` | — | only `dny` is pushed; `both` is pushed when `owner_email` resolves to a DNY person; `client` and `unclear` are not pushed (defaults, §7) |
| `due_date` | `deadline` | required; see §3.4 |
| `priority` | `priority` | §3.3 |
| `status` | `status` | §3.3; a first push always sends `OPEN`, or `IN_PROGRESS` if our status is already `in_progress` |
| — | `instance_id` | null |
| `meetings.erp_project_id` (new, §6 step 2) | `project_id` | nullable |
| — | `audience`, `report_to_user_id` | default `TEAM` with no approver (§7); if an approver is chosen in the dialog: `PERSON` + that person's `user_profiles.id`, never equal to the owner |
| the DNY person who clicked Push (`people.erp_user_id`) | `created_by` | the ERP keeps the payload value when there is no session (`0001:127-136`); falls back to a dedicated "Call to Action" profile if that person has no ERP account |
| `id` | `source_ref` (+ `source = 'call-to-action'`), new in 0141 | idempotency, §3.6 |
| — | `organization_id` | the single DNY org, resolved by the ERP route |

### 3.3 Enum mappings

Priority (ours `priority`: `high` / `medium` / `low` → ERP `app.task_priority`):

| Ours | ERP |
| --- | --- |
| `high` | `HIGH` |
| `medium` | `NORMAL` |
| `low` | `LOW` |
| — | `URGENT` (never sent; read back as `high`) |

Status, ours → ERP (`item_status`: `open`, `in_progress`, `done`, `dropped`, `superseded`):

| Ours | ERP | Note |
| --- | --- | --- |
| `open` | `OPEN` | |
| `in_progress` | `IN_PROGRESS` | |
| `done` | `DONE` | the route stamps `closed_at`; if the CTA has an approver the route sets `PENDING_APPROVAL` instead and the approver closes it in the ERP |
| `dropped` | `CANCELLED` | needs `ctas.assign` under RLS when an approver exists; the service-role route may do it, but only for CTAs with `source='call-to-action'` |
| `superseded` | `CANCELLED` | the sheet re-run replaced the item; the replacement item pushes as a new CTA |

Status, ERP → ours (read back by polling, §4.4):

| ERP | Ours |
| --- | --- |
| `OPEN` | `open` |
| `IN_PROGRESS` | `in_progress` |
| `PENDING_APPROVAL` | `in_progress` (shown in our UI as "waiting for approval in the ERP") |
| `DONE` | `done` (`done_at` = ERP `closed_at`, `done_by` null) |
| `CANCELLED` | `dropped` |
| `CARRIED_FORWARD` | unchanged (the ERP copied it into a meeting; the copy is a different row and is not ours to track) |

Phase 2 rule of thumb: once pushed, the ERP is the source of truth for status. Our UI marks a synced
item read-only for status and shows the ERP state; a person who still edits locally triggers a status
push (§4.3) which the ERP may refuse (e.g. `DONE` on an approved CTA).

### 3.4 Dates and time zone

- Both systems store `deadline`/`due_date` as a Postgres `date` and move it as a plain ISO
  `YYYY-MM-DD` string (ERP Zod `z.iso.date()`, `dny-erp/src/domains/meetings/schemas.ts`). No time, no zone,
  so nothing shifts. Never send a timestamp.
- "Today" for lateness: the ERP compares `deadline` with Postgres `current_date` in automation and with
  the UTC date in `isoDay()` on the server, while the CRM uses `Asia/Kolkata` (`dny-erp/supabase/migrations/0042_automation.sql:139-148`;
  `src/domains/meetings/meeting-state.ts:71-81`; `0121:46-51`). Our app computes in `Asia/Kolkata`
  (`ours/src/lib/format.ts:3`). The worst case is a 5.5-hour disagreement about whether an item became
  late at midnight; acceptable, noted.
- Items with `due_date null`: not pushable (constraint in §2.2). The Push dialog asks for a date per such
  item, pre-filled from `due_phrase` when it parses, else left blank and the item excluded.
- `closed_at` comes back as `timestamptz`; we store it in `done_at` unchanged (UTC) and display in IST.

### 3.5 How the evidence quote and the tl;dv link travel

`observation` (text, ≤ 2000 chars) carries everything the CTA line cannot:

```
<details, if not already in cta>

Evidence [12:34] Priya Nair: "<evidence_quote>"
Recording: <meetings.tldv_url>  (opens at the quote when tl;dv supports ?t=<evidence_ts_sec>)
Decision: <linked_decision text from the sheet, if any>
From Call to Action · meeting "<meetings.title>" on <happened_at in IST, d MMM yyyy> · item <action_items.id>
```

Order of truncation when over 2000 chars: shorten the quote first (keep ≥ 120 chars + "…"), then drop
the decision line, then shorten details. The last line always stays so an ERP user can find the item.
The ERP has no link column on CTAs (links exist on tasks only: `task_links`, `0021`), so the URL lives in
the text. **Inferred format**; the ERP shows `observation` under the CTA on `/ctas` and the meeting page.

### 3.6 Idempotency

- `source = 'call-to-action'`, `source_ref = action_items.id`. Our `id` is stable across sheet re-runs
  because the saver upserts on `(meeting_id, item_key)` and does not touch the `erp_*` columns
  (`ours/src/lib/sheet/save.ts:137`, `itemRow` at 47-73). `item_key` is only unique per meeting and
  changes when the title stem changes, so it is not the key.
- The ERP route upserts on `(organization_id, source, source_ref)` with "do nothing on conflict" for
  creates, so a retry after a timeout returns the existing row (`outcome: "already received"`) instead of
  a duplicate — the same pattern as `crm_meta_leads` (`dny-erp/src/app/api/crm/meta/route.ts:77-91`).
- Our side keeps the belt: before a push the row must be `erp_sync_status in ('not_applicable','pending','failed')` with
  `erp_task_id null`; on success we write `erp_task_id` and `sent`. A row with `erp_task_id` set is
  updated (status push), never created again.
- Rule for the saver: keep `erp_task_id` and `erp_sync_status` out of the upsert payload.

---

## 4. Transport

### 4.1 Recommendation: (a) an HTTP endpoint on the ERP guarded by a shared secret

Chosen over (b) direct Supabase access with a restricted role/RPC, for reasons visible in the ERP code:

1. The ERP's architecture confines the service-role key to its own server contexts and lists every use
   (`dny-erp/docs/ARCHITECTURE.md:80`; `src/lib/supabase/service-role.ts:27-58`). Calling PostgREST from our
   Vercel project with that key is out. A direct Postgres login role (option b) would still put a
   credential for the live database — the one holding salaries — into a second Vercel project, with
   safety resting only on grants and the ACL digest.
2. The ERP already has the exact pattern we need, twice: a bearer secret with constant-time compare that
   fails closed (`src/app/api/cron/automation/route.ts:37-55`) and an idempotent external intake with
   per-item outcomes and 503-until-configured (`src/app/api/crm/meta/route.ts:30-154`). Copying it is
   the smallest change that still follows the ERP's rules (Zod validation, explicit errors, docs, tests).
3. Option (b) needs a cluster-level `create role` plus a password set by hand per project, which the
   ERP's forward-only migrations cannot carry, and depends on Supabase network restrictions that are not
   visible in the repo (`dny-erp/README.md:81, 117-123`). Option (a) needs one env var in Vercel.
4. Option (a) gives us one place that enforces what the DB skips for session-less writes (approver ≠
   owner, ACTIVE owners, no Finance–Founder pair) and that calls `app.notify()` for the owner.
5. Reading master data (people, clients, projects for the picker, §5) and status (§4.4) is the same
   route family; option (b) would need two more RPCs and a read grant.

Ruled out as a last resort only: a human-style ERP account for our app signing in through the anon key
(over-broad `LEAD_CONSULTANT`/`PROJECT_MANAGER` permissions, 8 h sessions, no idempotency).

### 4.2 Endpoint family (in dny-erp)

Base: `https://dny-erp.vercel.app/api/integrations/call-to-action` (live) and the same path on a
preview deployment whose Preview env points at dev (§6).

Common rules:

- `Authorization: Bearer <CALL_TO_ACTION_SECRET>`; compare like the cron route; `401 {"error":"Not authorised."}`
  with no detail; `503 {"error":"Call to Action intake is not set up."}` when the secret or the
  service-role key is unset. `export const dynamic = 'force-dynamic'`, `maxDuration = 60`.
- `Content-Type: application/json`; body ≤ 256 KB; `400 {"error": "<zod summary>", "issues": [...]}` on
  bad shape.
- Organisation resolved as the Meta route does: `CALL_TO_ACTION_ORGANIZATION_ID` if set, else the single
  `organizations` row, `500` if more than one (`dny-erp/src/app/api/crm/meta/route.ts:62-69`).
- Writes with `createServiceRoleClient()`. Only rows with `source = 'call-to-action'` may ever be updated
  by this route.
- Every response carries `"contract": "1"` so both sides can version the DTO (PLAN §15).

**`POST .../ctas` — create or update a batch**

Request:
```json
{
  "contract": "1",
  "pushed_by_email": "tarique@dnyhospitality.com",
  "items": [
    {
      "source_ref": "0c0e0b7a-…",            // action_items.id
      "cta": "Send the revised menu costing to the client",
      "observation": "Evidence [12:34] …",    // optional, ≤ 2000
      "owner_email": "shishir@dnyhospitality.com",
      "deadline": "2026-11-12",
      "priority": "HIGH",                      // LOW | NORMAL | HIGH | URGENT
      "status": "OPEN",                        // OPEN | IN_PROGRESS | DONE | CANCELLED (ERP values)
      "project_id": "f3b1…",                   // optional uuid
      "approver_email": null                   // optional
    }
  ]
}
```
`items` 1–100. Per item the route: resolves `owner_email`, `approver_email`, `pushed_by_email` against
`user_profiles` (`lower(email)`, ACTIVE, INTERNAL, not deleted); refuses approver = owner; refuses a
Finance–Founder owner/approver pair; checks `project_id` belongs to the org and is not ARCHIVED;
requires `deadline`. Then:

- no row with `(org, 'call-to-action', source_ref)` → `insert` with `instance_id null`,
  `audience = approver ? 'PERSON' : 'TEAM'`, `created_by = pushed_by.id`, `status` as sent (`DONE`/`CANCELLED` are
  stamped by the closure trigger; `DONE` with an approver becomes `PENDING_APPROVAL` + `approval_requested_at`),
  then `app.notify(owner, 'ASSIGNED', 'CTA', id, 'A CTA for you: …', 'cta-owner:<id>:<owner>:<now()>', body, project_id, null, '{}')`
  — the same shape and idempotency key the trigger would have used (`0101:195-202`; signature `0039:230-241`) —
  because the trigger will not fire (`0101:175-209`); on unique-violation (`23505`, a racing retry) re-read and report `already received`;
- row exists → treat as an update of `cta`, `observation`, `deadline`, `priority`, `project_id`,
  `status` with the rules of §3.3 (never reopen a `DONE`/`CANCELLED` CTA that the ERP closed; never
  change `owner_id` or the approver after creation — that is an ERP user's job under `ctas.assign`).

Response `200` (always 200 when the batch was processed; failures are per item):
```json
{
  "contract": "1",
  "results": [
    { "source_ref": "0c0e…", "outcome": "created",  "id": "9a1f…", "status": "OPEN", "version": 1 },
    { "source_ref": "17d2…", "outcome": "already received", "id": "…", "status": "IN_PROGRESS", "version": 3 },
    { "source_ref": "2be0…", "outcome": "updated", "id": "…", "status": "DONE", "version": 4 },
    { "source_ref": "3c4a…", "outcome": "not stored: owner not an active ERP user (nilima@…)" },
    { "source_ref": "4d5b…", "outcome": "refused: the ERP closed this CTA on 2026-11-02" }
  ]
}
```
`outcome` values: `created`, `already received`, `updated`, `not stored: <reason>`, `refused: <reason>`.
This mirrors the Meta route's per-item `{leadgen_id, outcome}` (`dny-erp/src/app/api/crm/meta/route.ts:153`).

**`GET .../ctas?source_ref=a,b,c`** (or `?ids=`) — status read-back, up to 200 refs:
```json
{ "contract": "1",
  "ctas": [ { "source_ref": "0c0e…", "id": "9a1f…", "status": "PENDING_APPROVAL", "deadline": "2026-11-14",
              "priority": "HIGH", "owner_email": "shishir@…", "approver_email": "yash@…",
              "closed_at": null, "updated_at": "2026-11-06T04:12:00Z", "version": 5 } ],
  "missing": ["7e8f…"] }
```
With no refs it returns `{ "contract": "1", "ctas": [], "missing": [] }` — that is the healthcheck.

**`GET .../directory`** — master data for §5:
```json
{ "contract": "1",
  "people":   [ { "id": "…", "email": "…", "full_name": "…", "designation": "…", "status": "ACTIVE", "work_groups": ["EXECUTION"] } ],
  "clients":  [ { "id": "…", "name": "…", "legal_name": "…", "city": "…", "status": "ACTIVE",
                  "contacts": [ { "full_name": "…", "role_title": "…", "email": "…", "phone": "…", "is_primary": true } ],
                  "projects": [ { "id": "…", "name": "…", "status": "ACTIVE" } ] } ] }
```
People: `user_profiles` where `user_type='INTERNAL' and deleted_at is null` (all statuses, so we can
mark inactive ones). Clients: `clients where deleted_at is null` with `client_contacts` and
`projects where client_id = clients.id and status <> 'ARCHIVED'`. Finance tables are never read.

### 4.3 Our side: `ErpAdapter`

`ours/src/lib/erp/adapter.ts` (PLAN §15): `upsertTasks(items) → results`, `readStatus(refs)`,
`healthcheck()`, `directory()`. Env: `ERP_BASE_URL`, `ERP_API_KEY` (PLAN §4 line 137), saved with
`bash scripts/save-key.sh`, never printed. Calls run in server actions after `requireUser()` and in the
cron tick; the routine never touches the ERP.

Retries: `POST` is idempotent, so retry on network error, `429`, `5xx` with backoff 1 s, 5 s, 30 s
(three tries) and then mark the rows `failed` with the reason in `pipeline_events`. Never retry `400`,
`401`, `503` automatically; surface them to the admin. A `401`/`503` on healthcheck shows a banner
("ERP not reachable") and hides the Push button. The ERP has no rate limiting, so our batch cap of 100
and the once-per-tick status poll are the only throttles.

Per-row bookkeeping: `erp_sync_status` `pending` while in flight → `sent` with `erp_task_id` on
`created`/`already received`/`updated` → `failed` with the outcome text on `not stored`/`refused`.

### 4.4 Status flowing back (ERP → us) in phase 2

The ERP has no outbound webhooks or event bus; its only outbound calls are SMTP, web-push, one
`fetch` to graph.facebook.com and the Anthropic SDK (`grep 'fetch(' dny-erp/src`;
`src/domains/notifications/email.ts`). Realtime publishes only `notifications` (`0039:383-395`). So in
phase 2 **we poll**: the existing cron tick calls `GET .../ctas?source_ref=` for every row with
`erp_sync_status='sent'` whose local status is not `done`/`dropped` (and for `done` rows once a day for
reopen detection), in pages of 200, and applies §3.3 ERP→ours. A callback route on our side
(`/api/erp/callback`, bearer secret) is specified but not built until the ERP grows an outbound
drainer modelled on `email.ts` — that is phase 3 if DNY wants it.

---

## 5. Client and staff master data

### 5.1 Source tables and fields in the ERP

| Ours | ERP source | Fields |
| --- | --- | --- |
| `people` (`full_name`, `email`, `dept`, `active`, `erp_user_id`) | `public.user_profiles` (`0002:50-104`; `status`/`user_type` enums `0001:88-89`), work groups: `user_profiles.work_group` (`0089:30-33`, single) and the many-to-many `public.user_work_groups` (`0090:29`, what the UI reads, `src/domains/tasks/queries.ts:590-592`) | `id`, `email`, `full_name`, `display_name`, `designation`, `status` (`ACTIVE`/`INACTIVE`/`SUSPENDED`/`PENDING`), `user_type` (`INTERNAL` only), `deleted_at`; work group `EXECUTION`/`SUPPORT`/`SALES`/`INTERNS` → `dept` |
| `clients` (`name`, `domains`, `contact_emails`, `status`, `erp_client_id`, `notes`) | `public.clients` (`0012:32-69`), `public.client_contacts` (`0012:92-108`) | `id`, `name`, `legal_name`, `city`, `status` (`PROSPECT`/`ACTIVE`/`DORMANT`/`FORMER`), `notes`; contacts `full_name`, `role_title`, `email`, `phone`, `is_primary` |
| (new) `meetings.erp_project_id`, or a small `erp_projects` cache | `public.projects` (`0009:28, 53-60`; `COMPLETED` added `0091:20`; `import_ref` `0092`) | `id`, `name`, `client_id`, `status` (`ACTIVE`/`ON_HOLD`/`COMPLETED`/`DROPPED`/`CLOSED`/`ARCHIVED`) |

The ERP has **no** client domain, website or client email column; domains can only be derived from
`client_contacts.email` (`split_part(email,'@',2)`, dropping public mail providers), and `is_primary`
contacts come first. **Inferred.**

### 5.2 Seeding procedure

1. Admin screen "ERP → Import directory" calls `GET .../directory` (§4.2) and shows a diff.
2. People: for each ERP `INTERNAL` profile, match `lower(email)` to `people.email`. Match → set
   `erp_user_id`; `active = (status = 'ACTIVE')` only when the admin ticks "also update active flag".
   No match → offer to create a `people` row (`role 'member'`, `dept` from work group). Our rows with no
   ERP match are listed so the admin knows who cannot own a pushed CTA.
3. Clients: match `lower(name)` against `clients.name` (exact, then normalised: strip punctuation,
   "Pvt Ltd", "LLP"); then any ERP contact email in our `contact_emails`. Each proposed match is confirmed
   by the admin before `erp_client_id` is set. Unmatched ERP clients can be created in our table with
   `name`, `contact_emails` from contacts and `domains` derived as above (public providers excluded);
   `status` maps `ACTIVE`→`active`, `PROSPECT`→`onboarding`, `DORMANT`/`FORMER`→`churned`.
4. Projects: cached per client in a new table `erp_projects (id text pk, client_erp_id text, name, status, synced_at)`
   so the Push dialog can offer a picker without a live call; refreshed by the same import.
5. Re-run any time; the import is idempotent (keys are ERP ids). Our tl;dv-side guesses
   (`meetings.client_name_guess`, participant domains) keep working for classification; the ERP id is
   only needed at push time.

Until the directory endpoint exists, the same data can be exported once by the ERP owner with a
read-only service-role script in `dny-erp/scripts/` (the ERP's established pattern) and imported from
JSON through the same admin screen — a stop-gap, not the design.

---

## 6. Implementation plan, smallest first

Each step is testable on its own. ERP steps are proposed changes to dny-erp that someone with push
rights there lands; "staging" below is the ERP's live system, so every ERP step goes to **dev first**.

| # | Side | Step | Test |
| --- | --- | --- | --- |
| 1 | ours | Add `docs/erp-integration.md` (this file). Decide §7 defaults with Tarique. | Review |
| 2 | ours | Migration: `meetings.erp_project_id text`, `erp_projects` cache table, `action_items.erp_pushed_at timestamptz`, `action_items.erp_last_outcome text`; regenerate types (`npm run db:types`). Keep the saver's upsert free of `erp_*` columns (add a unit test on `itemRow`). | `npm test`, `npm run typecheck` |
| 3 | ours | `src/lib/erp/` : `dto.ts` (Zod for the §4.2 shapes, `contract: "1"`), `map.ts` (§3 mappings, pure, with tests), `adapter.ts` with a `FakeErp` used in tests. | Vitest on mapping edge cases: no due date, client-owed, title > 2000, approver = owner |
| 4 | ERP | Migration `0141` (§2.5) on local, then `supabase db push` to **dev**. Suite `58_cta_integration.sql`: unique index permits different refs, denies a duplicate, `check` pair holds; digests compared. | ERP CI (`supabase/tests/run_tests.sh`) |
| 5 | ERP | `src/lib/machine-auth.ts` (bearer compare lifted from the cron route), `GET .../directory`, `MACHINE_PATHS` + `public-paths.test.ts`, env `CALL_TO_ACTION_SECRET` documented in `docs/DEPLOYMENT.md`. Vitest for the auth helper (unset → 503, wrong → 401, right → 200). | ERP CI; `curl` against a **preview deployment whose Preview env vars point at dny-erp-dev** (inferred way to test without a second permanent deployment) |
| 6 | ours | Admin "Import directory" screen against the dev preview; seed people and clients; confirm `erp_user_id` for the DNY roster. | Manual, on our own preview deployment with `ERP_BASE_URL` = the ERP dev preview |
| 7 | ERP | `POST .../ctas` and `GET .../ctas` (§4.2) with the owner `app.notify`. Suite: insert via route shape with `created_by` supplied, re-send returns `already received`, approver = owner refused, Finance–Founder pair refused, closed CTA not reopened. | ERP CI + `curl` on dev |
| 8 | ours | "Push to ERP" dialog on the sheet: previews rows (excludes needs-check, client-owed, no-date; asks for dates and the project), calls `upsertTasks`, shows per-row outcomes, writes `erp_task_id`/`erp_sync_status`. | Vitest with `FakeErp`; manual against dev |
| 9 | ours | Cron tick: status poll (§4.4), applies ERP→ours mapping, logs to `pipeline_events`; healthcheck banner. | Vitest; manual: change a CTA in the ERP dev UI, see it reflected |
| 10 | ERP | Apply `0141` to **dny-erp-staging (live)**: `supabase db push`, repair if needed, compare the four digests; set `CALL_TO_ACTION_SECRET` in Vercel Production; push `main` (deploys live). `DECISIONS.md` entry recorded. | ERP runbook `docs/DEPLOYMENT.md:62-83`; `GET .../ctas` with no refs returns 200 |
| 11 | ours | Set `ERP_BASE_URL=https://dny-erp.vercel.app` and `ERP_API_KEY` in our Vercel Production via `bash scripts/vc.sh` (whoami must print tech-5297). First live push: one meeting, one item, owned by Tarique, verified on `/ctas`. | Manual, then widen |
| 12 | both | Watch for a week: duplicate check (`select source_ref, count(*)` on the ERP side via its admins), our `pipeline_events` errors, the ERP's email outbox showing the owner notice at the next drain. | Observation |

Not before phase 3: the ERP→us callback route and an ERP outbound drainer; pushing client-owed items;
promoting CTAs to tasks.

---

## 7. Open questions for Tarique (with the default we assume)

**Decided by Tarique on 5 Nov 2026:** questions 1, 2, 3 and 5, each exactly as its default below. The others still run on their defaults until someone says otherwise.

| # | Question | Default if unanswered |
| --- | --- | --- |
| 1 | Who approves and lands changes in dny-erp (migration `0141`, the route, the env var)? The repo's only committer is "DNY Execution Team" (TechDNYsanchay) and its `CLAUDE.md` demands a `DECISIONS.md` entry for schema/security changes. | **Decided 5 Nov 2026.** Tarique prepares the branch; the person who holds the TechDNYsanchay push rights reviews and pushes `main`; we do not push to dny-erp from this repo. |
| 2 | Transport: the HTTP route (§4.1, recommended) or a direct Postgres role/RPC? | **Decided 5 Nov 2026.** HTTP route with a bearer secret. |
| 3 | Do client-owed items (`owed_by='client'`) go to the ERP at all? | **Decided 5 Nov 2026.** No. They stay in Call to Action; the sheet shows them under "Client owes". |
| 4 | `owed_by='both'` and `'unclear'`? | `both` pushes when the owner resolves to a DNY person; `unclear` never pushes. |
| 5 | Items without a due date: ask in the dialog, default a date, or skip? | **Decided 5 Nov 2026.** Ask per item in the dialog; blank means skipped. No invented dates. |
| 6 | Should pushed CTAs carry an approver (`report_to_user_id`)? With one, the owner cannot mark done directly and a Founder approver forces a file upload. | No approver (`audience='TEAM'`). The dialog offers an optional approver per push. |
| 7 | Which ERP project does a meeting's items attach to? A client can have several. | A picker in the Push dialog listing the client's non-archived projects, ACTIVE first; "General CTA (no project)" allowed. |
| 8 | Who is `created_by` on pushed CTAs: the DNY person who pressed Push, or a dedicated "Call to Action" profile? | The person who pressed Push (resolved by email); a dedicated profile only as fallback. |
| 9 | Should the ERP notify the owner when we push (the trigger does not fire for service-role writes)? | Yes, the route calls `app.notify()` once per created CTA; nothing on updates. |
| 10 | Is the ERP the source of truth for status after a push, with our UI read-only for synced rows? | Yes. Local edits to synced rows are pushed and may be refused. |
| 11 | Where do we test? There is no deployment in front of dny-erp-dev and a second one was declined. | A Vercel **preview** deployment of dny-erp whose Preview env vars point at dny-erp-dev (inferred; needs the ERP owner's agreement). |
| 12 | Is the ERP's Phase 12 gate ("external integrations after Phases 1–11 are stable") considered met? | Yes, since `CLAUDE.md:24` records Phases 1–11 as built; the `DECISIONS.md` entry states it. |
| 13 | Which migrations are applied to live? The repo's last explicit record is "0001–0046 applied" on both projects (`README.md:77-78`, 25 Sep 2026) plus a 9 Oct 2026 history repair that mentions 0082 (`README.md:101-106`); nothing in the clone states the live project's position after that (**unverified**). | We assume live is at `0140` when `0141` is pushed; the ERP owner confirms with `supabase migration list --linked` and the four-digest comparison (`README.md:109`, `docs/TESTING.md` §6 item 42). |
| 14 | Name of the shared secret and its owner. | `CALL_TO_ACTION_SECRET` in the ERP's Vercel (Secret), `ERP_API_KEY` in ours; generated by Tarique, rotated yearly or on any suspected leak. |
| 15 | Is the dny-erp Vercel project in the same Vercel team as ours (`team_OlIlw1Oi3U81fSrgeQnvcZaq`)? Not visible in the ERP repo. | Assumed yes (same DNY login, tech-5297); if not, the ERP owner sets the env var. |

---

## 8. Note: the ERP's use of the Anthropic API (factual)

The ERP depends on `@anthropic-ai/sdk` 0.132.1 (`dny-erp/package.json:21`) and calls it in exactly
one place: the CRM "insight agent" server action `suggestFollowUp` in
`dny-erp/src/domains/crm/insight-actions.ts:3-110`. Before a sales follow-up it reads the deal, its last
ten follow-ups, up to 80 `crm_insight_library` rows and a reference text under the caller's RLS, then
calls `new Anthropic()` (key from `ANTHROPIC_API_KEY`) → `client.beta.messages.parse({ model: 'claude-opus-5-5',
max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium',
format: betaZodOutputFormat(Suggestion) }, … })` with a Zod output schema `{ value_to_share, message, insight_ids[], why_now }`.
Data is wrapped in `<deal>`, `<history>`, `<library>` tags with a "data, not instructions" line; errors
are mapped (`RateLimitError` → busy, `AuthenticationError` → key refused, `stop_reason 'refusal'` → write
it yourself); returned ids are filtered to known library ids; it drafts and never sends. The feature is
off until `ANTHROPIC_API_KEY` is set in Vercel and the UI says so (`dny-erp/docs/CRM.md:297-300`;
`docs/DEPLOYMENT.md:114, 146`). No other model, streaming, tool use or batch call exists in the ERP.

Call to Action has no Anthropic API key by decision (PLAN §0): analysis runs as a Claude Code cloud
routine on DNY's Max plan, through `/api/agent/*`. The two approaches are independent; nothing in this
contract requires either side to change that.
