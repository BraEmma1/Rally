/*
# Phase D — undo a check-in

The correction path for a mis-scan at the door. Same authorization as check-in
itself, because undoing one is the same authority as making one: only someone
`can_manage_event` returns true for, on an active account.

## checked_in_at becomes the authoritative signal
By requirement, undo clears `checked_in_at` and `checked_in_by` and does *not*
touch `status`. A row that has been undone therefore still reads
status = 'checked_in' while its timestamp is NULL, and the two disagree.

`event_activity_counts` counted `status = 'checked_in'`, so it would have kept
counting people whose check-in had been undone — the number on the organizer's
screen would never go down. It now counts `checked_in_at IS NOT NULL`, which
makes the timestamp the single source of truth for "did this person arrive".
That is the smallest change that makes undo actually work, and it is why this
migration touches that function at all.

The disagreement in `status` remains and is deliberate, per the requirement.
Anything reading check-in state should read `checked_in_at`, not `status`.

## Idempotent
Undoing a registration that is not checked in succeeds and reports
`was_checked_in = false`. Pressing undo twice is not an error, and the second
press does not need a different button.

## Archived events stay frozen
An archived event refuses check-ins, and it refuses undo for the same reason:
archiving is the point after which the record of what happened stops moving.
*/
CREATE OR REPLACE FUNCTION public.undo_event_check_in(
  target_event_id uuid,
  target_user_id uuid
)
RETURNS TABLE (
  was_checked_in boolean,
  status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  v_reg_id uuid;
  v_status text;
  v_checked_in_at timestamptz;
BEGIN
  -- Identical gate to check_in_event_attendee: organization owner/admin, or
  -- someone assigned to this event's team, on an active account. An attendee,
  -- a vendor, a sponsor, a non-member organizer and a platform admin all fail
  -- here unless the existing event/team model granted them this event.
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  -- Undoing your own check-in is not an organizer operation, for the same
  -- reason checking yourself in is not.
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot undo your own check-in';
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = target_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived and its check-ins can no longer be changed';
  END IF;

  SELECT r.id, r.status, r.checked_in_at
    INTO v_reg_id, v_status, v_checked_in_at
  FROM event_registrations r
  WHERE r.event_id = target_event_id AND r.user_id = target_user_id;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'That person is not registered for this event';
  END IF;

  -- Nothing to undo. Not an error: the desired state is already the case.
  IF v_checked_in_at IS NULL THEN
    RETURN QUERY SELECT false, v_status;
    RETURN;
  END IF;

  -- The registration itself is never deleted and its status is left exactly as
  -- it was; only the arrival record is cleared.
  UPDATE event_registrations r
     SET checked_in_at = NULL,
         checked_in_by = NULL
   WHERE r.id = v_reg_id;

  RETURN QUERY SELECT true, v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_event_check_in(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_event_check_in(uuid, uuid) TO authenticated;

-- ============================================================================
-- Counts follow the timestamp, not the status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_activity_counts(target_event_id uuid)
RETURNS TABLE (
  registrations bigint,
  checked_in bigint,
  cancelled bigint,
  connections_made bigint,
  invitations_pending bigint,
  invitations_accepted bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id AND r.status <> 'cancelled'),
    -- checked_in_at, not status: undo clears the timestamp and leaves the
    -- status alone, so status would over-count.
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id AND r.checked_in_at IS NOT NULL),
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id AND r.status = 'cancelled'),
    (SELECT count(*) FROM connections c
      WHERE c.event_id = target_event_id),
    (SELECT count(*) FROM event_invitations i
      WHERE i.event_id = target_event_id AND i.status = 'Pending'),
    (SELECT count(*) FROM event_invitations i
      WHERE i.event_id = target_event_id AND i.status = 'Accepted');
END;
$$;

CREATE OR REPLACE FUNCTION public.organization_event_counts(org_id uuid)
RETURNS TABLE (
  event_id uuid,
  registrations bigint,
  checked_in bigint,
  connections_made bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_org_authority(org_id, 'manager');

  RETURN QUERY
  SELECT
    e.id,
    count(r.id) FILTER (WHERE r.status <> 'cancelled'),
    count(r.id) FILTER (WHERE r.checked_in_at IS NOT NULL),
    (SELECT count(*) FROM connections c WHERE c.event_id = e.id)
  FROM events e
  LEFT JOIN event_registrations r ON r.event_id = e.id
  WHERE e.organization_id = org_id
  GROUP BY e.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_activity_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_event_counts(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_activity_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_event_counts(uuid) TO authenticated;
