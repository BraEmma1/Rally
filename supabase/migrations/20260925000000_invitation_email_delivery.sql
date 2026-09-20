/*
# Organization invitation email delivery

## There was no email mechanism to reuse
Rally had no configured email provider: no Edge Functions, no SMTP settings in
the repo, no provider SDK. The only mail it sends is Supabase Auth's own
transactional email (confirmation, recovery), which GoTrue composes and cannot
be used to send an arbitrary message. Supabase's `inviteUserByEmail` admin API
can send an invite, but it *creates a user account* as a side effect, which the
requirements forbid outright.

So transport is new. It is a Supabase Edge Function using Resend, which is the
provider Supabase documents for this; swapping it means changing one fetch call
in the function and one secret.

## Why an outbox rather than sending from the invite RPC
`invite_organization_member` runs inside the caller's transaction. Sending from
there would mean either holding a database transaction open across a network
call to a third party, or sending mail for an invitation that later rolls back.
Neither is acceptable.

Instead a trigger records a row here when an invitation becomes pending, in the
same transaction as the invitation itself. The Edge Function drains the queue
afterwards. That gives the properties the requirements ask for:

  - a send failure is recorded on the queue row, never reported as success;
  - the invitation row is untouched by a delivery failure and stays valid;
  - a retry is a new attempt on the same invitation, not a new invitation.

## What is in the email
Organization name, role, expiry date and a link. No ids beyond the invitation's
own, no addresses of other people, nothing about the database. Possessing the
link grants nothing on its own: acceptance still requires a signed-in session
whose *confirmed* email matches invited_email, which is enforced in
`accept_organization_invitation` and is not weakened here.
*/

CREATE TABLE IF NOT EXISTS organization_invitation_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES organization_invitations(id) ON DELETE CASCADE,
  -- Captured at queue time. If the invitation is later re-addressed, the
  -- historical row still records where mail was actually sent.
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  provider_message_id text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT invitation_email_status_allowed
    CHECK (status IN ('queued', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_invitation_emails_pending
  ON organization_invitation_emails (queued_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_invitation_emails_invitation
  ON organization_invitation_emails (invitation_id, queued_at DESC);

ALTER TABLE organization_invitation_emails ENABLE ROW LEVEL SECURITY;

-- Owners and admins of the organization may see whether their invitation was
-- delivered. Nobody writes through the client: the trigger and the Edge
-- Function (service role) are the only writers.
DROP POLICY IF EXISTS "read_invitation_emails_as_admin" ON organization_invitation_emails;
CREATE POLICY "read_invitation_emails_as_admin"
  ON organization_invitation_emails FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_invitations i
      WHERE i.id = invitation_id
        AND public.is_org_admin(i.organization_id)
    )
  );

REVOKE ALL ON public.organization_invitation_emails FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.organization_invitation_emails FROM authenticated;

-- ============================================================================
-- Queue a send when an invitation becomes pending
--
-- Fires on creation and on the refresh that re-inviting performs, and on
-- nothing else: answering, revoking or expiring an invitation must not send
-- mail.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.queue_organization_invitation_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pending'
     AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at THEN
    -- A pending row touched without being re-issued (for example
    -- invited_user_id being filled in) is not a reason to send again.
    RETURN NEW;
  END IF;

  INSERT INTO organization_invitation_emails (invitation_id, recipient_email)
  VALUES (NEW.id, NEW.invited_email);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_organization_invitation_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_invitation_pending_queue_email ON organization_invitations;
CREATE TRIGGER on_invitation_pending_queue_email
  AFTER INSERT OR UPDATE ON organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.queue_organization_invitation_email();

-- ============================================================================
-- Resend
--
-- Uses the existing invitation record: a resend is another attempt, never a
-- new invitation, so the partial unique index on pending rows is untouched and
-- no duplicate can appear. Expired and revoked invitations are refused, which
-- is what stops resend becoming a way to revive them.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resend_organization_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_email text;
  v_status text;
  v_expires timestamptz;
  v_role org_role;
  v_caller_role org_role;
  v_recent int;
BEGIN
  SELECT i.organization_id, i.invited_email, i.status, i.expires_at, i.role
    INTO v_org, v_email, v_status, v_expires, v_role
  FROM organization_invitations i
  WHERE i.id = invitation_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No such invitation';
  END IF;

  -- Same authority as issuing one, including the owner-only rule for owner
  -- invitations: resending is re-sending an offer of that role.
  v_caller_role := public.require_org_authority(v_org, 'admin');

  IF v_role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the organization owner may resend an owner invitation';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation is % and cannot be resent', v_status;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'That invitation has expired. Invite them again to issue a new one.';
  END IF;

  -- A send is a message to somebody else's inbox. Without a limit, the resend
  -- button is a way to use Rally to repeatedly mail an address the sender does
  -- not control.
  SELECT count(*) INTO v_recent
  FROM organization_invitation_emails e
  WHERE e.invitation_id = resend_organization_invitation.invitation_id
    AND e.queued_at > now() - interval '5 minutes';

  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'That invitation has just been sent several times. Wait a few minutes before trying again.';
  END IF;

  INSERT INTO organization_invitation_emails (invitation_id, recipient_email)
  VALUES (invitation_id, v_email);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resend_organization_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_organization_invitation(uuid) TO authenticated;

-- ============================================================================
-- Delivery status, for the team screen
-- ============================================================================
CREATE OR REPLACE FUNCTION public.invitation_delivery_status(invitation_id uuid)
RETURNS TABLE (
  status text,
  attempts integer,
  last_error text,
  queued_at timestamptz,
  sent_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT i.organization_id INTO v_org
  FROM organization_invitations i WHERE i.id = invitation_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No such invitation';
  END IF;

  PERFORM public.require_org_authority(v_org, 'admin');

  RETURN QUERY
  SELECT e.status, e.attempts, e.last_error, e.queued_at, e.sent_at
  FROM organization_invitation_emails e
  WHERE e.invitation_id = invitation_delivery_status.invitation_id
  ORDER BY e.queued_at DESC
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invitation_delivery_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_delivery_status(uuid) TO authenticated;
