# Account Type Architecture

Design proposal. Nothing here is implemented. Supersedes the identity model in
`organizer-authorization-architecture.md`. Audited against the live database and
`development` @ `63463ca` (Phase A merged).

---

## 0. What this changes about Phase A

Phase A was built on an explicit premise:

> One identity, additive capability. A person is not "an attendee" or "an
> organizer". They are a Rally user who may also hold membership in one or more
> organizations.

**That premise is now wrong.** The product requires a fixed primary account type
per user, mutually exclusive, determining the dashboard and onboarding flow. An
Organizer account cannot also be an Attendee.

The good news: almost none of the Phase A *schema* is wasted. Organizations,
members, event teams and organization-owned events are all still required. What
changes is that a second, higher authority is added above them — the account
type — and a few Phase A policies that assumed the old premise have to be
tightened. Section 9 lists exactly what.

State: 14 users, 14 profiles, **0 organizations, 0 memberships**. Phase B never
ran, so there is nothing to unwind.

---

## 1. Where the authoritative account type lives

### Not on `profiles`

`profiles` carries `update_own_profile`, which lets a user update **any column
of their own row**. An `account_type` column there would be self-assignable, so
any user could make themselves `platform_admin` with a single PATCH. This is
disqualifying, and it is worth stating as a general rule: **no authorization
column may ever live on `profiles` while that policy exists.**

### Proposed: `user_accounts`, one row per auth user

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid PK → `auth.users` ON DELETE CASCADE | |
| `account_type` | `account_type` enum NOT NULL | `platform_admin`, `organizer`, `attendee`, `vendor`, `sponsor` |
| `status` | `account_status` enum NOT NULL default `active` | `pending_approval`, `active`, `suspended` |
| `approved_by` | uuid → `auth.users` | set when a platform admin approves |
| `approved_at`, `created_at`, `updated_at` | timestamptz | |

RLS: SELECT own row, plus platform admins may read all. **No self INSERT, UPDATE
or DELETE policy at all** — the row is written by the signup trigger and by
admin-only RPCs. This is the same shape as `organization_members`: the table that
confers power has no client write path.

### JWT mirror, deliberately non-authoritative

Mirror the value into `auth.users.raw_app_meta_data.account_type`.
`app_metadata` is not client-writable (unlike `user_metadata`), and it rides in
the JWT, so the frontend can route on first paint without a round trip.

It must **not** be the authorization source. A JWT is valid until it refreshes —
up to an hour — so a demoted or suspended admin would keep their old claim for
that window. RLS and RPCs read the table; the claim is a rendering hint only.

### Helpers

```sql
current_account_type()  -> account_type   -- from user_accounts, not the JWT
is_platform_admin()     -> boolean
account_is_active()     -> boolean
```
All `SECURITY DEFINER STABLE SET search_path = public, pg_temp`, revoked from
`PUBLIC, anon, authenticated`, granted back to `authenticated` only.

---

## 2. How signup and invitation establish account type

### The trigger cannot trust signup metadata

`handle_new_user` currently reads `NEW.raw_user_meta_data`. That is populated
from `options.data` in the client's `signUp()` call, so **it is attacker
controlled**. If the trigger naively copied an `account_type` from there, anyone
could register as `platform_admin`.

Rules the trigger must enforce, in the database, not the UI:

1. `platform_admin` is **never** accepted from signup metadata. Not with a flag,
   not with a secret value.
2. Self-serve signup may only produce `attendee` or `organizer`.
3. `vendor` and `sponsor` are only reachable by redeeming an invitation.
4. Anything unrecognised falls back to `attendee`.

```
signup metadata says          resulting account
-----------------------------  ---------------------------------
(nothing)                      attendee, active
attendee                       attendee, active
organizer                      organizer, pending_approval
vendor / sponsor               rejected -> attendee  (needs an invitation)
platform_admin                 rejected -> attendee  (never self-serve)
```

### Invitation-bound signup for vendor and sponsor

A vendor or sponsor account only exists because an organizer invited that
company. The invitation carries the intended account type and the organization
it joins, so the account type is established by redeeming the invitation rather
than by anything the signing-up user chooses.

This needs a `partner_invitations` table (section 6) keyed by an unguessable
token, since the invitee may not have a Rally account yet. Note this is the one
place where the v1 "existing Rally users only" decision does not hold: a sponsor
company generally is not already on Rally.

---

## 3. How onboarding differs by account type

