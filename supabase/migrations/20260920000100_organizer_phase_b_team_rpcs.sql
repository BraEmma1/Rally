/*
# Organizer Phase B — team management RPCs

`organization_members` has no INSERT, UPDATE or DELETE policy, by design: it is
the table that grants power, so every write goes through a definer function that
can enforce the guard rails atomically. Phase A shipped only the two functions
the invitation loop needs. These are the rest.

## The rules every write enforces
- The caller must be an active organizer. An account that is suspended or still
  pending approval holds no organization authority even if a membership row
  exists, because approval can be withdrawn after the row was created.
- An admin may act on managers and admins. Only an owner may create, promote to,
  demote or remove an owner. This is the rule Phase A's review found broken on
  invitations and it is applied identically here.
- Nobody changes their own role or removes themselves. Self-service escalation
  is the whole attack, and a lone owner "leaving" would orphan the organization.
- The last owner cannot be demoted or removed, so an ownerless organization
  cannot be reached from any sequence of legal calls.
- Membership still passes `enforce_member_account_type`, so an attendee cannot
  be added to an organization by any route.

## Why reads are functions too
An organizer needs to see teammate names and the name of the organization that
invited them. `profiles` is not publicly readable and `organizations` is
readable only by members — correctly, since an invitee is not a member yet.
Rather than widen either policy, these functions return the narrow projection
each screen needs, and nothing else. No email or phone is returned for any
member; the organizer team screen shows the same public professional card the
rest of Rally shows.
*/

-- ============================================================================
-- Shared guard: the caller's authority over an organization
--
-- Returns the caller's role, having verified their account is an active
-- organizer. Raises rather than returning NULL so every caller fails closed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.require_org_authority(org_id uuid, minimum org_role)
RETURNS org_role
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_role org_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_account_type() <> 'organizer' OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Only an active organizer account may manage an organization';
  END IF;

  SELECT m.role INTO v_role
  FROM organization_members m
  WHERE m.organization_id = org_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this organization';
  END IF;

  -- owner > admin > manager
  IF minimum = 'owner' AND v_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may do that';
  END IF;

  IF minimum = 'admin' AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or admin may do that';
  END IF;

  RETURN v_role;
END;
$$;

-- ============================================================================
-- Reads
-- ============================================================================

