/*
# Secure notifications: remove the `OR true` insert policy

## Problem
`insert_notifications` used `WITH CHECK (auth.uid() = user_id OR true)`, which is
a no-op check. Any authenticated user could insert unlimited notifications
addressed to any other user, with attacker-controlled `title`, `message` and
`link`. That allows spam and phishing (fake "invitation accepted" or spoofed
system alerts whose link the UI renders as a clickable destination).

## Changes
1. Replace the insert policy with `auth.uid() = user_id`, so a client may only
   ever write notifications addressed to itself. Self-notifications
   (event registration confirmations, opportunity stage changes) keep working
   unchanged, and a user can at worst notify themselves.
2. Add two SECURITY DEFINER RPCs for the only two legitimate cross-user
   notifications in the product. Both derive the recipient AND the message text
   from server-side state after verifying the caller actually performed the
   action — the client cannot choose the recipient or the wording:
   - `notify_new_connection(connection_id uuid)`
   - `notify_invitation_response(invitation_id uuid)`
   Each is idempotent within a 24h window so a replayed call cannot be used to
   spam the recipient.
3. Constrain `type` to the set of types the app renders. Added NOT VALID so an
   existing row written while the table was open does not block the migration.
*/

-- ============================================================================
-- 1. Lock down direct inserts to self-addressed notifications only
-- ============================================================================
DROP POLICY IF EXISTS "insert_notifications" ON notifications;

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 2. Constrain notification types to the known set
-- ============================================================================
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_allowed;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_allowed CHECK (
    type IN (
      'new_connection',
      'event_invitation',
      'invitation_accepted',
      'invitation_declined',
      'follow_up_due',
      'follow_up_overdue',
      'opportunity_stage_changed',
      'event_registration',
      'upcoming_event'
    )
  ) NOT VALID;

-- ============================================================================
-- 3. Server-derived cross-user notifications
-- ============================================================================

-- Notify the person who was added as a connection.
-- Verifies the caller genuinely owns a connection row pointing at that user,
-- so the recipient cannot be chosen freely.
CREATE OR REPLACE FUNCTION public.notify_new_connection(connection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id uuid;
  v_actor_name text;
  v_body text;
BEGIN
  SELECT c.connected_user_id
    INTO v_target_id
  FROM connections c
  WHERE c.id = connection_id
    AND c.owner_id = auth.uid();

  -- No such connection, not the caller's connection, or a manually-added
  -- contact that is not a Rally user: nothing to notify.
  IF NOT FOUND OR v_target_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone')
    INTO v_actor_name
  FROM profiles p
  WHERE p.id = auth.uid();

  v_body := COALESCE(v_actor_name, 'Someone') || ' added you as a connection on Rally.';

  -- Idempotency guard: do not re-notify for a replayed call.
  IF EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = v_target_id
      AND n.type = 'new_connection'
      AND n.message = v_body
      AND n.created_at > now() - interval '1 day'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (v_target_id, 'new_connection', 'New connection', v_body, '/connections');
END;
$$;

-- Notify the inviter that their invitation was accepted or declined.
-- Verifies the caller is the invited user and reads the status from the row.
CREATE OR REPLACE FUNCTION public.notify_invitation_response(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_invited_by uuid;
  v_status text;
  v_responder_name text;
  v_event_name text;
  v_body text;
  v_type text;
  v_title text;
BEGIN
  SELECT ei.event_id, ei.invited_by, ei.status
    INTO v_event_id, v_invited_by, v_status
  FROM event_invitations ei
  WHERE ei.id = invitation_id
    AND ei.invited_user_id = auth.uid();

  IF NOT FOUND OR v_status NOT IN ('Accepted', 'Declined') THEN
    RETURN;
  END IF;

  -- Never notify yourself about your own invitation.
  IF v_invited_by IS NULL OR v_invited_by = auth.uid() THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone')
    INTO v_responder_name
  FROM profiles p
  WHERE p.id = auth.uid();

  SELECT COALESCE(NULLIF(btrim(e.name), ''), 'your event')
    INTO v_event_name
  FROM events e
  WHERE e.id = v_event_id;

  IF v_status = 'Accepted' THEN
    v_type := 'invitation_accepted';
    v_title := 'Invitation accepted';
  ELSE
    v_type := 'invitation_declined';
    v_title := 'Invitation declined';
  END IF;

  v_body := COALESCE(v_responder_name, 'Someone')
       || CASE WHEN v_status = 'Accepted' THEN ' accepted' ELSE ' declined' END
       || ' your invitation to '
       || COALESCE(v_event_name, 'your event')
       || '.';

  IF EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = v_invited_by
      AND n.type = v_type
      AND n.message = v_body
      AND n.created_at > now() - interval '1 day'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (
    v_invited_by,
    v_type,
    v_title,
    v_body,
    '/events/' || v_event_id::text
  );
END;
$$;

-- ============================================================================
-- 4. Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.notify_new_connection(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_invitation_response(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.notify_new_connection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_invitation_response(uuid) TO authenticated;
