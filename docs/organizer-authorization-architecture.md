# Organizer Authorization Architecture

Design proposal. Nothing here is implemented. Audited against the live database
on 2026-09-19 and `development` @ `49355c4`.

---

## 0. What exists today

### Two data domains, one authorization rule

Every table in Rally today is authorized by **ownership**: `owner_id = auth.uid()`
or `user_id = auth.uid()`.

| Domain | Tables | Rule |
| --- | --- | --- |
| Personal / attendee | `profiles`, `connections`, `notes`, `follow_ups`, `opportunities`, `notifications` | Strictly owner-scoped |
| Event catalog | `events`, `event_registrations`, `event_invitations` | Public read + self-write |

Organizer introduces a third domain that ownership cannot express:
**organization-scoped data, shared by several people, with different powers each.**
Authorization becomes *relationship-based* — "is this user a member of the
organization that owns this event, with a sufficient role" — rather than a column
comparison. That shift, not the new tables, is the substance of this design.

### Audited state

```
events                4 rows   RLS on, 1 policy (public_read_events, USING true)
                               owner_id NULL on all 4 rows, no write policy for any role
event_registrations  10 rows   RLS on, 3 policies (self or co-attendee read, self write)
event_invitations     4 rows   RLS on, 4 policies; INSERT allows ANY authenticated user
profiles             12 rows   RLS on, own-row only, no anon grants, no role column
```

Foreign keys already draw the personal/event boundary correctly:

```
event_registrations.event_id -> events.id   ON DELETE CASCADE
event_invitations.event_id   -> events.id   ON DELETE CASCADE
connections.event_id         -> events.id   ON DELETE SET NULL
opportunities.event_id       -> events.id   ON DELETE SET NULL
```

Deleting an event erases attendance records but leaves an attendee's personal
CRM intact. That is the right instinct and the new model preserves it.

Eight `SECURITY DEFINER` helpers already exist (`get_public_profile`,
`is_registered_for_event`, `get_event_registration_counts`, …). They are the
established pattern for scoped access and this design extends it rather than
inventing a second mechanism.

### Gaps this phase must close

1. **No ownership concept.** `events.owner_id` is nullable, defaults to
   `auth.uid()`, and is NULL on every row. Nothing can be attributed to anyone.
2. **No write path.** `events` has only a read policy, so events can only be
   created with elevated database access.
3. **Anyone can invite anyone.** `event_invitations` INSERT allows
   `auth.uid() = invited_user_id OR auth.uid() = invited_by`, so any signed-in
   user can invite any other user to any event.
4. **No role model.** `profiles` has no role column; there is no table
   expressing "these people run this thing".
5. **Business rules are client-side only.** Capacity and past-event checks live
   in React; the database accepts anything.

---

## 1. Proposed data model

```
auth.users ──1:1── profiles                        (personal identity, unchanged)
     │
     └──< organization_members >── organizations
                                        │
                                        └──< events ──< event_registrations >── auth.users
                                                   │
                                                   ├──< event_invitations
                                                   └──< event_team >── auth.users
```

**One identity, additive capability.** A person is not "an attendee" or "an
organizer". They are a Rally user who may also hold membership in one or more
organizations. The same account attends events and runs them; organizer power is
conferred entirely by rows in `organization_members` and `event_team`. No second
account type, no role column on `profiles`.

**Two levels of grant.**
- *Organization level* (`organization_members`) — applies to every event the org owns.
- *Event level* (`event_team`) — applies to one event only.

This is what makes "multiple team members managing the same event" work without
giving those people the run of the organization.

---

## 2. Required tables and columns

### 2.1 New: `organizations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `name` | text not null | |
| `slug` | text unique | lowercase, for future public org pages |
| `description` | text default `''` | |
| `logo_url` | text default `''` | same storage rules as avatars |
| `website` | text default `''` | same http(s) CHECK as profiles |
| `created_by` | uuid → `auth.users` ON DELETE SET NULL | audit only, **never** used for authorization |
| `created_at` / `updated_at` | timestamptz | |

`created_by` is deliberately not an authorization column. Ownership lives in
`organization_members` so it can be transferred without rewriting rows.

### 2.2 New: `organization_members` — the authorization table

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `organization_id` | uuid → `organizations` ON DELETE CASCADE | |
| `user_id` | uuid → `auth.users` ON DELETE CASCADE | |
| `role` | `org_role` not null | enum below |
| `invited_by` | uuid → `auth.users` ON DELETE SET NULL | |
| `created_at` | timestamptz | |

