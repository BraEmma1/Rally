/*
# Organizer registration counts: count confirmed registrations only

## Problem

event_activity_counts (event overview) and organization_event_counts (organizer
dashboard and events list) count "registrations" as status <> 'cancelled'. Both
were written before the waitlist (migration 20261026000000), so a waitlisted
person is counted as registered. Everywhere else Rally already treats a
registration as confirmed only when it is 'registered' or 'checked_in':
is_registered_for_event, get_event_registration_counts (public "N registered"),
the capacity check in enforce_registration_rules and register_for_event, and
waitlist promotion. With a waitlist, the organizer screens therefore showed more
registrations than the event's own public count and more than its capacity.

## Change

Same rule as the rest of Rally, applied to both functions:

- registrations = status IN ('registered', 'checked_in')  (confirmed)
- checked_in    = checked_in_at IS NOT NULL on a confirmed registration
  (still the timestamp, never the status: undo clears the timestamp and leaves
  the status as it was; see 20260922000300)
- cancelled     = status = 'cancelled' (unchanged)

The statuses are the four the event_registrations_status_allowed constraint
defines: registered, waitlisted, cancelled, checked_in. There is no 'rejected'.

Signatures, return columns, SECURITY DEFINER, search_path, authorization checks
and grants are unchanged, so this is CREATE OR REPLACE with no DROP. Waitlisted
counts are not added here: adding a return column would need DROP FUNCTION. The
event overview takes its waitlist count from event_attendee_list, which already
returns every registration with its status to the people who manage the event.

Check-in eligibility needs no change: check_in_event_attendee refuses cancelled
registrations, guard_registration_status_change refuses waitlisted -> checked_in,
there is no UPDATE policy on event_registrations, and self-registration may insert
only (event_id, user_id), so a status cannot be forged.

Forward-only. Do not edit once applied.
*/

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
    -- Confirmed: holds a seat. Waitlisted and cancelled people do not.
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id AND r.status IN ('registered', 'checked_in')),
    -- checked_in_at, not status: undo clears the timestamp and leaves the
    -- status alone, so status would over-count.
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id
        AND r.status IN ('registered', 'checked_in')
        AND r.checked_in_at IS NOT NULL),
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
    count(r.id) FILTER (WHERE r.status IN ('registered', 'checked_in')),
    count(r.id) FILTER (WHERE r.status IN ('registered', 'checked_in') AND r.checked_in_at IS NOT NULL),
    (SELECT count(*) FROM connections c WHERE c.event_id = e.id)
  FROM events e
  LEFT JOIN event_registrations r ON r.event_id = e.id
  WHERE e.organization_id = org_id
    AND public.can_manage_event(e.id)
  GROUP BY e.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_activity_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_event_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_activity_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_event_counts(uuid) TO authenticated;
