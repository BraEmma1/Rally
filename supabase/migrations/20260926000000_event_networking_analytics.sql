/*
# Event networking analytics

Aggregates over data Rally already records. Nothing here invents a number, and
where a metric cannot be computed it is returned as NULL and named in
`unavailable_metrics` — never as a zero, which a chart would render as a real
measurement of "none".

## What the schema actually supports
Investigated before writing:

- `connections` carries `event_id` (FK to events), `owner_id`,
  `connected_user_id` and `created_at`. That is the whole networking record.
- `opportunities` carries `event_id`, `stage` and `value`.
- `profiles.industry` exists and is free-ish text from a fixed list.
- `event_registrations` carries `status` and `checked_in_at`.

## What is NOT available, and why it is NULL rather than 0
- **Connection requests / accepted / pending.** Rally has no request model.
  `connections.status` has no CHECK constraint and every row in the database
  holds 'active'; a connection is created outright by the QR exchange or by
  `connect_with_event_attendee`. There is no pending state to count, so
  "requests" and "accepted" are not smaller numbers than connections — they are
  different data that is not recorded. Reporting 0, or reusing the connection
  count for both, would be inventing a funnel.
- **Profile views.** Nothing records them: no table, no column, no event
  stream. A table could be added, but it would only ever be filled by
  instrumenting the attendee profile screens, which is out of scope here — so
  it would stay empty and an empty table is indistinguishable from a fabricated
  zero. Left explicitly unavailable instead.

## Definitions, stated once so the numbers are comparable
- **Registered attendee** — an `event_registrations` row for the event whose
  status is not 'cancelled'.
- **Checked in** — that row has a `checked_in_at`. (Not status = 'checked_in':
  undoing a check-in clears the timestamp and deliberately leaves the status
  alone, so the timestamp is the truth.)
- **Networking participant** — a *registered attendee* who appears on at least
  one connection carrying this event's `event_id`, on either side. The
  registration requirement is what keeps an organizer who scanned a badge but
  never registered out of the count.
- **Connection made through the event** — a `connections` row whose `event_id`
  is this event. Connections made elsewhere by the same people are not counted;
  the event_id foreign key is the authority, never `event_name`.

## Authorization
Every function gates on `can_manage_event(target_event_id)` plus an active
account — the same predicate that governs event writes, check-in and the
attendee list. That means organization owners and admins organization-wide, and
event managers only for events they are assigned to. Public visibility of an
event grants nothing: `can_manage_event` never consults `visibility`. Platform
admins gain nothing implicitly, because they hold no membership.

Archived events stay readable, which is the point of archiving rather than
deleting; nothing here writes.
*/

