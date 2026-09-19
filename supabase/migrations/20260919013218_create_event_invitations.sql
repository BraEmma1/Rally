/*
# Event invitations table

## Overview
Creates the `event_invitations` table to track event invitations
sent to attendees. Each invitation belongs to an invited user and
references an event and the user who sent the invitation.

## New Table: event_invitations
- `id` (uuid, PK)
- `event_id` (uuid, NOT NULL, FK to events, CASCADE)
- `invited_user_id` (uuid, NOT NULL, FK to auth.users, CASCADE)
- `invited_by` (uuid, NOT NULL, FK to auth.users, CASCADE)
- `status` (text, NOT NULL, default 'Pending') — Pending, Accepted, Declined
- `created_at` (timestamptz, default now())
- `responded_at` (timestamptz, nullable)

## Security
- RLS enabled on event_invitations
- Users can only SELECT, UPDATE their own invitations (where
  invited_user_id = auth.uid())
- INSERT and DELETE are restricted to authenticated users (organizer
  side will be built later; for now inserts are done via SQL seeding)
- Unique constraint on (event_id, invited_user_id) to prevent
  duplicate invitations

## Indexes
- Index on invited_user_id for fast user-scoped queries
- Unique index on (event_id, invited_user_id) to prevent duplicates
*/

CREATE TABLE IF NOT EXISTS event_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'Pending',
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz
);

ALTER TABLE event_invitations ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_invitations_unique ON event_invitations(event_id, invited_user_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_user ON event_invitations(invited_user_id);

DROP POLICY IF EXISTS "select_own_invitations" ON event_invitations;
CREATE POLICY "select_own_invitations"
  ON event_invitations FOR SELECT
  TO authenticated
  USING (auth.uid() = invited_user_id);

DROP POLICY IF EXISTS "insert_own_invitations" ON event_invitations;
CREATE POLICY "insert_own_invitations"
  ON event_invitations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = invited_user_id OR auth.uid() = invited_by);

DROP POLICY IF EXISTS "update_own_invitations" ON event_invitations;
CREATE POLICY "update_own_invitations"
  ON event_invitations FOR UPDATE
  TO authenticated
  USING (auth.uid() = invited_user_id)
  WITH CHECK (auth.uid() = invited_user_id);

DROP POLICY IF EXISTS "delete_own_invitations" ON event_invitations;
CREATE POLICY "delete_own_invitations"
  ON event_invitations FOR DELETE
  TO authenticated
  USING (auth.uid() = invited_user_id);
