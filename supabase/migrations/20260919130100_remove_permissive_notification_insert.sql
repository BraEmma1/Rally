/*
# PHASE 2 (breaking) — remove the `OR true` notification insert policy

DO NOT APPLY until the frontend that calls notify_new_connection /
notify_invitation_response (phase 1, 20260919120100) is deployed. The previous
bundle inserts cross-user notifications directly and those inserts will start
failing once this lands.

After this, `insert_own_notifications` is the only INSERT policy: a client may
write notifications addressed to itself and nothing else. Anything aimed at
another user must go through the phase 1 RPCs, which derive both recipient and
wording from server-side state.
*/

DROP POLICY IF EXISTS "insert_notifications" ON notifications;
