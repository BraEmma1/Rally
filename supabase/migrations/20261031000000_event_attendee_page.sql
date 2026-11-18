/*
# Organizer attendee list: server-side search, status filter and pagination

## Why

The organizer Attendees panel loaded every registration of an event through
find_event_attendees and filtered by status in the browser. For a large event
that is one unbounded response, client-side filtering, no total count and an
order that is not deterministic (ties on name are left to the planner).

## What

event_attendee_page(target_event_id, search, status_filter, page_size, page_offset)
returns one page of the same public professional card find_event_attendees
returns, plus total_count: the number of registrations matching the search and
filter, before paging. The result is always exactly one row (total_count,
attendees jsonb array), so the total is known even when the requested page is
empty: no matches, or a page past the end, e.g. after registrations changed.

- Authorization is find_event_attendees' gate, unchanged:
  can_manage_event(event) AND account_is_active(). Owners and admins of the
  event's organization and managers assigned to the event pass; an unassigned
  manager, anyone outside the organization and a suspended account are refused.
- Fields are exactly find_event_attendees' (name, job title, company, photo,
  status, registration time, check-in time). No email, phone or contact-consent
  column is read.
- Search is case-insensitive partial matching on name and company, the two
  fields find_event_attendees already searched. LIKE wildcards in the search
  text are escaped, so "%" and "_" match themselves.
- Filters mirror src/lib/registrationStatus.ts and migration 20261030000000.
  Confirmed = registered or checked_in. Arrival is checked_in_at, never status.
    all | confirmed | checked_in (confirmed, arrived) |
    not_checked_in (confirmed, not arrived) | waitlisted | cancelled
  Any other value is refused rather than silently treated as "all".
- Search and filter apply before paging. Order: name (case-insensitive), then
  name, registration time, registration id, so every row has one fixed place
  and pages never overlap or skip.
- page_size defaults to 20 and is clamped to 1..100; page_offset to >= 0.

find_event_attendees is left unchanged: the check-in desk still uses it.

Forward-only. Do not edit once applied.
*/

CREATE OR REPLACE FUNCTION public.event_attendee_page(
  target_event_id uuid,
  search text DEFAULT '',
  status_filter text DEFAULT 'all',
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
-- Always exactly one row, so the total survives an empty or out-of-range page:
--   total_count  registrations matching search + filter, before paging
--   attendees    the requested page, a JSON array (possibly empty) of
--                {user_id, full_name, job_title, company, photo_url, status,
--                 registered_at, checked_in_at}, in page order
RETURNS TABLE (
  total_count bigint,
  attendees jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_needle  text    := lower(btrim(COALESCE(search, '')));
  v_pattern text;
  v_filter  text    := COALESCE(status_filter, 'all');
  v_size    integer := LEAST(GREATEST(COALESCE(page_size, 20), 1), 100);
  v_offset  integer := GREATEST(COALESCE(page_offset, 0), 0);
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  IF v_filter NOT IN ('all', 'confirmed', 'checked_in', 'not_checked_in', 'waitlisted', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown attendee filter';
  END IF;

  -- Escape LIKE's own characters so the search text is matched literally.
  v_pattern := '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  WITH matched AS (
    SELECT
      r.id                      AS reg_id,
      r.user_id                 AS m_user_id,
      COALESCE(p.full_name, '') AS m_full_name,
      COALESCE(p.job_title, '') AS m_job_title,
      COALESCE(p.company, '')   AS m_company,
      COALESCE(p.photo_url, '') AS m_photo_url,
      r.status                  AS m_status,
      r.created_at              AS m_registered_at,
      r.checked_in_at           AS m_checked_in_at
    FROM event_registrations r
    LEFT JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = target_event_id
      AND (
        v_needle = ''
        OR lower(COALESCE(p.full_name, '')) LIKE v_pattern ESCAPE '\'
        OR lower(COALESCE(p.company, ''))   LIKE v_pattern ESCAPE '\'
      )
      AND CASE v_filter
            WHEN 'all'            THEN true
            WHEN 'confirmed'      THEN r.status IN ('registered', 'checked_in')
            WHEN 'checked_in'     THEN r.status IN ('registered', 'checked_in') AND r.checked_in_at IS NOT NULL
            WHEN 'not_checked_in' THEN r.status IN ('registered', 'checked_in') AND r.checked_in_at IS NULL
            WHEN 'waitlisted'     THEN r.status = 'waitlisted'
            WHEN 'cancelled'      THEN r.status = 'cancelled'
          END
  )
  , page AS (
    SELECT m.*
    FROM matched m
    ORDER BY lower(m.m_full_name), m.m_full_name, m.m_registered_at, m.reg_id
    LIMIT v_size OFFSET v_offset
  )
  SELECT
    (SELECT count(*) FROM matched)::bigint,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id',       pg.m_user_id,
                  'full_name',     pg.m_full_name,
                  'job_title',     pg.m_job_title,
                  'company',       pg.m_company,
                  'photo_url',     pg.m_photo_url,
                  'status',        pg.m_status,
                  'registered_at', pg.m_registered_at,
                  'checked_in_at', pg.m_checked_in_at
                )
                ORDER BY lower(pg.m_full_name), pg.m_full_name, pg.m_registered_at, pg.reg_id
              )
         FROM page pg),
      '[]'::jsonb
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_attendee_page(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_attendee_page(uuid, text, text, integer, integer) TO authenticated;
