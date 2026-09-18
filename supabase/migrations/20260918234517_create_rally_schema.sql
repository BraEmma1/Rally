/*
# Rally — Initial Schema: Profiles, Connections, Notes, Follow-ups

## Overview
Creates the foundational database tables for Rally, a professional event networking app.
All tables use RLS scoped to authenticated users who own the data.

## New Tables

1. **profiles**
   - Stores professional profile information for each user.
   - `id` (uuid, PK, FK to auth.users) — one-to-one with auth user
   - `full_name` (text) — display name
   - `photo_url` (text) — profile photo URL
   - `job_title` (text) — current role
   - `company` (text) — current company
   - `industry` (text) — industry/sector
   - `location` (text) — city/region
   - `bio` (text) — professional summary
   - `looking_for` (text) — what the person wants from networking
   - `can_offer` (text) — what the person can provide
   - `linkedin` (text) — LinkedIn profile URL
   - `website` (text) — personal/company website
   - `email` (text) — contact email
   - `phone` (text) — phone/WhatsApp number
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

2. **connections**
   - Records people the user has met at events.
   - `id` (uuid, PK)
   - `owner_id` (uuid, FK to auth.users) — the user who created this connection
   - `full_name` (text, not null) — contact's name
   - `job_title` (text) — contact's role
   - `company` (text) — contact's company
   - `industry` (text)
   - `location` (text)
   - `email` (text)
   - `phone` (text)
   - `linkedin` (text)
   - `website` (text)
   - `photo_url` (text)
   - `relationship_type` (text) — e.g. "Client", "Prospect", "Partner", "Mentor", "Investor", "Colleague", "Other"
   - `event_name` (text) — where they met
   - `follow_up_date` (date) — next follow-up reminder
   - `status` (text, default 'active') — 'active' or 'archived'
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

3. **notes**
   - Free-text notes attached to a connection.
   - `id` (uuid, PK)
   - `connection_id` (uuid, FK to connections, CASCADE on delete)
   - `owner_id` (uuid, FK to auth.users) — the user who wrote the note
   - `content` (text, not null) — the note text
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

4. **follow_ups**
   - Structured follow-up reminders tied to a connection.
   - `id` (uuid, PK)
   - `connection_id` (uuid, FK to connections, CASCADE on delete)
   - `owner_id` (uuid, FK to auth.users)
   - `title` (text, not null) — short description of the follow-up
   - `due_date` (date) — when to follow up
   - `completed` (boolean, default false)
   - `completed_at` (timestamptz) — when it was done
   - `created_at` (timestamptz)

5. **events**
   - Events the user is attending or has attended.
   - `id` (uuid, PK)
   - `owner_id` (uuid, FK to auth.users)
   - `name` (text, not null)
   - `description` (text)
   - `location` (text)
   - `start_date` (date)
   - `end_date` (date)
   - `status` (text, default 'upcoming') — 'upcoming', 'attending', 'attended'
   - `created_at` (timestamptz)

## Security (RLS)

All tables have RLS enabled with owner-scoped policies:
- **profiles**: users can CRUD only their own profile (id = auth.uid()).
- **connections**: users can CRUD only connections they own (owner_id = auth.uid()).
- **notes**: users can CRUD only notes on connections they own (checked via connection_id → connections.owner_id).
- **follow_ups**: same ownership pattern as notes.
- **events**: users can CRUD only events they own.

Each table gets 4 separate policies (SELECT, INSERT, UPDATE, DELETE), scoped to `authenticated`.
Owner columns default to `auth.uid()` so inserts work without explicitly passing the owner ID.

## Important Notes

1. The `profiles` table uses `id` (not `user_id`) as its PK because it's a 1:1 extension of `auth.users`.
2. Child tables (notes, follow_ups) verify ownership through their parent connection, not a direct user_id check on the child — but they also carry `owner_id` for simpler queries.
3. `updated_at` columns are maintained by the application, not a trigger (keeps it simple for MVP).
4. Indexes on `owner_id` and `connection_id` for query performance.
*/

-- ============================================================================
-- PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text DEFAULT '',
  photo_url text DEFAULT '',
  job_title text DEFAULT '',
  company text DEFAULT '',
  industry text DEFAULT '',
  location text DEFAULT '',
  bio text DEFAULT '',
  looking_for text DEFAULT '',
  can_offer text DEFAULT '',
  linkedin text DEFAULT '',
  website text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- ============================================================================
-- CONNECTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text DEFAULT '',
  company text DEFAULT '',
  industry text DEFAULT '',
  location text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  linkedin text DEFAULT '',
  website text DEFAULT '',
  photo_url text DEFAULT '',
  relationship_type text DEFAULT 'Other',
  event_name text DEFAULT '',
  follow_up_date date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_connections" ON connections;
CREATE POLICY "select_own_connections" ON connections FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_connections" ON connections;
CREATE POLICY "insert_own_connections" ON connections FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_connections" ON connections;
CREATE POLICY "update_own_connections" ON connections FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_connections" ON connections;
CREATE POLICY "delete_own_connections" ON connections FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_connections_owner_id ON connections(owner_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
CREATE INDEX IF NOT EXISTS idx_connections_follow_up_date ON connections(follow_up_date);

-- ============================================================================
-- NOTES
-- ============================================================================
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notes" ON notes;
CREATE POLICY "select_own_notes" ON notes FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_notes" ON notes;
CREATE POLICY "insert_own_notes" ON notes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_notes" ON notes;
CREATE POLICY "update_own_notes" ON notes FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_notes" ON notes;
CREATE POLICY "delete_own_notes" ON notes FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_notes_connection_id ON notes(connection_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner_id ON notes(owner_id);

-- ============================================================================
-- FOLLOW_UPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_follow_ups" ON follow_ups;
CREATE POLICY "select_own_follow_ups" ON follow_ups FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_follow_ups" ON follow_ups;
CREATE POLICY "insert_own_follow_ups" ON follow_ups FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_follow_ups" ON follow_ups;
CREATE POLICY "update_own_follow_ups" ON follow_ups FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_follow_ups" ON follow_ups;
CREATE POLICY "delete_own_follow_ups" ON follow_ups FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_follow_ups_connection_id ON follow_ups(connection_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_owner_id ON follow_ups(owner_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date ON follow_ups(due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_completed ON follow_ups(completed);

-- ============================================================================
-- EVENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  location text DEFAULT '',
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'upcoming',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_events" ON events;
CREATE POLICY "select_own_events" ON events FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_events" ON events;
CREATE POLICY "insert_own_events" ON events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_events" ON events;
CREATE POLICY "update_own_events" ON events FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_events" ON events;
CREATE POLICY "delete_own_events" ON events FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);

-- ============================================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
