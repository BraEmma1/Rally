/*
# Event partnerships phase 3A: invitations and sponsor onboarding

One new table, one outbox, one helper, thirteen functions, and three narrow
amendments to phase 1.

## The capability this unlocks
The architecture audit found that **no sponsor organization can be created
through any client path**: `organizations`' INSERT policy is
`created_by = auth.uid() AND org_type = 'organizer' AND
current_account_type() = 'organizer' AND account_is_active()`. That policy is
left exactly as it is. Instead, a valid partnership invitation authorizes one
narrow SECURITY DEFINER function to create a `sponsor` organization on the
accepting user's behalf.

## Account types are not touched
An invited representative signs up normally, so `handle_new_user` gives them
`attendee` / `active` -- and that is what they stay. Sponsor authority comes
from `organization_members`, which is already legal:
`account_type_may_join_org('attendee', 'sponsor')` returns true. Nothing here
calls `set_account_type`, and `handle_new_user` is unchanged, so public signup
still cannot produce a `sponsor` account.

## What is reused rather than rebuilt
- `current_user_confirmed_email()` for email ownership, exactly as
  `accept_organization_invitation` does.
- `handle_new_organization`, which already creates the owner membership from
  `COALESCE(created_by, auth.uid())` -- so the new organization's owner row is
  not written here at all.
- `enforce_member_account_type`, left in force, so the attendee/sponsor
  compatibility rule is checked by the same trigger as everywhere else.
- The outbox shape: a queue table, a trigger that enqueues on pending, and the
  existing Edge Function draining it with the service role.
- The resend contract: re-queue the *same* invitation with a rate limit, which
  is what `resend_organization_invitation` does.

## Why a separate outbox instead of a generic one
`organization_invitation_emails` is joined by the Edge Function to
`organization_invitations -> organizations(name)`, and its row shape is baked
into that query. Making it generic would mean rewriting the working path that
already delivers organization invitations. A second table with the same shape
lets the Edge Function keep its existing query untouched and add a second
drain pass, which is the smaller change and cannot make the existing flow
fragile.
*/

-- ============================================================================
-- event_partnership_invitations
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id uuid NOT NULL,
  event_id uuid NOT NULL,

  invited_email text NOT NULL,
  invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'pending',
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,

  CONSTRAINT event_partnership_invitations_status_allowed CHECK (
    status IN ('pending', 'accepted', 'declined', 'revoked')
  ),
  -- Normalized by the RPC; asserted here so no other path can bypass it. The
  -- pattern matches organization_invitations.
  CONSTRAINT event_partnership_invitations_email_normalized CHECK (
    invited_email = lower(btrim(invited_email))
    AND invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND length(invited_email) <= 320
  ),
  CONSTRAINT event_partnership_invitations_partnership_fk
    FOREIGN KEY (partnership_id, event_id)
    REFERENCES event_partnerships (id, event_id) ON DELETE CASCADE
);

-- V1 is one representative per partnership, so one live invitation at a time.
-- This is also what makes revoke deterministic: there is never a second
-- pending invitation to reason about.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_invitations_one_pending
  ON event_partnership_invitations (partnership_id) WHERE status = 'pending';

-- The invitee's own lookup, by confirmed email.
CREATE INDEX IF NOT EXISTS idx_partnership_invitations_email
  ON event_partnership_invitations (invited_email, status);
-- The organizer's list for one partnership.
CREATE INDEX IF NOT EXISTS idx_partnership_invitations_partnership
  ON event_partnership_invitations (partnership_id, created_at DESC);

ALTER TABLE event_partnership_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_partnership_invitations FROM anon;
REVOKE TRUNCATE ON public.event_partnership_invitations FROM anon, authenticated;

-- Organizers manage; the invitee reads their own through an RPC rather than a
-- policy, so that nothing about other invitations is reachable by guessing.
-- All client writes go through the functions below.
DROP POLICY IF EXISTS "read_event_partnership_invitations" ON event_partnership_invitations;
CREATE POLICY "read_event_partnership_invitations"
  ON event_partnership_invitations FOR SELECT TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

REVOKE INSERT, UPDATE, DELETE ON public.event_partnership_invitations FROM authenticated;

