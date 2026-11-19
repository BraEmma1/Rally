/*
# Registration open/close controls (database)

Lets the people who run an event close and reopen registration, set an
optional deadline, and makes registration close by itself when the event has
actually ended, whatever its stored `status` says.

## What exists before this
- register_for_event (20261026000000) is the only way to create or revive a
  registration: clients have no INSERT on event_registrations, and a cancelled
  row is revived by UPDATE inside the function. It refuses archived, draft and
  `status = 'past'` events, then fills a seat or the waitlist under the event
  row lock.
- enforce_registration_rules is a BEFORE INSERT backstop with the same event
  checks.
- Nothing on the server derives "ended" from the dates. An event whose last
  day is over still takes registrations until someone clicks "Mark as
  finished" (rally-dev on 2026-11-19: 3 of 15 events in that state).
- events.timezone is free text, validated nowhere.

## What this adds
Columns on events (all NULL by default, so every existing event stays open
with no deadline):
- registration_closed_at  timestamptz  manual close; NULL = not closed by hand
- registration_closed_by  uuid         who closed it (ON DELETE SET NULL)
- registration_deadline   timestamptz  optional; an absolute instant

Table iana_time_zones(name): the IANA zone names Postgres knows, copied from
pg_timezone_names. pg_timezone_names reads the zone files on every call
(258 ms on rally-dev, measured read-only), far too slow to run inside the
registration lock. The table makes the check an index probe. RLS on, no
grants: only the functions below read it. A valid name that is missing from
it (a newer tzdata after an upgrade) is added the first time an organizer
saves it, because the write-time check falls back to pg_timezone_names.

Internal functions (no client EXECUTE):
- accept_event_timezone(text)              write-time check, self-refreshing
- event_effective_timezone(text)           the zone the end is computed in
- event_ends_at(events)                    when the event actually ends
- event_registration_state(events, at)     'open' | 'closed' |
                                           'deadline_passed' | 'ended' |
                                           'unavailable'
Client function:
- get_event_registration_states(uuid[])    the state, deadline, end and
                                           scheduled close, for the UI

## When an event ends
- Last day = greatest(start_date, end_date); end_date NULL = a one-day event.
- Ends at end_time on the last day. end_time NULL = the end of that day
  (24:00, i.e. 00:00 on the next day; registration is open until then).
- A one-day event (no end_date) whose end_time is not after its start_time
  runs overnight and ends at end_time on the next day.
- start_date NULL = no date-based end. Publishing has required a start date
  since 20260921000000, so only drafts lack one.
- The wall-clock end is read in events.timezone.

## Timezones
- New or changed timezone values must be IANA names Postgres recognises,
  matched exactly (case-sensitive). Abbreviations and POSIX strings are
  refused: Postgres reads 'UTC-5' as five hours AHEAD of UTC, which would end
  an event ten hours early in New York.
- Publishing (inserting a non-draft event, or moving draft -> published or
  unlisted) needs a recognised timezone.
- A non-draft event cannot have its timezone removed.
- Existing events are not rewritten. A published event with no timezone, or
  an unrecognised one, keeps working, and edits that leave the timezone alone
  still save.
- Legacy fallback: an event with no recognised timezone is ended at its
  wall-clock end in Etc/GMT+12 (UTC-12, "Anywhere on Earth"). That is the
  last place on Earth to reach any given wall-clock time, so the fallback can
  never close registration before the event has ended anywhere. The cost is
  that it can stay open late: up to 26 hours for an event really held at
  UTC+14, 12 hours for one at UTC. Setting a timezone, closing registration,
  or marking the event finished ends that immediately.

## Registration rules (register_for_event, enforce_registration_rules)
In order, under the event row lock:
1. signed in, account active                         (unchanged)
2. event exists, not archived, not draft             (unchanged)
3. registration state, judged at now():
   - status = 'past'                     -> 'That event has already finished'
   - otherwise the earliest of these that has happened wins:
     the event end                       -> 'That event has already finished'
     the deadline                        -> 'The registration deadline for this event has passed'
     the manual close                    -> 'Registration for this event is closed'
     The deadline and the end are closed AT the instant (now() >= it).
4. already registered, answers, capacity             (unchanged)
Step 3 runs before capacity decides between a seat and the waitlist, so a
closed event refuses both, and it runs before the cancelled row is revived,
so re-registering after a cancellation is refused too.

## Event writes (enforce_event_write_rules)
- Archived events: the three new columns join the frozen list, so they cannot
  change while archived, and a restore must still be the only change.
- registration_closed_at / _by are stamped by the server: closing (NULL ->
  any value) records now() and auth.uid(); reopening (-> NULL) clears both;
  any other write keeps the stored values. A client cannot backdate a close
  or name someone else as the closer.
- The timezone rules above.
- Everything else is copied verbatim from 20261103000000.
Who may write is unchanged: the update_organization_event policy, i.e.
owners, admins and assigned event managers with an active account.

## Not changed
cancel_event_registration, organizer_cancel_event_registration,
organizer_promote_waitlisted_registration, event_registration_detail,
promote_event_waitlist and its triggers, check-in and undo, and the capacity
floor. Closing registration stops new people from joining; it does not freeze
the existing queue, which is still promoted under the existing lifecycle rule
(`status <> 'past'`). Those functions still use `status = 'past'`, not the
date-based end.

## Visibility of the new columns
events has table-level SELECT for readers of published events, so attendees
can read registration_closed_by (a user id), as they can already read
created_by. No name or contact detail is exposed.

## Existing data
No existing row is modified. iana_time_zones is filled from the catalog.

## Reversal
Forward-only. To retire: re-create register_for_event and
enforce_registration_rules from 20261026000000 and enforce_event_write_rules
from 20261103000000, drop the five functions, the table and the three columns.
*/

