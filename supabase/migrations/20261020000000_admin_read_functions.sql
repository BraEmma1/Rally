/*
# Platform admin read functions (M1)

Read-only access for the platform admin workspace. Until now an administrator
could read user_accounts and account_type_changes and nothing else: there is
no admin policy on organizations, members, private events, registrations or
partnerships, so the dashboard could only say "unavailable".

Rather than add admin SELECT policies to those tables — which would hand an
admin every column, including contact details, internal notes and
representative emails — each function here returns a fixed, explicit set of
fields.

## Rules every function follows
- First statement: refuse unless public.is_platform_admin(), which requires an
  active platform_admin account (a suspended admin is refused immediately).
  The error uses SQLSTATE 42501 (insufficient_privilege).
- SECURITY DEFINER, STABLE, search_path pinned to public, pg_temp.
- EXECUTE revoked from PUBLIC, anon and authenticated, then granted back to
  authenticated only. Authorization is decided inside the function.
- Explicit fields only. Never returned: email, phone, contact_email,
  contact_phone, invited_email, representative_email, internal_notes,
  documents, obligation evidence.
- Lists return jsonb { total, limit, offset, rows }. total is computed on its
  own, so it stays correct when the requested page is past the end.
- p_limit is clamped to 1..100 (default 25); p_offset to >= 0.
- Search text is trimmed, capped at 100 characters and has LIKE wildcards
  escaped, so user input can never become a pattern.

## Product decisions applied
- Administrators may see draft and unlisted events (metadata in lists, the
  description only in admin_get_event).
- Partnership values are visible, always paired with their currency. Totals
  are per currency, never summed across currencies.
- Organization approval is reported, not enforced. Enforcement is deferred.

## Definitions worth knowing
- "Checked in" means checked_in_at IS NOT NULL — the column the check-in
  function always sets. Some older rows have checked_in_at set while status
  is still 'registered'.
- "Active registrations" means status NOT IN ('cancelled', 'waitlisted').
- Activity series bucket in UTC. organizer_accounts counts accounts whose
  current type is organizer, by creation date; type changes move accounts
  between series, and their true history is account_type_changes.

Read-only: no table, policy, grant on a table or existing function changes.
*/

-- ============================================================================
-- admin_platform_overview
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
    'partnerships', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE p.status = 'active'),
        'invited', count(*) FILTER (WHERE p.status = 'invited'),
        'completed', count(*) FILTER (WHERE p.status = 'completed')
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
  'Platform admin only. Aggregate counts for the admin overview. Read-only.';

-- ============================================================================
-- admin_list_users
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_type account_type DEFAULT NULL,
  p_status account_status DEFAULT NULL,
  p_sort text DEFAULT 'newest',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_pattern text;
  v_sort text := COALESCE(NULLIF(btrim(p_sort), ''), 'newest');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may list users' USING ERRCODE = '42501';
  END IF;
  IF v_sort NOT IN ('newest', 'oldest', 'recently_updated', 'name') THEN
    RAISE EXCEPTION 'Unknown sort: %', v_sort USING ERRCODE = '22023';
  END IF;
  IF length(v_search) > 100 THEN
    RAISE EXCEPTION 'Search text is too long' USING ERRCODE = '22023';
  END IF;
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH filtered AS (
    SELECT a.user_id, a.account_type, a.status, a.created_at, a.updated_at,
           a.approved_at, a.approved_by,
           NULLIF(btrim(p.full_name), '') AS full_name,
           NULLIF(btrim(p.photo_url), '') AS photo_url,
           NULLIF(btrim(p.job_title), '') AS job_title,
           NULLIF(btrim(p.company), '') AS company
    FROM user_accounts a
    LEFT JOIN profiles p ON p.id = a.user_id
    WHERE (p_type IS NULL OR a.account_type = p_type)
      AND (p_status IS NULL OR a.status = p_status)
      AND (v_pattern IS NULL
           OR p.full_name ILIKE v_pattern ESCAPE '\'
           OR p.company ILIKE v_pattern ESCAPE '\')
  ),
  ranked AS (
    SELECT f.*,
           row_number() OVER (ORDER BY
             CASE WHEN v_sort = 'newest' THEN f.created_at END DESC NULLS LAST,
             CASE WHEN v_sort = 'oldest' THEN f.created_at END ASC NULLS LAST,
             CASE WHEN v_sort = 'recently_updated' THEN f.updated_at END DESC NULLS LAST,
             CASE WHEN v_sort = 'name' THEN lower(f.full_name) END ASC NULLS LAST,
             f.user_id) AS rn
    FROM filtered f
  )
  SELECT (SELECT count(*) FROM filtered),
         COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', r.user_id,
           'full_name', r.full_name,
           'photo_url', r.photo_url,
           'job_title', r.job_title,
           'company', r.company,
           'account_type', r.account_type,
           'status', r.status,
           'created_at', r.created_at,
           'updated_at', r.updated_at,
           'approved_at', r.approved_at,
           'approved_by', r.approved_by,
           'approved_by_name', (SELECT NULLIF(btrim(ap.full_name), '') FROM profiles ap WHERE ap.id = r.approved_by)
         ) ORDER BY r.rn) FILTER (WHERE r.rn IS NOT NULL), '[]'::jsonb)
    INTO v_total, v_rows
  FROM (SELECT * FROM ranked WHERE rn > v_offset AND rn <= v_offset + v_limit) r;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.admin_list_users(text, account_type, account_status, text, integer, integer) IS
  'Platform admin only. Paginated account directory with public profile fields; no email or phone.';

