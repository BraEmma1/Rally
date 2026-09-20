/*
# Organizer Phase C — the People directory

One aggregate read behind the organizer People screen: everyone who has
registered for any event this organization owns, with how many of them they
have attended. Without it the screen would call event_attendee_list once per
event and stitch the results together in the browser.

Same privacy rule as everywhere else in the organizer surface: the public
professional card and nothing more. No email, no phone. The consent columns on
event_registrations remain ungranted to `authenticated`.
*/
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
  GROUP BY r.user_id, p.full_name, p.job_title, p.company, p.photo_url
  ORDER BY max(r.created_at) DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.organization_people(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_people(uuid) TO authenticated;
