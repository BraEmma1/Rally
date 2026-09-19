/*
# QR connections: link connections to Rally users + prevent duplicates

## 1. Add connected_user_id to connections
- New nullable column `connected_user_id` (uuid, FK to auth.users)
- When a user scans another Rally user's QR code, the connection is
  linked to that user via this column, so the connection carries both
  the owner (requester) and the connected user.

## 2. Unique constraint to prevent duplicate connections
- A unique index on (owner_id, connected_user_id) ensures a user can't
  connect to the same Rally user twice. Applies only when
  connected_user_id is NOT NULL (manually-added connections without a
  linked user are unaffected).

## 3. Update relationship_type allowed values
- Existing relationship types remain. New types added per the QR flow:
  Customer, Investor, Partner, Supplier, Employer, Employee, Mentor, Media, Other.
- The column is free-text so no schema change is needed; this is
  documented here for clarity.

## Security
- No RLS policy changes — existing owner-scoped CRUD on connections
  already enforces that users can only access their own connections.
- The new connected_user_id column is covered by existing policies
  (owner_id check still gates every row).
*/

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS connected_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_owner_connected_unique
  ON connections(owner_id, connected_user_id)
  WHERE connected_user_id IS NOT NULL;
