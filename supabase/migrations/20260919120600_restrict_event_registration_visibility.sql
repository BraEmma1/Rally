/*
# Stop the attendee list from leaking every user id

## Problem
`public_read_registrations` allowed `anon` and every authenticated user to read
all of `event_registrations` with `USING (true)`. That hands out the complete
list of user ids in the system, which defeats the point of scoping profile reads
to "you must already know the id": a caller could harvest every id here and then
walk them through the profile lookups.

It was also the client, not the database, deciding who may see an attendee list —
the Attendees tab is gated by `isRegistered` in React only.

## Changes
1. Replace the policy: a registration row is visible only to the user it belongs
   to, or to someone registered for that same event. This matches what the UI
   already intends and moves the check server-side.
   `is_registered_for_event()` is SECURITY DEFINER so the policy does not
   re-enter `event_registrations` and recurse.
2. Registration counts stay public via `get_event_registration_counts()`, an
   aggregate-only function. Counts are not personal data, and the events list
   shows them for events you have not joined.
   This also replaces a per-event count query loop in the client with one call.
*/

-- ============================================================================
-- 1. Registration visibility
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_registered_for_event(target_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_registrations r
    WHERE r.event_id = target_event_id
      AND r.user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_registered_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_registered_for_event(uuid) TO authenticated;

DROP POLICY IF EXISTS "public_read_registrations" ON event_registrations;

DROP POLICY IF EXISTS "read_own_or_co_attendee_registrations" ON event_registrations;
CREATE POLICY "read_own_or_co_attendee_registrations"
  ON event_registrations FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_registered_for_event(event_id)
  );

REVOKE ALL ON public.event_registrations FROM anon;

-- insert_own_registration and delete_own_registration are unchanged.

-- ============================================================================
-- 2. Public aggregate counts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_registration_counts(event_ids uuid[])
RETURNS TABLE (
  event_id uuid,
  registration_count bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT r.event_id, count(*)::bigint AS registration_count
  FROM event_registrations r
  WHERE r.event_id = ANY(COALESCE(event_ids, ARRAY[]::uuid[]))
  GROUP BY r.event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_registration_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_registration_counts(uuid[]) TO anon, authenticated;
