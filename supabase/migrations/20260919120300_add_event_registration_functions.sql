/*
# PHASE 1 (additive) — helpers for event registration visibility

Adds the two functions the phase 2 registration lockdown depends on. Additive
only: applying this changes no existing behaviour. Migration 20260919130500
swaps the policy once the new frontend is live.

- `is_registered_for_event(uuid)` backs the new SELECT policy. It is
  SECURITY DEFINER so the policy does not re-enter `event_registrations` and
  recurse infinitely.
- `get_event_registration_counts(uuid[])` keeps the "N registered" figure public
  once the underlying rows stop being world-readable. Counts are aggregates, not
  personal data, and the events list shows them for events you have not joined.
  It also replaces a per-event count query loop in the client with one call.
*/

CREATE OR REPLACE FUNCTION public.is_registered_for_event(target_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_registrations r
    WHERE r.event_id = target_event_id
      AND r.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.get_event_registration_counts(event_ids uuid[])
RETURNS TABLE (
  event_id uuid,
  registration_count bigint
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT r.event_id, count(*)::bigint AS registration_count
  FROM event_registrations r
  WHERE r.event_id = ANY(COALESCE(event_ids, ARRAY[]::uuid[]))
  GROUP BY r.event_id;
$$;

-- Revoke from anon/authenticated explicitly: Supabase default privileges grant
-- EXECUTE on new public-schema functions to both, so revoking PUBLIC is not enough.
REVOKE EXECUTE ON FUNCTION public.is_registered_for_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_registration_counts(uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_registered_for_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registration_counts(uuid[]) TO anon, authenticated;
