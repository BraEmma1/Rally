/*
# The capacity floor counts confirmed registrations only

## The problem
enforce_event_write_rules() (migration 20260921000000) refuses a capacity lower
than the registrations already holding a place. It counted them as
`status <> 'cancelled'`, which was right when it was written: nothing ever set
a registration to 'waitlisted' then. Migration 20261026000000 introduced the
waitlist, and 20261030000000 moved every count to the confirmed-only rule
(`status IN ('registered', 'checked_in')`), but this trigger was not updated.
So the floor counted waitlisted people as if they held seats.

Effect: an event with capacity 100, 100 confirmed and 20 waitlisted could not
be raised to 110. The trigger demanded at least 120, so the only accepted raise
promoted the entire waitlist at once. The organizer could not open a few
seats, which is the path the "event is full" message from 20261102000000
tells them to take.

## What this changes
The capacity check counts `status IN ('registered', 'checked_in')`: the same
rule as register_for_event, enforce_registration_rules, promote_event_waitlist,
event_activity_counts and the 'confirmed' attendee filter. Its message now says
"confirmed". Waitlisted people never block a capacity change; raising capacity
still promotes them oldest first through the existing AFTER UPDATE OF capacity
trigger (promote_waitlist_on_capacity_change), which is not touched here.

## What does not change
Everything else in the function is copied verbatim from 20260921000000:
- INSERT: status forced to 'upcoming', archived_at cleared, publishing needs a
  name and a start date, published_at stamped.
- UPDATE: organization and creator fixed; an archived event frozen except for
  restoring it as the only change; publishing needs a name and a start date;
  returning to draft is refused while any non-cancelled registration exists
  (that rule deliberately still counts waitlisted people: they would lose
  sight of the event too).
- SECURITY DEFINER, search_path, the EXECUTE revoke, and the trigger
  check_event_write_rules itself (CREATE OR REPLACE keeps it attached).
check_event_archive_authority (20261029000000) is a separate trigger and is
unaffected.

## Existing data
No rows are read or changed. The trigger only decides future writes, and it
now accepts some capacity values it used to refuse. It never accepts one it
used to refuse for a confirmed attendee.

## Reversal
Re-run the function body from 20260921000000 in a new migration.
*/

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

  -- Capacity cannot be cut below the people already holding a seat. Only
  -- confirmed registrations hold one; the waitlist is what a raise promotes
  -- (promote_waitlist_on_capacity_change), never something that blocks it.
  IF NEW.capacity IS NOT NULL
     AND NEW.capacity IS DISTINCT FROM OLD.capacity THEN
    SELECT count(*) INTO v_registered
    FROM event_registrations r
    WHERE r.event_id = OLD.id AND r.status IN ('registered', 'checked_in');

    IF NEW.capacity < v_registered THEN
      RAISE EXCEPTION 'Capacity cannot be lower than the % people already confirmed', v_registered;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_write_rules() FROM PUBLIC, anon, authenticated;
