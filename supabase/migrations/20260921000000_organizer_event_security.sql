/*
# Organizer Phase C — event ownership, lifecycle and security

Turns `events` from an operator-seeded table into one organizers write, and
closes the hole that opens the moment they can: today the only policy on
`events` is `public_read_events USING (true)`, so the first draft an organizer
saves would be world-readable.

## The five lifecycle states reuse existing columns
Phase A already added `visibility` with a CHECK allowing draft/published/
unlisted, plus `archived_at` and `published_at`; `status` has held upcoming/past
since the attendee build. Nothing new is needed:

| State     | Expressed as                                  |
|-----------|-----------------------------------------------|
| Draft     | visibility = 'draft'                          |
| Published | visibility IN ('published','unlisted'), status = 'upcoming' |
| Live      | status = 'live'                               |
| Completed | status = 'past'                               |
| Archived  | archived_at IS NOT NULL                       |

`status` gains 'live'; existing rows keep upcoming/past untouched. The attendee
Events page derives past/upcoming from the dates rather than from `status`, so
none of this changes what attendees see.

## Ownership cannot move
`organization_id` is immutable once set and `created_by` is frozen, both in a
trigger rather than a policy, because a policy can only say who may write the
row — not which columns of it. Without that, an admin of organization A who is
also a member of B could reassign an event between them with one UPDATE.

## Legacy events
The four seeded events have `organization_id IS NULL`. They stay readable and
registerable exactly as now; only organizer *writes* require an organization.
Assigning them to an organization is a separate decision and is not done here.
*/

-- ============================================================================
-- Lifecycle vocabulary
-- ============================================================================
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_allowed;
ALTER TABLE events ADD CONSTRAINT events_status_allowed
  CHECK (status IN ('upcoming', 'live', 'past'));