-- ============================================================================
-- admin_list_organizations
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_organizations(
  p_search text DEFAULT NULL,
  p_org_type org_type DEFAULT NULL,
  p_approval_status org_approval_status DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_sort text DEFAULT 'newest',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_pattern text;
  v_sort text := COALESCE(NULLIF(btrim(p_sort), ''), 'newest');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may list organizations' USING ERRCODE = '42501';
  END IF;
  IF v_sort NOT IN ('newest', 'oldest', 'name') THEN
    RAISE EXCEPTION 'Unknown sort: %', v_sort USING ERRCODE = '22023';
  END IF;
  IF length(v_search) > 100 THEN
    RAISE EXCEPTION 'Search text is too long' USING ERRCODE = '22023';
  END IF;
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH filtered AS (
    SELECT o.id, o.name, o.slug, o.org_type, o.approval_status, o.approved_at,
           o.created_at, o.archived_at, o.created_by,
           NULLIF(btrim(o.logo_url), '') AS logo_url
    FROM organizations o
    WHERE (p_org_type IS NULL OR o.org_type = p_org_type)
      AND (p_approval_status IS NULL OR o.approval_status = p_approval_status)
      AND (COALESCE(p_include_archived, false) OR o.archived_at IS NULL)
      AND (v_pattern IS NULL
           OR o.name ILIKE v_pattern ESCAPE '\'
           OR o.slug ILIKE v_pattern ESCAPE '\')
  ),
  ranked AS (
    SELECT f.*,
           row_number() OVER (ORDER BY
             CASE WHEN v_sort = 'newest' THEN f.created_at END DESC NULLS LAST,
             CASE WHEN v_sort = 'oldest' THEN f.created_at END ASC NULLS LAST,
             CASE WHEN v_sort = 'name' THEN lower(f.name) END ASC NULLS LAST,
             f.id) AS rn
    FROM filtered f
  )
  SELECT (SELECT count(*) FROM filtered),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'name', r.name,
           'slug', r.slug,
           'logo_url', r.logo_url,
           'org_type', r.org_type,
           'approval_status', r.approval_status,
           'approved_at', r.approved_at,
           'created_at', r.created_at,
           'archived_at', r.archived_at,
           'created_by', r.created_by,
           'created_by_name', (SELECT NULLIF(btrim(cp.full_name), '') FROM profiles cp WHERE cp.id = r.created_by),
           'member_count', (SELECT count(*) FROM organization_members m WHERE m.organization_id = r.id),
           'event_count', (SELECT count(*) FROM events e WHERE e.organization_id = r.id)
         ) ORDER BY r.rn) FILTER (WHERE r.rn IS NOT NULL), '[]'::jsonb)
    INTO v_total, v_rows
  FROM (SELECT * FROM ranked WHERE rn > v_offset AND rn <= v_offset + v_limit) r;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.admin_list_organizations(text, org_type, org_approval_status, boolean, text, integer, integer) IS
  'Platform admin only. Paginated organization directory with member and event counts.';

-- ============================================================================
-- admin_get_organization
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
      WHERE i.organization_id = o.id AND i.status = 'pending'),
    'sponsor_partnerships', (
      SELECT count(*) FROM event_partnerships sp WHERE sp.sponsor_organization_id = o.id)
  )
  INTO v_result
  FROM organizations o
  WHERE o.id = p_org_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_organization(uuid) IS
  'Platform admin only. Organization detail: members (public card fields only), up to 50 events, counts. No invitee or member emails.';

