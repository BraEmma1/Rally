/*
# Restrict platform admin access to partnership data

Partnerships are commercial relationships an organization manages for itself.
Platform administrators keep platform-wide aggregate figures and lose routine
access to individual partnership records, financial values, and any count
narrow enough to describe one organization's or one event's agreements.

## What changes
1. admin_list_partnerships is disabled for every client role. EXECUTE is
   revoked from PUBLIC, anon, authenticated and service_role (Supabase grants
   new functions to all three by default), and not granted back. The
   function is kept (not dropped) for compatibility and possible controlled
   future use; re-enabling it requires a reviewed migration. Without these
   grants the function cannot be called through PostgREST at all.
2. admin_get_event no longer returns the per-event partnership breakdown
   (draft / invited / active / completed / cancelled). At event level these
   are small numbers that describe individual agreements.
3. admin_get_organization no longer returns sponsor_partnerships, the number
   of agreements a specific sponsor company holds.
4. admin_activity_series refuses daily buckets for the partnerships metric.
   Weekly and monthly trends remain. Because bucket starts are aligned to the
   ISO week or month, no combination of ranges resolves finer than a week.
5. admin_platform_overview adds platform-wide draft and cancelled partnership
   counts beside total, active, invited and completed, so the agreed
   aggregates (total, active, completed, cancelled) are all available.

## What does not change
- No table, column, policy, storage policy or table grant.
- No organizer- or sponsor-facing function. Partnership tables are already
  readable only through can_manage_event (organizer membership), sponsor
  membership or the invited representative's own email; none of those paths
  has a platform-admin branch, and platform admins cannot hold organization
  membership.
- Every replaced function keeps its exact signature, so its EXECUTE grants
  (authenticated only) are untouched; they are re-asserted below anyway.

Forward-only. Reversal is a new migration restoring the M1 bodies
(20261020000000) and, if ever needed, re-granting admin_list_partnerships.
*/

-- ============================================================================
-- 1. Disable admin_list_partnerships for all client roles
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.admin_list_partnerships(text, text, uuid, uuid, uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_partnerships(text, text, uuid, uuid, uuid, text, integer, integer) IS
  'DISABLED (20261021000000): not executable by PUBLIC, anon, authenticated or service_role. Partnership records and values are organization-private. Retained for compatibility; re-enable only through a reviewed migration.';

-- ============================================================================
-- 2. admin_platform_overview — adds draft and cancelled partnership counts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_platform_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may view platform metrics' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'accounts', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active_attendees', count(*) FILTER (WHERE a.account_type = 'attendee' AND a.status = 'active'),
        'organizers', count(*) FILTER (WHERE a.account_type = 'organizer'),
        'pending_organizers', count(*) FILTER (WHERE a.account_type = 'organizer' AND a.status = 'pending_approval'),
        'platform_admins', count(*) FILTER (WHERE a.account_type = 'platform_admin'),
        'suspended', count(*) FILTER (WHERE a.status = 'suspended')
      )
      FROM user_accounts a
    ),
    'organizations', (
      SELECT jsonb_build_object(
        'total', count(*) FILTER (WHERE o.archived_at IS NULL),
        'archived', count(*) FILTER (WHERE o.archived_at IS NOT NULL),
        'pending', count(*) FILTER (WHERE o.archived_at IS NULL AND o.approval_status = 'pending'),
        'approved', count(*) FILTER (WHERE o.archived_at IS NULL AND o.approval_status = 'approved'),
        'organizer', count(*) FILTER (WHERE o.archived_at IS NULL AND o.org_type = 'organizer'),
        'sponsor', count(*) FILTER (WHERE o.archived_at IS NULL AND o.org_type = 'sponsor'),
        'vendor', count(*) FILTER (WHERE o.archived_at IS NULL AND o.org_type = 'vendor')
      )
      FROM organizations o
    ),
    'events', (
      SELECT jsonb_build_object(
        'total', count(*),
        'published', count(*) FILTER (WHERE e.archived_at IS NULL AND e.visibility = 'published'),
        'unlisted', count(*) FILTER (WHERE e.archived_at IS NULL AND e.visibility = 'unlisted'),
        'draft', count(*) FILTER (WHERE e.archived_at IS NULL AND e.visibility = 'draft'),
        'archived', count(*) FILTER (WHERE e.archived_at IS NOT NULL)
      )
      FROM events e
    ),
    -- Platform-wide status counts only: no values, no per-event or
    -- per-organization breakdown.
    'partnerships', (
      SELECT jsonb_build_object(
        'total', count(*),
        'draft', count(*) FILTER (WHERE p.status = 'draft'),
        'invited', count(*) FILTER (WHERE p.status = 'invited'),
        'active', count(*) FILTER (WHERE p.status = 'active'),
        'completed', count(*) FILTER (WHERE p.status = 'completed'),
        'cancelled', count(*) FILTER (WHERE p.status = 'cancelled')
      )
      FROM event_partnerships p
    ),
    'registrations', (
      SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE r.status NOT IN ('cancelled', 'waitlisted')),
        'checked_in', count(*) FILTER (WHERE r.checked_in_at IS NOT NULL),
        'waitlisted', count(*) FILTER (WHERE r.status = 'waitlisted'),
        'cancelled', count(*) FILTER (WHERE r.status = 'cancelled')
      )
      FROM event_registrations r
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_platform_overview() IS
  'Platform admin only. Aggregate counts for the admin overview; partnerships as platform-wide status counts only. Read-only.';

