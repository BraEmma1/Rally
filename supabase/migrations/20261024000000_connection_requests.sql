/*
# Connection requests ("friend requests") between event attendees

Today "Connect" at an event makes a one-sided connection straight away: the caller
gets a connections row and the other person only gets a notification. This adds a
second, consent-based path: send a request, the other person accepts, and then BOTH
people have the connection.

## What this adds
- table public.connection_requests (requester, recipient, optional event, status)
- one open request per pair of people, in either direction (partial unique index)
- RPCs: send_connection_request, respond_to_connection_request,
  cancel_connection_request, my_connection_requests
- two notification types: connection_request, connection_accepted

## Who can do what
- Sending: the caller must be an active account, registered (not cancelled) for the
  event, and the target must be attending the same event. Same rules as
  connect_with_event_attendee. Not yourself, not someone you are already connected
  with, not when a request is already open between the two of you, and at most 50
  open requests sent at a time.
- Responding: only the recipient, only while the request is pending.
- Cancelling: only the requester, only while pending.
- Accepting creates the connection for BOTH people (existing rows are kept, so
  notes and relationship are never overwritten), and notifies the requester.
- Declining is silent: the requester is not told.
- The table can be READ by its two people only; nobody writes it directly. Every
  change goes through the SECURITY DEFINER functions above.

## What does not change
No existing table, column or policy. connect_with_event_attendee (QR scan, manual
entry) is untouched. The one existing object that is replaced is the CHECK
constraint notifications_type_allowed, re-created with the same list plus the two
new types (it stays NOT VALID, as it is today).

## Reversal
DROP the four functions and the helper, DROP TABLE public.connection_requests, and
re-create notifications_type_allowed without the two new types. Forward-only.
*/

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connection_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id     uuid REFERENCES public.events(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT connection_requests_not_self CHECK (requester_id <> recipient_id)
);

