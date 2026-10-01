/*
# Event speakers

Two tables. A speaker is an **event role**, not a platform account type:
nothing here writes to `user_accounts`, `organization_members`, `event_team` or
`event_registrations`, and no policy anywhere consults a speaker record.

## Nothing existing was reused, because nothing existed
Checked first: no speaker, presenter, moderator, panelist or event-participant
concept exists in the schema or the codebase -- the only mentions of
"speakers" are a Coming Soon route. Everything below reuses existing Rally
machinery rather than inventing a parallel one: `can_manage_event` for
authority, the events existence check for visibility, `display_order` for
ordering, the `avatars` bucket for photos.

## Identity: the event's record is the speaker, the Rally account is optional
`event_speakers` carries its own name, title, company, bio and photo, always
populated, and those are what attendees see. `user_id` is an optional link to
a Rally account used for identity -- deduplication, "this speaker is also on
Rally", future search -- and never for display.

Two reasons this is a snapshot rather than a live read of `profiles`:

1. **External speakers have no profile at all.** A live-only model cannot
   represent them, so the snapshot columns must exist regardless; making
   linked speakers read from somewhere else would mean two display paths, two
   renderers and two privacy surfaces for one screen.
2. **An event programme is a historical record.** Someone whose Rally profile
   says "CEO, Acme" may speak at this event as "Founder, Future Africa
   Initiative", and when they change jobs in two years the 2026 agenda must
   not silently rewrite itself.

The organizer UI can prefill the snapshot from `get_public_profile(user_id)`
when linking. That is a copy at authoring time, which is what a snapshot is.

## Privacy
No email or phone column, deliberately. There is no speaker-contact,
invitation or messaging feature to consume one, and a PII column with no
consumer is a liability rather than a feature. Everything readable here was
typed by an organizer as public event information. `user_id` is returned so
the UI can link to the already-public profile; it is not a route to anything
private.

## Cross-event integrity is declared, not checked
A speaker from event A must not be attachable to a session from event B. That
is enforced with composite foreign keys rather than a trigger: the association
carries `event_id` and references `(id, event_id)` on both parents, so the
database cannot represent a mismatch at all.

The denormalized `event_id` is not a second source of truth -- the two foreign
keys make it provably equal to both parents. This is the opposite choice from
`event_session_bookmarks`, which deliberately has no `event_id`; there the
column would have been an unconstrained copy free to drift, here it is pinned
by the keys and is exactly what makes the rule declarative.
*/

-- Composite FK targets. `id` is already unique on both, so these are free
-- logically; they exist so the association can reference (id, event_id).
ALTER TABLE event_sessions
  DROP CONSTRAINT IF EXISTS event_sessions_id_event_unique;
ALTER TABLE event_sessions
  ADD CONSTRAINT event_sessions_id_event_unique UNIQUE (id, event_id);

-- ============================================================================
-- event_speakers
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Optional link to a Rally account. ON DELETE SET NULL, never CASCADE:
  -- someone deleting their Rally account must not erase an event's programme.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- The event-specific snapshot. Authoritative for everything attendees see.
  full_name text NOT NULL,
  job_title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  photo_url text NOT NULL DEFAULT '',
  linkedin text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  -- Structured rather than buried in prose, mirroring profiles.industry, so
  -- "speakers in fintech" is a query and not a text search over a bio.
  industry text NOT NULL DEFAULT '',

  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_speakers_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT event_speakers_name_length CHECK (length(full_name) <= 200),
  CONSTRAINT event_speakers_bio_length CHECK (length(bio) <= 4000),
  CONSTRAINT event_speakers_id_event_unique UNIQUE (id, event_id)
);

-- The directory is always read for one event, in display order.
CREATE INDEX IF NOT EXISTS idx_event_speakers_event_order
  ON event_speakers (event_id, display_order, full_name);

-- The same person cannot be linked twice to one event. Partial, because
-- external speakers have no user_id and any number of them is legitimate.
-- There is deliberately NO uniqueness on name: two different people can share
-- one, and the database must not refuse the second.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_speakers_event_user
  ON event_speakers (event_id, user_id) WHERE user_id IS NOT NULL;