-- One registration and one invitation per person per event. Neither table had
-- a uniqueness rule, so a double-tap on Register created two rows and made
-- every capacity count wrong.
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_unique_attendee
  ON event_registrations (event_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_invitations_unique_invitee
  ON event_invitations (event_id, invited_user_id);

CREATE INDEX IF NOT EXISTS idx_events_organization ON events (organization_id, status);

-- ============================================================================
-- Helper: was the caller invited to this event
--
-- Needed so an unlisted event stays reachable for the person invited to it.
-- Definer, because the invitations SELECT policy would otherwise filter the
-- lookup and a policy on events cannot see rows the caller may not read.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_invited_to_event(target_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_invitations i
    WHERE i.event_id = target_event_id AND i.invited_user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_invited_to_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_invited_to_event(uuid) TO authenticated;

-- ============================================================================
-- events: who may read
--
-- Replaces USING (true). Split across three policies because they answer
-- different questions and PostgREST ORs them together.
-- ============================================================================
DROP POLICY IF EXISTS "public_read_events" ON events;

-- Anyone, signed in or not: published, not archived, not unlisted.
DROP POLICY IF EXISTS "read_published_events" ON events;
CREATE POLICY "read_published_events"
  ON events FOR SELECT
  TO anon, authenticated
  USING (
    archived_at IS NULL
    AND visibility = 'published'
  );

-- The owning team sees everything it owns, drafts and archived included.
DROP POLICY IF EXISTS "read_own_organization_events" ON events;
CREATE POLICY "read_own_organization_events"
  ON events FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_org_member(organization_id)
  );

-- An unlisted event has to stay reachable for the people actually involved in
-- it, or registering for one would hide it from the person who registered.
DROP POLICY IF EXISTS "read_involved_events" ON events;
CREATE POLICY "read_involved_events"
  ON events FOR SELECT
  TO authenticated
  USING (
    archived_at IS NULL
    AND visibility <> 'draft'
    AND (
      public.is_registered_for_event(id)
      OR public.is_invited_to_event(id)
    )
  );

-- ============================================================================
-- events: who may write
--
-- Creating is an owner/admin act. A manager runs events assigned to them, so
-- they may edit but not create — which is what can_manage_event already means.
-- ============================================================================
DROP POLICY IF EXISTS "insert_organization_event" ON events;
CREATE POLICY "insert_organization_event"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND created_by = auth.uid()
    AND public.current_account_type() = 'organizer'
    AND public.account_is_active()
    AND public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS "update_organization_event" ON events;
CREATE POLICY "update_organization_event"
  ON events FOR UPDATE
  TO authenticated
  USING (public.can_manage_event(id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(id) AND public.account_is_active());

-- No DELETE policy, and the privilege is withdrawn so one cannot be added by
-- accident later. Events are archived, never destroyed: registrations and the
-- connections made at them hang off the event id.
REVOKE DELETE ON public.events FROM authenticated, anon;

-- ============================================================================
-- events: what a write may contain
--
-- The policies decide who; this decides what. Column-level rules cannot be
-- expressed in a policy, and these are the ones that carry authority.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_write_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_registered int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- An event starts at the beginning of its life: going live or marking it
    -- finished are later, explicit acts, never something a create call decides.
    NEW.status      := 'upcoming';
    NEW.archived_at := NULL;

    -- Creating it already published is allowed — but only with the details an
    -- attendee needs in order to decide. The guard is on being unfinished, not
    -- on publishing.
    IF NEW.visibility IS DISTINCT FROM 'draft' THEN
      IF btrim(COALESCE(NEW.name, '')) = '' THEN
        RAISE EXCEPTION 'An event needs a name before it can be published';
      END IF;
      IF NEW.start_date IS NULL THEN
        RAISE EXCEPTION 'An event needs a start date before it can be published';
      END IF;
      NEW.published_at := now();
    ELSE
      NEW.published_at := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- Ownership is fixed. Reassigning an event to another organization is how a
  -- member of two organizations would move an event — and its attendee list —
  -- out from under the first.
  IF OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'An event cannot be moved to another organization';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'The creator of an event cannot be changed';
  END IF;

  -- An archived event is frozen. The one permitted write is un-archiving it,
  -- which must be the only change in that statement.
  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'This event is archived. Restore it before making changes.';
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.end_time IS DISTINCT FROM OLD.end_time
       OR NEW.capacity IS DISTINCT FROM OLD.capacity
       OR NEW.image_url IS DISTINCT FROM OLD.image_url
       OR NEW.visibility IS DISTINCT FROM OLD.visibility
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Restore this event before making other changes';
    END IF;
    RETURN NEW;
  END IF;

  -- Publishing needs the details an attendee decides on.
  IF OLD.visibility = 'draft' AND NEW.visibility <> 'draft' THEN
    IF btrim(COALESCE(NEW.name, '')) = '' THEN
      RAISE EXCEPTION 'An event needs a name before it can be published';
    END IF;
    IF NEW.start_date IS NULL THEN
      RAISE EXCEPTION 'An event needs a start date before it can be published';
    END IF;
    NEW.published_at := COALESCE(OLD.published_at, now());
  END IF;

  -- Un-publishing an event people have already registered for would strip it
  -- from their Events page with no explanation. Archive it instead.
  IF OLD.visibility <> 'draft' AND NEW.visibility = 'draft' THEN
    SELECT count(*) INTO v_registered
    FROM event_registrations r
    WHERE r.event_id = OLD.id AND r.status <> 'cancelled';

    IF v_registered > 0 THEN
      RAISE EXCEPTION 'This event has % registration(s) and cannot be returned to draft. Archive it instead.', v_registered;
    END IF;
  END IF;

  -- Capacity cannot be cut below the people already holding a place.
  IF NEW.capacity IS NOT NULL
     AND NEW.capacity IS DISTINCT FROM OLD.capacity THEN
    SELECT count(*) INTO v_registered
    FROM event_registrations r
    WHERE r.event_id = OLD.id AND r.status <> 'cancelled';

    IF NEW.capacity < v_registered THEN
      RAISE EXCEPTION 'Capacity cannot be lower than the % people already registered', v_registered;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_write_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_write_rules ON events;
CREATE TRIGGER check_event_write_rules
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_write_rules();

-- ============================================================================
-- event_registrations: the organizer may see their own event's registrations
--
-- The consent columns stay unreachable: 20260919150400 granted `authenticated`
-- an explicit column list that excludes share_contact, contact_email and
-- contact_phone, and nothing here widens it.
-- ============================================================================
DROP POLICY IF EXISTS "read_organizer_event_registrations" ON event_registrations;
CREATE POLICY "read_organizer_event_registrations"
  ON event_registrations FOR SELECT
  TO authenticated
  USING (public.can_manage_event(event_id));

-- ============================================================================
-- event_registrations: registering is checked against the event
--
-- insert_own_registration only ever checked that you were registering
-- yourself. Capacity, whether the event is open, and whether it is archived
-- were not enforced anywhere, so they were enforced nowhere.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_registration_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_taken int;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = NEW.event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'That event is no longer available';
  END IF;

  IF v_event.visibility = 'draft' THEN
    RAISE EXCEPTION 'That event is not open for registration';
  END IF;

  IF v_event.status = 'past' THEN
    RAISE EXCEPTION 'That event has already finished';
  END IF;

  IF v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_taken
    FROM event_registrations r
    WHERE r.event_id = NEW.event_id AND r.status <> 'cancelled';

    IF v_taken >= v_event.capacity THEN
      RAISE EXCEPTION 'That event is full';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_registration_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_registration_rules ON event_registrations;
CREATE TRIGGER check_registration_rules
  BEFORE INSERT ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_registration_rules();

-- ============================================================================
-- event_invitations
--
-- The old INSERT check was `invited_user_id = auth.uid() OR invited_by =
-- auth.uid()`, which let any user invite any user to any event — and, through
-- the first branch, forge an invitation addressed to themselves from someone
-- else. Nothing in the app ever inserted through it, so tightening it to the
-- organizer path breaks no existing behaviour.
-- ============================================================================
DROP POLICY IF EXISTS "insert_own_invitations" ON event_invitations;
DROP POLICY IF EXISTS "insert_event_invitation_as_organizer" ON event_invitations;
CREATE POLICY "insert_event_invitation_as_organizer"
  ON event_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND public.can_manage_event(event_id)
    AND public.account_is_active()
  );

DROP POLICY IF EXISTS "select_own_invitations" ON event_invitations;
CREATE POLICY "select_own_invitations"
  ON event_invitations FOR SELECT
  TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR public.can_manage_event(event_id)
  );

-- The invitee still answers their own invitation, which is what the attendee
-- Events page does today. Organizers may withdraw one they sent.
DROP POLICY IF EXISTS "update_own_invitations" ON event_invitations;
CREATE POLICY "update_own_invitations"
  ON event_invitations FOR UPDATE
  TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR public.can_manage_event(event_id)
  )
  WITH CHECK (
    invited_user_id = auth.uid()
    OR public.can_manage_event(event_id)
  );