-- ============================================================================
-- admin_list_events
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_events(
  p_search text DEFAULT NULL,
  p_visibility text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_sort text DEFAULT 'start_desc',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_pattern text;
  v_visibility text := NULLIF(btrim(COALESCE(p_visibility, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_sort text := COALESCE(NULLIF(btrim(p_sort), ''), 'start_desc');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may list events' USING ERRCODE = '42501';
  END IF;
  IF v_visibility IS NOT NULL AND v_visibility NOT IN ('draft', 'published', 'unlisted') THEN
    RAISE EXCEPTION 'Unknown visibility: %', v_visibility USING ERRCODE = '22023';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('upcoming', 'live', 'past') THEN
    RAISE EXCEPTION 'Unknown status: %', v_status USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('start_desc', 'start_asc', 'newest', 'name') THEN
    RAISE EXCEPTION 'Unknown sort: %', v_sort USING ERRCODE = '22023';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'The start of the date range is after its end' USING ERRCODE = '22023';
  END IF;
  IF length(v_search) > 100 THEN
    RAISE EXCEPTION 'Search text is too long' USING ERRCODE = '22023';
  END IF;
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH filtered AS (
    SELECT e.id, e.name, e.location, e.organization_id, e.start_date, e.end_date,
           e.start_time, e.end_time, e.timezone, e.status, e.visibility,
           e.published_at, e.archived_at, e.created_at, e.capacity
    FROM events e
    WHERE (v_visibility IS NULL OR e.visibility = v_visibility)
      AND (v_status IS NULL OR e.status = v_status)
      AND (p_organization_id IS NULL OR e.organization_id = p_organization_id)
      AND (p_from IS NULL OR e.start_date >= p_from)
      AND (p_to IS NULL OR e.start_date <= p_to)
      AND (COALESCE(p_include_archived, false) OR e.archived_at IS NULL)
      AND (v_pattern IS NULL
           OR e.name ILIKE v_pattern ESCAPE '\'
           OR e.location ILIKE v_pattern ESCAPE '\')
  ),
  ranked AS (
    SELECT f.*,
           row_number() OVER (ORDER BY
             CASE WHEN v_sort = 'start_desc' THEN f.start_date END DESC NULLS LAST,
             CASE WHEN v_sort = 'start_asc' THEN f.start_date END ASC NULLS LAST,
             CASE WHEN v_sort = 'newest' THEN f.created_at END DESC NULLS LAST,
             CASE WHEN v_sort = 'name' THEN lower(f.name) END ASC NULLS LAST,
             f.id) AS rn
    FROM filtered f
  )
  SELECT (SELECT count(*) FROM filtered),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'name', r.name,
           'location', r.location,
           'organization_id', r.organization_id,
           'organization_name', (SELECT o.name FROM organizations o WHERE o.id = r.organization_id),
           'start_date', r.start_date,
           'end_date', r.end_date,
           'start_time', r.start_time,
           'end_time', r.end_time,
           'timezone', r.timezone,
           'status', r.status,
           'visibility', r.visibility,
           'published_at', r.published_at,
           'archived_at', r.archived_at,
           'created_at', r.created_at,
           'capacity', r.capacity,
           'registrations', (
             SELECT jsonb_build_object(
               'active', count(*) FILTER (WHERE g.status NOT IN ('cancelled', 'waitlisted')),
               'checked_in', count(*) FILTER (WHERE g.checked_in_at IS NOT NULL),
               'waitlisted', count(*) FILTER (WHERE g.status = 'waitlisted'),
               'cancelled', count(*) FILTER (WHERE g.status = 'cancelled'))
             FROM event_registrations g WHERE g.event_id = r.id)
         ) ORDER BY r.rn) FILTER (WHERE r.rn IS NOT NULL), '[]'::jsonb)
    INTO v_total, v_rows
  FROM (SELECT * FROM ranked WHERE rn > v_offset AND rn <= v_offset + v_limit) r;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.admin_list_events(text, text, text, uuid, date, date, boolean, text, integer, integer) IS
  'Platform admin only. Paginated platform-wide event directory, drafts and unlisted included, with registration counts.';

-- ============================================================================
-- admin_get_event
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
    'exhibitors', (SELECT count(*) FROM event_exhibitors x WHERE x.event_id = e.id),
    'partnerships', (
      SELECT jsonb_build_object(
        'total', count(*),
        'draft', count(*) FILTER (WHERE p.status = 'draft'),
        'invited', count(*) FILTER (WHERE p.status = 'invited'),
        'active', count(*) FILTER (WHERE p.status = 'active'),
        'completed', count(*) FILTER (WHERE p.status = 'completed'),
        'cancelled', count(*) FILTER (WHERE p.status = 'cancelled'))
      FROM event_partnerships p WHERE p.event_id = e.id
    )
  )
  INTO v_result
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_event(uuid) IS
  'Platform admin only. Event detail with registration, team, programme and partnership counts. No attendee identities.';

-- ============================================================================
-- admin_list_partnerships
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_partnerships(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_sponsor_org_id uuid DEFAULT NULL,
  p_organizer_org_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'newest',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_pattern text;
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_sort text := COALESCE(NULLIF(btrim(p_sort), ''), 'newest');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform administrator may list partnerships' USING ERRCODE = '42501';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'invited', 'active', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown status: %', v_status USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('newest', 'oldest', 'company', 'value_desc') THEN
    RAISE EXCEPTION 'Unknown sort: %', v_sort USING ERRCODE = '22023';
  END IF;
  IF length(v_search) > 100 THEN
    RAISE EXCEPTION 'Search text is too long' USING ERRCODE = '22023';
  END IF;
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  -- internal_notes, representative_email and description are never selected.
  WITH filtered AS (
    SELECT p.id, p.event_id, p.sponsor_organization_id, p.company_name, p.tier_label,
           p.status, p.acknowledged_at, p.value_amount, p.value_currency,
           p.created_at, p.updated_at,
           e.name AS event_name, e.start_date AS event_start_date,
           e.organization_id AS organizer_organization_id
    FROM event_partnerships p
    JOIN events e ON e.id = p.event_id
    WHERE (v_status IS NULL OR p.status = v_status)
      AND (p_event_id IS NULL OR p.event_id = p_event_id)
      AND (p_sponsor_org_id IS NULL OR p.sponsor_organization_id = p_sponsor_org_id)
      AND (p_organizer_org_id IS NULL OR e.organization_id = p_organizer_org_id)
      AND (v_pattern IS NULL
           OR p.company_name ILIKE v_pattern ESCAPE '\'
           OR e.name ILIKE v_pattern ESCAPE '\')
  ),
  ranked AS (
    SELECT f.*,
           row_number() OVER (ORDER BY
             CASE WHEN v_sort = 'newest' THEN f.created_at END DESC NULLS LAST,
             CASE WHEN v_sort = 'oldest' THEN f.created_at END ASC NULLS LAST,
             CASE WHEN v_sort = 'company' THEN lower(f.company_name) END ASC NULLS LAST,
             CASE WHEN v_sort = 'value_desc' THEN f.value_amount END DESC NULLS LAST,
             f.id) AS rn
    FROM filtered f
  )
  SELECT (SELECT count(*) FROM filtered),
         -- Totals per currency across the whole filtered set. Amounts in
         -- different currencies are never added together.
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'currency', t.value_currency, 'total', t.total, 'partnerships', t.n)
                 ORDER BY t.value_currency NULLS LAST), '[]'::jsonb)
          FROM (SELECT f2.value_currency, sum(f2.value_amount) AS total, count(*) AS n
                FROM filtered f2 WHERE f2.value_amount IS NOT NULL
                GROUP BY f2.value_currency) t),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'event_id', r.event_id,
           'event_name', r.event_name,
           'event_start_date', r.event_start_date,
           'organizer_organization_id', r.organizer_organization_id,
           'organizer_organization_name', (SELECT o.name FROM organizations o WHERE o.id = r.organizer_organization_id),
           'sponsor_organization_id', r.sponsor_organization_id,
           'sponsor_organization_name', (SELECT so.name FROM organizations so WHERE so.id = r.sponsor_organization_id),
           'company_name', r.company_name,
           'tier_label', r.tier_label,
           'status', r.status,
           'acknowledged_at', r.acknowledged_at,
           'value_amount', r.value_amount,
           'value_currency', r.value_currency,
           'created_at', r.created_at,
           'updated_at', r.updated_at,
           'obligations_total', (SELECT count(*) FROM event_partnership_obligations ob WHERE ob.partnership_id = r.id),
           'obligations_completed', (SELECT count(*) FROM event_partnership_obligations ob WHERE ob.partnership_id = r.id AND ob.status = 'completed')
         ) ORDER BY r.rn) FILTER (WHERE r.rn IS NOT NULL), '[]'::jsonb)
    INTO v_total, v_totals, v_rows
  FROM (SELECT * FROM ranked WHERE rn > v_offset AND rn <= v_offset + v_limit) r;

  RETURN jsonb_build_object(
    'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'value_totals', v_totals, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.admin_list_partnerships(text, text, uuid, uuid, uuid, text, integer, integer) IS
  'Platform admin only. Paginated partnerships with values and currency, per-currency totals. Never internal notes, representative email, documents or evidence.';

-- ============================================================================
-- admin_activity_series
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
  'Platform admin only. Zero-filled activity counts per UTC day, ISO week or month, with a cumulative total.';

-- ============================================================================
-- Grants: authenticated callers only; authorization is checked inside.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.admin_platform_overview() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_users(text, account_type, account_status, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_organizations(text, org_type, org_approval_status, boolean, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_organization(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_events(text, text, text, uuid, date, date, boolean, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_partnerships(text, text, uuid, uuid, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_activity_series(text, text, date, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_platform_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, account_type, account_status, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations(text, org_type, org_approval_status, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_events(text, text, text, uuid, date, date, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_partnerships(text, text, uuid, uuid, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_series(text, text, date, date) TO authenticated;
