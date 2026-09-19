/*
# Remove automatic email confirmation on signup

## Problem
`handle_new_user()` ran `UPDATE auth.users SET email_confirmed_at = now()` for
every new signup. Rally therefore never verified that a user owns the address
they signed up with: anyone could register a "confirmed" account under someone
else's email. For a professional networking product — where the identity shown
on a profile and used for event invitations is the whole value — that removes
the only ownership signal there is.

## Changes
- Recreate `handle_new_user()` so it only provisions the profile row. The
  `email_confirmed_at` write is gone, so Supabase Auth's own confirmation flow
  decides when an account becomes usable.
- Added `ON CONFLICT (id) DO NOTHING` so a retried signup cannot fail the
  trigger if the profile row already exists.

## Manual step required (cannot be done from SQL)
Enable "Confirm email" in the Supabase dashboard under
Authentication > Sign In / Providers > Email. Until that setting is on, the
project still issues sessions without verification — this migration only removes
the forced backdating of `email_confirmed_at`.
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

-- The function is a signup trigger only; it must not be callable over the API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