-- "Which events is this person speaking at" -- their speaking history, and
-- the shape future search will want.
CREATE INDEX IF NOT EXISTS idx_event_speakers_user
  ON event_speakers (user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- event_session_speakers -- the many-to-many
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_session_speakers (
  session_id uuid NOT NULL,
  speaker_id uuid NOT NULL,
  -- Pinned to both parents by the composite keys below; see the header.
  event_id uuid NOT NULL,

  -- A presentation label only. No policy in this database reads it and it
  -- confers no authority of any kind.
  speaker_role text NOT NULL DEFAULT 'speaker',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (session_id, speaker_id),

  CONSTRAINT event_session_speakers_role_allowed
    CHECK (speaker_role IN ('speaker', 'moderator', 'panelist', 'host')),

  -- The whole cross-event rule, declared. A session and a speaker can only be
  -- joined when both already agree on the event.
  CONSTRAINT event_session_speakers_session_fk
    FOREIGN KEY (session_id, event_id)
    REFERENCES event_sessions (id, event_id) ON DELETE CASCADE,
  CONSTRAINT event_session_speakers_speaker_fk
    FOREIGN KEY (speaker_id, event_id)
    REFERENCES event_speakers (id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_session_speakers_speaker
  ON event_session_speakers (speaker_id);
CREATE INDEX IF NOT EXISTS idx_event_session_speakers_event
  ON event_session_speakers (event_id);

-- ============================================================================
-- RLS -- visibility inherits the event's, exactly as event_sessions does
-- ============================================================================
ALTER TABLE event_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_session_speakers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_speakers FROM anon;
REVOKE ALL ON public.event_session_speakers FROM anon;
-- As public as the published event itself, and SELECT only -- matching the
-- grant event_sessions carries.
GRANT SELECT ON public.event_speakers TO anon;
GRANT SELECT ON public.event_session_speakers TO anon;

-- A subquery in a policy is subject to the referenced table's policies, so
-- this resolves through the three existing event SELECT policies. A speaker is
-- visible exactly when their event is, and any future change to event
-- visibility applies here on its own.
DROP POLICY IF EXISTS "read_visible_event_speakers" ON event_speakers;
CREATE POLICY "read_visible_event_speakers"
  ON event_speakers FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_speakers.event_id));

DROP POLICY IF EXISTS "insert_event_speakers_as_manager" ON event_speakers;
CREATE POLICY "insert_event_speakers_as_manager"
  ON event_speakers FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "update_event_speakers_as_manager" ON event_speakers;
CREATE POLICY "update_event_speakers_as_manager"
  ON event_speakers FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "delete_event_speakers_as_manager" ON event_speakers;
CREATE POLICY "delete_event_speakers_as_manager"
  ON event_speakers FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

-- The association inherits through the session, which inherits through the
-- event. Still one definition of visibility, two links further down the chain.
DROP POLICY IF EXISTS "read_visible_session_speakers" ON event_session_speakers;
CREATE POLICY "read_visible_session_speakers"
  ON event_session_speakers FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM event_sessions s WHERE s.id = event_session_speakers.session_id
  ));

DROP POLICY IF EXISTS "insert_session_speakers_as_manager" ON event_session_speakers;
CREATE POLICY "insert_session_speakers_as_manager"
  ON event_session_speakers FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "update_session_speakers_as_manager" ON event_session_speakers;
CREATE POLICY "update_session_speakers_as_manager"
  ON event_session_speakers FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "delete_session_speakers_as_manager" ON event_session_speakers;
CREATE POLICY "delete_session_speakers_as_manager"
  ON event_session_speakers FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

-- ============================================================================
-- What a write may contain
--
-- The policies decide who; this decides what. Same shape as event_sessions.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_speaker_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Observed, never accepted from the caller.
    NEW.created_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A speaker cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a speaker record cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its speakers.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_speaker_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_speaker_rules ON event_speakers;
CREATE TRIGGER check_event_speaker_rules
  BEFORE INSERT OR UPDATE ON event_speakers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_speaker_rules();

CREATE OR REPLACE FUNCTION public.enforce_event_speaker_delete_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = OLD.event_id;
  -- The event itself being deleted cascades here; that is not an edit.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its speakers.';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_speaker_delete_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_speaker_delete_rules ON event_speakers;
CREATE TRIGGER check_event_speaker_delete_rules
  BEFORE DELETE ON event_speakers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_speaker_delete_rules();

-- ============================================================================
-- Reads
--
-- All SECURITY INVOKER: the policies above already say who may see this, and a
-- definer function would replace that rule with a second copy free to drift.
-- Each one answers a whole screen in a single round trip; none of them makes
-- the caller fetch a list and then query per row.
-- ============================================================================

