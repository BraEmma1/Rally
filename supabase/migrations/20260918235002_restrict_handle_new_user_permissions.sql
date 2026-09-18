/*
# Restrict handle_new_user function permissions

1. Security Changes
   - Revoke EXECUTE on `handle_new_user()` from `anon` and `authenticated` roles.
   - This function should only be invoked by the auth trigger, not directly via the REST API.
*/

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
