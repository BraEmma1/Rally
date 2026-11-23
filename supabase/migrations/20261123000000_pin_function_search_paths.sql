/*
# Pin the search_path of the two functions that do not follow the convention

## The problem
The repository convention (CLAUDE.md §7) is that functions set
`search_path = public, pg_temp`. Two do not:

- `get_event_registration_counts(uuid[])` is SECURITY DEFINER and callable by
  `anon` (deliberately: migration 20260919120300). It pins
  `search_path = public` without `pg_temp`. When `pg_temp` is not named,
  PostgreSQL searches it *first* for tables and views, so a session that can
  create temporary objects could put a lookalike `event_registrations` in front
  of the real one inside a function that runs with its owner's rights. Naming
  `pg_temp` last removes that precedence. This is the reason the convention
  exists.
- `account_type_may_join_org(account_type, org_type)` (an IMMUTABLE SQL helper,
  not SECURITY DEFINER, no client EXECUTE) has no search_path at all. It is the
  one function the Supabase security advisor reports as "Function Search Path
  Mutable". Its body references no tables, so this is consistency, not a live
  risk.

## What this changes
`ALTER FUNCTION ... SET search_path = public, pg_temp` on both. Nothing else:
bodies, volatility, SECURITY DEFINER flags, owners and EXECUTE grants are
untouched (ALTER FUNCTION ... SET does not change any of them).

## Verification
tests/sql/security-definer-inventory.test.mjs asserts that every function in
`public` pins exactly `public, pg_temp`, and that both functions keep their
exact EXECUTE grants.

Forward-only; safe to re-run (ALTER ... SET is idempotent).
*/

ALTER FUNCTION public.get_event_registration_counts(uuid[])
  SET search_path = public, pg_temp;

ALTER FUNCTION public.account_type_may_join_org(public.account_type, public.org_type)
  SET search_path = public, pg_temp;
