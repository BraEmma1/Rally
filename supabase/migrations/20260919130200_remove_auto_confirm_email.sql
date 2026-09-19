/*
# PHASE 2 (breaking) — stop auto-confirming every signup

DO NOT APPLY until the frontend that shows the "check your email" state after
signup (phase 1 companion change in SignUpPage) is deployed. The previous bundle
routes straight to /onboarding after signup and will bounce users to /login when
no session is issued.

## What this closes
`handle_new_user()` ran `UPDATE auth.users SET email_confirmed_at = now()` on
every signup, so Rally never verified that a user owns the address they signed up
with — anyone could register a confirmed account under someone else's email. For
a professional network, where the identity on a profile and the address used for
event invitations are the product, that removes the only ownership signal there
is.

The function now only provisions the profile row; Supabase Auth decides when an
account becomes usable. ON CONFLICT added so a retried signup cannot fail the
trigger.

## Manual step — this migration alone is not enough
Enable "Confirm email" in the Supabase dashboard under
Authentication > Sign In / Providers > Email. Until that setting is on, the
project still issues sessions without verification; this migration only stops the
forced backdating of email_confirmed_at.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger function only; never callable over the API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
