/*
# Organizer Phase A (additive) — organization fields on events and registrations

Adds the columns the organizer model needs, without changing a single policy.
No existing code reads these, and RLS on `events` and `event_registrations` is
untouched, so the Professional/Attendee app behaves exactly as before.

## events.visibility and the catalog
The column is added with DEFAULT 'published' and the default is then changed to
'draft'. That is deliberate: the four existing events are publicly visible
today, so 'published' records the truth about them, while events created from
here on start as drafts. Doing it this way means no backfill can be forgotten
later — the risk that Phase C empties the attendee catalog is closed now,
while the column is still inert.

## Archiving instead of deleting
Per the decision that historical registration, networking and outcome data must
survive, events are retired with `archived_at` rather than deleted.
`organization_id` uses ON DELETE RESTRICT for the same reason: removing an
organization must not cascade into erasing attendees' event history.

## Per-registration contact consent
Attendee email and phone stay private. `profiles` RLS is not widened, and the
public profile functions still exclude those fields. Instead an attendee may
choose, for one event, to share contact details with that event's organizers:
`share_contact` defaults to false, and `contact_email` / `contact_phone` hold
what they chose to share for that event only. Consent is per registration, so it
does not leak across events and can be withdrawn by updating the row.

The policy that lets organizers read these is Phase C; nothing can read them yet.

## owner_id
Left in place. It is NULL on every row and is superseded by `organization_id`,
but dropping a column is not additive — that happens in Phase C.
*/

-- ============================================================================
-- events
-- ============================================================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  -- start_time/end_time are `time without time zone`; this records which zone
  -- they are meant to be read in. Nullable, unused until the organizer UI sets it.
  ADD COLUMN IF NOT EXISTS timezone text;

-- Existing rows are publicly visible today, so they are 'published'...
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'published';

-- ...but anything created from now on starts as a draft.
ALTER TABLE events
  ALTER COLUMN visibility SET DEFAULT 'draft';

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_visibility_allowed;
ALTER TABLE events
  ADD CONSTRAINT events_visibility_allowed CHECK (
    visibility IN ('draft', 'published', 'unlisted')
  );

CREATE INDEX IF NOT EXISTS idx_events_organization_id ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility) WHERE archived_at IS NULL;

-- Record when the already-visible events became visible, for consistency.
UPDATE events
SET published_at = COALESCE(published_at, created_at, now())
WHERE visibility = 'published' AND published_at IS NULL;

-- ============================================================================
-- event_registrations
-- ============================================================================
ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  -- Per-registration contact consent. Default false: organizers get nothing
  -- unless the attendee opts in for that specific event.
  ADD COLUMN IF NOT EXISTS share_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'registered';

ALTER TABLE event_registrations DROP CONSTRAINT IF EXISTS event_registrations_status_allowed;
ALTER TABLE event_registrations
  ADD CONSTRAINT event_registrations_status_allowed CHECK (
    status IN ('registered', 'waitlisted', 'cancelled', 'checked_in')
  );

CREATE INDEX IF NOT EXISTS idx_event_registrations_event_status
  ON event_registrations(event_id, status);