-- ============================================================================
-- 3. admin_get_organization — drops sponsor_partnerships
-- ============================================================================
-- Returns NULL when no organization has that id.
CREATE OR REPLACE FUNCTION public.admin_get_organization(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may view organizations' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'description', o.description,
      'website', NULLIF(btrim(o.website), ''),
      'logo_url', NULLIF(btrim(o.logo_url), ''),
      'org_type', o.org_type,
      'approval_status', o.approval_status,
      'approved_at', o.approved_at,
      'approved_by', o.approved_by,
      'approved_by_name', (SELECT NULLIF(btrim(ap.full_name), '') FROM profiles ap WHERE ap.id = o.approved_by),
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'archived_at', o.archived_at,
      'created_by', o.created_by,
      'created_by_name', (SELECT NULLIF(btrim(cp.full_name), '') FROM profiles cp WHERE cp.id = o.created_by)
    ),
    'member_count', (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'full_name', NULLIF(btrim(p.full_name), ''),
               'photo_url', NULLIF(btrim(p.photo_url), ''),
               'role', m.role,
               'account_type', a.account_type,
               'account_status', a.status,
               'joined_at', m.created_at
             ) ORDER BY m.role, m.created_at, m.user_id)
      FROM (
        SELECT * FROM organization_members mm
        WHERE mm.organization_id = o.id
        ORDER BY mm.role, mm.created_at, mm.user_id
        LIMIT 200
      ) m
      LEFT JOIN profiles p ON p.id = m.user_id
      LEFT JOIN user_accounts a ON a.user_id = m.user_id
    ), '[]'::jsonb),
    'event_count', (SELECT count(*) FROM events e WHERE e.organization_id = o.id),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id,
               'name', e.name,
               'start_date', e.start_date,
               'end_date', e.end_date,
               'status', e.status,
               'visibility', e.visibility,
               'published_at', e.published_at,
               'archived_at', e.archived_at,
               'active_registrations', (
                 SELECT count(*) FROM event_registrations r
                 WHERE r.event_id = e.id AND r.status NOT IN ('cancelled', 'waitlisted'))
             ) ORDER BY e.start_date DESC NULLS LAST, e.id)
      FROM (
        SELECT * FROM events ee
        WHERE ee.organization_id = o.id
        ORDER BY ee.start_date DESC NULLS LAST, ee.id
        LIMIT 50
      ) e
    ), '[]'::jsonb),
    'pending_invitations', (
      SELECT count(*) FROM organization_invitations i
      WHERE i.organization_id = o.id AND i.status = 'pending')
  )
  INTO v_result
  FROM organizations o
  WHERE o.id = p_org_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_organization(uuid) IS
  'Platform admin only. Organization detail: members (public card fields only), up to 50 events, counts. No invitee or member emails, no partnership data.';