| Account type | Onboarding | Reuses |
| --- | --- | --- |
| `attendee` | Existing profile flow: full name, job title, company, bio | **Unchanged**, `isProfileComplete` as-is |
| `organizer` | Create organization → submit for approval → pending screen until approved | New |
| `vendor` / `sponsor` | Accept invitation → join the organization it names → company profile | New, shares the organization form |
| `platform_admin` | None. Provisioned already onboarded | — |

The attendee path must not change. `isProfileComplete` and the onboarding form
stay exactly as they are; they simply stop being the *only* onboarding path.

Each account type needs its own completeness test, so the router can tell "needs
onboarding" from "ready". Keep them in one module beside `isProfileComplete`
rather than scattering the logic.

---

## 4. How login routing works

One decision point, driven by the account type, evaluated after the session
resolves:

```
session?                 no  -> /login
account row loaded?      no  -> spinner (never guess)
status = suspended           -> /account/suspended
status = pending_approval    -> /organizer/pending
account_type = platform_admin-> /admin
                 organizer   -> /organizer        (onboarding first if incomplete)
                 vendor      -> /vendor
                 sponsor     -> /sponsor
                 attendee    -> /dashboard         (existing behaviour)
```

Three things this must get right, learned from the OAuth and recovery bugs:

- **Never route on a missing value.** If the account row has not loaded, show a
  spinner. Treating "unknown" as "attendee" would flash the wrong dashboard and,
  worse, could send an admin into the attendee app.
- **Do not route from the JWT claim alone.** Use it for the first paint if
  desired, but gate real access on the table-backed value.
- **`/auth/callback` must defer, not decide.** It already hands off to the
  guards; it should continue to, so there is one router, not two.

The existing `ProtectedRoute` gains an `allowedTypes` notion. Attendee routes
become attendee-only rather than "any signed-in user", which is what enforces
"an Organizer account cannot also be an Attendee" at the routing layer — with
RLS enforcing it underneath.

---

## 5. How Platform Admin is created and managed

Three layers, because this is the account type that can do the most damage:

1. **Bootstrap.** The first platform admin is inserted by a migration run by a
   trusted operator — the only time an admin is created without an existing
   admin. Recorded explicitly, not quietly.
2. **Thereafter, promotion only.** `set_account_type(target_user, type)` is
   `SECURITY DEFINER` and begins by checking `is_platform_admin()`. It refuses
   if the caller is not an admin, and refuses to let an admin change their own
   type (mirroring the no-self-escalation rule already used for organizations).
3. **Never from signup.** Enforced in the trigger, per section 2.

Add an `account_type_changes` audit table — who changed whom, from what, to
what, when. Promotion to admin is exactly the event you want a record of, and
there is no other trace of it in the schema.

Do not rely on the absence of a UI control. The rule belongs in the database,
because the REST API is directly reachable with any user's token.

---

## 6. How Organizer → Vendor/Sponsor onboarding works

### Reuse organizations rather than inventing parallel tables

A sponsor is a company with staff, exactly like an organizer. Give
`organizations` an `org_type` (`organizer` | `vendor` | `sponsor`) and the whole
membership, role and team apparatus is reused unchanged. Separate
`vendors`/`sponsors` tables would duplicate members, invitations and RLS three
times over.

```
organizations (org_type = 'organizer')  --owns-->  events
organizations (org_type = 'sponsor')    --linked by--> event_sponsors --> events
organizations (org_type = 'vendor')     --linked by--> event_vendors  --> events
```

Sponsor and vendor organizations **participate in** events; they never own them.
A CHECK or trigger should enforce that `events.organization_id` always points at
an `organizer` organization.

### Flow

1. Organizer invites a company to an event — creates a `partner_invitations` row
   (organization name, contact email, intended `account_type`, event, token).
2. Invitee follows the tokenised link and signs up, or signs in if they already
   have an account of that type.
3. Redemption RPC creates the vendor/sponsor organization, makes them its
   `owner`, sets their `account_type`, and inserts the `event_sponsors` /
   `event_vendors` link — all in one transaction.
4. They land in their own dashboard.

A returning sponsor invited to a second event skips steps 1–3's account
creation: the RPC just adds the new event link to their existing organization.

---

## 7. How organizations and events relate to account types

| Rule | Enforcement |
| --- | --- |
| Only `organizer` accounts may create organizations | Replaces Phase A's open `insert_own_organization` |
| Only an **approved** organizer may publish events | `organizations.approval_status` + the Phase C events policy |
| `events.organization_id` must reference an `organizer` org | CHECK/trigger |
| Members of an org must have a compatible account type | Trigger on `organization_members` |
| Attendees never appear in `organization_members` | Follows from the above |
| Sponsors/vendors reach events through link tables, never ownership | `event_sponsors` / `event_vendors` |

