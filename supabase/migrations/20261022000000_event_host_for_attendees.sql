/*
# Let attendees see who is hosting an event

An event already belongs to an organization (events.organization_id), but
attendees cannot read the organization row: the only SELECT policy on
organizations is is_org_member(id). So the event page had no way to say
"Hosted by <name>".

This adds one narrow read function instead of loosening that policy.

## What it returns
organization_id, name, logo_url, website -- the organization's public identity
and nothing else. No description, no members, no org_type or approval state,
no created_by.

## When it returns a row
Only when ALL of these hold, which mirrors who may read the event itself
(read_published_events) and adds the organization's own standing:
  - the event is published and not archived;
  - the organization is approved and not archived.
Otherwise it returns no rows, so a draft, unlisted or archived event, or a
pending / suspended organization, reveals nothing.

## What does not change
No table, column, policy or table grant. SECURITY DEFINER with a fixed
search_path, EXECUTE for authenticated only (the attendee app is signed-in).
Forward-only. Reversal is DROP FUNCTION public.get_event_host(uuid).
*/

CREATE OR REPLACE FUNCTION public.get_event_host(target_event_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  logo_url text,
  website text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.name,
    NULLIF(btrim(o.logo_url), ''),
    NULLIF(btrim(o.website), '')
  FROM events e
  JOIN organizations o ON o.id = e.organization_id
  WHERE e.id = target_event_id
    AND e.archived_at IS NULL
    AND e.visibility = 'published'
    AND o.archived_at IS NULL
    AND o.approval_status = 'approved'
$$;

COMMENT ON FUNCTION public.get_event_host(uuid) IS
  'Attendee-facing: the hosting organization''s name, logo and website for a published, non-archived event whose organization is approved. Returns no row otherwise.';

REVOKE EXECUTE ON FUNCTION public.get_event_host(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_host(uuid) TO authenticated;
