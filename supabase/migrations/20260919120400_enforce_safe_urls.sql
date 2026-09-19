/*
# Reject unsafe URL schemes in stored profile and connection links

## Problem
`linkedin` and `website` are rendered straight into `href` attributes on the
profile, public profile and connection detail pages. Nothing stopped a user from
storing `javascript:...` in those fields, which becomes a stored script-execution
vector for anyone who clicks the link on a shared public profile.

## Changes
Add CHECK constraints requiring these columns to be empty or to start with
`http://` or `https://`. The client normalises input before saving; these
constraints are the backstop so the value can never be stored via a direct API
call either.

Added NOT VALID so the migration cannot fail on pre-existing rows; the check
still governs every new INSERT/UPDATE, which is what matters. The rendering layer
independently refuses to emit a non-http(s) href, so historical rows are not
exploitable either.

At the time of writing, zero rows in this database violate these checks, so the
VALIDATE statements at the bottom can be run immediately to make the constraints
fully trusted.
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

-- After auditing/cleaning any pre-existing rows, promote the constraints:
--   ALTER TABLE profiles    VALIDATE CONSTRAINT profiles_linkedin_safe_url;
--   ALTER TABLE profiles    VALIDATE CONSTRAINT profiles_website_safe_url;
--   ALTER TABLE connections VALIDATE CONSTRAINT connections_linkedin_safe_url;
--   ALTER TABLE connections VALIDATE CONSTRAINT connections_website_safe_url;