`organizations` needs two new columns: `org_type` and `approval_status`
(`pending`, `approved`, `rejected`, `suspended`).

---

## 8. How existing Professional/Attendee functionality stays intact

All 14 existing users become `attendee`, `active`. Every owner-scoped table —
`profiles`, `connections`, `notes`, `follow_ups`, `opportunities`,
`notifications` — is untouched, as are the public profile functions and the
attendee registration flow. The attendee dashboard becomes one branch of the
router rather than the only destination.

### The one real conflict: the intended first Organizer account

The account earmarked to own the four existing events holds **8 connections,
3 registrations and 7 opportunities**. It is a genuinely used attendee account.
Under strict mutual exclusivity, converting it to `organizer` strands all of
that behind a dashboard it can no longer reach.

Three options, and this needs a decision before Phase B:

- **(a) Separate organizer account (recommended).** Keep the existing account as
  the attendee it is; create a distinct organizer account to own the events.
  Cleanest fit with the model, and it is how the rule will apply to every real
  user later.
- **(b) Convert it.** Simplest, but the connections and opportunities become
  unreachable, and the 3 registrations sit oddly on an account that can no
  longer attend.
- **(c) Convert and migrate the data out first** — export or reassign the
  attendee records, then flip the type. Most work, avoids silent data loss.

---

## 9. What has to change in Phase A before Phase B or C

### Phase A policies that now contradict the model

1. **`insert_own_organization` is too open.** It currently lets *any*
   authenticated user create an organization and become its owner. Under the new
   model an organization may only be created by an `organizer` account (or a
   platform admin), and an organizer only becomes able to publish after
   approval. This directly contradicts "Platform Admin approves organizers" and
   must be tightened before any organizer UI exists.
2. **No account-type constraint on membership.** Nothing stops an attendee being
   added to `organization_members`, which would make them an organizer in all
   but name.
3. **`organizations` lacks `org_type` and `approval_status`**, both of which the
   model requires.

### Findings from the Phase A review, still outstanding

These were agreed for a hardening pass that was not started, and they remain
prerequisites:

4. **Contact-consent fields are readable by co-attendees.** Leave the columns in
   place and inaccessible; the organizer attendee-access design must land before
   anything can write them. **Phase C blocker.**
5. **An admin can mint an owner** via an invitation carrying `role = 'owner'`.
   Owners may promote to owner; admins must not.
6. **`search_path = public` does not pin `pg_temp`** on all 17 SECURITY DEFINER
   functions. Not reachable through PostgREST today, but a one-line fix.
7. **`anon` retains table grants** on the four Phase A tables. Inert while RLS
   holds, but it breaks the pattern used for `profiles` and
   `event_registrations`.
8. **`handle_new_organization` uses `COALESCE(NEW.created_by, auth.uid())`**,
   both NULL in a migration context — Phase B must set `created_by` explicitly.

### Revised phase order

- **Phase A.1 — account type foundation.** `account_type` / `account_status`
  enums, `user_accounts`, helpers, audit table, the rewritten `handle_new_user`,
  backfill all 14 users to `attendee`, admin bootstrap. Additive.
- **Phase A.2 — hardening.** Findings 4–8 above, plus `org_type` and
  `approval_status` on `organizations`.
- **Phase B — data.** Organizations created, the four events assigned, per the
  decision in section 8.
- **Phase C — enforcement and UI.** Breaking policy switch, routing, dashboards.

---

## 10. Open questions

1. **Section 8's conflict** — separate organizer account, or convert? Blocks
   Phase B.
2. **Speaker.** Recommend *not* making it an account type. A speaker is normally
   also a networking professional, and an exclusive Speaker account would remove
   the ability to connect and follow up — the core of the product. Model it as
   an event-scoped role (`event_speakers`) on an attendee account instead. If it
   must be an account type, that is a product call, not a technical one.
3. **Can one person hold two account types across two logins?** The model says
   an account has one type; nothing stops a human registering twice with
   different emails. If that should be prevented, it needs a rule; if it is the
   intended escape hatch (section 8 option (a) relies on it), say so explicitly.
4. **Vendor and sponsor — genuinely different, or one "partner" type with a
   flag?** They are structurally identical here. Two enum values are cheap, but
   two dashboards are not.
5. **What can a suspended account still do?** Read-only, or fully locked out?
6. **Does an organizer awaiting approval see anything** beyond a pending screen —
   can they draft events before approval?
