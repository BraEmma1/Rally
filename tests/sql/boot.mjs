// Replays every migration in supabase/migrations onto an in-process Postgres (PGlite) so
// SQL behaviour can be checked without touching any Supabase project. Supabase itself is
// replaced by the small stand-in below (roles, auth.uid(), a storage stub): this proves the
// SQL does what it says on real Postgres, NOT that it behaves identically on Supabase.
//
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node tests/sql/event-registration.test.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations')

// Minimal stand-in for what Supabase provides before any migration runs.
export const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN; CREATE ROLE supabase_auth_admin NOLOGIN; CREATE ROLE supabase_admin NOLOGIN;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA public, auth, extensions, storage TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.jwt() ->> 'role', 'anon') $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'email' $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid,
  metadata jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql AS $$ SELECT lower((regexp_match(name, '\.([^.]+)$'))[1]) $$;
CREATE PUBLICATION supabase_realtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`

export async function boot(dir, { upTo = 'zzzz', skip = [] } = {}) {
  const db = new PGlite()
  await db.exec(STUBS)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const failures = []
  for (const f of files) {
    if (f.slice(0, 14) > upTo || skip.includes(f)) continue
    try {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch (e) {
      failures.push([f, String(e.message).split('\n')[0]])
    }
  }
  return { db, failures }
}

if (process.argv[1] && process.argv[1].endsWith('boot.mjs')) {
  const dir = process.argv[2] || MIGRATIONS
  const upTo = process.argv[3] || 'zzzz'
  const { failures } = await boot(dir, { upTo })
  console.log('failures:', failures.length)
  for (const [f, m] of failures) console.log(' ', f, '=>', m)
}
