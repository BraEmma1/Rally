/*
# 30-day cool-off on repeated connection requests

A person who declined a connection request, or whose request was cancelled, is
not asked again by the same requester for 30 days.

## What changes
send_connection_request gains one check, placed after the "already pending"
checks and before the open-request cap. It refuses with
"You cannot send a request to this person right now" when the same requester
already has a declined or cancelled request to the same recipient whose
responded_at is within the last 30 days.

The check is directional: it stops A re-asking B, not B asking A.

## What does not change
Signature, return type, SECURITY DEFINER, search_path, and every other check
and side effect are exactly as in 20261024000000_connection_requests.sql. No
table, column, policy or index. EXECUTE stays authenticated-only (re-asserted
below).

## Why a new migration
20261024000000 is already recorded on rally-dev (as 20261023234941) and must
not be edited. Forward-only. Reversal is a new migration restoring the body from
20261024000000.

NOT applied to rally-dev or production.
*/

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

  -- Cool-off: someone who declined (or whose request was cancelled) is not asked
  -- again by the same person for 30 days.
  IF EXISTS (SELECT 1 FROM connection_requests q
              WHERE q.requester_id = v_me AND q.recipient_id = target_user_id
                AND q.status IN ('declined', 'cancelled')
                AND q.responded_at >= now() - interval '30 days') THEN
    RAISE EXCEPTION 'You cannot send a request to this person right now';
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

REVOKE EXECUTE ON FUNCTION public.send_connection_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_connection_request(uuid, uuid) TO authenticated;
