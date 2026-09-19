/*
# Organizer Phase A (additive) — authorization helper functions

The membership tests every organizer policy needs. Additive: no existing policy
calls these yet.

## Why functions rather than subqueries in the policies
A policy on `organization_members` that itself selects from
`organization_members` re-enters the policy and recurses. Every membership test
therefore goes through a SECURITY DEFINER function, which runs as the owner and
bypasses RLS — the same pattern `is_registered_for_event` already uses.

The same applies to reaching an event's organization: a policy subquery against
`events` would be filtered by the events policy, so `event_org_id` resolves it
as definer instead.

## Grants
Supabase's default privileges grant EXECUTE on new public-schema functions to
both `anon` and `authenticated`, and revoking PUBLIC does not remove those
direct grants. Each function is therefore revoked from all three and granted
back only to `authenticated`.
*/

-- Resolve an event's owning organization without tripping the events policy.
CREATE OR REPLACE FUNCTION public.event_org_id(target_event_id uuid)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT e.organization_id FROM events e WHERE e.id = target_event_id;
$$;

-- The caller's role in an organization, NULL when they are not a member.
CREATE OR REPLACE FUNCTION public.org_role_for(org_id uuid)
RETURNS org_role
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT m.role
  FROM organization_members m
  WHERE m.organization_id = org_id
    AND m.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = org_id AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = org_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(org_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = org_id
      AND m.user_id = auth.uid()
      AND m.role = 'owner'
  );
$$;

-- Can the caller manage this specific event: an owner/admin of the owning
-- organization, or someone assigned to the event's team.
--
-- The event_team branch also requires organization membership. A manager is an
-- organization member who has been assigned an event, so a stale event_team row
-- for someone who has left the organization must not keep granting access.
CREATE OR REPLACE FUNCTION public.can_manage_event(target_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM events e
    JOIN organization_members m
      ON m.organization_id = e.organization_id
     AND m.user_id = auth.uid()
    WHERE e.id = target_event_id
      AND m.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1
    FROM event_team t
    JOIN events e ON e.id = t.event_id
    JOIN organization_members m
      ON m.organization_id = e.organization_id
     AND m.user_id = t.user_id
    WHERE t.event_id = target_event_id
      AND t.user_id = auth.uid()
  );
$$;

-- ============================================================================
-- Grants: authenticated only
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.event_org_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_role_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_manage_event(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_org_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_role_for(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event(uuid) TO authenticated;
