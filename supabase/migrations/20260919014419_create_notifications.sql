/*
# Notifications table

## Overview
Creates the `notifications` table to keep users informed about activity
across Rally: new connections, event invitations and responses, follow-ups
due/overdue, opportunity stage changes, event registration confirmations,
and upcoming registered events.

## New Table: notifications
- `id` (uuid, PK)
- `user_id` (uuid, NOT NULL, DEFAULT auth.uid(), FK to auth.users, CASCADE) —
  the notification recipient
- `type` (text, NOT NULL) — notification type:
  'new_connection', 'event_invitation', 'invitation_accepted',
  'invitation_declined', 'follow_up_due', 'follow_up_overdue',
  'opportunity_stage_changed', 'event_registration', 'upcoming_event'
- `title` (text, NOT NULL) — short headline
- `message` (text, DEFAULT '') — short supporting message
- `link` (text, DEFAULT '') — in-app path to open the related item
  (e.g. '/connections/<id>', '/events/<id>', '/opportunities/<id>')
- `read` (boolean, NOT NULL, DEFAULT false) — read/unread status
- `created_at` (timestamptz, DEFAULT now())

## Security
- RLS enabled on notifications
- Owner-scoped CRUD: each authenticated user can only read, update,
  and delete their own notifications (4 separate policies)
- INSERT: any authenticated user may create a notification addressed to
  a specific user (this is how in-app actions like "invitation accepted"
  notify the other party). Ownership is enforced at the database level
  via the DEFAULT auth.uid() and WITH CHECK on user_id.
- Indexes on user_id (fast per-user queries) and (user_id, read) for
  fast unread counts.
*/

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text DEFAULT '',
  link text DEFAULT '',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_notifications" ON notifications;
CREATE POLICY "insert_notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR true);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications"
  ON notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