-- ============================================================================
-- 4. admin_get_event — drops the per-event partnership breakdown
-- ============================================================================
-- Returns NULL when no event has that id. Counts only: no attendee identities.
CREATE OR REPLACE FUNCTION public.admin_get_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may view events' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'description', e.description,
      'location', e.location,
      'image_url', NULLIF(btrim(e.image_url), ''),
      'start_date', e.start_date,
      'end_date', e.end_date,
      'start_time', e.start_time,
      'end_time', e.end_time,
      'timezone', e.timezone,
      'status', e.status,
      'visibility', e.visibility,
      'capacity', e.capacity,
      'published_at', e.published_at,
      'archived_at', e.archived_at,
      'created_at', e.created_at,
      'created_by', e.created_by,
      'created_by_name', (SELECT NULLIF(btrim(cp.full_name), '') FROM profiles cp WHERE cp.id = e.created_by)
    ),
    'organization', (
      SELECT jsonb_build_object('id', o.id, 'name', o.name, 'org_type', o.org_type, 'approval_status', o.approval_status)
      FROM organizations o WHERE o.id = e.organization_id
    ),
    'registrations', (
      SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE r.status NOT IN ('cancelled', 'waitlisted')),
        'checked_in', count(*) FILTER (WHERE r.checked_in_at IS NOT NULL),
        'waitlisted', count(*) FILTER (WHERE r.status = 'waitlisted'),
        'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'),
        'total', count(*))
      FROM event_registrations r WHERE r.event_id = e.id
    ),
    'team_size', (SELECT count(*) FROM event_team t WHERE t.event_id = e.id),
    'sessions', (SELECT count(*) FROM event_sessions s WHERE s.event_id = e.id),
    'speakers', (SELECT count(*) FROM event_speakers sp WHERE sp.event_id = e.id),
    'exhibitors', (SELECT count(*) FROM event_exhibitors x WHERE x.event_id = e.id)
  )
  INTO v_result
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_event(uuid) IS
  'Platform admin only. Event detail with registration, team and programme counts. No attendee identities, no partnership data.';

