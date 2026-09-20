/*
# Event manager access is assignment-based

## The hole
`read_own_organization_events` allowed any organization member to SELECT any
event the organization owns:

    organization_id IS NOT NULL AND public.is_org_member(organization_id)

`event_team` existed from Phase A and `can_manage_event` already consulted it,
so every *write* and every operational RPC was already assignment-aware. Reads
were not. A manager assigned to one event could list, open and read every other
event in the organization, including drafts — by the organization events list,
or by pasting an event id.

## The fix
The read policy now uses the same predicate as the writes. `can_manage_event`
already means exactly what is wanted here:

  - an owner or admin of the owning organization — organization-wide, unchanged;
  - or someone with an `event_team` row for *that* event who is still an
    organization member.

A manager with no assignment now matches no organization event at all. One
predicate governs read, write and every RPC, so there is no second definition
to drift.

## No new table
`event_team` is the assignment. It already has (event_id, user_id) uniqueness,
cascade deletes and the right indexes; Phase A created it for precisely this.
What was missing was a way to write it safely and the read policy above.

## Roles
Assigning is an owner/admin act, and only a member whose organization role is
`manager` can be assigned — assigning an owner or admin would be meaningless,
since they already reach every event in the organization.
*/

-- ============================================================================
-- Reads follow assignment
-- ============================================================================
-- The owner/admin branch is tested against the row's own organization_id
-- rather than through can_manage_event alone. can_manage_event resolves the
-- event by selecting from `events`, and it is STABLE, so during
-- INSERT ... RETURNING it cannot see the row being inserted — which made
-- creating a draft fail its own read policy. Testing organization_id directly
-- short-circuits for the creator; the assignment branch below still governs
-- managers.
DROP POLICY IF EXISTS "read_own_organization_events" ON events;
CREATE POLICY "read_own_organization_events"
  ON events FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND (
      public.is_org_admin(organization_id)
      OR public.can_manage_event(id)
    )
  );

-- ============================================================================
-- Assigning a manager to an event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_event_manager(
  target_event_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_archived timestamptz;
  v_role org_role;
BEGIN
  v_org := public.event_org_id(target_event_id);

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'That event does not belong to an organization';
  END IF;

  -- Only owners and admins hand out event access.
  PERFORM public.require_org_authority(v_org, 'admin');

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = target_event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived';
  END IF;

  SELECT m.role INTO v_role
  FROM organization_members m
  WHERE m.organization_id = v_org AND m.user_id = target_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'That person is not a member of this organization';
  END IF;

  -- Owners and admins already reach every event in the organization; an
  -- assignment row for them would imply a narrowing that does not exist.
  IF v_role <> 'manager' THEN
    RAISE EXCEPTION 'Only event managers are assigned to individual events. An % already has access to every event.', v_role;
  END IF;

  INSERT INTO event_team (event_id, user_id, assigned_by)
  VALUES (target_event_id, target_user_id, auth.uid())
  ON CONFLICT (event_id, user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_event_manager(
  target_event_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := public.event_org_id(target_event_id);

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'That event does not belong to an organization';
  END IF;

  PERFORM public.require_org_authority(v_org, 'admin');

  DELETE FROM event_team
  WHERE event_id = target_event_id AND user_id = target_user_id;
END;
$$;

-- Who is assigned to this event. Readable by anyone who can reach the event,
-- which by the policy above is an owner/admin or an assigned manager.
CREATE OR REPLACE FUNCTION public.event_team_list(target_event_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  job_title text,
  photo_url text,
  assigned_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT
    t.user_id,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(p.job_title, '') AS job_title,
    COALESCE(p.photo_url, '') AS photo_url,
    t.created_at AS assigned_at
  FROM event_team t
  LEFT JOIN profiles p ON p.id = t.user_id
  WHERE t.event_id = target_event_id
  ORDER BY t.created_at;
END;
$$;

-- ============================================================================
-- Organization-wide reads must respect assignment too
--
-- Both of these took require_org_authority(org_id, 'manager'), which admits any
-- member — so a manager assigned to one event could read attendee and count
-- data for every event in the organization. Both now aggregate only over
-- events the caller can actually reach.
-- ============================================================================
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
    AND public.can_manage_event(e.id)
  GROUP BY e.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.organization_people(org_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  job_title text,
  company text,
  photo_url text,
  events_registered bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_org_authority(org_id, 'manager');

  RETURN QUERY
  SELECT
    r.user_id,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(p.job_title, '') AS job_title,
    COALESCE(p.company, '')   AS company,
    COALESCE(p.photo_url, '') AS photo_url,
    count(*)                  AS events_registered,
    min(r.created_at)         AS first_seen,
    max(r.created_at)         AS last_seen
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE e.organization_id = org_id
    AND r.status <> 'cancelled'
    AND public.can_manage_event(e.id)
  GROUP BY r.user_id, p.full_name, p.job_title, p.company, p.photo_url
  ORDER BY max(r.created_at) DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_event_manager(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unassign_event_manager(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_team_list(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_event_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_people(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.assign_event_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_event_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_team_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_event_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_people(uuid) TO authenticated;
