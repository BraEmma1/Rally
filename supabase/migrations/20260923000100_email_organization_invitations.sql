/*
# Organization invitations by email

Until now `organization_invitations.invited_user_id` was NOT NULL, so you could
only invite someone who had already signed up — the v1 decision. The identity
of an invitation becomes the email address instead, which is the only thing the
inviter actually knows.

## The email is the identity
`invited_email` is now NOT NULL and normalized to lower(btrim(...)) on the way
in. `invited_user_id` becomes nullable and is only a convenience: it is
resolved at invite time when an account happens to exist, and it is not what
acceptance is checked against.

## Why acceptance checks a *confirmed* email
Matching on the authenticated user's email is what stops another Rally user
claiming someone else's invitation. That check is only worth anything if the
address has been proven: without the confirmation requirement, anyone could
sign up as finance-director@bigcorp.example and accept an invitation meant for
them. Acceptance therefore requires `email_confirmed_at IS NOT NULL`.

This is also why no account is created when an invitation is sent. Creating one
would mean Rally asserting an identity nobody has proven.

## Expiry
`expires_at` defaults to 30 days. Existing rows are backfilled from their
created_at so none of them expire retroactively. Revocation via status
'revoked' is unchanged.

## Account type is NOT changed by accepting
`enforce_member_account_type` still requires the accepting account's type to
suit the organization, and an attendee is refused outright — accepting an
invitation must never quietly turn someone's attendee account into an
organizer one.

One narrow exception, and it is a real authorization decision: an *organizer*
account still in `pending_approval` is activated by accepting. Organizer
signups await a platform admin because nobody has vouched for them; an owner or
admin of an existing organization inviting them by name is exactly that
vouching. It is recorded in account_type_changes with the inviting organization
in the reason, so it is auditable. Attendee, vendor and sponsor accounts are
never activated this way. If you would rather these invitees also wait for a
platform admin, delete the activation block and acceptance will simply fail
until they are approved.
*/

-- ============================================================================
-- Schema: the email is the identity
-- ============================================================================
ALTER TABLE organization_invitations
  ALTER COLUMN invited_user_id DROP NOT NULL;

-- Backfill addresses for the rows that predate this change, then require one.
UPDATE organization_invitations i
SET invited_email = lower(btrim(u.email))
FROM auth.users u
WHERE u.id = i.invited_user_id
  AND (i.invited_email IS NULL OR btrim(i.invited_email) = '');

DELETE FROM organization_invitations
WHERE invited_email IS NULL OR btrim(invited_email) = '';

ALTER TABLE organization_invitations
  ALTER COLUMN invited_email SET NOT NULL;

