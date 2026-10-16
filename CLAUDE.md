# CLAUDE.md — Rally

Project instructions for Claude Code. Everything here was verified against this
repository and the October 2026 audits; where something is a convention rather
than a guarantee, it says so.

---

## 1. Hard rules — read before touching anything

These are not defaults to weigh. They need explicit approval from the repository
owner, every time, for each specific action.

**Never, without approval:**

- Write to the **production** Supabase project (`zmmhoctseulbroaggysv`). Read-only
  schema inspection is fine; `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER` and
  `TRUNCATE` are not.
- Run `supabase db push`. The repository's migration versions **do not match**
  production's (see §7). A push would try to re-run 51 migrations against live
  data.
- Run `supabase db reset`.
- Run `supabase migration repair`, or edit `supabase_migrations.schema_migrations`
  by hand.
- Run any destructive SQL — dropping tables, columns, policies, functions or
  buckets; disabling RLS; disabling triggers; deleting rows.
- Rewrite shared Git history, force-push, or merge a pull request.

**Also never:**

- Commit credentials, API keys, service-role keys, passwords or tokens. Not in
  migrations, not in scripts, not in docs, not in a PR description. A migration
  provisions schema and controlled data; it never creates a reusable login.
- Edit a migration that has already been applied anywhere. Migrations are
  **forward-only** — add a new file.
- Weaken authorization to make something work. If a policy blocks you, that is
  usually the policy doing its job.

**When a change is risky or ambiguous:** state the concern in a sentence or two,
propose the minimal correction, and wait. Do not work around a permission
boundary.

---

## 2. What Rally is

Rally turns event attendance into tracked business relationships. A professional
scans a QR code at a conference, and Rally carries that contact forward through
notes, follow-ups and opportunities — from first handshake to closed outcome.

Around that core it serves four other audiences: **organizers** who run events
and their teams, **sponsors** who fund them and track what they were promised,
**vendors/exhibitors** who staff booths, and **platform admins** who approve
accounts.

The product thesis: the value of an event is not the event, it is what happens
to the connections afterwards.

---

## 3. Account types

`account_type` is the authoritative answer to "what is this user". It is set by
the signup trigger and changed **only** by a platform admin through an audited
RPC. There is no client write path, and the types are mutually exclusive — an
organizer is not also an attendee.

| Type | Purpose |
| --- | --- |
| `platform_admin` | Approves accounts and organizations. Cannot be an organization member |
| `organizer` | Runs events through an organizer organization |
| `attendee` | The networking user — connections, follow-ups, opportunities |
| `vendor` | Exhibitor / booth staff |
| `sponsor` | Funds events, tracks partnership deliverables |

Status: `pending_approval` → `active` → `suspended`. Almost every authorization
helper calls `account_is_active()`; a suspended account keeps its rows but loses
its access.

**Organizations** have their own axis — `org_type` is `organizer | vendor |
sponsor`, and membership roles are `owner | admin | manager` (`manager` = event
manager, scoped to assigned events only). `account_type_may_join_org()` decides
compatibility: an `attendee` may join any organization, a `platform_admin` may
join none, and otherwise the account type must equal the org type.

---

## 4. Sponsor workspace access — the rule that is easy to get wrong

**Sponsor workspace access depends on accepted sponsor-organization membership,
never on `account_type = 'sponsor'`.**

Having a sponsor account type grants nothing. Access flows from an *accepted
partnership* whose `sponsor_organization_id` points at an organization the caller
is a member of. `my_sponsor_partnership_ids()` is the single gate, and it requires
**all** of:

- `sponsor_organization_id IS NOT NULL` — a partnership was actually linked
- `acknowledged_at IS NOT NULL` — the invitation was accepted
- `status IN ('active', 'completed', 'cancelled')` — it reached a real lifecycle state
- `account_is_active()` — the caller is not suspended
- `is_org_member(sponsor_organization_id)` — the caller belongs to that organization

`is_my_sponsor_partnership(uuid)` wraps it for single-partnership checks, and
`my_sponsor_partnerships()` (28 columns) is the workspace's read surface.

**What sponsors must never see:**

- `event_partnerships.internal_notes` — organizer-private, exposed by no sponsor RPC
- Obligation **evidence**, roles, or obligations tables directly — all three
  `SELECT` policies are `can_manage_event(event_id)`, organizer-only
- The **package library** (`event_partnership_packages`, `_deliverables`) —
  organizer-only `ALL` policy, no sponsor read path
- Any other organization's partnerships
- Documents, unless `visibility = 'shared'` **and**
  `is_partnership_sponsor_member(partnership_id)` (which itself requires an
  active account)