-- ============================================================================
-- Outbox
--
-- Same columns as organization_invitation_emails, so the Edge Function's
-- second drain pass is the first one with a different table name.
-- The browser can never write here: no grants at all, and the only writer is
-- the trigger below plus the resend function, both of which read the
-- recipient from the authoritative invitation row rather than an argument.
-- ============================================================================
CREATE TABLE IF NOT EXISTS partnership_invitation_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES event_partnership_invitations(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  provider_message_id text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT partnership_invitation_emails_status_allowed CHECK (
    status IN ('queued', 'sent', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_partnership_invitation_emails_queue
  ON partnership_invitation_emails (status, queued_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_partnership_invitation_emails_invitation
  ON partnership_invitation_emails (invitation_id, queued_at DESC);

ALTER TABLE partnership_invitation_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partnership_invitation_emails FROM anon, authenticated;
-- No policy of any kind: service_role bypasses RLS, and nothing else may read
-- or write a queue of other people's email addresses. Delivery status reaches
-- the organizer through a function instead.

CREATE OR REPLACE FUNCTION public.queue_partnership_invitation_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- On update, only a genuine re-issue (created_at moved) enqueues again, so
  -- an unrelated edit to a pending invitation does not send a second email.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pending'
     AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO partnership_invitation_emails (invitation_id, recipient_email)
  VALUES (NEW.id, NEW.invited_email);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_partnership_invitation_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_partnership_invitation_pending_queue_email ON event_partnership_invitations;
CREATE TRIGGER on_partnership_invitation_pending_queue_email
  AFTER INSERT OR UPDATE ON event_partnership_invitations
  FOR EACH ROW EXECUTE FUNCTION public.queue_partnership_invitation_email();

-- ============================================================================
-- Phase 1 amendment 1: the sponsor organization link
--
-- Phase 1 rejected any non-NULL sponsor_organization_id outright, because
-- there was no way to verify such a claim. There is now exactly one: accepting
-- an invitation whose email you have proven you own. That path announces
-- itself with a GUC the client cannot set, the same escape-hatch pattern
-- `enforce_organization_immutable_fields` already uses.
--
-- Once set, the link is immutable. An organizer cannot swap Acme Bank for
-- another organization by supplying a different uuid, and cannot clear it.
-- Correcting a wrong link is deliberately left to a future administrative
-- flow rather than made ordinarily editable.
--
-- The same gate owns acknowledged_at, which phase 1 froze.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_partnership_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  -- COALESCE is load-bearing: current_setting(name, true) returns NULL when
  -- the setting has never been set, and NULL = 'on' is NULL, not false. A NULL
  -- flag makes every `IF NOT v_privileged` below a no-op, which would leave
  -- the sponsor-link guard and the acknowledged_at freeze silently inert.
  v_privileged boolean :=
    COALESCE(current_setting('rally.allow_partnership_link', true) = 'on', false);
BEGIN
  IF NEW.representative_email IS NOT NULL THEN
    NEW.representative_email := lower(btrim(NEW.representative_email));
    IF NEW.representative_email = '' THEN
      NEW.representative_email := NULL;
    END IF;
  END IF;

  IF NEW.value_currency IS NOT NULL THEN
    NEW.value_currency := upper(btrim(NEW.value_currency));
    IF NEW.value_currency = '' THEN
      NEW.value_currency := NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.status := 'draft';
    NEW.acknowledged_at := NULL;
    -- A partnership is never born linked: the link is earned by acceptance.
    IF NEW.sponsor_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'A sponsor organization is linked by accepting an invitation, not when the partnership is created';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A partnership cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a partnership cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();

    -- acknowledged_at and the organization link belong to the acceptance path.
    IF NOT v_privileged THEN
      NEW.acknowledged_at := OLD.acknowledged_at;
    END IF;

    IF NEW.sponsor_organization_id IS DISTINCT FROM OLD.sponsor_organization_id THEN
      IF OLD.sponsor_organization_id IS NOT NULL THEN
        RAISE EXCEPTION 'The sponsor organization on an accepted partnership cannot be changed';
      END IF;
      IF NOT v_privileged THEN
        RAISE EXCEPTION 'A sponsor organization is linked by accepting an invitation';
      END IF;
    END IF;

    -- The live invitation and the representative of record must not disagree.
    -- Only a change that WOULD disagree is refused -- invite_partnership_
    -- representative records the address it has just invited, and that always
    -- matches, so it is not caught by its own rule.
    IF NEW.representative_email IS DISTINCT FROM OLD.representative_email
       AND EXISTS (
         SELECT 1 FROM event_partnership_invitations i
         WHERE i.partnership_id = NEW.id
           AND i.status = 'pending'
           AND i.invited_email IS DISTINCT FROM NEW.representative_email
       ) THEN
      RAISE EXCEPTION 'Revoke the pending invitation before changing the representative';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
           (OLD.status = 'draft'     AND NEW.status IN ('invited', 'cancelled'))
        OR (OLD.status = 'invited'   AND NEW.status IN ('active', 'draft', 'cancelled'))
        OR (OLD.status = 'active'    AND NEW.status IN ('completed', 'cancelled'))
        OR (OLD.status = 'completed' AND NEW.status IN ('active'))
        OR (OLD.status = 'cancelled' AND NEW.status IN ('draft'))
      ) THEN
        RAISE EXCEPTION 'A partnership cannot go from % to %', OLD.status, NEW.status;
      END IF;
    END IF;
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_partnership_rules() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Phase 1 amendment 2: cancelling a partnership retires its invitation
--
-- Deterministic beats defensive. Rather than leaving a pending invitation that
-- acceptance would later refuse, cancelling revokes it immediately, so the
-- invitee sees it disappear instead of hitting an error.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.retire_partnership_invitations_on_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    UPDATE event_partnership_invitations
       SET status = 'revoked', responded_at = now()
     WHERE partnership_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.retire_partnership_invitations_on_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_partnership_cancelled_retire_invitations ON event_partnerships;
CREATE TRIGGER on_partnership_cancelled_retire_invitations
  AFTER UPDATE OF status ON event_partnerships
  FOR EACH ROW EXECUTE FUNCTION public.retire_partnership_invitations_on_cancel();

-- ============================================================================
-- Phase 1 amendment 3: sponsor-side read authority
--
-- A definer helper, deliberately: a sponsor member has no SELECT on
-- event_partnerships at all, so an invoker subquery would see nothing. This
-- answers one question -- may the caller read this partnership's contents --
-- and is the single place sponsor read authority is defined.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_read_partnership(target_partnership_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_partnerships p
    WHERE p.id = target_partnership_id
      AND (
        public.can_manage_event(p.event_id)
        OR (
          p.sponsor_organization_id IS NOT NULL
          AND public.is_org_member(p.sponsor_organization_id)
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_read_partnership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_partnership(uuid) TO authenticated;

-- The three child tables carry no organizer-only columns, so their SELECT can
-- widen directly. event_partnerships cannot: it holds internal_notes, and a
-- policy grants whole rows, not columns. Sponsors read it through a function
-- with a chosen projection instead.
--
-- Phase 1's single FOR ALL policy is therefore split: SELECT widens, and the
-- write policies stay organizer-only.
DROP POLICY IF EXISTS "manage_event_partnership_roles" ON event_partnership_roles;
DROP POLICY IF EXISTS "read_event_partnership_roles" ON event_partnership_roles;
DROP POLICY IF EXISTS "write_event_partnership_roles" ON event_partnership_roles;
DROP POLICY IF EXISTS "update_event_partnership_roles" ON event_partnership_roles;
DROP POLICY IF EXISTS "delete_event_partnership_roles" ON event_partnership_roles;
CREATE POLICY "read_event_partnership_roles"
  ON event_partnership_roles FOR SELECT TO authenticated
  USING (public.can_read_partnership(partnership_id));
CREATE POLICY "write_event_partnership_roles"
  ON event_partnership_roles FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());
CREATE POLICY "update_event_partnership_roles"
  ON event_partnership_roles FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());
CREATE POLICY "delete_event_partnership_roles"
  ON event_partnership_roles FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "manage_event_partnership_obligations" ON event_partnership_obligations;
DROP POLICY IF EXISTS "read_event_partnership_obligations" ON event_partnership_obligations;
DROP POLICY IF EXISTS "write_event_partnership_obligations" ON event_partnership_obligations;
DROP POLICY IF EXISTS "update_event_partnership_obligations" ON event_partnership_obligations;
DROP POLICY IF EXISTS "delete_event_partnership_obligations" ON event_partnership_obligations;
CREATE POLICY "read_event_partnership_obligations"
  ON event_partnership_obligations FOR SELECT TO authenticated
  USING (public.can_read_partnership(partnership_id));
CREATE POLICY "write_event_partnership_obligations"
  ON event_partnership_obligations FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());
CREATE POLICY "update_event_partnership_obligations"
  ON event_partnership_obligations FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());
CREATE POLICY "delete_event_partnership_obligations"
  ON event_partnership_obligations FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "manage_event_partnership_evidence" ON event_partnership_obligation_evidence;
DROP POLICY IF EXISTS "read_event_partnership_evidence" ON event_partnership_obligation_evidence;
DROP POLICY IF EXISTS "write_event_partnership_evidence" ON event_partnership_obligation_evidence;
DROP POLICY IF EXISTS "update_event_partnership_evidence" ON event_partnership_obligation_evidence;
DROP POLICY IF EXISTS "delete_event_partnership_evidence" ON event_partnership_obligation_evidence;
CREATE POLICY "read_event_partnership_evidence"
  ON event_partnership_obligation_evidence FOR SELECT TO authenticated
  USING (public.can_read_partnership(partnership_id));
CREATE POLICY "write_event_partnership_evidence"
  ON event_partnership_obligation_evidence FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());
CREATE POLICY "update_event_partnership_evidence"
  ON event_partnership_obligation_evidence FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());
