/*
# event_team is written only through assign_event_manager / unassign_event_manager

## The gap
event_team has direct INSERT and DELETE policies for organization admins
(insert_event_team_as_admin, delete_event_team_as_admin) on top of broad table
privileges for `authenticated`. assign_event_manager refuses things the policy
does not, so a signed-in admin calling the table API directly could:

  - assign an owner or an admin (meaningless: they already reach every event);
  - assign someone to an ARCHIVED event, which really does grant that person
    access to a frozen event (can_manage_event does not look at archived_at);
  - insert a row for a non-member or a member of another organization (these
    grant nothing, because can_manage_event also requires membership, but they
    are junk rows);
  - set assigned_by to any user, forging the audit trail the RPC records from
    auth.uid().

## The fix
The RPCs become the only write path:

  - DROP the INSERT and DELETE policies. With no policy, RLS refuses the write.
  - REVOKE every table privilege from authenticated, then GRANT back SELECT
    alone. This also removes UPDATE (which never had a policy, so it did
    nothing), TRUNCATE, REFERENCES and TRIGGER, none of which a client needs.
    Revoking at table level removes the matching column privileges too.
  - Keep select_event_team as it is: TeamPage reads (user_id, event_id) to count
    each manager's events, and a manager reads their own rows.

## What does not change
  - assign_event_manager, unassign_event_manager and event_team_list are not
    touched. They are SECURITY DEFINER with search_path = public, pg_temp,
    EXECUTE for authenticated only. They run as the table owner, which is not
    subject to the grants or policies changed here (the table has no FORCE
    ROW LEVEL SECURITY).
  - Other writers keep working for the same reason: remove_organization_member
    (clears stale rows), and the ON DELETE CASCADE from events and auth.users.
  - can_manage_event and every other reader of event_team (all SECURITY
    DEFINER).
  - Organization isolation: select_event_team is unchanged, and no other table,
    policy or function is touched.
  - No data is modified. Rows created earlier by direct inserts stay; this does
    not audit them.

## Forward-only
Reversal is a new migration that re-creates the two policies and re-grants
INSERT, DELETE to authenticated. That would reopen the gap.

NOT applied to rally-dev or production.
*/

DROP POLICY IF EXISTS "insert_event_team_as_admin" ON public.event_team;
DROP POLICY IF EXISTS "delete_event_team_as_admin" ON public.event_team;

REVOKE ALL ON TABLE public.event_team FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_team TO authenticated;
