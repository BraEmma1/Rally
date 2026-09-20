/*
# Phase D — event check-in

Extends `event_registrations` rather than adding a check-in table: the
registration *is* the record of someone attending, and `status`
('registered' | 'waitlisted' | 'cancelled' | 'checked_in') and `checked_in_at`
already exist. Only "who checked them in" was missing.

## Both check-in paths converge on one function
QR and manual lookup differ only in how the organizer arrives at a user id —
the scanner reads it, the lookup searches for it. Authorization, validity and
idempotency are identical, so they share `check_in_event_attendee` and there is
exactly one place where a check-in can be written. `find_event_attendees` is
the lookup half of the manual path.

## Why there is still no UPDATE policy on event_registrations
Check-in is the first operation that writes to an existing registration row,
and the temptation is to add an UPDATE policy for it. That would also open
`status` to the attendee themselves, who could then mark themselves checked in.
The definer function bypasses RLS instead, so the table keeps no client write
path at all and check-in remains something only an organizer can do.

## Idempotency
A second scan of the same badge returns the original check-in time with
`already_checked_in = true` rather than raising or overwriting it. The arrival
time is evidence; re-scanning a badge at the door should not rewrite it.
*/

ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Phase C added a unique index on (event_id, user_id) that duplicated
-- idx_event_registrations_event_user, UNIQUE since the original attendee
-- build. Two identical unique indexes cost two writes per registration and
-- give one confusing error. The Phase C one goes.
DROP INDEX IF EXISTS event_registrations_unique_attendee;

CREATE INDEX IF NOT EXISTS idx_event_registrations_checked_in
  ON event_registrations (event_id, checked_in_at)
  WHERE checked_in_at IS NOT NULL;

-- ============================================================================
-- Check in a registered attendee
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_in_event_attendee(
  target_event_id uuid,
  target_user_id uuid
)
RETURNS TABLE (
  already_checked_in boolean,
  checked_in_at timestamptz,
  status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  v_visibility text;
  v_reg_id uuid;
  v_status text;
  v_checked_in_at timestamptz;
BEGIN
  -- can_manage_event covers the organization owner/admin and anyone assigned
  -- to the event team, and it re-checks organization membership, so a vendor,
  -- a sponsor, an attendee and a platform admin all fail here unless the
  -- existing event/team model has explicitly granted them the event.
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  -- Checking yourself in is not an organizer operation, whatever role you hold.
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot check yourself in';
  END IF;

  SELECT e.archived_at, e.visibility INTO v_archived, v_visibility
  FROM events e WHERE e.id = target_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived and cannot take check-ins';
  END IF;

  IF v_visibility = 'draft' THEN
    RAISE EXCEPTION 'This event is still a draft';
  END IF;

  SELECT r.id, r.status, r.checked_in_at
    INTO v_reg_id, v_status, v_checked_in_at
  FROM event_registrations r
  WHERE r.event_id = target_event_id AND r.user_id = target_user_id;

  -- Check-in never creates a registration. Someone at the door who never
  -- registered is a registration decision, not a check-in one.
  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'That person is not registered for this event';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'That registration was cancelled';
  END IF;

  IF v_status = 'checked_in' AND v_checked_in_at IS NOT NULL THEN
    RETURN QUERY SELECT true, v_checked_in_at, v_status;
    RETURN;
  END IF;

  UPDATE event_registrations r
     SET status        = 'checked_in',
         checked_in_at = now(),
         checked_in_by = auth.uid()
   WHERE r.id = v_reg_id
   RETURNING r.checked_in_at, r.status INTO v_checked_in_at, v_status;

  RETURN QUERY SELECT false, v_checked_in_at, v_status;
END;
$$;

-- ============================================================================
-- Manual lookup: find someone on the door list
--
-- Searches only within this event's registrations, so it cannot be used as a
-- directory of Rally users. Returns the public professional card; no email or
-- phone, consistent with every other organizer read.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_event_attendees(
  target_event_id uuid,
  search text DEFAULT ''
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  job_title text,
  company text,
  photo_url text,
  status text,
  registered_at timestamptz,
  checked_in_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_needle text := lower(btrim(COALESCE(search, '')));
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT
    r.user_id,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(p.job_title, '') AS job_title,
    COALESCE(p.company, '')   AS company,
    COALESCE(p.photo_url, '') AS photo_url,
    r.status,
    r.created_at AS registered_at,
    r.checked_in_at
  FROM event_registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = target_event_id
    AND (
      v_needle = ''
      OR lower(COALESCE(p.full_name, '')) LIKE '%' || v_needle || '%'
      OR lower(COALESCE(p.company, ''))   LIKE '%' || v_needle || '%'
    )
  ORDER BY
    CASE WHEN r.checked_in_at IS NULL THEN 0 ELSE 1 END,
    COALESCE(p.full_name, '');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_in_event_attendee(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_event_attendees(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_in_event_attendee(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_event_attendees(uuid, text) TO authenticated;
