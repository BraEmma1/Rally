/*
# Authorization hardening

The outstanding findings from the Phase A review.

## 1. Contact-consent columns made inaccessible
`read_own_or_co_attendee_registrations` grants SELECT on the whole registration
row to anyone registered for the same event, so share_contact / contact_email /
contact_phone were readable by every co-attendee — not by organizers, as
intended. The columns stay, but SELECT and write privileges on them are revoked
from anon and authenticated until the organizer attendee-contact access design
lands. Nothing in the app reads them: every registration query names explicit
columns, so no query breaks.

## 2. Invitation owner-escalation closed
An admin could create, or edit, an invitation carrying role = 'owner', and
acceptance granted that role — so an admin could mint an owner and contradict
the rule that only owners manage owners. Owners may still invite owners. The
existing self-escalation protection is untouched: an admin inviting themselves
still hits ON CONFLICT DO NOTHING in the accept function.

## 3. pg_temp pinned on every SECURITY DEFINER function
Postgres searches the temp schema first for relation names unless pg_temp is
listed in search_path. A session able to create a temp table named, say,
organization_members could shadow the real table inside a definer function.
Not reachable through PostgREST, which exposes no DDL, but it is a one-line fix
and the functions are the backbone of authorization.

## 4. anon table grants removed from the organization tables
RLS already yields nothing to anon because no policy targets it, but these four
tables kept the default grants while profiles and event_registrations had theirs
revoked. Matching the established pattern means a future policy written without
a role qualifier cannot silently expose them.
*/

-- ============================================================================
-- 1. Contact-consent columns: present but inaccessible
--
-- NOTE: these column-level REVOKEs are a no-op on their own — a column REVOKE
-- cannot subtract from the table-wide grant `authenticated` already holds.
-- Verification caught this, and 20260919150400 does the job properly by
-- dropping the table-wide grants and re-granting an explicit column list.
-- Left in place because it is what was applied, and it is harmless.
-- ============================================================================
REVOKE SELECT (share_contact, contact_email, contact_phone) ON public.event_registrations FROM anon, authenticated;
REVOKE INSERT (share_contact, contact_email, contact_phone) ON public.event_registrations FROM anon, authenticated;
REVOKE UPDATE (share_contact, contact_email, contact_phone) ON public.event_registrations FROM anon, authenticated;

-- ============================================================================
-- 2. Only owners may invite or promote to owner
-- ============================================================================
DROP POLICY IF EXISTS "insert_invitation_as_admin" ON organization_invitations;
CREATE POLICY "insert_invitation_as_admin"
  ON organization_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND (
      public.is_org_owner(organization_id)
      OR (public.is_org_admin(organization_id) AND role <> 'owner')
    )
  );

-- USING inspects the existing row and WITH CHECK the proposed one, so an admin
-- can neither edit an owner invitation nor turn another invitation into one.
DROP POLICY IF EXISTS "update_invitation_as_admin" ON organization_invitations;
CREATE POLICY "update_invitation_as_admin"
  ON organization_invitations FOR UPDATE
  TO authenticated
  USING (
    public.is_org_owner(organization_id)
    OR (public.is_org_admin(organization_id) AND role <> 'owner')
  )
  WITH CHECK (
    public.is_org_owner(organization_id)
    OR (public.is_org_admin(organization_id) AND role <> 'owner')
  );

-- ============================================================================
-- 3. Pin pg_temp on the pre-existing SECURITY DEFINER functions
--    (functions added in this phase already declare it)
-- ============================================================================
ALTER FUNCTION public.accept_organization_invitation(uuid)   SET search_path = public, pg_temp;
ALTER FUNCTION public.can_manage_event(uuid)                 SET search_path = public, pg_temp;
ALTER FUNCTION public.decline_organization_invitation(uuid)  SET search_path = public, pg_temp;
ALTER FUNCTION public.event_org_id(uuid)                     SET search_path = public, pg_temp;
ALTER FUNCTION public.get_connect_profile(uuid)              SET search_path = public, pg_temp;
ALTER FUNCTION public.get_event_registration_counts(uuid[])  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_public_profile(uuid)               SET search_path = public, pg_temp;
ALTER FUNCTION public.get_public_profiles(uuid[])            SET search_path = public, pg_temp;
ALTER FUNCTION public.is_org_admin(uuid)                     SET search_path = public, pg_temp;
ALTER FUNCTION public.is_org_member(uuid)                    SET search_path = public, pg_temp;
ALTER FUNCTION public.is_org_owner(uuid)                     SET search_path = public, pg_temp;
ALTER FUNCTION public.is_registered_for_event(uuid)          SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_invitation_response(uuid)       SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_new_connection(uuid)            SET search_path = public, pg_temp;
ALTER FUNCTION public.org_role_for(uuid)                     SET search_path = public, pg_temp;

-- ============================================================================
-- 4. Remove anon grants from the organization tables
-- ============================================================================
REVOKE ALL ON public.organizations FROM anon;
REVOKE ALL ON public.organization_members FROM anon;
REVOKE ALL ON public.event_team FROM anon;
REVOKE ALL ON public.organization_invitations FROM anon;