If you add a sponsor-facing feature, extend `my_sponsor_partnership_ids()` or
build on it. Do not reintroduce `can_read_partnership()` as a `SELECT` policy —
it is superseded and carries a `COMMENT` saying so, because it ignores the
partnership lifecycle and account status.

---

## 5. Frontend

React 18.3 · TypeScript 5.6 (`strict`, `noUnusedLocals`, `noUnusedParameters`) ·
Vite 5.4 · Tailwind 3.4 · React Router 6.26 · `@supabase/supabase-js` 2.45.

Also: `lucide-react` (icons), `clsx` + `tailwind-merge` +
`class-variance-authority` (styling), `qrcode` (generate) + `jsqr` (scan).

Scale: 45 pages · 53 components · 16 `lib/` modules · 4 contexts · ~32k LOC.

```
src/
  pages/       one component per route
  components/  shared UI; components/ui/* are the primitives
  lib/         Supabase access layer — typed wrappers around RPCs
  context/     AuthContext, OrganizerContext, EventModeContext, NotificationContext
```

- **Path alias:** `@` → `./src`, declared in *both* `vite.config.ts` and
  `tsconfig.json`. Keep them in sync.
- **Data access convention:** pages call typed helpers in `lib/`, which call
  `supabase.rpc(...)`. This is the convention, not an invariant — 5 pages call
  `supabase.rpc` directly and 8 use `supabase.from`. Prefer adding to `lib/` for
  new work.
- **Types live in `src/lib/supabase.ts`** alongside the client, with comments
  recording *why* a shape is what it is. Read those comments before changing a
  type; several encode a privacy decision (e.g. `PublicProfile` deliberately
  omits email and phone).
- **Event lifecycle** is derived, not stored: `eventLifecycle()` in
  `lib/events.ts` combines `visibility` (`draft|published|unlisted`), `status`
  (`upcoming|live|past`) and `archived_at`. Do not add a lifecycle column.
- **Tailwind tokens:** the config defines `primary`, `accent`, `success`,
  `warning`, `error` scales. `success` is a deliberate alias of `accent` because
  pages referenced `success-*` directly and Tailwind emitted no rule without it.
- **Auth lifecycle:** `AuthContext` keeps the UI mounted while a session
  revalidates (`revalidating`, stable published identity). supabase-js emits
  `SIGNED_IN` on every visibility regain, so do not remount on auth events. Do
  not "fix" this by disabling token refresh.

### Environment

Only two frontend variables, read in `src/lib/supabase.ts`:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The Edge Function needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, `INVITE_FROM`, `APP_URL` — all set in the Supabase dashboard,
**never committed**. There is currently no `.env.example` (see §10).

---

## 6. Routing

Five persona surfaces behind guard wrappers. ~60 routes in `src/App.tsx`.

| Surface | Routes |
| --- | --- |
| Public | `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/p/:id` |
| Attendee | `/dashboard`, `/connections`, `/events`, `/follow-ups`, `/opportunities`, `/messages`, `/notifications`, `/scan`, `/onboarding` |
| Event-scoped | `/events/:eventId/{home,network,agenda,schedule,speakers,exhibitors,messages,info,map,deal-room}` |
| Organizer | `/organizer`, `/organizer/events[/:id[/edit]]`, `/organizer/people`, `/organizer/team`, `/organizer/settings`, `/organizer/invitations` |
| Sponsor | `/sponsor`, `/sponsor/partnerships` |
| Admin | `/admin` |

Signed-in users hitting `/` are redirected to their persona home. Deploy is a
static SPA — `public/_redirects` holds `/* /index.html 200`.

---

## 7. Backend and migration history

Supabase Postgres. **68 forward-only migrations** in `supabase/migrations/`, plus
one Deno Edge Function (`supabase/functions/send-invitation-emails`).

### The numbering divergence — read `supabase/migrations/README.md` first

Repository migration versions **do not match** production's. The schemas agree;
the numbering does not. `supabase/migrations/README.md` carries the verified
51-row mapping and explains why. This is exactly why `db push` is forbidden.

Key points:
- Early history was renumbered in the repo into a tidy ladder while the database
  kept wall-clock versions. The re-sequencing is **order-preserving**.
- Twelve repo files are **consolidated** — they hold the final state of a change
  production reached in two or more steps.
- Partnership phases 3B–6A keep their **forward-dated repository versions**.
  Renaming them to production's versions would sort them before their own
  prerequisites and break a fresh deployment.
- `20261003115854_create_test_sponsor_account.sql.sql` is a deliberate
  **tombstone** — intentionally empty, 0 executable statements. Do not restore it.

### Writing migrations