- `UNIQUE (organization_id, user_id)`
- `INDEX (user_id, organization_id)` — every policy check starts from `auth.uid()`
- Enum: `CREATE TYPE org_role AS ENUM ('owner', 'admin', 'manager')`

### 2.3 New: `event_team`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `event_id` | uuid → `events` ON DELETE CASCADE | |
| `user_id` | uuid → `auth.users` ON DELETE CASCADE | |
| `assigned_by` | uuid → `auth.users` ON DELETE SET NULL | |
| `created_at` | timestamptz | |

- `UNIQUE (event_id, user_id)`, `INDEX (user_id, event_id)`
- Membership here grants event management to a `manager` who has no org-wide rights.

### 2.4 New: `organization_invitations` (team invitations)

Needed because teammates are invited by email before they have accounts.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `organization_id` | uuid → `organizations` ON DELETE CASCADE | |
| `email` | text not null | stored lowercased |
| `role` | `org_role` not null | role granted on acceptance |
| `token` | uuid not null unique | unguessable accept link |
| `status` | text | `pending` / `accepted` / `revoked` / `expired` |
| `invited_by` | uuid → `auth.users` | |
| `expires_at` | timestamptz | |
| `accepted_at`, `accepted_user_id` | | |

- `UNIQUE (organization_id, lower(email)) WHERE status = 'pending'`
- Acceptance happens through a `SECURITY DEFINER` RPC that matches the token to
  the caller's verified email and inserts the `organization_members` row. The
  invitation table itself is never readable by the invitee.

### 2.5 Changed: `events`

| Change | Reason |
| --- | --- |
| ADD `organization_id` uuid → `organizations` ON DELETE RESTRICT | the owning org; **nullable during migration, NOT NULL after** |
| ADD `visibility` text (`draft`/`published`/`unlisted`/`archived`) default `'draft'` | organizers need drafts attendees cannot see |
| ADD `created_by` uuid → `auth.users` ON DELETE SET NULL | audit |
| ADD `published_at` timestamptz | |
| ADD `timezone` text | see Risk 7 |
| DROP `owner_id` | NULL on every row, superseded by `organization_id` |

`ON DELETE RESTRICT` on `organization_id` is deliberate: deleting an organization
must not silently cascade into deleting attendees' event history.

`status` (`upcoming`/`past`) stays as-is — it is a date-derived display label and
is orthogonal to `visibility`. Worth renaming later; not now.

### 2.6 Changed: `event_registrations`

| Change | Reason |
| --- | --- |
| ADD `status` text default `'registered'` (`registered`/`waitlisted`/`cancelled`/`checked_in`) | capacity, waitlists and check-in are organizer features |
| ADD `checked_in_at` timestamptz | |
| ADD `cancelled_at` timestamptz | preserve history instead of deleting rows |

### 2.7 Changed: `event_invitations`

| Change | Reason |
| --- | --- |
| ALTER `invited_user_id` to nullable | invite people who have no account yet |
| ADD `invited_email` text | ditto |
| ADD `token` uuid unique | accept link for non-users |
| ADD `expires_at`, `revoked_at` | |
| CHECK `invited_user_id IS NOT NULL OR invited_email IS NOT NULL` | |

The permissive INSERT policy is replaced (section 5).

---

## 3. Relationships and foreign keys

| From | To | On delete | Why |
| --- | --- | --- | --- |
| `organization_members.organization_id` | `organizations.id` | CASCADE | membership is meaningless without the org |
| `organization_members.user_id` | `auth.users.id` | CASCADE | |
| `event_team.event_id` | `events.id` | CASCADE | |
| `event_team.user_id` | `auth.users.id` | CASCADE | |
| `organization_invitations.organization_id` | `organizations.id` | CASCADE | |
| `events.organization_id` | `organizations.id` | **RESTRICT** | protects attendee history |
| `event_registrations.event_id` | `events.id` | CASCADE *(review — Risk 5)* | |
| `event_invitations.event_id` | `events.id` | CASCADE | |
| `connections.event_id` | `events.id` | SET NULL *(unchanged)* | personal CRM survives |
| `opportunities.event_id` | `events.id` | SET NULL *(unchanged)* | personal CRM survives |

---

## 4. Roles and permissions

### Organization roles

- **owner** — ultimate authority. Manages billing, deletes or transfers the
  organization, manages every member including other owners. At least one must
  always exist.
