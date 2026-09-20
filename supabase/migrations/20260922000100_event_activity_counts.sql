/*
# Phase D — event activity counts

Real counts over real rows. Nothing derived, estimated or invented.

The connections figure is the one that needs a definer function rather than a
query the organizer could run themselves: `connections` is owner-private, so an
organizer cannot see rows belonging to their attendees — correctly, because a
connection is someone's private CRM record, not the organizer's data. The
function returns only how many were made at the event, never who connected with
whom, so the aggregate cannot be used to reconstruct the graph.

A count of 1 does leak slightly more than a count of 50 — with exactly two
attendees, a count tells an organizer that those two met. That is inherent to
publishing any aggregate over a small population and is accepted here: the
alternative is not reporting the number at all, and an organizer knowing that
networking happened at their own event is the point of the metric.
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
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id AND r.status <> 'cancelled'),
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id AND r.status = 'checked_in'),
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

-- Roll-up across an organization's events, for an organizer overview. Same
-- authorization rule as every other organization read: an active member.
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
    count(r.id) FILTER (WHERE r.status = 'checked_in'),
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
