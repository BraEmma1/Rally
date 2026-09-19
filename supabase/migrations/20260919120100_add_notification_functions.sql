/*
# PHASE 1 (additive) — server-derived cross-user notifications

Part one of the notifications fix. Adds the RPCs, a self-scoped insert policy and
a type constraint. The permissive `insert_notifications` policy is still in place
after this migration, so the previous frontend keeps working; migration
20260919130100 removes it once the new frontend is live.

## Why these exist
`insert_notifications` uses `WITH CHECK (auth.uid() = user_id OR true)`, which is
a no-op. Any authenticated user can insert unlimited notifications addressed to
anyone, with attacker-chosen title, message and link — spam and phishing, since
the UI renders that link as a destination.

Self-addressed notifications (registration confirmations, opportunity stage
changes) need no privilege and are covered by `insert_own_notifications`.
The only two legitimate cross-user notifications get RPCs that verify the caller
actually performed the action and compose the text server-side, so neither the
recipient nor the wording is client-controlled. Both are idempotent within 24h
so a replayed call cannot be used to spam someone.
*/

-- Self-addressed inserts. Additive: permissive policies are OR'd, so this
-- changes nothing until insert_notifications is dropped in phase 2.
DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Constrain type to what the UI renders. NOT VALID so pre-existing rows cannot
-- fail the migration (verified: zero rows violate this today).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_allowed;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_allowed CHECK (
    type IN (
      'new_connection', 'event_invitation', 'invitation_accepted',
      'invitation_declined', 'follow_up_due', 'follow_up_overdue',
      'opportunity_stage_changed', 'event_registration', 'upcoming_event'
    )
  ) NOT VALID;

-- Notify the person who was added as a connection. The recipient comes from the
-- caller's own connection row, so it cannot be chosen freely.
CREATE OR REPLACE FUNCTION public.notify_new_connection(connection_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target_id uuid;
  v_actor_name text;
  v_body text;
BEGIN
  SELECT c.connected_user_id INTO v_target_id
  FROM connections c
  WHERE c.id = connection_id AND c.owner_id = auth.uid();

  -- Not the caller's connection, or a manually-added contact who is not a
  -- Rally user: nothing to notify.
  IF NOT FOUND OR v_target_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone') INTO v_actor_name
  FROM profiles p WHERE p.id = auth.uid();

  v_body := COALESCE(v_actor_name, 'Someone') || ' added you as a connection on Rally.';

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

-- Notify the inviter of an accept/decline. Status is read from the row, not
-- supplied by the caller, and only the invited user can trigger it.
CREATE OR REPLACE FUNCTION public.notify_invitation_response(invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  WHERE ei.id = invitation_id AND ei.invited_user_id = auth.uid();

  IF NOT FOUND OR v_status NOT IN ('Accepted', 'Declined') THEN
    RETURN;
  END IF;

  IF v_invited_by IS NULL OR v_invited_by = auth.uid() THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone') INTO v_responder_name
  FROM profiles p WHERE p.id = auth.uid();

  SELECT COALESCE(NULLIF(btrim(e.name), ''), 'your event') INTO v_event_name
  FROM events e WHERE e.id = v_event_id;

  IF v_status = 'Accepted' THEN
    v_type := 'invitation_accepted';
    v_title := 'Invitation accepted';
  ELSE
    v_type := 'invitation_declined';
    v_title := 'Invitation declined';
  END IF;

  v_body := COALESCE(v_responder_name, 'Someone')
         || CASE WHEN v_status = 'Accepted' THEN ' accepted' ELSE ' declined' END
         || ' your invitation to ' || COALESCE(v_event_name, 'your event') || '.';

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
  VALUES (v_invited_by, v_type, v_title, v_body, '/events/' || v_event_id::text);
END;
$$;

-- Revoke from anon/authenticated explicitly: Supabase default privileges grant
-- EXECUTE on new public-schema functions to both, so revoking PUBLIC is not enough.
REVOKE EXECUTE ON FUNCTION public.notify_new_connection(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_invitation_response(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.notify_new_connection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_invitation_response(uuid) TO authenticated;
