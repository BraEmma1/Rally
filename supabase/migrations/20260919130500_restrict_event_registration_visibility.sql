/*
# PHASE 2 (breaking) — stop the attendee list leaking every user id

DO NOT APPLY until the frontend that reads counts via
get_event_registration_counts (phase 1, 20260919120300) is deployed. The previous
bundle counts registrations by selecting the rows directly and will show 0
registered everywhere once this lands.

## What this closes
`public_read_registrations` let anon and every authenticated user read all of
`event_registrations` with `USING (true)`. That hands out the complete list of
user ids in the system, which defeats the point of scoping profile reads to
"you must already know the id" — a caller could harvest every id here and walk
them through the profile functions.

It was also the client, not the database, deciding who may see an attendee list:
the Attendees tab is gated by `isRegistered` in React only. This moves that check
server-side, where it belongs.

Counts stay public through the aggregate function, so the events list still shows
"N registered" for events you have not joined.
*/

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
