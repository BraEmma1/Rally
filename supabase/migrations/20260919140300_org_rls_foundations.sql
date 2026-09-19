/*
# Organizer Phase A (additive) — RLS on the new organization tables

Locks down the tables created in this phase. Additive: these are new tables, so
no existing behaviour changes. RLS on `events` and `event_registrations` is
deliberately untouched — that is the breaking Phase C change and ships with the
organizer UI.

## Membership writes are RPC-only
`organization_members` has no INSERT, UPDATE or DELETE policy, so direct writes
are denied outright. Membership is the highest-risk surface in the whole model —
it is what grants power — so it changes only through functions that can enforce
the guard rails atomically: the last owner cannot be removed or demoted, nobody
can change their own role, and an admin cannot act on an owner.

This phase ships only the two RPCs the invitation loop needs. Full member
management (add, remove, change role, transfer ownership) lands in Phase C with
the UI that calls it.

## An organization always has an owner
A trigger inserts the creator as `owner` immediately after the organization row
is created, in the same transaction, so an ownerless organization cannot exist —
not even briefly, and not if the client crashes mid-flow.
*/

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Creator becomes owner, atomically
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (NEW.id, COALESCE(NEW.created_by, auth.uid()), 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_organization() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_organization_created ON organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();

-- ============================================================================
-- organizations
-- ============================================================================
DROP POLICY IF EXISTS "select_member_organizations" ON organizations;
CREATE POLICY "select_member_organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (public.is_org_member(id));

-- Any authenticated user may start an organization; the trigger makes them its
-- owner. created_by is pinned to the caller so it cannot be forged.
DROP POLICY IF EXISTS "insert_own_organization" ON organizations;
CREATE POLICY "insert_own_organization"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "update_organization_as_admin" ON organizations;
CREATE POLICY "update_organization_as_admin"
  ON organizations FOR UPDATE
  TO authenticated
  USING (public.is_org_admin(id))
  WITH CHECK (public.is_org_admin(id));

DROP POLICY IF EXISTS "delete_organization_as_owner" ON organizations;
CREATE POLICY "delete_organization_as_owner"
  ON organizations FOR DELETE
  TO authenticated
  USING (public.is_org_owner(id));

-- ============================================================================
-- organization_members — readable by the team, writable only via RPC
-- ============================================================================
DROP POLICY IF EXISTS "select_org_members" ON organization_members;
CREATE POLICY "select_org_members"
  ON organization_members FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- ============================================================================
-- event_team
-- ============================================================================
DROP POLICY IF EXISTS "select_event_team" ON event_team;
CREATE POLICY "select_event_team"
  ON event_team FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member(public.event_org_id(event_id))
  );

DROP POLICY IF EXISTS "insert_event_team_as_admin" ON event_team;
CREATE POLICY "insert_event_team_as_admin"
  ON event_team FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_admin(public.event_org_id(event_id)));

DROP POLICY IF EXISTS "delete_event_team_as_admin" ON event_team;
CREATE POLICY "delete_event_team_as_admin"
  ON event_team FOR DELETE
  TO authenticated
  USING (public.is_org_admin(public.event_org_id(event_id)));

-- ============================================================================
-- organization_invitations
-- ============================================================================
DROP POLICY IF EXISTS "select_own_or_admin_invitations" ON organization_invitations;
CREATE POLICY "select_own_or_admin_invitations"
  ON organization_invitations FOR SELECT
  TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR public.is_org_admin(organization_id)
  );

-- Only an owner/admin invites, and only as themselves.
DROP POLICY IF EXISTS "insert_invitation_as_admin" ON organization_invitations;
CREATE POLICY "insert_invitation_as_admin"
  ON organization_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_admin(organization_id)
    AND invited_by = auth.uid()
  );

-- Admins revoke; the invitee responds through the RPCs below.
DROP POLICY IF EXISTS "update_invitation_as_admin" ON organization_invitations;
CREATE POLICY "update_invitation_as_admin"
  ON organization_invitations FOR UPDATE
  TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "delete_invitation_as_admin" ON organization_invitations;
CREATE POLICY "delete_invitation_as_admin"
  ON organization_invitations FOR DELETE
  TO authenticated
  USING (public.is_org_admin(organization_id));

-- ============================================================================
-- Invitation response RPCs
--
-- Accepting has to create a membership row, and membership has no INSERT
-- policy, so this is the only way in. Both functions verify the caller is the
-- invitee and that the invitation is still pending.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role org_role;
  v_invited_by uuid;
BEGIN
  SELECT i.organization_id, i.role, i.invited_by
    INTO v_org_id, v_role, v_invited_by
  FROM organization_invitations i
  WHERE i.id = invitation_id
    AND i.invited_user_id = auth.uid()
    AND i.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation for this user';
  END IF;

  -- Never let an invitation quietly change an existing member's role; that is
  -- member management, not invitation acceptance.
  INSERT INTO organization_members (organization_id, user_id, role, invited_by)
  VALUES (v_org_id, auth.uid(), v_role, v_invited_by)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_invitations
  SET status = 'accepted', responded_at = now()
  WHERE id = invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE organization_invitations
  SET status = 'declined', responded_at = now()
  WHERE id = invitation_id
    AND invited_user_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation for this user';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decline_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_organization_invitation(uuid) TO authenticated;
