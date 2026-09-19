/*
# Opportunities table

## Overview
Creates the `opportunities` table to track business opportunities arising
from professional relationships (sales deals, investments, partnerships,
recruitment, mentorship, etc.). Each opportunity belongs to an
authenticated user and is linked to a connection.

## New Table: opportunities
- `id` (uuid, PK)
- `owner_id` (uuid, NOT NULL, DEFAULT auth.uid(), FK to auth.users)
- `connection_id` (uuid, NOT NULL, FK to connections, CASCADE)
- `title` (text, NOT NULL)
- `description` (text, default '')
- `type` (text, NOT NULL) — Sales, Investment, Partnership, Recruitment, Mentorship, Other
- `stage` (text, NOT NULL, default 'New') — New, Discussing, Proposal, Negotiation, Won, Lost
- `value` (numeric, default 0) — estimated monetary value
- `expected_close_date` (date, nullable)
- `event_name` (text, default '') — event where the opportunity originated
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

## Security
- RLS enabled on opportunities
- Owner-scoped CRUD: each authenticated user can only access their own
  opportunities (4 separate policies for SELECT/INSERT/UPDATE/DELETE)
- `owner_id` defaults to `auth.uid()` so inserts omitting it still work

## Indexes
- Index on owner_id for fast user-scoped queries
- Index on connection_id for fast lookups from connection detail page
*/

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  type text NOT NULL DEFAULT 'Other',
  stage text NOT NULL DEFAULT 'New',
  value numeric(12, 2) DEFAULT 0,
  expected_close_date date,
  event_name text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_opportunities_owner_id ON opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_connection_id ON opportunities(connection_id);

DROP POLICY IF EXISTS "select_own_opportunities" ON opportunities;
CREATE POLICY "select_own_opportunities"
  ON opportunities FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_opportunities" ON opportunities;
CREATE POLICY "insert_own_opportunities"
  ON opportunities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_opportunities" ON opportunities;
CREATE POLICY "update_own_opportunities"
  ON opportunities FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_opportunities" ON opportunities;
CREATE POLICY "delete_own_opportunities"
  ON opportunities FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);