- **admin** — runs the organization day to day: create/edit/publish/delete
  events, manage attendees and invitations, manage `manager` members. Cannot
  delete the org, change owners, or promote to owner.
- **manager** — team member with no organization-wide authority. Manages only
  events they are assigned to via `event_team`.

### Permission matrix

| Capability | owner | admin | manager (assigned events only) |
| --- | :-: | :-: | :-: |
| Edit organization profile | ✓ | ✓ | – |
| Delete organization | ✓ | – | – |
| Transfer ownership | ✓ | – | – |
| Invite/remove admins | ✓ | – | – |
| Invite/remove managers | ✓ | ✓ | – |
| Create event | ✓ | ✓ | – |
| Edit / publish event | ✓ | ✓ | ✓ (assigned) |
| Delete / archive event | ✓ | ✓ | – |
| Assign event team | ✓ | ✓ | – |
| View attendee list | ✓ | ✓ | ✓ (assigned) |
| Check attendees in | ✓ | ✓ | ✓ (assigned) |
| Send event invitations | ✓ | ✓ | ✓ (assigned) |
| **See attendees' connections / notes / follow-ups / opportunities** | – | – | – |

The last row is the point of the whole design and is enforced by leaving the
existing owner-scoped policies on those tables completely untouched.

### Guard rails (enforced in RPCs, not just UI)

- The last `owner` of an organization cannot be removed or demoted.
- No one can change their own role.
- An `admin` cannot create, modify or remove an `owner`.
- Removing a member cascades their `event_team` rows.

---

## 5. RLS and authorization model

### Principle

A policy on table X must never `SELECT` from table X — Postgres re-enters the
policy and recurses. Every membership test therefore goes through a
`SECURITY DEFINER STABLE` helper, exactly as `is_registered_for_event` already
does for registrations.

### Helper functions

```sql
org_role_for(org_id uuid)        -> org_role   -- caller's role, NULL if not a member
is_org_member(org_id uuid)       -> boolean
is_org_admin(org_id uuid)        -> boolean    -- owner or admin
is_org_owner(org_id uuid)        -> boolean
can_manage_event(event_id uuid)  -> boolean    -- org admin of owning org OR on event_team
```