ALTER TABLE organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_email_format;
ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_email_format
  CHECK (invited_email = lower(btrim(invited_email))
         AND invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE organization_invitations
SET expires_at = COALESCE(created_at, now()) + interval '30 days'
WHERE expires_at IS NULL;

ALTER TABLE organization_invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');
ALTER TABLE organization_invitations
  ALTER COLUMN expires_at SET NOT NULL;

-- At most one *live* invitation per organization per address. Answered ones
-- (accepted / declined / revoked) are history and may accumulate.
DROP INDEX IF EXISTS organization_invitations_unique_pending_email;
CREATE UNIQUE INDEX organization_invitations_unique_pending_email
  ON organization_invitations (organization_id, invited_email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_invitations_email
  ON organization_invitations (invited_email, status);

-- ============================================================================
-- Invite by email, account or no account
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

  -- Resolve an account if one exists. Not finding one is fine: the invitation
  -- is addressed to the email, and they can sign up afterwards.
  SELECT u.id, a.account_type INTO v_target, v_account
  FROM auth.users u
  LEFT JOIN user_accounts a ON a.user_id = u.id
  WHERE lower(u.email) = v_email;

  -- If an account does exist, it has to be one that could ever hold this
  -- membership. Saying so now beats a confusing failure at accept time.
  IF v_target IS NOT NULL AND v_account IS NOT NULL
     AND v_account::text <> v_org_type::text THEN
    RAISE EXCEPTION 'That email belongs to a % account, which cannot join a % organization', v_account, v_org_type;
  END IF;

  IF v_target IS NOT NULL AND EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = org_id AND m.user_id = v_target
  ) THEN
    RAISE EXCEPTION 'That person is already on the team';
  END IF;

  -- Re-inviting an address that has a live invitation refreshes it rather than
  -- failing on the partial unique index, and re-inviting after a decline or a
  -- revocation opens a new one.
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

-- ============================================================================
-- The caller's proven address
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_confirmed_email()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT lower(btrim(u.email))
  FROM auth.users u
  WHERE u.id = auth.uid()
    AND u.email_confirmed_at IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_confirmed_email() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Accept: the address must be yours, and proven
-- ============================================================================
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
    -- The whole point: the invitation belongs to an address, and this must be
    -- that address. A different Rally user cannot claim it.
    AND i.invited_email = v_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation for this account';
  END IF;

  SELECT a.account_type, a.status INTO v_account, v_status
  FROM user_accounts a WHERE a.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Your account is not set up yet';
  END IF;

  IF v_account::text <> v_org_type::text THEN
    RAISE EXCEPTION 'A % account cannot join a % organization. Accepting an invitation does not change your account type.', v_account, v_org_type;
  END IF;

  -- See the header: being invited by an existing organization is the vouching
  -- that organizer approval waits for. Audited, and only for organizers.
  IF v_status = 'pending_approval' AND v_account = 'organizer' THEN
    UPDATE user_accounts
       SET status     = 'active',
           updated_at = now()
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

CREATE OR REPLACE FUNCTION public.decline_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := public.current_user_confirmed_email();
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirm your email address before responding to an invitation';
  END IF;

  UPDATE organization_invitations
  SET status       = 'declined',
      responded_at = now()
  WHERE id = invitation_id
    AND status = 'pending'
    AND invited_email = v_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation for this account';
  END IF;
END;
$$;

-- ============================================================================
-- What is waiting for me, found by address
-- ============================================================================
-- Return columns change (expires_at is new), so the old signature must go
-- first: CREATE OR REPLACE cannot alter a function's OUT parameters.
DROP FUNCTION IF EXISTS public.my_pending_organization_invitations();
CREATE FUNCTION public.my_pending_organization_invitations()
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_type org_type,
  role org_role,
  created_at timestamptz,
  expires_at timestamptz,
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
    i.expires_at,
    COALESCE(p.full_name, '')
  FROM organization_invitations i
  JOIN organizations o ON o.id = i.organization_id
  LEFT JOIN profiles p ON p.id = i.invited_by
  WHERE i.status = 'pending'
    AND i.expires_at > now()
    AND o.archived_at IS NULL
    AND i.invited_email = public.current_user_confirmed_email()
  ORDER BY i.created_at DESC;
$$;

-- The invitee may not be a Rally user, so the row's own address is what the
-- team screen shows; the joined profile is a nicety when an account exists.
DROP FUNCTION IF EXISTS public.organization_invitation_list(uuid);
CREATE FUNCTION public.organization_invitation_list(org_id uuid)
RETURNS TABLE (
  id uuid,
  invited_user_id uuid,
  invited_email text,
  role org_role,
  status text,
  created_at timestamptz,
  responded_at timestamptz,
  expires_at timestamptz,
  has_account boolean,
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
    i.invited_email,
    i.role,
    CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
    i.created_at,
    i.responded_at,
    i.expires_at,
    (i.invited_user_id IS NOT NULL) AS has_account,
    COALESCE(p.full_name, '') AS full_name
  FROM organization_invitations i
  LEFT JOIN profiles p ON p.id = i.invited_user_id
  WHERE i.organization_id = org_id
  ORDER BY
    CASE WHEN i.status = 'pending' AND i.expires_at > now() THEN 0 ELSE 1 END,
    i.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, org_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decline_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_pending_organization_invitations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_invitation_list(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_organization_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pending_organization_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_invitation_list(uuid) TO authenticated;