-- ============================================================================
-- 5. admin_activity_series — partnerships limited to weekly or monthly buckets
-- ============================================================================
-- Zero-filled counts per UTC day, ISO week (Monday) or month, plus a running
-- total that starts from everything before the first bucket. Rows without a
-- timestamp are reported as "undated" rather than dropped silently.
CREATE OR REPLACE FUNCTION public.admin_activity_series(
  p_metric text,
  p_period text DEFAULT 'day',
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_metric text := NULLIF(btrim(COALESCE(p_metric, '')), '');
  v_period text := COALESCE(NULLIF(btrim(p_period), ''), 'day');
  v_step interval;
  v_to date := COALESCE(p_to, (now() AT TIME ZONE 'UTC')::date);
  v_from date;
  v_start date;
  v_end date;
  v_buckets integer;
  v_max integer;
  v_baseline bigint;
  v_undated bigint;
  v_series jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may view platform activity' USING ERRCODE = '42501';
  END IF;
  IF v_metric IS NULL OR v_metric NOT IN (
       'accounts', 'organizer_accounts', 'organizations', 'events_created',
       'events_published', 'partnerships', 'registrations') THEN
    RAISE EXCEPTION 'Unknown metric: %', COALESCE(v_metric, '(none)') USING ERRCODE = '22023';
  END IF;
  IF v_period NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Unknown period: %', v_period USING ERRCODE = '22023';
  END IF;
  -- Daily partnership counts can date an individual agreement. Weekly and
  -- monthly buckets are aligned to their period start, so no combination of
  -- ranges resolves finer than one ISO week.
  IF v_metric = 'partnerships' AND v_period = 'day' THEN
    RAISE EXCEPTION 'Partnership activity is available by week or month only' USING ERRCODE = '22023';
  END IF;

  v_step := ('1 ' || v_period)::interval;
  v_max := CASE v_period WHEN 'day' THEN 92 WHEN 'week' THEN 104 ELSE 60 END;
  v_from := COALESCE(p_from, CASE v_period
    WHEN 'day' THEN v_to - 29
    WHEN 'week' THEN (v_to - interval '11 weeks')::date
    ELSE (v_to - interval '11 months')::date END);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'The start of the date range is after its end' USING ERRCODE = '22023';
  END IF;

  v_start := date_trunc(v_period, v_from::timestamp)::date;
  v_end := date_trunc(v_period, v_to::timestamp)::date;
  SELECT count(*) INTO v_buckets FROM generate_series(v_start::timestamp, v_end::timestamp, v_step);
  IF v_buckets > v_max THEN
    RAISE EXCEPTION 'That range has % % buckets; the limit is %', v_buckets, v_period, v_max USING ERRCODE = '22023';
  END IF;

  WITH src AS (
    SELECT a.created_at AS ts FROM user_accounts a WHERE v_metric = 'accounts'
    UNION ALL
    SELECT a.created_at FROM user_accounts a WHERE v_metric = 'organizer_accounts' AND a.account_type = 'organizer'
    UNION ALL
    SELECT o.created_at FROM organizations o WHERE v_metric = 'organizations'
    UNION ALL
    SELECT e.created_at FROM events e WHERE v_metric = 'events_created'
    UNION ALL
    -- An unpublished event has no publication time; it is not "undated".
    SELECT e.published_at FROM events e WHERE v_metric = 'events_published' AND e.published_at IS NOT NULL
    UNION ALL
    SELECT p.created_at FROM event_partnerships p WHERE v_metric = 'partnerships'
    UNION ALL
    SELECT r.created_at FROM event_registrations r WHERE v_metric = 'registrations' AND r.status <> 'cancelled'
  ),
  stamped AS (
    SELECT (s.ts AT TIME ZONE 'UTC') AS ts_utc FROM src s
  ),
  counts AS (
    SELECT date_trunc(v_period, st.ts_utc)::date AS bucket, count(*) AS n
    FROM stamped st
    WHERE st.ts_utc >= v_start::timestamp AND st.ts_utc < (v_end::timestamp + v_step)
    GROUP BY 1
  ),
  series AS (
    SELECT g::date AS bucket FROM generate_series(v_start::timestamp, v_end::timestamp, v_step) g
  )
  SELECT
    (SELECT count(*) FROM stamped st WHERE st.ts_utc < v_start::timestamp),
    (SELECT count(*) FROM stamped st WHERE st.ts_utc IS NULL),
    (SELECT jsonb_agg(jsonb_build_object('bucket_start', x.bucket, 'count', x.n, 'running', x.running) ORDER BY x.bucket)
       FROM (
         SELECT se.bucket, COALESCE(c.n, 0) AS n,
                sum(COALESCE(c.n, 0)) OVER (ORDER BY se.bucket) AS running
         FROM series se LEFT JOIN counts c ON c.bucket = se.bucket
       ) x)
  INTO v_baseline, v_undated, v_series;

  -- running becomes cumulative by adding everything before the first bucket.
  SELECT jsonb_agg(jsonb_build_object(
           'bucket_start', b->'bucket_start',
           'count', b->'count',
           'cumulative', v_baseline + (b->>'running')::bigint) ORDER BY ord)
    INTO v_series
  FROM jsonb_array_elements(v_series) WITH ORDINALITY AS t(b, ord);

  RETURN jsonb_build_object(
    'metric', v_metric,
    'period', v_period,
    'timezone', 'UTC',
    'from', v_start,
    'to', v_end,
    'before_range', v_baseline,
    'undated', v_undated,
    'buckets', COALESCE(v_series, '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.admin_activity_series(text, text, date, date) IS
  'Platform admin only. Zero-filled activity counts per UTC day, ISO week or month, with a cumulative total. Partnerships by week or month only.';

-- ============================================================================
-- Grants for the replaced functions, re-asserted (unchanged from M1):
-- authenticated callers only; authorization is checked inside.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.admin_platform_overview() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_organization(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_activity_series(text, text, date, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_platform_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_series(text, text, date, date) TO authenticated;