-- The team screen: members with the public professional card, no contact data.
CREATE OR REPLACE FUNCTION public.organization_member_directory(org_id uuid)
RETURNS TABLE (
  user_id uuid,
  role org_role,
  created_at timestamptz,
  full_name text,
  job_title text,
  company text,
  photo_url text,
  is_self boolean
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_org_authority(org_id, 'manager');

  RETURN QUERY
  SELECT
    m.user_id,
    m.role,
    m.created_at,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(p.job_title, '') AS job_title,
    COALESCE(p.company, '')   AS company,
    COALESCE(p.photo_url, '') AS photo_url,
    (m.user_id = auth.uid())  AS is_self
  FROM organization_members m
  LEFT JOIN profiles p ON p.id = m.user_id
  WHERE m.organization_id = org_id
  ORDER BY
    CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    m.created_at;
END;
$$;

-- Invitations an organization has sent. Owner/admin only: a manager has no
-- business seeing who else is being recruited.
CREATE OR REPLACE FUNCTION public.organization_invitation_list(org_id uuid)
RETURNS TABLE (
  id uuid,
  invited_user_id uuid,
  invited_email text,
  role org_role,
  status text,
  created_at timestamptz,
  responded_at timestamptz,
  full_name text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_org_authority(org_id, 'admin');

  RETURN QUERY
  SELECT
    i.id,
    i.invited_user_id,
    COALESCE(i.invited_email, '') AS invited_email,
    i.role,
    i.status,
    i.created_at,
    i.responded_at,
    COALESCE(p.full_name, '') AS full_name
  FROM organization_invitations i
  LEFT JOIN profiles p ON p.id = i.invited_user_id
  WHERE i.organization_id = org_id
  ORDER BY
    CASE i.status WHEN 'pending' THEN 0 ELSE 1 END,
    i.created_at DESC;
END;
$$;

-- Invitations addressed to the caller. Needs to be a function because the
-- organization name lives behind a members-only SELECT policy and the invitee
-- is, by definition, not a member yet.
CREATE OR REPLACE FUNCTION public.my_pending_organization_invitations()
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_type org_type,
  role org_role,
  created_at timestamptz,
  invited_by_name text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    i.id,
    i.organization_id,
    o.name,
    o.org_type,
    i.role,
    i.created_at,
    COALESCE(p.full_name, '')
  FROM organization_invitations i
  JOIN organizations o ON o.id = i.organization_id
  LEFT JOIN profiles p ON p.id = i.invited_by
  WHERE i.invited_user_id = auth.uid()
    AND i.status = 'pending'
    AND o.archived_at IS NULL
  ORDER BY i.created_at DESC;
$$;

-- ============================================================================
-- Invite by email
--
-- The organizer types an address; this resolves it to an existing Rally user.
-- Deliberately uniform failure: "no organizer account with that address" covers
-- both an unregistered address and a registered attendee, so an organizer
-- cannot use the invite box to probe who has a Rally account or what type it
-- is. The one case that reports precisely is an address that is already on the
-- team, because the caller can see that on the same screen anyway.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.invite_organization_member(
  org_id uuid,
  invitee_email text,
  invitee_role org_role DEFAULT 'manager'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role org_role;
  v_email text := lower(btrim(invitee_email));
  v_target uuid;
  v_org_type org_type;
  v_invitation_id uuid;
BEGIN
  v_caller_role := public.require_org_authority(org_id, 'admin');

  IF invitee_role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may invite another owner';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  SELECT o.org_type INTO v_org_type FROM organizations o
  WHERE o.id = org_id AND o.archived_at IS NULL;

  IF v_org_type IS NULL THEN
    RAISE EXCEPTION 'This organization is archived';
  END IF;

  -- The account type must suit the organization, the same rule
  -- enforce_member_account_type applies when the invitation is accepted.
  -- Checking here turns a confusing failure at accept time into a clear one at
  -- invite time.
  SELECT u.id INTO v_target
  FROM auth.users u
  JOIN user_accounts a ON a.user_id = u.id
  WHERE lower(u.email) = v_email
    AND a.account_type::text = v_org_type::text;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No % account with that email address. They need to sign up for Rally first.', v_org_type;
  END IF;

  IF v_target = auth.uid() THEN
    RAISE EXCEPTION 'You are already a member of this organization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = org_id AND m.user_id = v_target
  ) THEN
    RAISE EXCEPTION 'That person is already on the team';
  END IF;

  -- One row per person per organization: re-inviting someone who declined puts
  -- the same row back to pending rather than accumulating history.
  INSERT INTO organization_invitations
    (organization_id, invited_user_id, invited_email, role, status, invited_by)
  VALUES
    (org_id, v_target, v_email, invitee_role, 'pending', auth.uid())
  ON CONFLICT (organization_id, invited_user_id) DO UPDATE
    SET role          = EXCLUDED.role,
        invited_email = EXCLUDED.invited_email,
        status        = 'pending',
        invited_by    = EXCLUDED.invited_by,
        created_at    = now(),
        responded_at  = NULL
  RETURNING id INTO v_invitation_id;

  RETURN v_invitation_id;
END;
$$;

-- Withdraw an invitation that has not been answered.
CREATE OR REPLACE FUNCTION public.revoke_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_role org_role;
  v_caller_role org_role;
BEGIN
  SELECT i.organization_id, i.role INTO v_org_id, v_role
  FROM organization_invitations i
  WHERE i.id = invitation_id AND i.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation to withdraw';
  END IF;

  v_caller_role := public.require_org_authority(v_org_id, 'admin');

  IF v_role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may withdraw an owner invitation';
  END IF;

  UPDATE organization_invitations
  SET status = 'revoked', responded_at = now()
  WHERE id = invitation_id;
END;
$$;

-- ============================================================================
-- Member management
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_organization_member_role(
  org_id uuid,
  target_user_id uuid,
  new_role org_role
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role org_role;
  v_target_role org_role;
  v_owner_count int;
BEGIN
  v_caller_role := public.require_org_authority(org_id, 'admin');

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  SELECT m.role INTO v_target_role
  FROM organization_members m
  WHERE m.organization_id = org_id AND m.user_id = target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'That person is not a member of this organization';
  END IF;

  -- Only an owner may act on an owner, in either direction: an admin can
  -- neither demote one nor mint one.
  IF (v_target_role = 'owner' OR new_role = 'owner') AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may change an owner role';
  END IF;

  IF v_target_role = new_role THEN
    RETURN;
  END IF;

  IF v_target_role = 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM organization_members m
    WHERE m.organization_id = org_id AND m.role = 'owner';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'An organization must always have an owner';
    END IF;
  END IF;

  UPDATE organization_members
  SET role = new_role
  WHERE organization_id = org_id AND user_id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_organization_member(
  org_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role org_role;
  v_target_role org_role;
  v_owner_count int;
BEGIN
  v_caller_role := public.require_org_authority(org_id, 'admin');

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove yourself from an organization';
  END IF;

  SELECT m.role INTO v_target_role
  FROM organization_members m
  WHERE m.organization_id = org_id AND m.user_id = target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'That person is not a member of this organization';
  END IF;

  IF v_target_role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may remove an owner';
  END IF;

  IF v_target_role = 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM organization_members m
    WHERE m.organization_id = org_id AND m.role = 'owner';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'An organization must always have an owner';
    END IF;
  END IF;

  DELETE FROM organization_members
  WHERE organization_id = org_id AND user_id = target_user_id;

  -- Leaving a stale event_team row would keep granting event access that
  -- can_manage_event only happens to refuse because it re-checks membership.
  DELETE FROM event_team t
  USING events e
  WHERE t.event_id = e.id
    AND e.organization_id = org_id
    AND t.user_id = target_user_id;
END;
$$;

-- ============================================================================
-- Archive / restore — the replacement for deletion
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_organization_archived(org_id uuid, archived boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_org_authority(org_id, 'owner');

  UPDATE organizations
  SET archived_at = CASE WHEN archived THEN now() ELSE NULL END,
      updated_at  = now()
  WHERE id = org_id;
END;
$$;

-- ============================================================================
-- Accepting an invitation must also check account standing
--
-- Phase A's version verified the invitation but not the invitee's account. An
-- organizer suspended or still awaiting approval could accept an invitation
-- sent earlier and hold organization authority, which is exactly what approval
-- is supposed to gate. The rest of the function is unchanged.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_role org_role;
  v_invited_by uuid;
BEGIN
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active yet, so it cannot join an organization';
  END IF;

  SELECT i.organization_id, i.role, i.invited_by
    INTO v_org_id, v_role, v_invited_by
  FROM organization_invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.id = invitation_id
    AND i.invited_user_id = auth.uid()
    AND i.status = 'pending'
    AND o.archived_at IS NULL;

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

-- ============================================================================
-- Creating an organization
--
-- Phase A allowed this as a plain INSERT, and the policy that guards it is
-- still in place as defence in depth. The UI goes through this function
-- instead, for a reason that only shows up at runtime: `handle_new_organization`
-- adds the creator's membership row in an AFTER ROW trigger, which Postgres
-- queues until the end of the statement, while the SELECT policy applied to
-- `INSERT ... RETURNING` is evaluated during it. The caller is therefore not
-- yet a member when the returned row is filtered, so the row comes back empty
-- even though the insert succeeded. Returning just the id from a definer
-- function sidesteps that ordering entirely.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_organizer_organization(
  org_name text,
  org_description text DEFAULT '',
  org_website text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := btrim(org_name);
  v_website text := btrim(COALESCE(org_website, ''));
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_account_type() <> 'organizer' THEN
    RAISE EXCEPTION 'Only an organizer account may create an organization';
  END IF;

  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your organizer account is awaiting approval';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Enter a name for your organization';
  END IF;

  IF v_website <> '' AND v_website !~* '^https?://' THEN
    RAISE EXCEPTION 'A website must start with http:// or https://';
  END IF;

  INSERT INTO organizations (name, description, website, org_type, created_by)
  VALUES (v_name, COALESCE(org_description, ''), v_website, 'organizer', auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- Managing an organization requires a standing account, not just a role
--
-- `update_organization_as_admin` checks membership only, so an organizer whose
-- account is later suspended keeps write access to the organization profile
-- through their existing membership row. Approval has to be revocable to mean
-- anything.
-- ============================================================================
DROP POLICY IF EXISTS "update_organization_as_admin" ON organizations;
CREATE POLICY "update_organization_as_admin"
  ON organizations FOR UPDATE
  TO authenticated
  USING (public.is_org_admin(id) AND public.account_is_active())
  WITH CHECK (public.is_org_admin(id) AND public.account_is_active());

-- ============================================================================
-- Grants: authenticated only, never anon
--
-- Supabase's default privileges grant EXECUTE on new public-schema functions to
-- both anon and authenticated, and revoking PUBLIC does not remove those direct
-- grants. Each function is revoked from all three and granted back explicitly.
--
-- require_org_authority is not granted to anyone: it is an internal guard, and
-- exposing it would hand out a membership oracle for arbitrary organization ids.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.require_org_authority(uuid, org_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_member_directory(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_invitation_list(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_pending_organization_invitations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, org_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_organization_member_role(uuid, uuid, org_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_organization_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_organization_archived(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_organizer_organization(text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.organization_member_directory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organizer_organization(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_invitation_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pending_organization_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_member_role(uuid, uuid, org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_archived(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) TO authenticated;