-- ============================================================================
-- Columns
-- ============================================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS registration_deadline timestamptz;

-- ============================================================================
-- Recognised IANA zone names
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.iana_time_zones (
  name text PRIMARY KEY
);

ALTER TABLE public.iana_time_zones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.iana_time_zones FROM PUBLIC, anon, authenticated;

INSERT INTO public.iana_time_zones (name)
SELECT n.name FROM pg_timezone_names n
ON CONFLICT (name) DO NOTHING;

-- Write-time check. Exact match. A name Postgres knows but the table does not
-- (tzdata grew after an upgrade) is accepted and remembered.
CREATE OR REPLACE FUNCTION public.accept_event_timezone(p_tz text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tz IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM iana_time_zones z WHERE z.name = p_tz) THEN
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = p_tz) THEN
    INSERT INTO iana_time_zones (name) VALUES (p_tz) ON CONFLICT (name) DO NOTHING;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_event_timezone(text) FROM PUBLIC, anon, authenticated;

-- The zone an event's end is computed in: its own when recognised, otherwise
-- Etc/GMT+12 (UTC-12, the latest wall clock on Earth), which can only ever
-- close registration late, never early. Never raises on bad stored text.
CREATE OR REPLACE FUNCTION public.event_effective_timezone(p_tz text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM iana_time_zones z WHERE z.name = p_tz) THEN p_tz
    ELSE 'Etc/GMT+12'
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_effective_timezone(text) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- When an event actually ends
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_ends_at(p_event public.events)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_event.start_date IS NULL THEN NULL
    -- No end time: the whole last day.
    WHEN p_event.end_time IS NULL THEN
      ((GREATEST(p_event.start_date, p_event.end_date) + 1)::timestamp)
        AT TIME ZONE public.event_effective_timezone(p_event.timezone)
    -- One-day event ending at or before it starts: it runs past midnight.
    WHEN p_event.end_date IS NULL
         AND p_event.start_time IS NOT NULL
         AND p_event.end_time <= p_event.start_time THEN
      ((p_event.start_date + 1) + p_event.end_time)
        AT TIME ZONE public.event_effective_timezone(p_event.timezone)
    ELSE
      (GREATEST(p_event.start_date, p_event.end_date) + p_event.end_time)
        AT TIME ZONE public.event_effective_timezone(p_event.timezone)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_ends_at(public.events) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Registration state: the one rule every caller uses
