/*
# Attendees may join organization teams

Corrects the rule that an organization member must be an organizer account.
Someone can join Rally as an attendee, start working with an organization
later, and be invited onto its team — without their account becoming something
else.

## The rule that replaces it
`account_type_may_join_org` is now the single definition of who may hold an
organization membership row:

  - platform_admin — never. Platform authority and organization authority are
    separate, and an invitation must not be a route to either.
  - attendee — any organization. They keep account_type = 'attendee'; what they
    may do inside the organization is decided by their org_role, exactly like
    every other member.
  - organizer / vendor / sponsor — only an organization of the matching type,
    unchanged.

Four places assumed member == organizer and have been corrected:

1. `enforce_member_account_type` — the trigger that rejected attendees outright.
2. `require_org_authority` — required current_account_type() = 'organizer', so
   an attendee admin of an organization could not have used any team or event
   RPC.
3. `insert_organization_event` — required the creator to be an organizer
   account, so an attendee acting as organization admin could not create the
   organization's events. Membership already guarantees a permitted account
   type via the trigger, so `is_org_admin` plus an active account is the whole
   test.
4. `invite_organization_member` / `accept_organization_invitation` — refused
   attendees at both ends.

## What is deliberately NOT changed
- `create_organizer_organization` and `insert_organization_as_organizer` still
  require an organizer account. Joining someone else's organization is not the
  same as founding one, and the decision that attendees do not own
  organizations stands.
- Accepting an invitation still never changes account_type. The one status
  change that exists — activating an organizer who was awaiting approval —
  applies only to organizer accounts and is audited. An attendee's account is
  untouched by accepting.
- Email matching against a *confirmed* address, normalization, expiry and
  revocation are all unchanged.
*/

-- ============================================================================
-- Who may hold an organization membership
-- ============================================================================
CREATE OR REPLACE FUNCTION public.account_type_may_join_org(
  a account_type,
  o org_type
)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    -- Platform authority is not an organization role, and an invitation must
    -- never be a way to acquire or exercise it.
    WHEN a = 'platform_admin' THEN false
    -- An attendee joins as a person. Their org_role decides what they can do
    -- inside the organization; their account type is unaffected.
    WHEN a = 'attendee' THEN true
    -- A vendor belongs on a vendor organization, a sponsor on a sponsor one.
    ELSE a::text = o::text
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.account_type_may_join_org(account_type, org_type) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 1. The membership trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_member_account_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_account account_type;
  v_org org_type;
BEGIN
  SELECT a.account_type INTO v_account FROM user_accounts a WHERE a.user_id = NEW.user_id;
  SELECT o.org_type INTO v_org FROM organizations o WHERE o.id = NEW.organization_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'User has no account record and cannot join an organization';
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'That organization does not exist';
  END IF;

  IF NOT public.account_type_may_join_org(v_account, v_org) THEN
    IF v_account = 'platform_admin' THEN
      RAISE EXCEPTION 'A platform administrator account cannot be a member of an organization';
    END IF;
    RAISE EXCEPTION 'A % account cannot join a % organization', v_account, v_org;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_member_account_type() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. Organization authority comes from membership, not from account type
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

  -- A suspended or unapproved account holds no authority anywhere, whatever
  -- membership rows it has. Account *type* is no longer part of this test:
  -- membership is, and the trigger above already decided who may hold one.
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  SELECT m.role INTO v_role
  FROM organization_members m
  WHERE m.organization_id = org_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this organization';
  END IF;

  IF minimum = 'owner' AND v_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may do that';
  END IF;

  IF minimum = 'admin' AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or admin may do that';
  END IF;

  RETURN v_role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.require_org_authority(uuid, org_role) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. Creating an event is an organization-role act
--
-- Membership already guarantees a permitted account type, so requiring the
-- creator to be an organizer *account* only excluded attendee admins from
-- doing the job their org_role gives them.
-- ============================================================================
DROP POLICY IF EXISTS "insert_organization_event" ON events;
CREATE POLICY "insert_organization_event"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND created_by = auth.uid()
    AND public.account_is_active()
    AND public.is_org_admin(organization_id)
  );

