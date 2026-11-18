/*
# Organizer attendee contact details, CSV export, and event marketing consent

## Why

Organizers need to reach the people registered for their events about the event
itself: venue changes, schedules, waitlist places, refunds. Until now no
organizer read returned an attendee's email or phone (see 20260919140100,
20260921000200, 20261031000000). This migration changes that deliberately, for
event administration only, and keeps promotional marketing as a separate,
opt-in choice.

## Two different purposes, two different rules

1. Event administration. Registering for an event lets the people who run it
   contact you about it. Organization owners and admins, and managers assigned
   to the event, see each registrant's email and phone, through the same gate
   every organizer attendee read already uses:
     can_manage_event(event) AND account_is_active()
   Nobody else gains anything: profiles RLS, the public profile functions and
   the event_registrations column grants are unchanged.
     email  the Rally account email (the address they registered with),
            falling back to the profile email when the account has none
     phone  the phone on their profile, when they have set one
   The registration form tells attendees this before they register.

2. Promotional marketing. Never implied by registering. It is a separate,
   optional choice per registration, unchecked by default, recorded with
   evidence, and changeable at any time by the attendee:
     event_registrations.marketing_consent     current choice, default false
     event_registrations.marketing_consent_at  when that choice was recorded
     event_marketing_consents                  append-only log of every change:
                                               who, which event, yes/no, the
                                               exact statement shown, its
                                               version, and when
   The statement is rendered by the server (event_marketing_consent_statement),
   shown to the attendee from the server, and stored from the server, so the
   evidence is exactly the wording they saw.

## Functions

- event_attendee_page(...)     unchanged signature and gate; each attendee
                               object gains email, phone, marketing_consent,
                               marketing_consent_at
- event_attendee_export(...)   new; same gate, search, filters and order, up to
                               1000 rows per call, for CSV export in chunks
- my_event_marketing_consent(event)          attendee: my choice + the wording
- set_event_marketing_consent(event, bool)   attendee: give or withdraw
- event_attendee_rows(...), event_attendee_page_rows(...),
  event_marketing_consent_statement(event)   internal; no client can execute them

Both organizer reads share one query (event_attendee_rows), so the list and the
export can never disagree about who matches a search or filter.

## Not changed

- share_contact / contact_email / contact_phone stay as they are: unused and
  unreadable. They were a per-event "share my details" design that nothing ever
  wrote; event administration access replaces it and marketing consent is
  recorded separately. Removing them is a separate, destructive change.
- find_event_attendees (check-in desk, speaker picker) still returns no contact
  details.
- register_for_event is not changed. Consent is recorded by a second call, so a
  failure there leaves the attendee registered with no marketing consent, which
  is the safe default.

Forward-only. Do not edit once applied.
*/

-- ============================================================================
-- Marketing consent: current state on the registration, evidence in a log
-- ============================================================================
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz;

-- authenticated holds explicit column grants on event_registrations
-- (20260919150400), so these new columns are not readable or writable by
-- clients. They are reached only through the functions below.

CREATE TABLE IF NOT EXISTS public.event_marketing_consents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id   uuid NOT NULL REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consented         boolean NOT NULL,
  statement         text NOT NULL,
  statement_version text NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_marketing_consents_registration
  ON public.event_marketing_consents(registration_id, recorded_at);