CREATE POLICY "delete_event_partnership_evidence"
  ON event_partnership_obligation_evidence FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

-- Private evidence files: a sponsor member of the owning partnership may read
-- their own partnership's objects, and nothing else. The evidence row remains
-- the authorization anchor, so an object nothing points at stays unreadable.
DROP POLICY IF EXISTS "Read partnership assets for managed events" ON storage.objects;
CREATE POLICY "Read partnership assets for managed events"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'partnership-assets'
    AND EXISTS (
      SELECT 1
      FROM public.event_partnership_obligation_evidence ev
      WHERE ev.file_path = storage.objects.name
        AND public.can_read_partnership(ev.partnership_id)
    )
  );

-- ============================================================================
-- Organizer contract
-- ============================================================================

-- Send, or re-issue, the invitation for a partnership. Mirrors
-- invite_organization_member: an existing pending invitation to the same
-- address is re-issued rather than duplicated, which is also what re-queues
-- the email.
CREATE OR REPLACE FUNCTION public.invite_partnership_representative(
  target_partnership_id uuid,
  invitee_email text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_status text;
  v_email text := lower(btrim(COALESCE(invitee_email, '')));
  v_target uuid;
  v_existing record;
  v_id uuid;
BEGIN
  SELECT p.event_id, p.status INTO v_event, v_status
  FROM event_partnerships p WHERE p.id = target_partnership_id;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'No such partnership';
  END IF;

  IF NOT public.can_manage_event(v_event) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  IF EXISTS (SELECT 1 FROM events e WHERE e.id = v_event AND e.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  IF v_status NOT IN ('draft', 'invited') THEN
    RAISE EXCEPTION 'A % partnership cannot be invited. Only a draft can be.', v_status;
  END IF;

  -- The account may not exist yet; that is the normal case and is fine.
  SELECT u.id INTO v_target FROM auth.users u WHERE lower(u.email) = v_email;

  SELECT * INTO v_existing
  FROM event_partnership_invitations i
  WHERE i.partnership_id = target_partnership_id AND i.status = 'pending'
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.invited_email <> v_email THEN
      RAISE EXCEPTION 'This partnership already has a pending invitation to %. Revoke it before inviting someone else.',
        v_existing.invited_email;
    END IF;
    -- Re-issue: moving created_at is what the queue trigger watches for.
    UPDATE event_partnership_invitations
       SET invited_user_id = v_target,
           invited_by      = auth.uid(),
           created_at      = now(),
           expires_at      = now() + interval '30 days',
           responded_at    = NULL
     WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO event_partnership_invitations
      (partnership_id, event_id, invited_email, invited_user_id, invited_by)
    VALUES
      (target_partnership_id, v_event, v_email, v_target, auth.uid())
    RETURNING id INTO v_id;
  END IF;

  -- The representative of record follows the invitation, and the partnership
  -- moves out of draft.
  UPDATE event_partnerships
     SET representative_email = v_email,
         status = CASE WHEN status = 'draft' THEN 'invited' ELSE status END
   WHERE id = target_partnership_id;

  RETURN v_id;
END;
$$;

-- Re-queue the email for a live invitation without re-issuing it. Same rate
-- limit as resend_organization_invitation.
CREATE OR REPLACE FUNCTION public.resend_partnership_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid; v_email text; v_status text; v_expires timestamptz; v_recent int;
BEGIN
  SELECT i.event_id, i.invited_email, i.status, i.expires_at
    INTO v_event, v_email, v_status, v_expires
  FROM event_partnership_invitations i WHERE i.id = invitation_id;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'No such invitation';
  END IF;

  IF NOT public.can_manage_event(v_event) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  IF EXISTS (SELECT 1 FROM events e WHERE e.id = v_event AND e.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation is % and cannot be resent', v_status;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'That invitation has expired. Invite them again to issue a new one.';
  END IF;

  SELECT count(*) INTO v_recent
  FROM partnership_invitation_emails e
  WHERE e.invitation_id = resend_partnership_invitation.invitation_id
    AND e.queued_at > now() - interval '5 minutes';

  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'That invitation has just been sent several times. Wait a few minutes before trying again.';
  END IF;

  INSERT INTO partnership_invitation_emails (invitation_id, recipient_email)
  VALUES (invitation_id, v_email);
END;
$$;

-- Revoke a pending invitation. The partnership keeps every obligation, every
-- piece of evidence and its commercial terms; it simply returns to draft so
-- the organizer can edit it and invite someone else.
CREATE OR REPLACE FUNCTION public.revoke_partnership_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid; v_partnership uuid; v_status text;
BEGIN
  SELECT i.event_id, i.partnership_id, i.status
    INTO v_event, v_partnership, v_status
  FROM event_partnership_invitations i WHERE i.id = invitation_id FOR UPDATE;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'No such invitation';
  END IF;

  IF NOT public.can_manage_event(v_event) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  IF EXISTS (SELECT 1 FROM events e WHERE e.id = v_event AND e.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation is % and cannot be revoked', v_status;
  END IF;

  UPDATE event_partnership_invitations
     SET status = 'revoked', responded_at = now()
   WHERE id = invitation_id;

  -- One pending invitation per partnership is enforced by a unique index, so
  -- revoking the only one always leaves none.
  UPDATE event_partnerships
     SET status = 'draft'
   WHERE id = v_partnership AND status = 'invited';
END;
$$;

-- The organizer's view of a partnership's invitations, newest first, with the
-- delivery state of the most recent email for each.
CREATE OR REPLACE FUNCTION public.list_partnership_invitations(target_partnership_id uuid)
RETURNS TABLE (
  id uuid,
  invited_email text,
  status text,
  invited_user_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  responded_at timestamptz,
  is_expired boolean,
  delivery_status text,
  delivery_attempts integer,
  delivery_last_error text,
  delivery_queued_at timestamptz,
  delivery_sent_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
BEGIN
  SELECT p.event_id INTO v_event FROM event_partnerships p WHERE p.id = target_partnership_id;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'No such partnership';
  END IF;

  IF NOT public.can_manage_event(v_event) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT
    i.id, i.invited_email, i.status, i.invited_user_id,
    i.created_at, i.expires_at, i.responded_at,
    (i.status = 'pending' AND i.expires_at <= now()),
    d.status, d.attempts, d.last_error, d.queued_at, d.sent_at
  FROM event_partnership_invitations i
  LEFT JOIN LATERAL (
    SELECT e.status, e.attempts, e.last_error, e.queued_at, e.sent_at
    FROM partnership_invitation_emails e
    WHERE e.invitation_id = i.id
    ORDER BY e.queued_at DESC
    LIMIT 1
  ) d ON true
  WHERE i.partnership_id = target_partnership_id
  ORDER BY i.created_at DESC;
END;
$$;

-- ============================================================================
-- Invitee contract
--
-- Expiry is evaluated here rather than by a job, matching
-- my_pending_organization_invitations: an expired invitation simply stops
-- being returned and stops being acceptable.
-- ============================================================================

-- What the invitee is being offered. Deliberately NOT the whole partnership:
-- internal_notes and the sponsorship value are withheld until they have
-- accepted, because before acceptance this is an approach, not an agreement.
CREATE OR REPLACE FUNCTION public.my_pending_partnership_invitations()
RETURNS TABLE (
  invitation_id uuid,
  partnership_id uuid,
  event_id uuid,
  event_name text,
  event_start_date date,
  organizer_organization_name text,
  company_name text,
  tier_label text,
  roles text[],
  invited_by_name text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    i.id, p.id, p.event_id, e.name, e.start_date,
    COALESCE(o.name, ''), p.company_name, p.tier_label,
    COALESCE((SELECT array_agg(r.role ORDER BY r.role)
              FROM event_partnership_roles r WHERE r.partnership_id = p.id),
             ARRAY[]::text[]),
    COALESCE(prof.full_name, ''),
    i.created_at, i.expires_at
  FROM event_partnership_invitations i
  JOIN event_partnerships p ON p.id = i.partnership_id
  JOIN events e ON e.id = p.event_id
  LEFT JOIN organizations o ON o.id = e.organization_id
  LEFT JOIN profiles prof ON prof.id = i.invited_by
  WHERE i.status = 'pending'
    AND i.expires_at > now()
    AND p.status = 'invited'
    AND e.archived_at IS NULL
    AND i.invited_email = public.current_user_confirmed_email()
  ORDER BY i.created_at DESC;
$$;

-- Sponsor organizations the caller may link this invitation to: ones they
-- already own or administer. There is deliberately no search, no lookup by
-- name and no lookup by domain -- the candidate list can only contain
-- organizations the caller already has authority over.
CREATE OR REPLACE FUNCTION public.my_eligible_sponsor_organizations(invitation_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  logo_url text,
  website text,
  my_role org_role
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM event_partnership_invitations i
    JOIN event_partnerships p ON p.id = i.partnership_id
    JOIN events e ON e.id = p.event_id
    WHERE i.id = my_eligible_sponsor_organizations.invitation_id
      AND i.status = 'pending'
      AND i.expires_at > now()
      AND p.status = 'invited'
      AND e.archived_at IS NULL
      AND i.invited_email = public.current_user_confirmed_email()
  ) THEN
    RAISE EXCEPTION 'No pending invitation for this account';
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, o.logo_url, o.website, m.role
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND o.org_type = 'sponsor'
    AND o.archived_at IS NULL
    AND m.role IN ('owner', 'admin')
  ORDER BY o.name;
END;
$$;

-- Shared validation for both acceptance paths. Locks the invitation row, so
-- two tabs accepting at once serialize and the second finds it already
-- answered.
CREATE OR REPLACE FUNCTION public.lock_acceptable_partnership_invitation(invitation_id uuid)
RETURNS TABLE (partnership_id uuid, event_id uuid, invited_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := public.current_user_confirmed_email();
  v_partnership uuid; v_event uuid; v_invited_by uuid; v_status text; v_expires timestamptz;
  v_pstatus text; v_archived timestamptz; v_account account_type; v_astatus account_status;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirm your email address before responding to an invitation';
  END IF;

  SELECT i.partnership_id, i.event_id, i.invited_by, i.status, i.expires_at
    INTO v_partnership, v_event, v_invited_by, v_status, v_expires
  FROM event_partnership_invitations i
  WHERE i.id = lock_acceptable_partnership_invitation.invitation_id
    AND i.invited_email = v_email
  FOR UPDATE;

  -- One message for "no such invitation", "not yours" and "wrong email", so
  -- the uuid alone reveals nothing about what exists.
  IF v_partnership IS NULL THEN
    RAISE EXCEPTION 'No pending invitation for this account';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation has already been %', v_status;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'That invitation has expired. Ask the organizer to send a new one.';
  END IF;

  SELECT p.status INTO v_pstatus FROM event_partnerships p WHERE p.id = v_partnership;
  IF v_pstatus <> 'invited' THEN
    RAISE EXCEPTION 'That partnership is no longer open for a response';
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = v_event;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'That event has been archived';
  END IF;

  SELECT a.account_type, a.status INTO v_account, v_astatus
  FROM user_accounts a WHERE a.user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Your account is not set up yet';
  END IF;
  IF v_astatus <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;
  -- The existing compatibility rule, consulted rather than reimplemented.
  IF NOT public.account_type_may_join_org(v_account, 'sponsor') THEN
    RAISE EXCEPTION 'A % account cannot join a sponsor organization', v_account;
  END IF;

  RETURN QUERY SELECT v_partnership, v_event, v_invited_by;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_acceptable_partnership_invitation(uuid) FROM PUBLIC, anon, authenticated;

-- Shared completion: link, accept, activate, stamp. One statement each, all in
-- the caller's transaction, so a failure anywhere leaves nothing behind.
CREATE OR REPLACE FUNCTION public.finish_partnership_acceptance(
  invitation_id uuid,
  target_partnership_id uuid,
  sponsor_org uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- The gate the partnership trigger looks for. set_config with is_local =
  -- true confines it to this transaction, and no client can reach it.
  PERFORM set_config('rally.allow_partnership_link', 'on', true);

  UPDATE event_partnerships
     SET sponsor_organization_id = sponsor_org,
         status = 'active',
         acknowledged_at = now()
   WHERE id = target_partnership_id;

  UPDATE event_partnership_invitations
     SET status = 'accepted',
         responded_at = now(),
         invited_user_id = auth.uid()
   WHERE id = invitation_id;

  PERFORM set_config('rally.allow_partnership_link', 'off', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_partnership_acceptance(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Accept using a sponsor organization the caller already administers.
CREATE OR REPLACE FUNCTION public.accept_partnership_invitation_with_organization(
  invitation_id uuid,
  sponsor_organization_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx
  FROM public.lock_acceptable_partnership_invitation(invitation_id);

  -- Authority over the organization, not merely knowledge of its id.
  IF NOT public.is_org_admin(accept_partnership_invitation_with_organization.sponsor_organization_id) THEN
    RAISE EXCEPTION 'You do not administer that organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = accept_partnership_invitation_with_organization.sponsor_organization_id
      AND o.org_type = 'sponsor'
      AND o.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'That organization cannot be a sponsor';
  END IF;

  PERFORM public.finish_partnership_acceptance(
    invitation_id, v_ctx.partnership_id,
    accept_partnership_invitation_with_organization.sponsor_organization_id
  );

  RETURN v_ctx.partnership_id;
END;
$$;

-- Accept by creating the sponsor organization. This is the one privileged
-- capability phase 3A adds: `organizations`' INSERT policy is organizer-only
-- and is NOT relaxed, so the row is written by this definer function instead,
-- authorized entirely by an unexpired pending invitation whose address the
-- caller has confirmed. handle_new_organization then creates the owner
-- membership from created_by, and enforce_member_account_type still checks
-- account/org compatibility.
CREATE OR REPLACE FUNCTION public.create_sponsor_organization_for_partnership_invitation(
  invitation_id uuid,
  organization_name text,
  organization_website text DEFAULT NULL,
  organization_description text DEFAULT NULL,
  organization_logo_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_name text := btrim(COALESCE(organization_name, ''));
  v_org uuid;
BEGIN
  SELECT * INTO v_ctx
  FROM public.lock_acceptable_partnership_invitation(invitation_id);

  -- The representative states their own company. The organizer's snapshot is
  -- what the organizer believed; it is not authoritative for the sponsor's
  -- own organization record.
  IF v_name = '' THEN
    RAISE EXCEPTION 'Enter your organization name';
  END IF;
  IF length(v_name) > 120 THEN
    RAISE EXCEPTION 'That organization name is too long';
  END IF;

  INSERT INTO organizations
    (name, org_type, created_by, description, website, logo_url, approval_status)
  VALUES
    (v_name, 'sponsor', auth.uid(),
     COALESCE(NULLIF(btrim(organization_description), ''), ''),
     COALESCE(NULLIF(btrim(organization_website), ''), ''),
     COALESCE(NULLIF(btrim(organization_logo_url), ''), ''),
     'approved')
  RETURNING id INTO v_org;

  PERFORM public.finish_partnership_acceptance(invitation_id, v_ctx.partnership_id, v_org);

  RETURN v_org;
END;
$$;

-- Decline. The organizer's work is untouched; the partnership returns to draft
-- so they can change the representative and invite again.
CREATE OR REPLACE FUNCTION public.decline_partnership_invitation(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := public.current_user_confirmed_email();
  v_partnership uuid; v_status text;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirm your email address before responding to an invitation';
  END IF;

  SELECT i.partnership_id, i.status INTO v_partnership, v_status
  FROM event_partnership_invitations i
  WHERE i.id = decline_partnership_invitation.invitation_id
    AND i.invited_email = v_email
  FOR UPDATE;

  IF v_partnership IS NULL THEN
    RAISE EXCEPTION 'No pending invitation for this account';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'That invitation has already been %', v_status;
  END IF;

  UPDATE event_partnership_invitations
     SET status = 'declined', responded_at = now(), invited_user_id = auth.uid()
   WHERE id = invitation_id;

  UPDATE event_partnerships
     SET status = 'draft'
   WHERE id = v_partnership AND status = 'invited';
END;
$$;

-- ============================================================================
-- Sponsor read contract
--
-- A chosen projection, because a SELECT policy grants whole rows and
-- event_partnerships holds internal_notes. value_amount and value_currency ARE
-- returned: that is the sponsor's own agreement. internal_notes is not, and
-- neither is representative_email.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_sponsor_partnerships()
RETURNS TABLE (
  partnership_id uuid,
  event_id uuid,
  event_name text,
  event_start_date date,
  event_end_date date,
  event_location text,
  sponsor_organization_id uuid,
  company_name text,
  tier_label text,
  status text,
  acknowledged_at timestamptz,
  value_amount numeric,
  value_currency text,
  roles text[],
  owed_total bigint,
  owed_completed bigint,
  required_total bigint,
  required_completed bigint
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    p.id, p.event_id, e.name, e.start_date, e.end_date, e.location,
    p.sponsor_organization_id, p.company_name, p.tier_label, p.status,
    p.acknowledged_at, p.value_amount, p.value_currency,
    COALESCE((SELECT array_agg(r.role ORDER BY r.role)
              FROM event_partnership_roles r WHERE r.partnership_id = p.id),
             ARRAY[]::text[]),
    COALESCE(o.owed_total, 0), COALESCE(o.owed_completed, 0),
    COALESCE(o.required_total, 0), COALESCE(o.required_completed, 0)
  FROM event_partnerships p
  JOIN events e ON e.id = p.event_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE ob.direction = 'organizer_to_partner') AS owed_total,
      count(*) FILTER (WHERE ob.direction = 'organizer_to_partner' AND ob.status = 'completed') AS owed_completed,
      count(*) FILTER (WHERE ob.direction = 'partner_to_organizer') AS required_total,
      count(*) FILTER (WHERE ob.direction = 'partner_to_organizer' AND ob.status = 'completed') AS required_completed
    FROM event_partnership_obligations ob WHERE ob.partnership_id = p.id
  ) o ON true
  WHERE p.sponsor_organization_id IS NOT NULL
    AND public.is_org_member(p.sponsor_organization_id)
  ORDER BY e.start_date DESC NULLS LAST, p.company_name;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.invite_partnership_representative(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resend_partnership_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_partnership_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_partnership_invitations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_pending_partnership_invitations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_eligible_sponsor_organizations(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_partnership_invitation_with_organization(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_sponsor_organization_for_partnership_invitation(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decline_partnership_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_sponsor_partnerships() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.invite_partnership_representative(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_partnership_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_partnership_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_partnership_invitations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pending_partnership_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_eligible_sponsor_organizations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_partnership_invitation_with_organization(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sponsor_organization_for_partnership_invitation(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_partnership_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_sponsor_partnerships() TO authenticated;

-- ============================================================================
-- Delivery payload for the Edge Function
--
-- Everything the invitation email needs, flattened into one row. The drainer
-- could in principle embed four levels through PostgREST, but
-- event_partnership_invitations reaches its parent through a COMPOSITE foreign
-- key, and relying on that being auto-detected for embedding is a gamble the
-- delivery path does not need to take. A view is deterministic.
--
-- SECURITY INVOKER is deliberately NOT set, so this runs as its owner and
-- service_role can read it. There is no grant to anon or authenticated: it
-- exposes recipient addresses and is for the drainer alone.
-- ============================================================================
CREATE OR REPLACE VIEW public.partnership_invitation_email_payload AS
SELECT
  q.id                  AS queue_id,
  q.invitation_id,
  q.recipient_email,
  q.attempts,
  i.status              AS invitation_status,
  i.expires_at,
  p.company_name,
  p.tier_label,
  e.name                AS event_name,
  COALESCE(o.name, 'a Rally organizer') AS organizer_name,
  COALESCE(
    (SELECT string_agg(initcap(replace(r.role, '_', ' ')), ' + ' ORDER BY r.role)
     FROM event_partnership_roles r WHERE r.partnership_id = p.id),
    'Partner'
  )                     AS role_label,
  -- The queue row's own state. Without this the drainer has nothing to
  -- filter on and re-sends an already-sent row on every run.
  q.status              AS queue_status
FROM partnership_invitation_emails q
JOIN event_partnership_invitations i ON i.id = q.invitation_id
JOIN event_partnerships p ON p.id = i.partnership_id
JOIN events e ON e.id = p.event_id
LEFT JOIN organizations o ON o.id = e.organization_id;

REVOKE ALL ON public.partnership_invitation_email_payload FROM anon, authenticated;
GRANT SELECT ON public.partnership_invitation_email_payload TO service_role;

/*
## Deferred, deliberately

- **Sponsor writes.** Sponsor members can read their partnership, its roles,
  obligations and evidence, and nothing more: every INSERT/UPDATE/DELETE policy
  above is organizer-only. Submitting evidence against a
  `partner_to_organizer` obligation needs direction-scoped write policies and
  its own probe set, and the brief asks for security over scope, so it is
  phase 4. The architecture supports it with two policies and no schema
  change.
- **Notifications.** `partnership_invited` and `partnership_acknowledged` would
  each need the `notifications` type CHECK swapped and a definer trigger to
  compose them. The email is the invitation's real notification; these are a
  small follow-up rather than part of this migration.
- **Relinking a sponsor organization.** Immutable once accepted, by design. A
  wrong link needs a deliberate administrative flow.
- **Frontend.** No route, no UI. The deep link contract is
  `/partner/invitations?invitation=<id>`, built by the Edge Function from
  APP_URL.
*/
