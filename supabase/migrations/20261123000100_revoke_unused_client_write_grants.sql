/*
# Remove client write grants the app does not use (GAP-1, GAP-5, GAP-6)

Found by tests/sql/identity-authorization.test.mjs and
tests/sql/identity-type-rules.test.mjs (minimum security foundation). In each
case the client role holds a table privilege the frontend never uses, and the
row-level policy that guards it is weaker than the RPC that does the real work.

## GAP-1: organization_invitations
`authenticated` held INSERT, UPDATE and DELETE. The policies check
`is_org_admin()` / `is_org_owner()` but not `account_is_active()`, and a direct
write skips everything invite_organization_member() enforces (the 30-day
expiry, archived organizations, account-type compatibility, refusing platform
administrators). So an admin could issue a 10-year invitation or re-open a
revoked one, and a *suspended* admin could still issue invitations.

Invitations are created, re-sent and withdrawn only through
invite_organization_member() and revoke_organization_invitation(), and accepted
through accept_organization_invitation(). All three are SECURITY DEFINER and run
as the table owner, so they are unaffected. `src/` has no direct write to this
table. SELECT (the invitations page) is unchanged.

## GAP-5: organizations INSERT
`authenticated` held INSERT, and insert_organization_as_organizer does not
constrain approval_status / approved_by / approved_at (the immutability trigger
is BEFORE UPDATE only). An active organizer could insert an organization that
was already "approved", approved_by themselves.

Organizations are created through create_organizer_organization() and
create_sponsor_organization_for_partnership_invitation(), both SECURITY
DEFINER. `src/` never inserts into organizations. SELECT and UPDATE (the
settings page, guarded by update_organization_as_admin and the immutability
trigger) are unchanged.

## GAP-6: event_invitations UPDATE
`authenticated` held table-wide UPDATE, and update_own_invitations only requires
`invited_user_id` to stay the caller's. So an invitee could rewrite event_id
(moving the invitation into another organizer's list) or invited_by
(redirecting the response notification). The app only ever sets `status` and
`responded_at` (EventsPage.tsx, accept and decline).

UPDATE becomes a column grant on (status, responded_at). The existing policy
still decides *which rows*; the grant now decides *which columns*. A table-level
REVOKE also removes any column-level UPDATE grant on other columns.

## What does not change
No policy, function, trigger or row is changed or dropped. The now-inert write
policies on organization_invitations stay in place (dropping a policy is a
separate, approved change). Forward-only; safe to re-run.
*/

-- GAP-1
REVOKE INSERT, UPDATE, DELETE ON public.organization_invitations FROM PUBLIC, anon, authenticated;

-- GAP-5
REVOKE INSERT ON public.organizations FROM PUBLIC, anon, authenticated;

-- GAP-6
REVOKE UPDATE ON public.event_invitations FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status, responded_at) ON public.event_invitations TO authenticated;