-- ============================================================================
-- 'unavailable'      archived or draft
-- 'ended'            marked finished, or the event end has passed
-- 'deadline_passed'  the registration deadline has passed
-- 'closed'           closed by hand
-- 'open'             none of the above
-- When several closures have happened, the earliest one is reported (ties:
-- ended, then deadline, then manual).
CREATE OR REPLACE FUNCTION public.event_registration_state(p_event public.events, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ends timestamptz;
  v_state text := 'open';
  v_when timestamptz := NULL;
BEGIN
  IF p_event.archived_at IS NOT NULL OR p_event.visibility = 'draft' THEN
    RETURN 'unavailable';
  END IF;
  IF p_event.status = 'past' THEN
    RETURN 'ended';
  END IF;

  v_ends := public.event_ends_at(p_event);
  IF v_ends IS NOT NULL AND p_at >= v_ends THEN
    v_state := 'ended';
    v_when := v_ends;
  END IF;

  IF p_event.registration_deadline IS NOT NULL AND p_at >= p_event.registration_deadline
     AND (v_when IS NULL OR p_event.registration_deadline < v_when) THEN
    v_state := 'deadline_passed';
    v_when := p_event.registration_deadline;
  END IF;

  IF p_event.registration_closed_at IS NOT NULL
     AND (v_when IS NULL OR p_event.registration_closed_at < v_when) THEN
    v_state := 'closed';
    v_when := p_event.registration_closed_at;
  END IF;

  RETURN v_state;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_registration_state(public.events, timestamptz) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- get_event_registration_states (client read)
-- ============================================================================
-- Same visibility gate as get_event_registration_form: published or unlisted
-- and not archived, or an event the caller manages. Others are left out.
CREATE OR REPLACE FUNCTION public.get_event_registration_states(p_event_ids uuid[])
RETURNS TABLE (
  event_id uuid,
  registration_state text,
  registration_closed_at timestamptz,
  registration_deadline timestamptz,
  ends_at timestamptz,
  closes_at timestamptz,
  timezone_fallback boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF cardinality(COALESCE(p_event_ids, ARRAY[]::uuid[])) > 200 THEN
    RAISE EXCEPTION 'Ask for at most 200 events at a time';
  END IF;

  RETURN QUERY
  SELECT e.id,
         public.event_registration_state(e, now()),
         e.registration_closed_at,
         e.registration_deadline,
         public.event_ends_at(e),
         LEAST(e.registration_deadline, public.event_ends_at(e)),
         e.start_date IS NOT NULL AND public.event_effective_timezone(e.timezone) IS DISTINCT FROM e.timezone
  FROM events e
  WHERE e.id = ANY (COALESCE(p_event_ids, ARRAY[]::uuid[]))
    AND (
      (e.archived_at IS NULL AND e.visibility IN ('published', 'unlisted'))
      OR public.can_manage_event(e.id)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_registration_states(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_registration_states(uuid[]) TO authenticated;

-- ============================================================================
-- enforce_event_write_rules: 20261103000000 plus the registration controls
-- and timezone rules
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

    -- A timezone, when given, must be one Postgres recognises.
    NEW.timezone := NULLIF(btrim(NEW.timezone), '');
    IF NEW.timezone IS NOT NULL AND NOT public.accept_event_timezone(NEW.timezone) THEN
      RAISE EXCEPTION 'That timezone is not recognised. Choose a timezone name such as Africa/Accra';
    END IF;

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
      IF NEW.timezone IS NULL THEN
        RAISE EXCEPTION 'An event needs a timezone before it can be published';
      END IF;
      NEW.published_at := now();
    ELSE
      NEW.published_at := NULL;
    END IF;

    -- Who closed registration, and when, is the server's record.
    IF NEW.registration_closed_at IS NOT NULL THEN
      NEW.registration_closed_at := now();
      NEW.registration_closed_by := auth.uid();
    ELSE
      NEW.registration_closed_by := NULL;
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
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.registration_closed_at IS DISTINCT FROM OLD.registration_closed_at
       OR NEW.registration_closed_by IS DISTINCT FROM OLD.registration_closed_by
       OR NEW.registration_deadline IS DISTINCT FROM OLD.registration_deadline THEN
      RAISE EXCEPTION 'Restore this event before making other changes';
    END IF;
    RETURN NEW;
  END IF;

  -- A new or changed timezone must be one Postgres recognises, and a
  -- published event cannot lose its timezone. A stored value that is left
  -- alone is never re-judged, so existing events keep saving.
  IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    NEW.timezone := NULLIF(btrim(NEW.timezone), '');
    IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
      IF NEW.timezone IS NOT NULL AND NOT public.accept_event_timezone(NEW.timezone) THEN
        RAISE EXCEPTION 'That timezone is not recognised. Choose a timezone name such as Africa/Accra';
      END IF;
      IF NEW.timezone IS NULL AND NEW.visibility <> 'draft' THEN
        RAISE EXCEPTION 'A published event needs a timezone';
      END IF;
    END IF;
  END IF;

  -- Publishing needs the details an attendee decides on.
  IF OLD.visibility = 'draft' AND NEW.visibility <> 'draft' THEN
    IF btrim(COALESCE(NEW.name, '')) = '' THEN
      RAISE EXCEPTION 'An event needs a name before it can be published';
    END IF;
    IF NEW.start_date IS NULL THEN
      RAISE EXCEPTION 'An event needs a start date before it can be published';
    END IF;
    IF NEW.timezone IS NULL THEN
      RAISE EXCEPTION 'An event needs a timezone before it can be published';
    END IF;
    IF NOT public.accept_event_timezone(NEW.timezone) THEN
      RAISE EXCEPTION 'That timezone is not recognised. Choose a timezone name such as Africa/Accra';
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

  -- Closing and reopening registration: the server records when and by whom.
  -- NULL -> anything closes now; -> NULL reopens; anything else keeps the
  -- stored close, so it cannot be backdated or reattributed.
  IF OLD.registration_closed_at IS NULL AND NEW.registration_closed_at IS NOT NULL THEN
    NEW.registration_closed_at := now();
    NEW.registration_closed_by := auth.uid();
  ELSIF NEW.registration_closed_at IS NULL THEN
    NEW.registration_closed_by := NULL;
  ELSE
    NEW.registration_closed_at := OLD.registration_closed_at;
    NEW.registration_closed_by := OLD.registration_closed_by;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_write_rules() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- enforce_registration_rules: 20261026000000 with the registration state
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_registration_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_taken int;
  v_state text;
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

  v_state := public.event_registration_state(v_event, now());
  IF v_state = 'ended' THEN
    RAISE EXCEPTION 'That event has already finished';
  ELSIF v_state = 'deadline_passed' THEN
    RAISE EXCEPTION 'The registration deadline for this event has passed';
  ELSIF v_state = 'closed' THEN
    RAISE EXCEPTION 'Registration for this event is closed';
  END IF;

  IF v_event.capacity IS NOT NULL AND NEW.status <> 'waitlisted' THEN
    SELECT count(*) INTO v_taken
    FROM event_registrations r
    WHERE r.event_id = NEW.event_id AND r.status NOT IN ('cancelled', 'waitlisted');

    IF v_taken >= v_event.capacity THEN
      RAISE EXCEPTION 'That event is full';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- register_for_event: 20261026000000 with the registration state
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid, p_answers jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  registration_id uuid,
  registration_status text,
  waitlist_position integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_event events%ROWTYPE;
  v_existing event_registrations%ROWTYPE;
  v_had_row boolean;
  v_taken int;
  v_status text;
  v_state text;
  v_id uuid;
  v_pos int := NULL;
  v_answers jsonb := COALESCE(p_answers, '{}'::jsonb);
  k text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.account_is_active() THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  -- The event row is the lock every registration change queues behind, so the
  -- seat count below cannot change under us.
  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;
  IF v_event.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'That event is no longer available';
  END IF;
  IF v_event.visibility = 'draft' THEN
    RAISE EXCEPTION 'That event is not open for registration';
  END IF;

  -- Closed for any reason: no seat and no waitlist place, and no reviving a
  -- cancelled registration either (that happens further down).
  v_state := public.event_registration_state(v_event, now());
  IF v_state = 'ended' THEN
    RAISE EXCEPTION 'That event has already finished';
  ELSIF v_state = 'deadline_passed' THEN
    RAISE EXCEPTION 'The registration deadline for this event has passed';
  ELSIF v_state = 'closed' THEN
    RAISE EXCEPTION 'Registration for this event is closed';
  END IF;

  SELECT * INTO v_existing FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = v_me FOR UPDATE;
  v_had_row := FOUND;
  IF v_had_row AND v_existing.status <> 'cancelled' THEN
    RAISE EXCEPTION 'You are already registered for this event';
  END IF;

  PERFORM public.validate_registration_answers(p_event_id, v_answers);

  SELECT count(*) INTO v_taken FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.status NOT IN ('cancelled', 'waitlisted');
  v_status := CASE WHEN v_event.capacity IS NULL OR v_taken < v_event.capacity THEN 'registered' ELSE 'waitlisted' END;

  IF v_had_row THEN
    -- Registering again after cancelling reuses the row. created_at moves to now
    -- so a returning person joins the back of the waitlist, not their old place.
    UPDATE event_registrations r
       SET status = v_status, cancelled_at = NULL, checked_in_at = NULL, created_at = now()
     WHERE r.id = v_existing.id
     RETURNING r.id INTO v_id;
    DELETE FROM event_registration_answers a WHERE a.registration_id = v_id;
  ELSE
    INSERT INTO event_registrations (event_id, user_id, status)
    VALUES (p_event_id, v_me, v_status)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO event_registration_answers (registration_id, question_id, answer)
  SELECT v_id, x.id, v_answers -> k2
  FROM event_registration_questions x, LATERAL (SELECT x.id::text AS k2) s
  WHERE x.event_id = p_event_id AND x.archived_at IS NULL
    AND v_answers ? k2
    AND NOT (v_answers -> k2 = 'null'::jsonb OR v_answers -> k2 = '[]'::jsonb OR v_answers -> k2 = '""'::jsonb
             OR (jsonb_typeof(v_answers -> k2) = 'string' AND btrim(v_answers -> k2 #>> '{}') = ''));

  IF v_status = 'waitlisted' THEN
    SELECT count(*)::int INTO v_pos FROM event_registrations r
     WHERE r.event_id = p_event_id AND r.status = 'waitlisted'
       AND (r.created_at, r.id) <= (SELECT r2.created_at, r2.id FROM event_registrations r2 WHERE r2.id = v_id);
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (v_me, 'registration_waitlisted', 'You''re on the waitlist',
            v_event.name || ' is full. You are number ' || v_pos || ' on the waitlist; we will register you if a place opens.',
            '/events/' || p_event_id);
  ELSE
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (v_me, 'event_registration', 'Registration confirmed',
            'You are registered for ' || v_event.name || '.',
            '/events/' || p_event_id);
  END IF;

  RETURN QUERY SELECT v_id, v_status, v_pos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_for_event(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, jsonb) TO authenticated;