-- ============================================================================
-- 4. Invitation: invite and accept
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
  v_account account_type;
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

  IF v_email = lower(btrim((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))) THEN
    RAISE EXCEPTION 'You are already a member of this organization';
  END IF;

  SELECT u.id, a.account_type INTO v_target, v_account
  FROM auth.users u
  LEFT JOIN user_accounts a ON a.user_id = u.id
  WHERE lower(u.email) = v_email;

  -- Attendees now pass this; only a genuinely incompatible account is refused,
  -- and saying so at invite time beats a confusing failure at accept time.
  IF v_target IS NOT NULL AND v_account IS NOT NULL
     AND NOT public.account_type_may_join_org(v_account, v_org_type) THEN
    IF v_account = 'platform_admin' THEN
      RAISE EXCEPTION 'A platform administrator account cannot join an organization';
    END IF;
    RAISE EXCEPTION 'That email belongs to a % account, which cannot join a % organization', v_account, v_org_type;
  END IF;

  IF v_target IS NOT NULL AND EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = org_id AND m.user_id = v_target
  ) THEN
    RAISE EXCEPTION 'That person is already on the team';
  END IF;

  UPDATE organization_invitations
     SET role            = invitee_role,
         invited_user_id = v_target,
         invited_by      = auth.uid(),
         status          = 'pending',
         created_at      = now(),
         responded_at    = NULL,
         expires_at      = now() + interval '30 days'
   WHERE organization_id = org_id
     AND invited_email = v_email
     AND status = 'pending'
  RETURNING id INTO v_invitation_id;

  IF v_invitation_id IS NOT NULL THEN
    RETURN v_invitation_id;
  END IF;

  INSERT INTO organization_invitations
    (organization_id, invited_user_id, invited_email, role, status, invited_by, expires_at)
  VALUES
    (org_id, v_target, v_email, invitee_role, 'pending', auth.uid(), now() + interval '30 days')
  RETURNING id INTO v_invitation_id;

  RETURN v_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := public.current_user_confirmed_email();
  v_org_id uuid;
  v_role org_role;
  v_invited_by uuid;
  v_org_type org_type;
  v_org_name text;
  v_account account_type;
  v_status account_status;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirm your email address before accepting an invitation';
  END IF;

  SELECT i.organization_id, i.role, i.invited_by, o.org_type, o.name
    INTO v_org_id, v_role, v_invited_by, v_org_type, v_org_name
  FROM organization_invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.id = invitation_id
    AND i.status = 'pending'
    AND i.expires_at > now()
    AND o.archived_at IS NULL
    -- Still the load-bearing check: the invitation belongs to an address, and
    -- this must be that address, proven.
    AND i.invited_email = v_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation for this account';
  END IF;

  SELECT a.account_type, a.status INTO v_account, v_status
  FROM user_accounts a WHERE a.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Your account is not set up yet';
  END IF;

  IF NOT public.account_type_may_join_org(v_account, v_org_type) THEN
    IF v_account = 'platform_admin' THEN
      RAISE EXCEPTION 'A platform administrator account cannot join an organization';
    END IF;
    RAISE EXCEPTION 'A % account cannot join a % organization', v_account, v_org_type;
  END IF;

  -- The only status change acceptance can cause, and only for organizers: an
  -- organizer awaiting approval has now been vouched for by an existing
  -- organization. An attendee is already active and is never touched here —
  -- their account type and status come out of this unchanged.
  IF v_status = 'pending_approval' AND v_account = 'organizer' THEN
    UPDATE user_accounts
       SET status = 'active', updated_at = now()
     WHERE user_id = auth.uid();

    INSERT INTO account_type_changes
      (user_id, changed_by, previous_type, new_type, previous_status, new_status, reason)
    VALUES
      (auth.uid(), v_invited_by, v_account, v_account, v_status, 'active',
       'Activated by accepting an organization invitation from ' || v_org_name);

    v_status := 'active';
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active, so it cannot join an organization';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role, invited_by)
  VALUES (v_org_id, auth.uid(), v_role, v_invited_by)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_invitations
  SET status          = 'accepted',
      responded_at    = now(),
      invited_user_id = auth.uid()
  WHERE id = invitation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, org_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) TO authenticated;