-- One open request per pair of people, whichever way round.
CREATE UNIQUE INDEX IF NOT EXISTS connection_requests_one_pending_per_pair
  ON public.connection_requests (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS connection_requests_recipient_idx ON public.connection_requests (recipient_id, status);
CREATE INDEX IF NOT EXISTS connection_requests_requester_idx ON public.connection_requests (requester_id, status);

ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_connection_requests ON public.connection_requests
  FOR SELECT TO authenticated
  USING ((requester_id = auth.uid() OR recipient_id = auth.uid()) AND public.account_is_active());

-- Read-only through the API; writes only via the functions below.
REVOKE ALL ON TABLE public.connection_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.connection_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- Notification types
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_allowed;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_allowed CHECK (type = ANY (ARRAY[
    'new_connection', 'event_invitation', 'invitation_accepted', 'invitation_declined',
    'follow_up_due', 'follow_up_overdue', 'opportunity_stage_changed', 'event_registration',
    'upcoming_event', 'new_message', 'connection_request', 'connection_accepted'
  ])) NOT VALID;

-- ---------------------------------------------------------------------------
-- Internal helper: create one person's connection row if it does not exist.
-- Mirrors connect_with_event_attendee: an existing row (and its notes /
-- relationship) is kept, only a missing event context is filled in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_connection_if_absent(
  p_owner uuid, p_other uuid, p_event uuid, p_event_name text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  p profiles%ROWTYPE;
BEGIN
  SELECT c.id INTO v_id FROM connections c
   WHERE c.owner_id = p_owner AND c.connected_user_id = p_other;
  IF v_id IS NOT NULL THEN
    UPDATE connections
       SET event_id   = COALESCE(event_id, p_event),
           event_name = CASE WHEN COALESCE(event_name, '') = '' THEN p_event_name ELSE event_name END,
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO p FROM profiles WHERE id = p_other;

  INSERT INTO connections (
    owner_id, connected_user_id, full_name, job_title, company, industry,
    location, photo_url, linkedin, website, relationship_type, event_id, event_name
  )
  VALUES (
    p_owner, p_other,
    COALESCE(NULLIF(btrim(p.full_name), ''), 'Rally member'),
    COALESCE(p.job_title, ''), COALESCE(p.company, ''), COALESCE(p.industry, ''),
    COALESCE(p.location, ''), COALESCE(p.photo_url, ''),
    COALESCE(p.linkedin, ''), COALESCE(p.website, ''),
    'Other', p_event, p_event_name
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_connection_if_absent(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- send_connection_request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_connection_request(target_event_id uuid, target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_archived timestamptz;
  v_event_name text;
  v_id uuid;
  v_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;
  IF target_user_id = v_me THEN
    RAISE EXCEPTION 'You cannot send a request to yourself';
  END IF;

  SELECT e.name, e.archived_at INTO v_event_name, v_archived FROM events e WHERE e.id = target_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'That event is archived';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM event_registrations r
                  WHERE r.event_id = target_event_id AND r.user_id = v_me AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'You are not registered for this event';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_registrations r
                  WHERE r.event_id = target_event_id AND r.user_id = target_user_id AND r.status <> 'cancelled') THEN
    RAISE EXCEPTION 'That person is not attending this event';
  END IF;

  IF EXISTS (SELECT 1 FROM connections c WHERE c.owner_id = v_me AND c.connected_user_id = target_user_id) THEN
    RAISE EXCEPTION 'You are already connected with this person';
  END IF;

  IF EXISTS (SELECT 1 FROM connection_requests q
              WHERE q.status = 'pending' AND q.requester_id = target_user_id AND q.recipient_id = v_me) THEN
    RAISE EXCEPTION 'This person has already sent you a request. Accept it from your requests.';
  END IF;
  IF EXISTS (SELECT 1 FROM connection_requests q
              WHERE q.status = 'pending' AND q.requester_id = v_me AND q.recipient_id = target_user_id) THEN
    RAISE EXCEPTION 'You have already sent this person a request';
  END IF;

  IF (SELECT count(*) FROM connection_requests q WHERE q.requester_id = v_me AND q.status = 'pending') >= 50 THEN
    RAISE EXCEPTION 'You have too many open requests. Wait for some to be answered.';
  END IF;

  BEGIN
    INSERT INTO connection_requests (requester_id, recipient_id, event_id)
    VALUES (v_me, target_user_id, target_event_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A request between you and this person is already open';
  END;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone') INTO v_name FROM profiles p WHERE p.id = v_me;
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (target_user_id, 'connection_request', 'Connection request',
          COALESCE(v_name, 'Someone') || ' wants to connect with you at ' || v_event_name || '.',
          '/connections?view=requests');

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- respond_to_connection_request: only the recipient, only while pending
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_connection_request(request_id uuid, accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  q connection_requests%ROWTYPE;
  v_event_name text;
  v_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  SELECT * INTO q FROM connection_requests r WHERE r.id = request_id FOR UPDATE;
  IF NOT FOUND OR q.recipient_id <> v_me THEN
    RAISE EXCEPTION 'That request does not exist';
  END IF;
  IF q.status <> 'pending' THEN
    RAISE EXCEPTION 'That request has already been answered or withdrawn';
  END IF;

  IF NOT accept THEN
    UPDATE connection_requests SET status = 'declined', responded_at = now() WHERE id = q.id;
    RETURN 'declined';
  END IF;

  SELECT e.name INTO v_event_name FROM events e WHERE e.id = q.event_id;

  UPDATE connection_requests SET status = 'accepted', responded_at = now() WHERE id = q.id;
  PERFORM public.create_connection_if_absent(q.requester_id, q.recipient_id, q.event_id, v_event_name);
  PERFORM public.create_connection_if_absent(q.recipient_id, q.requester_id, q.event_id, v_event_name);

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Someone') INTO v_name FROM profiles p WHERE p.id = v_me;
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (q.requester_id, 'connection_accepted', 'Request accepted',
          COALESCE(v_name, 'Someone') || ' accepted your connection request.',
          '/connections');

  RETURN 'accepted';
END;
$$;

-- ---------------------------------------------------------------------------
-- cancel_connection_request: only the requester, only while pending
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_connection_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  UPDATE connection_requests r
     SET status = 'cancelled', responded_at = now()
   WHERE r.id = request_id AND r.requester_id = v_me AND r.status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That request cannot be withdrawn';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- my_connection_requests: the caller's open requests, both directions, with
-- the other person's public card (profiles are not readable directly).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_connection_requests()
RETURNS TABLE (
  id uuid,
  direction text,
  event_id uuid,
  event_name text,
  created_at timestamptz,
  other_user_id uuid,
  other_full_name text,
  other_job_title text,
  other_company text,
  other_photo_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT q.id,
         CASE WHEN q.recipient_id = auth.uid() THEN 'incoming' ELSE 'outgoing' END,
         q.event_id,
         e.name,
         q.created_at,
         o.id,
         COALESCE(NULLIF(btrim(o.full_name), ''), 'Rally member'),
         COALESCE(o.job_title, ''),
         COALESCE(o.company, ''),
         COALESCE(o.photo_url, '')
  FROM connection_requests q
  JOIN profiles o ON o.id = CASE WHEN q.recipient_id = auth.uid() THEN q.requester_id ELSE q.recipient_id END
  LEFT JOIN events e ON e.id = q.event_id
  WHERE q.status = 'pending'
    AND (q.requester_id = auth.uid() OR q.recipient_id = auth.uid())
    AND public.account_is_active()
  ORDER BY q.created_at DESC
  LIMIT 200;
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.send_connection_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_to_connection_request(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_connection_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_connection_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_connection_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_connection_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_connection_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_connection_requests() TO authenticated;
