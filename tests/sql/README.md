# SQL tests (PGlite)

Checks database behaviour by replaying every migration in `supabase/migrations/` onto
an in-process Postgres ([PGlite](https://pglite.dev)) and then acting as different users.

```bash
npm i --no-save @electric-sql/pglite@0.2.17   # not a project dependency
node tests/sql/event-registration.test.mjs
```

No Supabase project is contacted and nothing is written anywhere but memory.

## What this proves, and what it does not

- It proves the migrations apply in order on real Postgres, and that the SQL does what
  its tests say (rules, RLS, grants, triggers).
- It does **not** prove identical behaviour on Supabase. Supabase's roles, `auth.uid()`
  and storage are replaced by the small stand-in in `boot.mjs`.
- Concurrency (two sessions racing for the last seat) is not covered: one embedded
  connection cannot race. That rests on the `FOR UPDATE` lock in `register_for_event`.

| File | Covers |
| --- | --- |
| `event-registration.test.mjs` | Registration form validation, capacity and waitlist order, automatic promotion (cancel, delete, capacity change), cancellation keeps a record, direct INSERT/DELETE blocked, privacy of waitlisted / cancelled rows, organizer-only form and answers, grants |
