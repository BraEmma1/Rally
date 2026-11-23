/* BUG-1: historical invitation uniqueness must not block a fresh invitation.
   The existing partial unique index on pending organization/email preserves the
   single-live-invitation invariant. UUID primary key remains unique.
   Prevent expired invitation reactivation and serialize same-address invites.
   Keep old accepted/revoked/expired rows for audit. */
ALTER TABLE public.organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_organization_id_invited_user_id_key;

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

  -- Serialize invitations per organization/address to prevent duplicate pending
  -- rows during concurrent invitation attempts.
  PERFORM pg_advisory_xact_lock(hashtextextended(org_id::text || ':' || v_email, 0));

  -- An expired invitation must stay invalid forever. Retire its pending status
  -- before creating a fresh invitation with a new ID and expiry.
  UPDATE public.organization_invitations
  SET status = 'revoked', responded_at = now()
  WHERE organization_id = org_id AND invited_email = v_email
    AND status = 'pending' AND expires_at <= now();

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
     AND expires_at > now()
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