- `SECURITY DEFINER` functions always set `SET search_path = public, pg_temp`.
- Grant pattern: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` then
  `GRANT EXECUTE ... TO authenticated`.
- Guard existence checks with `to_regclass('public.x') IS NOT NULL` — it returns
  NULL instead of raising. This is the F-01 fix.
- `CREATE OR REPLACE VIEW` can append a column but **never drop one**. Build a
  view in the same step sequence production used. This is the F-02 fix.
- RLS is enabled on all 33 public tables. Keep it that way.

### Authorization helpers

`can_manage_event` · `is_org_admin` · `is_org_member` · `is_org_owner` ·
`require_org_authority` · `account_is_active` · `account_type_may_join_org` ·
`my_sponsor_partnership_ids` · `is_my_sponsor_partnership` ·
`is_partnership_sponsor_member` · `current_user_confirmed_email`

Compose these rather than writing new membership logic inline.

### Storage buckets

| Bucket | Public |
| --- | --- |
| `avatars`, `event-assets`, `event-banners` | yes |
| `partnership-assets`, `partnership-documents` | **no** |

---

## 8. Branch workflow

- **`development` is the integration branch.** It is the base for every pull
  request and must be preserved. Never force-push it.
- `main` is **stale**: 123 commits behind `development`, plus two commits of its
  own that touch only a previously committed `dist/`. No source is lost there.
  Do not branch from it or merge it without asking.
- Branch names follow `feat/*`, `fix/*`, `chore/*`, `docs/*`, `design/*`.
- **Small, scoped PRs.** One concern per PR. If a change grows a second purpose,
  split it.
- **Never merge automatically.** Never enable auto-merge. The repository owner
  reviews and merges, always.
- Commit messages explain *why*, not just what. Several existing commits are
  worth imitating.

---

## 9. Commands

```bash
npm install
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build   (verified working, ~36s)
npm run preview   # serve the production build
```

For a type check without a full build:

```bash
npx tsc --noEmit -p tsconfig.json   # currently exits 0 across ~32k LOC
```

**There is no test suite, no linter and no `typecheck` script.** Do not claim
tests pass. "Verified" means: `tsc --noEmit` is clean, `npm run build` exits 0,
and — where the change is observable — the behaviour was exercised in a browser.

Note: `npm run build` rewrites `tsconfig.tsbuildinfo`, which is currently
**tracked**, so a build dirties the working tree. That is a known issue (§10),
not something you caused.

---

## 10. Outstanding issues

Known and unresolved. Do not fix these as a side effect of unrelated work — each
deserves its own scoped PR.

**Functional**

1. **Broken sponsor invitation deep link.** The Edge Function builds
   `${APP_URL}/partner/invitations?invitation=<id>`, but **no `/partner` route
   exists**. Sponsor invitation emails land on the 404 route. Sponsor email
   onboarding is broken end to end.
2. **1.28 MB single JS chunk** (326 kB gzip), no code splitting. With ~60 routes,
   `React.lazy` per persona surface is the obvious fix.
3. **`public/ChatGPT_Image_Oct_5,_2026,_09_38_27_PM.png`** — 1.46 MB unoptimised
   PNG, referenced by a URL containing commas. Larger than the whole CSS bundle.

**Repository hygiene**

4. No `.env.example` — a fresh clone throws `Missing Supabase environment
   variables` with no hint which variables.
5. `README.md` is one line.
6. No `supabase/config.toml`, so the CLI has no project config for linking or
   deploying the Edge Function.
7. `tsconfig.tsbuildinfo` is tracked and regenerated by every build.
8. `.gitignore` has only three entries; missing `tsconfig.tsbuildinfo`,
   `supabase/.temp/`, `.DS_Store`.
9. No ESLint, no Prettier, no CI workflow, no Node version pin (built on Node
   22.x).

**Cosmetic schema difference**

10. `event_networking_overview` carries an em-dash in the repository where
    production has an ASCII hyphen, inside one explanatory string in its
    `unavailable_metrics` array. No logic or authorization effect.

---

## 11. Validation status

As of the October 2026 audits:

- All 68 migrations apply in order to an empty project, with F-01 and F-02 both
  confirmed fixed at runtime.
- Against production, read-only: RLS policies (116), triggers (32), enum types
  (5), and all 135 function signatures / return types / `SECURITY DEFINER`
  settings / `search_path` / EXECUTE grants hash **identically**.
- Every structural difference is the seven legacy prototype tables (`account`,
  `connection`, `event`, `identifier`, `organizer`, `participation`, `profile`)
  that exist only in production and that no migration creates.
- A fully uninterrupted clean-room rebuild has **not** yet been demonstrated.
