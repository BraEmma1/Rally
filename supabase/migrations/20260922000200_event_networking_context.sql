/*
# Phase D — event networking and event context integrity

No second connection system. `connections.event_id` and `opportunities.event_id`
already exist as real foreign keys (added in 20260919120200), so an event
connection is an ordinary connection that carries event context. This migration
adds the guard rails that were missing and one authorized path for making a
connection at an event.

## What was actually missing
- **Self-connection was not prevented anywhere in the database.** Duplicates
  were: `idx_connections_owner_connected_unique` is a partial unique index on
  (owner_id, connected_user_id). But nothing stopped `connected_user_id =
  owner_id`, so the protection existed only in the client. There are no such
  rows today, so the guard is safe to add.
- **Nothing tied an opportunity's event context to its connection's.** A client
  could set any `event_id` on an opportunity regardless of where the
  relationship came from, which makes "opportunities from this event"
  unreliable. All 7 existing opportunities already agree with their connection,
  so the rule is enforceable without touching data.

## What is deliberately NOT enforced as a constraint
Requiring that a connection's `event_id` name an event the owner registered for
would be the strictest reading of "event context". One of the 7 existing
event-linked connections has an owner who is not registered for that event, so
a blanket constraint would either fail to apply or silently invalidate real
data. The rule is enforced on the new `connect_with_event_attendee` path
instead, where both parties are verified, and existing rows are left alone.

## Privacy
`event_attendee_directory` returns the public professional card only. The QR
flow remains the way contact details are exchanged, because there both people
deliberately take part in the exchange; discovering someone on an attendee list
is not consent to receive their phone number.
*/

-- ============================================================================
-- You cannot connect with yourself
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_connection_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.connected_user_id IS NOT NULL AND NEW.connected_user_id = NEW.owner_id THEN
    RAISE EXCEPTION 'You cannot connect with yourself';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_connection_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_connection_rules ON connections;
CREATE TRIGGER check_connection_rules
  BEFORE INSERT OR UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_connection_rules();

-- ============================================================================
-- An opportunity's event context must match its connection's
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_opportunity_event_context()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_connection_event uuid;
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.event_id INTO v_connection_event
  FROM connections c WHERE c.id = NEW.connection_id;

  IF v_connection_event IS DISTINCT FROM NEW.event_id THEN
    RAISE EXCEPTION 'An opportunity''s event must be the event its connection came from';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_event_context() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_opportunity_event_context ON opportunities;
CREATE TRIGGER check_opportunity_event_context
  BEFORE INSERT OR UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_opportunity_event_context();

-- ============================================================================
-- Discover who else is at an event
--
-- Only for people actually registered for it. is_registered_for_event is the
-- same definer helper the attendee registration policies already use.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_attendee_directory(target_event_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  job_title text,
  company text,
  industry text,
  location text,
  photo_url text,
  already_connected boolean
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_registered_for_event(target_event_id) THEN
    RAISE EXCEPTION 'You are not registered for this event';
  END IF;

  RETURN QUERY
  SELECT
    r.user_id,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(p.job_title, '') AS job_title,
    COALESCE(p.company, '')   AS company,
    COALESCE(p.industry, '')  AS industry,
    COALESCE(p.location, '')  AS location,
    COALESCE(p.photo_url, '') AS photo_url,
    EXISTS (
      SELECT 1 FROM connections c
      WHERE c.owner_id = auth.uid() AND c.connected_user_id = r.user_id
    ) AS already_connected
  FROM event_registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = target_event_id
    AND r.status <> 'cancelled'
    AND r.user_id <> auth.uid()
  ORDER BY COALESCE(p.full_name, '');
END;
$$;

-- ============================================================================
-- Connect with someone at an event
--
-- An ordinary connection row with event_id set from a verified event, not a
-- separate entity. Both people must be registered for it, which is what makes
-- the event context true rather than merely claimed.
--
-- Contact fields are left empty on purpose: this is discovery, not the
-- deliberate exchange the QR flow represents.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.connect_with_event_attendee(
  target_event_id uuid,
  target_user_id uuid,
  relationship text DEFAULT 'Other'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing uuid;
  v_id uuid;
  v_event_name text;
  v_archived timestamptz;
  p profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot connect with yourself';
  END IF;

  IF NOT public.is_registered_for_event(target_event_id) THEN
    RAISE EXCEPTION 'You are not registered for this event';
  END IF;

  SELECT e.name, e.archived_at INTO v_event_name, v_archived
  FROM events e WHERE e.id = target_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'That event is archived';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM event_registrations r
    WHERE r.event_id = target_event_id
      AND r.user_id = target_user_id
      AND r.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'That person is not attending this event';
  END IF;

  -- Already connected: keep the existing relationship and its notes, and only
  -- fill in the event context if it was never recorded. Re-connecting at a
  -- later event must not rewrite where you originally met.
  SELECT c.id INTO v_existing
  FROM connections c
  WHERE c.owner_id = auth.uid() AND c.connected_user_id = target_user_id;

  IF v_existing IS NOT NULL THEN
    UPDATE connections
       SET event_id   = COALESCE(event_id, target_event_id),
           event_name = CASE WHEN COALESCE(event_name, '') = '' THEN v_event_name ELSE event_name END,
           updated_at = now()
     WHERE id = v_existing;
    RETURN v_existing;
  END IF;

  SELECT * INTO p FROM profiles WHERE id = target_user_id;

  INSERT INTO connections (
    owner_id, connected_user_id, full_name, job_title, company, industry,
    location, photo_url, linkedin, website, relationship_type,
    event_id, event_name
  )
  VALUES (
    auth.uid(), target_user_id,
    COALESCE(NULLIF(btrim(p.full_name), ''), 'Rally member'),
    COALESCE(p.job_title, ''), COALESCE(p.company, ''), COALESCE(p.industry, ''),
    COALESCE(p.location, ''), COALESCE(p.photo_url, ''),
    COALESCE(p.linkedin, ''), COALESCE(p.website, ''),
    COALESCE(NULLIF(btrim(relationship), ''), 'Other'),
    target_event_id, v_event_name
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_attendee_directory(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.connect_with_event_attendee(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_attendee_directory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.connect_with_event_attendee(uuid, uuid, text) TO authenticated;