-- The speaker directory for one event, with how many sessions each is on.
CREATE OR REPLACE FUNCTION public.get_event_speakers(target_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  user_id uuid,
  full_name text,
  job_title text,
  company text,
  bio text,
  photo_url text,
  linkedin text,
  website text,
  industry text,
  display_order integer,
  session_count bigint
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    sp.id, sp.event_id, sp.user_id, sp.full_name, sp.job_title, sp.company,
    sp.bio, sp.photo_url, sp.linkedin, sp.website, sp.industry, sp.display_order,
    (SELECT count(*) FROM event_session_speakers ss WHERE ss.speaker_id = sp.id)
  FROM event_speakers sp
  WHERE sp.event_id = target_event_id
  ORDER BY sp.display_order, sp.full_name;
$$;

-- One speaker, with every session they are on. Returns zero rows for a
-- speaker the caller may not see, because both tables are RLS-filtered.
CREATE OR REPLACE FUNCTION public.get_event_speaker_sessions(target_speaker_id uuid)
RETURNS TABLE (
  session_id uuid,
  title text,
  start_at timestamptz,
  end_at timestamptz,
  location text,
  session_type text,
  status text,
  speaker_role text,
  event_timezone text
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    s.id, s.title, s.start_at, s.end_at, s.location, s.session_type, s.status,
    ss.speaker_role,
    -- Nullable, like every other agenda read: events.timezone is unset on half
    -- the events and a substituted default would render a confidently wrong
    -- local time.
    e.timezone
  FROM event_session_speakers ss
  JOIN event_sessions s ON s.id = ss.session_id
  JOIN events e ON e.id = s.event_id
  WHERE ss.speaker_id = target_speaker_id
  ORDER BY s.start_at, s.display_order, s.title;
$$;

-- Every (session, speaker) pair for one event, in one call. This is what the
-- Agenda uses to show speakers on each session row: fetch the agenda, fetch
-- this, group by session_id. Two queries for the whole screen rather than one
-- per session.
CREATE OR REPLACE FUNCTION public.get_event_session_speakers(target_event_id uuid)
RETURNS TABLE (
  session_id uuid,
  speaker_id uuid,
  speaker_role text,
  display_order integer,
  full_name text,
  job_title text,
  company text,
  photo_url text,
  user_id uuid
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    ss.session_id, ss.speaker_id, ss.speaker_role, ss.display_order,
    sp.full_name, sp.job_title, sp.company, sp.photo_url, sp.user_id
  FROM event_session_speakers ss
  JOIN event_speakers sp ON sp.id = ss.speaker_id
  WHERE ss.event_id = target_event_id
  ORDER BY ss.session_id, ss.display_order, sp.full_name;
$$;

-- ============================================================================
-- Reorder, in one statement -- the same contract as reorder_event_sessions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reorder_event_speakers(
  target_event_id uuid,
  speaker_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  v_count int;
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = target_event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its speakers.';
  END IF;

  -- Every id must belong to this event, or a caller could renumber a speaker
  -- on another event they also manage.
  SELECT count(*) INTO v_count
  FROM unnest(speaker_ids) AS sid
  WHERE NOT EXISTS (
    SELECT 1 FROM event_speakers sp WHERE sp.id = sid AND sp.event_id = target_event_id
  );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Those speakers do not all belong to this event';
  END IF;

  UPDATE event_speakers sp
  SET display_order = ordered.ord
  FROM (SELECT sid, (ordinality - 1)::int AS ord
        FROM unnest(speaker_ids) WITH ORDINALITY AS t(sid, ordinality)) ordered
  WHERE sp.id = ordered.sid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_speakers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_speaker_sessions(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_session_speakers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reorder_event_speakers(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- The speakers of a published event are public, like the event and its agenda.
GRANT EXECUTE ON FUNCTION public.get_event_speakers(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_speaker_sessions(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_session_speakers(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_event_speakers(uuid, uuid[]) TO authenticated;

/*
## Deliberately NOT built here

- **Linking a Rally user who is not registered for the event.** The safe path
  that exists today is `find_event_attendees(event_id, search)`: manager-only,
  scoped to one event, returns the public card and no contact details. An
  organizer picks a registered person from it and the UI sends their
  `user_id`. Resolving an arbitrary address through
  `auth.users` the way `invite_event_attendee` does would be a new disclosure
  surface -- confirming to an organizer that a given email has a Rally account
  -- and it is not needed to ship speakers, because an unregistered speaker is
  simply an external one. Flagged as a product decision rather than taken.
- **Speaker invitations, claiming, messaging, analytics, ratings, check-in.**
- **A speaker photo bucket.** The existing `avatars` bucket already accepts an
  upload under the uploader's own uid folder and is publicly readable, so an
  organizer can upload an external speaker's photo with no storage change at
  all.
*/
