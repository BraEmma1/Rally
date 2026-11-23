/* GAP-2: suspended accounts cannot use organization membership to read protected records.
   Existing membership rows are retained. Public events remain governed by their
   independent published-event RLS policy. Forward-only. */
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$ SELECT public.account_is_active() AND EXISTS(
 SELECT 1 FROM public.organization_members m WHERE m.organization_id=org_id AND m.user_id=auth.uid()
); $$;
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$ SELECT public.account_is_active() AND EXISTS(
 SELECT 1 FROM public.organization_members m WHERE m.organization_id=org_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')
); $$;
CREATE OR REPLACE FUNCTION public.is_org_owner(org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$ SELECT public.account_is_active() AND EXISTS(
 SELECT 1 FROM public.organization_members m WHERE m.organization_id=org_id AND m.user_id=auth.uid() AND m.role='owner'
); $$;
CREATE OR REPLACE FUNCTION public.org_role_for(org_id uuid)
RETURNS public.org_role LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$ SELECT m.role FROM public.organization_members m
 WHERE m.organization_id=org_id AND m.user_id=auth.uid() AND public.account_is_active(); $$;
CREATE OR REPLACE FUNCTION public.can_manage_event(target_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
 SELECT public.account_is_active() AND (
 EXISTS(SELECT 1 FROM public.events e JOIN public.organization_members m
 ON m.organization_id=e.organization_id AND m.user_id=auth.uid()
 WHERE e.id=target_event_id AND m.role IN ('owner','admin'))
 OR EXISTS(SELECT 1 FROM public.event_team t JOIN public.events e ON e.id=t.event_id
 JOIN public.organization_members m ON m.organization_id=e.organization_id AND m.user_id=t.user_id
 WHERE t.event_id=target_event_id AND t.user_id=auth.uid())
 ); $$;
-- No DROP: retain the function's EXECUTE grants and dependent views.
CREATE OR REPLACE FUNCTION public.get_my_organization_access()
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
  WHERE m.user_id = auth.uid() AND public.account_is_active()
  ORDER BY o.name;
$$;


-- Read policies that rely on direct invited-user or event-team membership
-- must also reject suspended accounts.
DROP POLICY IF EXISTS select_own_or_admin_invitations ON public.organization_invitations;
CREATE POLICY select_own_or_admin_invitations ON public.organization_invitations
FOR SELECT TO authenticated USING (
 public.account_is_active() AND (invited_user_id=auth.uid() OR public.is_org_admin(organization_id))
);
DROP POLICY IF EXISTS select_event_team ON public.event_team;
CREATE POLICY select_event_team ON public.event_team FOR SELECT TO authenticated
USING (public.account_is_active() AND (user_id=auth.uid() OR public.is_org_member(public.event_org_id(event_id))));
-- Event invitation rows are personal/private, not publicly discoverable.
DROP POLICY IF EXISTS select_own_invitations ON public.event_invitations;
CREATE POLICY select_own_invitations ON public.event_invitations FOR SELECT TO authenticated
USING (public.account_is_active() AND (invited_user_id=auth.uid() OR public.can_manage_event(event_id)));
