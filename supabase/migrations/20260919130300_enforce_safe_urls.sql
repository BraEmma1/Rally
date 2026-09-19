/*
# PHASE 2 (breaking) — reject unsafe URL schemes on write

DO NOT APPLY until the frontend that normalises URLs before saving is deployed.
The previous bundle stores whatever was typed, so a user entering a bare domain
("linkedin.com/in/jane") would have their entire profile save rejected by these
checks.

## What this closes
`linkedin` and `website` are rendered straight into href attributes on the
profile, public profile and connection detail pages. Nothing stopped a user
storing `javascript:...`, which becomes a stored script-execution vector for
anyone clicking the link on a shared public profile.

The new frontend normalises input to http(s) before saving and refuses to emit a
non-http(s) href when rendering. These constraints are the backstop for anything
written straight to the API.

NOT VALID so the migration cannot fail on pre-existing rows; the check still
governs every new INSERT and UPDATE, which is the point. Verified at authoring
time: zero rows in this database violate these checks, so the VALIDATE statements
at the bottom can be run immediately after applying.
*/

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_linkedin_safe_url;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_linkedin_safe_url CHECK (
    linkedin IS NULL OR linkedin = '' OR linkedin ~* '^https?://'
  ) NOT VALID;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_website_safe_url;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_website_safe_url CHECK (
    website IS NULL OR website = '' OR website ~* '^https?://'
  ) NOT VALID;

ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_linkedin_safe_url;
ALTER TABLE connections
  ADD CONSTRAINT connections_linkedin_safe_url CHECK (
    linkedin IS NULL OR linkedin = '' OR linkedin ~* '^https?://'
  ) NOT VALID;

ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_website_safe_url;
ALTER TABLE connections
  ADD CONSTRAINT connections_website_safe_url CHECK (
    website IS NULL OR website = '' OR website ~* '^https?://'
  ) NOT VALID;

-- Safe to run straight after this migration (no violating rows):
--   ALTER TABLE profiles    VALIDATE CONSTRAINT profiles_linkedin_safe_url;
--   ALTER TABLE profiles    VALIDATE CONSTRAINT profiles_website_safe_url;
--   ALTER TABLE connections VALIDATE CONSTRAINT connections_linkedin_safe_url;
--   ALTER TABLE connections VALIDATE CONSTRAINT connections_website_safe_url;
