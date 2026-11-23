/* BUG-1: allow reinvitation after revocation or expiry.
   Preserve the currently deployed invite_organization_member authorization
   behavior (including attendee membership compatibility) and all grants.
   Keep the pending-email uniqueness index and historical rows. Concurrent
   attempts cannot produce two pending invitations because of the index. */
ALTER TABLE public.organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_organization_id_invited_user_id_key;

CREATE OR REPLACE FUNCTION public.invite_organization_member(org_id uuid, invitee_email text, invitee_role org_role DEFAULT 'manager'::org_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Retire expired pending links without reopening old bearer tokens.
  UPDATE public.organization_invitations
     SET status = 'revoked', responded_at = now()
   WHERE organization_id = org_id
     AND invited_email = v_email
     AND status = 'pending'
     AND expires_at <= now();

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
$function$
;