-- ============================================================================
-- Shared gate
-- ============================================================================
CREATE OR REPLACE FUNCTION public.require_event_analytics_access(target_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.require_event_analytics_access(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 1 + 2 + 6 + 7. Participation, connections, opportunities, funnel
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_networking_overview(target_event_id uuid)
RETURNS TABLE (
  registered_attendees bigint,
  checked_in_attendees bigint,
  networking_participants bigint,
  attendees_without_networking bigint,
  participation_percent numeric,
  connections_made bigint,
  connection_requests bigint,
  accepted_connections bigint,
  pending_requests bigint,
  profile_views bigint,
  opportunities_total bigint,
  opportunities_value numeric,
  unavailable_metrics text[]
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_registered bigint;
  v_participants bigint;
BEGIN
  PERFORM public.require_event_analytics_access(target_event_id);

  SELECT count(*) INTO v_registered
  FROM event_registrations r
  WHERE r.event_id = target_event_id AND r.status <> 'cancelled';

  -- Either side of the connection counts, but only if that person is actually
  -- registered for this event.
  SELECT count(DISTINCT r.user_id) INTO v_participants
  FROM event_registrations r
  WHERE r.event_id = target_event_id
    AND r.status <> 'cancelled'
    AND EXISTS (
      SELECT 1 FROM connections c
      WHERE c.event_id = target_event_id
        AND (c.owner_id = r.user_id OR c.connected_user_id = r.user_id)
    );

  RETURN QUERY
  SELECT
    v_registered,
    (SELECT count(*) FROM event_registrations r
      WHERE r.event_id = target_event_id
        AND r.status <> 'cancelled'
        AND r.checked_in_at IS NOT NULL),
    v_participants,
    GREATEST(v_registered - v_participants, 0),
    CASE WHEN v_registered = 0 THEN 0::numeric
         ELSE round((v_participants::numeric * 100) / v_registered, 1) END,
    (SELECT count(*) FROM connections c WHERE c.event_id = target_event_id),
    -- Not recorded anywhere. NULL, so a chart shows "no data" rather than a
    -- confident zero.
    NULL::bigint,
    NULL::bigint,
    NULL::bigint,
    NULL::bigint,
    (SELECT count(*) FROM opportunities o WHERE o.event_id = target_event_id),
    (SELECT COALESCE(sum(o.value), 0) FROM opportunities o WHERE o.event_id = target_event_id),
    ARRAY[
      'connection_requests: Rally has no connection request model; connections are created outright',
      'accepted_connections: same — there is no pending state to accept from',
      'pending_requests: same',
      'profile_views: not recorded anywhere in the schema'
    ]::text[];
END;
$$;

-- ============================================================================
-- 4. Activity over time
--
-- Bucket follows the event's own length, so a one-evening meetup is not
-- flattened into a single bar and a week-long conference is not 168 of them.
-- Only connections: requests and acceptances do not exist to plot.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_networking_timeline(target_event_id uuid)
RETURNS TABLE (
  bucket_start timestamptz,
  bucket_interval text,
  connections_made bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_first timestamptz;
  v_last timestamptz;
  v_span interval;
  v_bucket interval;
  v_label text;
BEGIN
  PERFORM public.require_event_analytics_access(target_event_id);

  -- Bucket over the window networking actually happened in, not the advertised
  -- event dates: connections are frequently made before and after.
  SELECT min(c.created_at), max(c.created_at) INTO v_first, v_last
  FROM connections c WHERE c.event_id = target_event_id;

  IF v_first IS NULL THEN
    RETURN;  -- no activity: an empty series, not a row of zeroes
  END IF;

  v_span := GREATEST(v_last - v_first, interval '1 minute');

  IF v_span <= interval '4 hours' THEN
    v_bucket := interval '15 minutes'; v_label := '15 minutes';
  ELSIF v_span <= interval '3 days' THEN
    v_bucket := interval '1 hour';     v_label := '1 hour';
  ELSE
    v_bucket := interval '1 day';      v_label := '1 day';
  END IF;

  RETURN QUERY
  SELECT
    to_timestamp(floor(extract(epoch FROM c.created_at) / extract(epoch FROM v_bucket))
                 * extract(epoch FROM v_bucket)) AS bucket_start,
    v_label,
    count(*)
  FROM connections c
  WHERE c.event_id = target_event_id
  GROUP BY 1, 2
  ORDER BY 1;
END;
$$;

-- ============================================================================
-- 5. Industry activity
--
-- profiles.industry is optional, so the return carries how many of the
-- participants actually have one. Without that number the shares are
-- misleading: a 60%-complete field looks like a finding rather than a gap.
-- Participants with no industry are grouped as 'Not specified' rather than
-- dropped, so the column still totals to the participant count.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_industry_activity(target_event_id uuid)
RETURNS TABLE (
  industry text,
  participants bigint,
  connections_made bigint,
  participant_share numeric,
  industry_known boolean
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_event_analytics_access(target_event_id);

  -- A CTE rather than a temp table: a STABLE function may not write, and this
  -- needs to stay STABLE so it cannot be mistaken for something with effects.
  RETURN QUERY
  WITH participant AS (
    SELECT
      r.user_id,
      CASE WHEN COALESCE(btrim(p.industry), '') = ''
           THEN 'Not specified' ELSE btrim(p.industry) END AS industry,
      COALESCE(btrim(p.industry), '') <> '' AS known,
      (SELECT count(*) FROM connections c
        WHERE c.event_id = target_event_id
          AND (c.owner_id = r.user_id OR c.connected_user_id = r.user_id)) AS conns
    FROM event_registrations r
    LEFT JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = target_event_id
      AND r.status <> 'cancelled'
      AND EXISTS (
        SELECT 1 FROM connections c
        WHERE c.event_id = target_event_id
          AND (c.owner_id = r.user_id OR c.connected_user_id = r.user_id)
      )
  ),
  total AS (SELECT count(*) AS n FROM participant)
  SELECT
    pa.industry,
    count(*)::bigint,
    sum(pa.conns)::bigint,
    CASE WHEN (SELECT n FROM total) = 0 THEN 0::numeric
         ELSE round((count(*)::numeric * 100) / (SELECT n FROM total), 1) END,
    bool_and(pa.known)
  FROM participant pa
  GROUP BY pa.industry
  ORDER BY count(*) DESC, pa.industry;
END;
$$;

-- Industry A -> Industry B, counted once per connection from the owner's
-- industry to the other party's. Only pairs where both sides have an industry
-- recorded; a pair involving an unknown is not a cross-industry finding.
CREATE OR REPLACE FUNCTION public.event_industry_connections(target_event_id uuid)
RETURNS TABLE (
  industry_from text,
  industry_to text,
  connections_made bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_event_analytics_access(target_event_id);

  RETURN QUERY
  SELECT
    btrim(po.industry),
    btrim(pc.industry),
    count(*)::bigint
  FROM connections c
  JOIN profiles po ON po.id = c.owner_id
  JOIN profiles pc ON pc.id = c.connected_user_id
  WHERE c.event_id = target_event_id
    AND COALESCE(btrim(po.industry), '') <> ''
    AND COALESCE(btrim(pc.industry), '') <> ''
  GROUP BY 1, 2
  ORDER BY 3 DESC, 1, 2;
END;
$$;

-- ============================================================================
-- 6. Opportunities by stage
--
-- `value` is a bare numeric with no currency column anywhere in the schema, so
-- it is returned as a number and the caller must not label it with a symbol it
-- cannot know.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_opportunity_breakdown(target_event_id uuid)
RETURNS TABLE (
  stage text,
  opportunities bigint,
  total_value numeric
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_event_analytics_access(target_event_id);

  RETURN QUERY
  SELECT o.stage, count(*)::bigint, COALESCE(sum(o.value), 0)
  FROM opportunities o
  WHERE o.event_id = target_event_id
  GROUP BY o.stage
  ORDER BY count(*) DESC, o.stage;
END;
$$;

-- ============================================================================
-- Grants: authenticated only, never anon
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.event_networking_overview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_networking_timeline(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_industry_activity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_industry_connections(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_opportunity_breakdown(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_networking_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_networking_timeline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_industry_activity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_industry_connections(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_opportunity_breakdown(uuid) TO authenticated;