All `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, and — per the
lesson from the profile functions — `REVOKE EXECUTE ... FROM PUBLIC, anon,
authenticated` followed by an explicit `GRANT` to `authenticated` only.
Supabase's default privileges grant EXECUTE to both roles automatically, so
revoking `PUBLIC` alone is not enough.

### Policies

**`organizations`**
- SELECT: `is_org_member(id)`. Public-facing org details (for a published event
  page) come from a `SECURITY DEFINER` function returning name/logo only, not
  from widening this policy.
- INSERT: any authenticated user may create one; a trigger immediately inserts
  the creator as `owner`, so an org is never ownerless.
- UPDATE: `is_org_admin(id)`. DELETE: `is_org_owner(id)`.

**`organization_members`**
- SELECT: `is_org_member(organization_id)` — the team can see itself.
- INSERT / UPDATE / DELETE: through RPCs only, so the guard rails above are
  enforced atomically. Direct table writes are denied.

**`event_team`**
- SELECT: `is_org_member(...)` of the owning org, or `user_id = auth.uid()`.
- WRITE: `is_org_admin(...)` of the owning org.

**`events`**
- SELECT: `visibility = 'published' OR can_manage_event(id)`.
  This is the one policy change attendees can feel: today it is `USING (true)`.
  Every existing event must be backfilled to `published` before it lands.
- INSERT: `is_org_admin(organization_id)`.
- UPDATE: `can_manage_event(id)`. DELETE: `is_org_admin(organization_id)`.

**`event_registrations`**
- SELECT: `user_id = auth.uid() OR is_registered_for_event(event_id) OR can_manage_event(event_id)`.
  The first two clauses are today's behaviour, unchanged; the third gives
  organizers their attendee list.
- INSERT: `user_id = auth.uid()` — self-registration stays attendee-driven —
  with capacity, visibility and date rules enforced in a `BEFORE INSERT` trigger
  so they stop being client-side suggestions.
- UPDATE: `user_id = auth.uid()` (cancel) `OR can_manage_event(event_id)` (check-in, waitlist).
- DELETE: same as UPDATE.

**`event_invitations`**
- SELECT: `invited_user_id = auth.uid() OR can_manage_event(event_id)`.
- INSERT: `can_manage_event(event_id)` — closes the "anyone can invite anyone" hole.
- UPDATE: invited user (accept/decline) or event manager (revoke).

### Personal/organization separation

Organizers may read, for their own events: registration rows, check-in state, and
each attendee's **public profile card** — served by the existing
`get_public_profiles` shape, which already excludes email and phone. Organizer
access is granted by extending policies on *event* tables only. No policy on
`connections`, `notes`, `follow_ups`, `opportunities` or `notifications` changes,
and `profiles` RLS stays own-row-only. Whether organizers get attendee contact
details is Decision 2 below, and should be answered with a per-registration
consent field rather than by widening `profiles`.

---

## 6. Migration strategy

Phased, additive first — the same shape that worked for the security hardening,
where the breaking half only lands once the frontend is ready.

**Phase A — additive, zero impact.** Create the enum, four new tables, helper
functions and indexes. Add `organization_id`, `visibility`, `created_by`,
`published_at`, `timezone` to `events` as nullable; add the new
`event_registrations` columns. No policy changes. The running app is unaffected.

**Phase B — backfill.** Create the first organization, insert its `owner`
member, attach all 4 existing events to it, and set **every existing event to
`visibility = 'published'`**. Skipping that last step would empty the attendee
catalog the moment Phase C lands. There is nothing to infer here:
`events.owner_id` is NULL on all four rows, so the owning organization and its
owner are a human decision, not a data migration (Decision 1).

**Phase C — enforce (breaking, ships with the organizer UI).** Set
`events.organization_id NOT NULL`; replace `public_read_events` with the
visibility-aware policy; add the write policies; replace the
`event_invitations` INSERT policy; add the registration-rules trigger; drop
`events.owner_id`.

**Phase D — cleanup.** Drop the seven inert prototype tables (`account`,
`connection`, `event`, `identifier`, `organizer`, `participation`, `profile`).
They are empty, have no grants and no RLS, and two of them are literally named
`event` and `organizer` — leaving them next to the new model invites a genuinely
dangerous mistake.

Rollback: Phases A and B are reversible by dropping the new objects. Phase C is
the point of no return for the old catalog behaviour and should ship behind the
same deploy coordination used for the security phase.

---

## 7. Risks and decisions needed before implementation

**Decisions (block implementation)**

1. **Who owns the 4 existing events?** No data answers this — `owner_id` is NULL
   on every row. Need an organization name and a first owner account.
2. **Do organizers see attendee email/phone?** Real event operations usually
   need contact details, but `profiles.email` is user-entered and currently
   private. Recommendation: collect a contact email *per registration* with
   explicit consent, rather than exposing the profile field.
3. **Can a user belong to several organizations?** The model supports it; the UI
   then needs an org switcher and every organizer screen needs an org context.
   Confirm before building.
4. **Email-based team invitations in v1?** They require sending mail, which
   Supabase will not do for arbitrary addresses — an Edge Function plus a
   provider. Alternative for v1: invite only existing Rally users by lookup, and
   defer `organization_invitations`.
5. **Event deletion semantics.** `event_registrations` currently CASCADEs, so an
   organizer deleting an event erases attendance history for every attendee.
   Recommendation: archive instead of delete, and make hard deletion owner-only.

**Risks**

6. **Catalog visibility regression.** New events default to `draft`. If the
   Phase B backfill misses any row, it vanishes from the attendee catalog.
7. **Timezones.** `start_time`/`end_time` are `time without time zone` with no
   timezone column. Multi-organization events across regions will display
   wrongly. Cheapest to fix now, while there are 4 rows.
8. **RLS performance.** Policies calling helpers run per row. Requires
   `STABLE` helpers and indexes on `organization_members(user_id, organization_id)`
   and `event_team(user_id, event_id)`; otherwise the attendee catalog degrades
   as organizations grow.
9. **Policy recursion.** Any membership policy written as a direct subquery on
   its own table will recurse. All such checks must go through the helpers.
10. **Function grant defaults.** Supabase grants EXECUTE on new public functions
    to `anon` and `authenticated` automatically. Every helper needs an explicit
    revoke — this was a real bug caught during the security phase.
11. **Capacity enforcement is still client-side.** It belongs in the Phase C
    trigger; until then "sold out" means nothing.
12. **Privilege escalation surface.** Member management is the highest-risk new
    code. It must be RPC-only with the guard rails in section 4, and deserves
    explicit tests for last-owner removal and self-promotion.
