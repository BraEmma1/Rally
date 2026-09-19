/*
# Attendee event experience: public events + registrations

## Overview
Transforms the events table from a personal owner-scoped list into a
public, attendee-facing event catalog. Adds event_registrations for
tracking which professionals are attending which events. Seeds sample
events for demo purposes.

## 1. Events table changes
- Adds `image_url` (text) — event banner/logo image URL
- Adds `start_time` (time) — event start time
- Adds `end_time` (time) — event end time
- Adds `capacity` (int) — max attendees (nullable, for display)
- Makes `owner_id` nullable (events are no longer user-owned)
- Changes RLS: events become publicly readable. Removes write policies.

## 2. New table: event_registrations
- Links professionals to events they're attending.
- Unique constraint prevents duplicate registrations.
- RLS: public SELECT, owner-scoped INSERT and DELETE.

## 3. Seed sample events
- 4 sample events with images, dates, times, locations.
*/

-- ============================================================================
-- EVENTS: add columns, make owner_id nullable, change RLS to public read
-- ============================================================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS capacity int;

ALTER TABLE events ALTER COLUMN owner_id DROP NOT NULL;

-- Make events public-readable, remove attendee write access
DROP POLICY IF EXISTS "select_own_events" ON events;
DROP POLICY IF EXISTS "insert_own_events" ON events;
DROP POLICY IF EXISTS "update_own_events" ON events;
DROP POLICY IF EXISTS "delete_own_events" ON events;

CREATE POLICY "public_read_events"
  ON events FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- EVENT REGISTRATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registrations_event_user
  ON event_registrations(event_id, user_id);

CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_user_id ON event_registrations(user_id);

-- Anyone can see who's registered (attendee lists are public to attendees)
DROP POLICY IF EXISTS "public_read_registrations" ON event_registrations;
CREATE POLICY "public_read_registrations"
  ON event_registrations FOR SELECT
  TO anon, authenticated
  USING (true);

-- Users can only register themselves
DROP POLICY IF EXISTS "insert_own_registration" ON event_registrations;
CREATE POLICY "insert_own_registration"
  ON event_registrations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only unregister themselves
DROP POLICY IF EXISTS "delete_own_registration" ON event_registrations;
CREATE POLICY "delete_own_registration"
  ON event_registrations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- SEED SAMPLE EVENTS
-- ============================================================================
INSERT INTO events (id, name, description, location, start_date, end_date, start_time, end_time, status, image_url, capacity)
VALUES
  (
    'a1b2c3d4-1111-4111-8111-aaaaaaaaaa01',
    'TechConnect Summit 2026',
    'The premier networking conference for tech professionals, founders, and investors. Three days of keynotes, workshops, and curated networking sessions.',
    'Moscone Center, San Francisco, CA',
    '2026-10-15',
    '2026-10-17',
    '09:00',
    '17:00',
    'upcoming',
    'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
    500
  ),
  (
    'a1b2c3d4-1111-4111-8111-aaaaaaaaaa02',
    'Founders & Funders Mixer',
    'An intimate evening connecting early-stage founders with angel investors and VCs. Lightning pitches followed by structured networking.',
    'The Battery, New York, NY',
    '2026-10-22',
    '2026-10-22',
    '18:00',
    '21:00',
    'upcoming',
    'https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg?auto=compress&cs=tinysrgb&w=800',
    120
  ),
  (
    'a1b2c3d4-1111-4111-8111-aaaaaaaaaa03',
    'Product Innovation Forum',
    'A one-day forum for product leaders to share frameworks, discuss emerging trends, and build cross-industry relationships.',
    'Convention Centre, Austin, TX',
    '2026-11-08',
    '2026-11-08',
    '10:00',
    '16:00',
    'upcoming',
    'https://images.pexels.com/photos/7988079/pexels-photo-7988079.jpeg?auto=compress&cs=tinysrgb&w=800',
    300
  ),
  (
    'a1b2c3d4-1111-4111-8111-aaaaaaaaaa04',
    'Global Marketing Meetup 2026',
    'Marketers, brand strategists, and growth leaders come together for a day of talks, panels, and peer networking.',
    'ExCeL London, UK',
    '2026-09-05',
    '2026-09-06',
    '09:30',
    '17:30',
    'past',
    'https://images.pexels.com/photos/7103/woman-coffee-meeting-office.jpg?auto=compress&cs=tinysrgb&w=800',
    250
  )
ON CONFLICT (id) DO NOTHING;
