-- ===========================================================================
-- Forward-only correction: bring read_own_organization_events back to the
-- definition production actually runs.
--
-- Production applied a fix to this policy on 2026-09-20 as version
-- 20260920213835 (event_read_policy_insert_returning_fix). That migration was
-- never committed, and the file that creates the policy here --
-- 20260921000000_organizer_event_security.sql -- still carries the original.
-- So the repository and production disagree, and the repository is the LOOSER
-- of the two:
--
--   repository  organization_id IS NOT NULL AND is_org_member(organization_id)
--   production  organization_id IS NOT NULL AND (is_org_admin(organization_id)
--                                                OR can_manage_event(id))
--
-- Under the repository's version any member of the organization -- including a
-- plain 'manager' with no event assignment -- can read every event the
-- organization owns. Under production's version that requires being an owner
-- or admin of the organization, or being assigned to the specific event
-- through event_team, which is what can_manage_event() checks.
--
-- A fresh environment built from this repository would therefore be more
-- permissive than production. This migration closes that gap in the direction
-- of least privilege; it widens nothing.
--
-- Written forward-only rather than by editing 20260921000000: that migration
-- has already run everywhere, and rewriting an applied migration makes the
-- recorded history a lie. Against production this statement is a no-op -- it
-- recreates the policy with the definition production already has.
-- ===========================================================================

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