-- Evidence only. RLS on with no policies, and no table privileges for clients:
-- written and read solely by the SECURITY DEFINER functions here.
ALTER TABLE public.event_marketing_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_marketing_consents FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- event_marketing_consent_statement (internal)
-- The exact wording an attendee sees and agrees to. Bump the version whenever
-- the wording changes, so old evidence keeps meaning what it said.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_marketing_consent_statement(p_event_id uuid)
RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT 'Send me news and offers about future events from '
         || COALESCE(NULLIF(btrim(o.name), ''), 'the organizer of ' || e.name)
         || '. I can turn this off at any time.'
  FROM events e
  LEFT JOIN organizations o ON o.id = e.organization_id
  WHERE e.id = p_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.event_marketing_consent_statement(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- my_event_marketing_consent (attendee)
-- My current choice for this event and the wording to show. Works before I
-- register (consented false, no timestamp) so the form can show the statement.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_event_marketing_consent(p_event_id uuid)
RETURNS TABLE (
  consented   boolean,
  recorded_at timestamptz,
  statement   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_visibility text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT e.visibility INTO v_visibility FROM events e WHERE e.id = p_event_id;
  IF NOT FOUND OR (v_visibility = 'draft' AND NOT public.can_manage_event(p_event_id)) THEN
    RAISE EXCEPTION 'That event does not exist';
  END IF;

  RETURN QUERY
  SELECT COALESCE(r.marketing_consent, false),
         r.marketing_consent_at,
         public.event_marketing_consent_statement(p_event_id)
  FROM (SELECT 1) one
  LEFT JOIN event_registrations r ON r.event_id = p_event_id AND r.user_id = v_me;
END;
$$;

-- ============================================================================
-- set_event_marketing_consent (attendee)
-- Give or withdraw my marketing consent for one event's organizer. Giving needs
-- an active account and a live (not cancelled) registration. Withdrawing needs
-- only a registration: it is never blocked. Every change is logged with the
-- statement in force; repeating the current choice changes nothing.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_event_marketing_consent(p_event_id uuid, p_consent boolean)
RETURNS TABLE (
  consented   boolean,
  recorded_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_reg event_registrations%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_consent IS NULL THEN
    RAISE EXCEPTION 'Choose yes or no';
  END IF;

  SELECT * INTO v_reg FROM event_registrations r
   WHERE r.event_id = p_event_id AND r.user_id = v_me FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not registered for this event';
  END IF;

  IF p_consent THEN
    IF NOT public.account_is_active() THEN
      RAISE EXCEPTION 'Your account is not active';
    END IF;
    IF v_reg.status = 'cancelled' THEN
      RAISE EXCEPTION 'You are not registered for this event';
    END IF;
  END IF;

  IF v_reg.marketing_consent = p_consent AND v_reg.marketing_consent_at IS NOT NULL THEN
    RETURN QUERY SELECT v_reg.marketing_consent, v_reg.marketing_consent_at;
    RETURN;
  END IF;

  UPDATE event_registrations r
     SET marketing_consent = p_consent, marketing_consent_at = v_now
   WHERE r.id = v_reg.id;

  INSERT INTO event_marketing_consents
    (registration_id, event_id, user_id, consented, statement, statement_version, recorded_at)
  VALUES
    (v_reg.id, p_event_id, v_me, p_consent,
     public.event_marketing_consent_statement(p_event_id), 'event-marketing-v1', v_now);

  RETURN QUERY SELECT p_consent, v_now;
END;
$$;

-- ============================================================================
-- event_attendee_rows (internal)
-- The one definition of "who matches this search and filter", with contact
-- details and consent. No gate of its own: only the gated functions below call
-- it, and no client role can execute it.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_attendee_rows(
  target_event_id uuid,
  search text,
  status_filter text
)
RETURNS TABLE (
  reg_id               uuid,
  user_id              uuid,
  full_name            text,
  job_title            text,
  company              text,
  photo_url            text,
  email                text,
  phone                text,
  status               text,
  registered_at        timestamptz,
  checked_in_at        timestamptz,
  marketing_consent    boolean,
  marketing_consent_at timestamptz
)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_needle  text := lower(btrim(COALESCE(search, '')));
  v_pattern text;
  v_filter  text := COALESCE(status_filter, 'all');
BEGIN
  IF v_filter NOT IN ('all', 'confirmed', 'checked_in', 'not_checked_in', 'waitlisted', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown attendee filter';
  END IF;

  -- Escape LIKE's own characters so the search text is matched literally.
  v_pattern := '%' || replace(replace(replace(v_needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT
    r.id,
    r.user_id,
    COALESCE(p.full_name, ''),
    COALESCE(p.job_title, ''),
    COALESCE(p.company, ''),
    COALESCE(p.photo_url, ''),
    COALESCE(NULLIF(btrim(u.email), ''), NULLIF(btrim(p.email), '')),
    NULLIF(btrim(p.phone), ''),
    r.status,
    r.created_at,
    r.checked_in_at,
    r.marketing_consent,
    r.marketing_consent_at
  FROM event_registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  LEFT JOIN auth.users u ON u.id = r.user_id
  WHERE r.event_id = target_event_id
    AND (
      v_needle = ''
      OR lower(COALESCE(p.full_name, '')) LIKE v_pattern ESCAPE '\'
      OR lower(COALESCE(p.company, ''))   LIKE v_pattern ESCAPE '\'
    )
    AND CASE v_filter
          WHEN 'all'            THEN true
          WHEN 'confirmed'      THEN r.status IN ('registered', 'checked_in')
          WHEN 'checked_in'     THEN r.status IN ('registered', 'checked_in') AND r.checked_in_at IS NOT NULL
          WHEN 'not_checked_in' THEN r.status IN ('registered', 'checked_in') AND r.checked_in_at IS NULL
          WHEN 'waitlisted'     THEN r.status = 'waitlisted'
          WHEN 'cancelled'      THEN r.status = 'cancelled'
        END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_attendee_rows(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- event_attendee_page_rows (internal)
-- One page in the fixed order, plus the total before paging. Always one row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_attendee_page_rows(
  target_event_id uuid,
  search text,
  status_filter text,
  page_size integer,
  page_offset integer
)
RETURNS TABLE (
  total_count bigint,
  attendees jsonb
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  WITH matched AS (
    SELECT * FROM public.event_attendee_rows(target_event_id, search, status_filter)
  ),
  page AS (
    SELECT m.*
    FROM matched m
    ORDER BY lower(m.full_name), m.full_name, m.registered_at, m.reg_id
    LIMIT page_size OFFSET page_offset
  )
  SELECT
    (SELECT count(*) FROM matched)::bigint,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id',              pg.user_id,
                  'full_name',            pg.full_name,
                  'job_title',            pg.job_title,
                  'company',              pg.company,
                  'photo_url',            pg.photo_url,
                  'email',                pg.email,
                  'phone',                pg.phone,
                  'status',               pg.status,
                  'registered_at',        pg.registered_at,
                  'checked_in_at',        pg.checked_in_at,
                  'marketing_consent',    pg.marketing_consent,
                  'marketing_consent_at', pg.marketing_consent_at
                )
                ORDER BY lower(pg.full_name), pg.full_name, pg.registered_at, pg.reg_id
              )
         FROM page pg),
      '[]'::jsonb
    );
$$;

REVOKE EXECUTE ON FUNCTION public.event_attendee_page_rows(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- event_attendee_page (organizer list) — same signature and gate as
-- 20261031000000; attendee objects now carry contact details and consent.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_attendee_page(
  target_event_id uuid,
  search text DEFAULT '',
  status_filter text DEFAULT 'all',
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  total_count bigint,
  attendees jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT * FROM public.event_attendee_page_rows(
    target_event_id, search, status_filter,
    LEAST(GREATEST(COALESCE(page_size, 20), 1), 100),
    GREATEST(COALESCE(page_offset, 0), 0)
  );
END;
$$;

-- ============================================================================
-- event_attendee_export (organizer CSV export)
-- The full search/filter result, read in chunks of up to 1000 so a large event
-- never becomes one unbounded response (PostgREST caps rows per response).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.event_attendee_export(
  target_event_id uuid,
  search text DEFAULT '',
  status_filter text DEFAULT 'all',
  page_size integer DEFAULT 1000,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  total_count bigint,
  attendees jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  RETURN QUERY
  SELECT * FROM public.event_attendee_page_rows(
    target_event_id, search, status_filter,
    LEAST(GREATEST(COALESCE(page_size, 1000), 1), 1000),
    GREATEST(COALESCE(page_offset, 0), 0)
  );
END;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.event_attendee_page(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_attendee_export(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_event_marketing_consent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_event_marketing_consent(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_attendee_page(uuid, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_attendee_export(uuid, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_event_marketing_consent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_marketing_consent(uuid, boolean) TO authenticated;
