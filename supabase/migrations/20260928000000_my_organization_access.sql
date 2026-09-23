/*
# My organization access, normalized

## The bug this exists to remove
The attendee sidebar ran:

    from('organization_members').select('role, organizations(*)')

with no `user_id` filter, trusting RLS to narrow it. RLS does narrow it — but
`select_org_members` is `is_org_member(organization_id)`, which is *org*-scoped,
not *user*-scoped: it shows you every member of every organization you belong
to, which is correct for the team directory and wrong here. So the query
returned one row per co-member, each embedding the same organization, and the
sidebar rendered the organization once per teammate.

Worse than the duplication: the rows carried *other people's* roles. Ordered by
`created_at`, the first row is always the owner, because the ownership trigger
writes it when the organization is created. Every member who did not create the
organization therefore saw the owner's role presented as their own, and
`canManageTeam()` offered them team controls the database then refused.

The RLS policy is not the bug and is not changed: seeing your teammates is what
the Team screen needs.

## What this returns
One row per organization the caller actually belongs to, carrying the caller's
own organization role and their own event assignments nested as JSON. Event
assignments never create additional organization rows — that distinction is the
whole point.

An organization with no assignments returns an empty array, not null, so the
caller can iterate without a guard.

The full organization row is returned, not a subset: OrganizerContext feeds
this straight into the organizer settings form, and returning blank strings for
description or website would have shown empty fields that overwrite the real
values on save.
*/
DROP FUNCTION IF EXISTS public.get_my_organization_access();
CREATE FUNCTION public.get_my_organization_access()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_description text,
  organization_logo_url text,
  organization_website text,
  organization_type org_type,
  approval_status org_approval_status,
  archived_at timestamptz,
  organization_created_by uuid,
  organization_created_at timestamptz,
  organization_updated_at timestamptz,
  organization_role org_role,
  joined_at timestamptz,
  event_assignments jsonb
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    COALESCE(o.description, ''),
    COALESCE(o.logo_url, ''),
    COALESCE(o.website, ''),
    o.org_type,
    o.approval_status,
    o.archived_at,
    o.created_by,
    o.created_at,
    o.updated_at,
    -- The caller's own role, from the caller's own membership row. This is the
    -- fix: the row is selected by user_id, not merely exposed by RLS.
    m.role,
    m.created_at,
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'event_id',   e.id,
                   'event_name', e.name,
                   'start_date', e.start_date,
                   'visibility', e.visibility,
                   'archived_at', e.archived_at,
                   'role',       'event_manager'
                 )
                 ORDER BY e.start_date NULLS LAST, e.name
               )
        FROM event_team t
        JOIN events e ON e.id = t.event_id
        -- The caller's own assignments only, and only within this
        -- organization. Someone else's assignment is not the caller's access.
        WHERE t.user_id = auth.uid()
          AND e.organization_id = o.id
      ),
      '[]'::jsonb
    ) AS event_assignments
  FROM organization_members m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
  ORDER BY o.name;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_organization_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_organization_access() TO authenticated;
