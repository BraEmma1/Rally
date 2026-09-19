/*
# Auto-confirm emails on signup

1. Changes
   - Updated `handle_new_user()` trigger function to set `email_confirmed_at` on the new auth user
     immediately after insert, so users can log in right after signing up without waiting for an email.
   - This mirrors the behavior of having "Confirm email" disabled in the Supabase dashboard.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = NEW.id;
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;
