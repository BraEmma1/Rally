// Registration open/close controls (migration 20261104000000): manual close and
// reopen, the registration deadline, the date-based event end (multi-day,
// overnight, missing end date/time), timezone rules and the legacy fallback,
// the waitlist and cancellation while closed, archived events, who may change
// the settings, and grants. Runs on PGlite; see boot.mjs for what that does and
// does not prove.
//   node tests/sql/registration-open-close.test.mjs
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
async function as(uid, sql, params = [], role = 'authenticated') {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role })])
  try { return await db.query(sql, params) } finally {
    await db.exec(`RESET ROLE`)
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`)
  }
}
async function err(uid, sql, params = [], role) {
  try { await as(uid, sql, params, role); return null } catch (e) { return String(e.message) }
}
const sup = (sql, params = []) => db.query(sql, params)
const user = async (email) =>
  (await sup(`INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),$1) RETURNING id`, [email])).rows[0].id

const CLOSED = /Registration for this event is closed/
const DEADLINE = /The registration deadline for this event has passed/
const FINISHED = /That event has already finished/
const NO_TZ = /needs a timezone before it can be published/
const BAD_TZ = /That timezone is not recognised/

// ---- seed -----------------------------------------------------------------
const U = {}
for (const k of ['owner', 'admin', 'mgr', 'idle', 'susp', 'owner2', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) U[k] = await user(`${k}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id = ANY($1)`, [[U.owner, U.owner2]])
const mkOrg = async (name, by) =>
  (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1,'organizer','approved',$2) RETURNING id`, [name, by])).rows[0].id
const org = await mkOrg('Acme Events', U.owner)
const org2 = await mkOrg('Other', U.owner2)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org2, U.owner2])
await sup(`SET session_replication_role = replica`)
for (const [k, r] of [['admin', 'admin'], ['mgr', 'manager'], ['idle', 'manager'], ['susp', 'manager']]) {
  await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [org, U[k], r])
}
await sup(`SET session_replication_role = origin`)

// Inserted as the superuser, so the event write trigger runs (unlike replica).
const ev = async ({ name = 'Ev', vis = 'published', start = '2030-01-15', end = null, st = null, et = null, tz = 'Africa/Accra', cap = null } = {}) =>
  (await sup(
    `INSERT INTO events (name, visibility, organization_id, created_by, start_date, end_date, start_time, end_time, timezone, capacity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [name, vis, org, U.owner, start, end, st, et, tz, cap])).rows[0].id
// Legacy rows: written with triggers off, as existing production rows were.
const legacy = async ({ name = 'Legacy', start = '2030-01-15', end = null, et = null, tz = null } = {}) => {
  await sup(`SET session_replication_role = replica`)
  const id = (await sup(
    `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, end_time, timezone, published_at)
     VALUES ($1,'upcoming','published',$2,$3,$4,$5,$6,$7, now()) RETURNING id`, [name, org, U.owner, start, end, et, tz])).rows[0].id
  await sup(`SET session_replication_role = origin`)
  return id
}

const REG = `SELECT * FROM register_for_event($1,'{}'::jsonb)`
const register = (k, e) => err(U[k], REG, [e])
const row = async (e) => (await sup(`SELECT * FROM events WHERE id=$1`, [e])).rows[0]
const regOf = async (e, k) => (await sup(`SELECT status, created_at FROM event_registrations WHERE event_id=$1 AND user_id=$2`, [e, U[k]])).rows[0]
const stateAt = async (e, at) => (await sup(`SELECT event_registration_state(e, $2::timestamptz) s FROM events e WHERE e.id=$1`, [e, at])).rows[0].s
const endsAt = async (e) => (await sup(`SELECT event_ends_at(e) t FROM events e WHERE e.id=$1`, [e])).rows[0].t
const iso = (d) => (d ? new Date(d).toISOString() : null)
const tick = () => sup(`SELECT pg_sleep(0.002)`)
const close = (k, e) => as(U[k], `UPDATE events SET registration_closed_at = '2000-01-01' WHERE id=$1 RETURNING id`, [e])
const reopen = (k, e) => as(U[k], `UPDATE events SET registration_closed_at = NULL WHERE id=$1 RETURNING id`, [e])

// ============================================================================
// Schema
// ============================================================================
{
  const cols = (await sup(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='events'
        AND column_name IN ('registration_closed_at','registration_closed_by','registration_deadline') ORDER BY 1`)).rows
  ok('three nullable registration columns, no defaults',
    cols.length === 3 && cols.every((c) => c.is_nullable === 'YES' && c.column_default === null)
      && cols.find((c) => c.column_name === 'registration_closed_by').data_type === 'uuid'
      && cols.filter((c) => c.data_type === 'timestamp with time zone').length === 2, JSON.stringify(cols))
  const fk = (await sup(
    `SELECT pg_get_constraintdef(c.oid) d FROM pg_constraint c
      WHERE c.conrelid='public.events'::regclass AND c.contype='f' AND pg_get_constraintdef(c.oid) LIKE '%registration_closed_by%'`)).rows
  ok('registration_closed_by references auth.users ON DELETE SET NULL', fk.length === 1 && /auth\.users\(id\) ON DELETE SET NULL/.test(fk[0].d), JSON.stringify(fk))
  const tz = (await sup(`SELECT count(*)::int n, bool_or(name='Africa/Accra') accra, bool_or(name='Etc/GMT+12') aoe, bool_or(name='UTC-5') posix FROM iana_time_zones`)).rows[0]
  ok('iana_time_zones holds the catalog names (and no POSIX strings)', tz.n > 400 && tz.accra && tz.aoe && !tz.posix, JSON.stringify(tz))
  const t = (await sup(`SELECT relrowsecurity r FROM pg_class WHERE oid='public.iana_time_zones'::regclass`)).rows[0]
  const priv = (await sup(
    `SELECT bool_or(has_table_privilege(r, 'public.iana_time_zones', p)) any
       FROM unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`)).rows[0]
  ok('iana_time_zones: RLS on, no client privileges', t.r && !priv.any)
  ok('clients cannot read iana_time_zones', /permission denied/.test((await err(U.a, `SELECT * FROM iana_time_zones LIMIT 1`)) ?? ''))
}

// ============================================================================
// Events used below
// ============================================================================
const OPEN = await ev({ name: 'Open', cap: 2 })
for (const m of ['mgr', 'susp']) {
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [OPEN, U[m]])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}
ok('every existing event starts open with no deadline', (await stateAt(OPEN, new Date().toISOString())) === 'open'
  && (await row(OPEN)).registration_closed_at === null && (await row(OPEN)).registration_deadline === null)

// ============================================================================
// Manual close and reopen
// ============================================================================
{
  ok('a registers while open', (await register('a', OPEN)) === null && (await regOf(OPEN, 'a')).status === 'registered')
  await tick()
  ok('b registers while open', (await register('b', OPEN)) === null && (await regOf(OPEN, 'b')).status === 'registered')
  await tick()
  ok('c joins the waitlist while open', (await register('c', OPEN)) === null && (await regOf(OPEN, 'c')).status === 'waitlisted')
  await tick()
  const before = (await sup(`SELECT user_id, status, created_at FROM event_registrations WHERE event_id=$1 ORDER BY user_id`, [OPEN])).rows

  const t0 = Date.now()
  const r = await close('owner', OPEN)
  const e = await row(OPEN)
  ok('owner closes registration', r.rows.length === 1 && e.registration_closed_at !== null)
  ok('the close is stamped with the server clock, not the client value',
    new Date(e.registration_closed_at).getUTCFullYear() !== 2000 && Math.abs(new Date(e.registration_closed_at).getTime() - t0) < 60_000, iso(e.registration_closed_at))
  ok('the close records who closed it', e.registration_closed_by === U.owner)
  ok('state is closed', (await stateAt(OPEN, new Date().toISOString())) === 'closed')

  ok('closed: a new registration is refused', CLOSED.test((await register('d', OPEN)) ?? ''))
  ok('closed: no row was created for the refused person', (await regOf(OPEN, 'd')) === undefined)
  // The event is full (cap 2), so d would have been waitlisted: also refused.
  ok('closed: a would-be waitlist entry is refused too', CLOSED.test((await register('e', OPEN)) ?? '') && (await regOf(OPEN, 'e')) === undefined)
  ok('closed: an existing registrant gets the closed message, nothing changes',
    CLOSED.test((await register('a', OPEN)) ?? '') && (await regOf(OPEN, 'a')).status === 'registered')
  const after = (await sup(`SELECT user_id, status, created_at FROM event_registrations WHERE event_id=$1 ORDER BY user_id`, [OPEN])).rows
  ok('closing leaves existing registrations and waitlist positions exactly as they were', JSON.stringify(before) === JSON.stringify(after))
  const pos = (await as(U.c, `SELECT waitlist_position p FROM my_event_registration($1)`, [OPEN])).rows[0].p
  ok('the waitlisted person keeps position 1', pos === 1, pos)

  // Writes while closed keep the original stamp and closer.
  const stamp = iso(e.registration_closed_at)
  await as(U.admin, `UPDATE events SET registration_closed_at = '2001-01-01', registration_closed_by = $2 WHERE id=$1`, [OPEN, U.admin])
  const e2 = await row(OPEN)
  ok('a second close cannot backdate or reattribute it', iso(e2.registration_closed_at) === stamp && e2.registration_closed_by === U.owner)
  await as(U.admin, `UPDATE events SET name = 'Open (renamed)' WHERE id=$1`, [OPEN])
  const e3 = await row(OPEN)
  ok('an unrelated edit keeps the close', iso(e3.registration_closed_at) === stamp && e3.registration_closed_by === U.owner)
  await as(U.admin, `UPDATE events SET registration_closed_by = $2 WHERE id=$1`, [OPEN, U.admin])
  ok('registration_closed_by cannot be written on its own', (await row(OPEN)).registration_closed_by === U.owner)

  // Cancelling while closed works; registering again does not.
  ok('closed: cancelling your own registration still works', (await err(U.b, `SELECT cancel_event_registration($1)`, [OPEN])) === null)
  ok('the freed seat goes to the waitlist while closed', (await regOf(OPEN, 'c')).status === 'registered' && (await regOf(OPEN, 'b')).status === 'cancelled')
  ok('closed: re-registering after cancelling is refused', CLOSED.test((await register('b', OPEN)) ?? '') && (await regOf(OPEN, 'b')).status === 'cancelled')

  const ro = await reopen('owner', OPEN)
  const e4 = await row(OPEN)
  ok('owner reopens registration; closer is cleared', ro.rows.length === 1 && e4.registration_closed_at === null && e4.registration_closed_by === null)
  // c took b's seat, so the event is full again: b re-registers onto the waitlist.
  const rb = await register('b', OPEN)
  ok('reopened: re-registration after cancelling works again (waitlisted: c took the seat)', rb === null && (await regOf(OPEN, 'b')).status === 'waitlisted', rb)
  await tick()
  ok('reopened: a full event waitlists again', (await register('d', OPEN)) === null && (await regOf(OPEN, 'd')).status === 'waitlisted')

  // Created closed: the server stamps it.
  await sup(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U.owner, role: 'authenticated' })])
  const C = (await sup(
    `INSERT INTO events (name, visibility, organization_id, created_by, start_date, timezone, registration_closed_at, registration_closed_by)
     VALUES ('Born closed','published',$1,$2,'2030-01-15','UTC','1999-01-01',$3) RETURNING id`, [org, U.owner, U.a])).rows[0].id
  await sup(`SELECT set_config('request.jwt.claims', '', false)`)
  const c = await row(C)
  ok('an event created closed is stamped by the server', new Date(c.registration_closed_at).getUTCFullYear() !== 1999 && c.registration_closed_by === U.owner)
  const C2 = await ev({ name: 'Forged closer' })
  await sup(`UPDATE events SET registration_closed_by=$2 WHERE id=$1`, [C2, U.a])
  ok('a closer cannot be set on an open event', (await row(C2)).registration_closed_by === null)
}

// ============================================================================
// Deadline
// ============================================================================
{
  const D = await ev({ name: 'Deadline' })
  await as(U.owner, `UPDATE events SET registration_deadline = now() + interval '1 hour' WHERE id=$1`, [D])
  ok('before the deadline: registration works', (await register('a', D)) === null)
  await as(U.owner, `UPDATE events SET registration_deadline = now() - interval '1 second' WHERE id=$1`, [D])
  ok('after the deadline: registration refused', DEADLINE.test((await register('b', D)) ?? ''))
  ok('a deadline set in the past is accepted (it closes registration)', (await row(D)).registration_deadline !== null)

  const dl = '2030-01-10T12:00:00Z'
  await sup(`UPDATE events SET registration_deadline=$2 WHERE id=$1`, [D, dl])
  ok('boundary: one microsecond before the deadline is open', (await stateAt(D, '2030-01-10T11:59:59.999999Z')) === 'open')
  ok('boundary: at the deadline it is closed', (await stateAt(D, dl)) === 'deadline_passed')
  ok('boundary: after the deadline it is closed', (await stateAt(D, '2030-01-10T12:00:00.000001Z')) === 'deadline_passed')

  // A deadline later than the event end is permitted, and the end wins.
  const L = await ev({ name: 'Late deadline', start: '2030-01-15', tz: 'UTC' })
  ok('a deadline after the event end is accepted',
    (await err(U.owner, `UPDATE events SET registration_deadline='2030-02-01T00:00Z' WHERE id=$1`, [L])) === null)
  ok('…and the event end still closes registration', (await stateAt(L, '2030-01-16T00:00:00Z')) === 'ended'
    && (await stateAt(L, '2030-01-15T23:59:59Z')) === 'open')
  const cl = (await as(U.owner, `SELECT closes_at FROM get_event_registration_states($1)`, [[L]])).rows[0].closes_at
  ok('closes_at is the earlier of deadline and end', iso(cl) === '2030-01-16T00:00:00.000Z', iso(cl))
  const D2 = await ev({ name: 'Clear deadline' })
  await sup(`UPDATE events SET registration_deadline = now() - interval '1 minute' WHERE id=$1`, [D2])
  await as(U.owner, `UPDATE events SET registration_deadline = NULL WHERE id=$1`, [D2])
  ok('removing the deadline reopens registration', (await register('c', D2)) === null)
}

// ============================================================================
// Precedence: the earliest closure wins
// ============================================================================
{
  const P = await ev({ name: 'Precedence', start: '2030-01-15', tz: 'UTC' })
  await sup(`UPDATE events SET registration_deadline='2030-01-10T00:00Z' WHERE id=$1`, [P])
  ok('deadline before end: after both, the deadline is reported', (await stateAt(P, '2030-01-20T00:00Z')) === 'deadline_passed')
  await sup(`SET session_replication_role = replica`)
  await sup(`UPDATE events SET registration_closed_at='2030-01-12T00:00Z' WHERE id=$1`, [P])
  ok('a manual close after the deadline does not replace it', (await stateAt(P, '2030-01-13T00:00Z')) === 'deadline_passed')
  await sup(`UPDATE events SET registration_closed_at='2030-01-05T00:00Z' WHERE id=$1`, [P])
  ok('a manual close before the deadline is reported', (await stateAt(P, '2030-01-13T00:00Z')) === 'closed')
  await sup(`UPDATE events SET registration_closed_at=NULL, registration_deadline='2030-03-01T00:00Z' WHERE id=$1`, [P])
  await sup(`SET session_replication_role = origin`)
  ok('end before deadline: the end is reported', (await stateAt(P, '2030-03-02T00:00Z')) === 'ended')
  await sup(`UPDATE events SET status='past' WHERE id=$1`, [P])
  ok('marked finished: ended, whatever the dates', (await stateAt(P, '2029-01-01T00:00Z')) === 'ended')
}

// ============================================================================
// Event end (dates, times, timezones)
// ============================================================================
{
  // Registration stays open after the start, until the end.
  const today = (await sup(`SELECT (now() AT TIME ZONE 'UTC')::date d`)).rows[0].d
  const fmt = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const S = await ev({ name: 'Started', start: fmt(today, -1), end: fmt(today, 2), st: '09:00', tz: 'UTC' })
  await sup(`UPDATE events SET status='live' WHERE id=$1`, [S])
  ok('an event that has started but not ended accepts registrations', (await register('a', S)) === null)

  // Ended by date while status still says upcoming.
  const PASTDATE = await ev({ name: 'Ended by date', start: '2026-01-10', tz: 'Africa/Accra' })
  ok('status stays upcoming…', (await row(PASTDATE)).status === 'upcoming')
  ok('…but registration is refused once the dates have passed', FINISHED.test((await register('a', PASTDATE)) ?? ''))
  ok('the BEFORE INSERT backstop refuses it too',
    FINISHED.test(await sup(`INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1,$2,'registered')`, [PASTDATE, U.b]).then(() => '', (e) => e.message)))

  // One day, no end time: open to the end of that day in the event's zone.
  const A1 = await ev({ name: 'Accra day', start: '2030-03-20', tz: 'Africa/Accra' })
  ok('one day, no end time: ends at midnight after it (Accra = UTC)', iso(await endsAt(A1)) === '2030-03-21T00:00:00.000Z', iso(await endsAt(A1)))
  ok('boundary: 23:59:59.999999 on the day is open', (await stateAt(A1, '2030-03-20T23:59:59.999999Z')) === 'open')
  ok('boundary: midnight is ended', (await stateAt(A1, '2030-03-21T00:00:00Z')) === 'ended')

  // End time in a zone behind UTC.
  const LA = await ev({ name: 'LA evening', start: '2030-01-15', st: '13:00', et: '17:00', tz: 'America/Los_Angeles' })
  ok('end time in America/Los_Angeles: 17:00 PST = 01:00Z next day', iso(await endsAt(LA)) === '2030-01-16T01:00:00.000Z', iso(await endsAt(LA)))
  ok('LA: open at 00:59Z', (await stateAt(LA, '2030-01-16T00:59:59Z')) === 'open')
  ok('LA: ended at 01:00Z', (await stateAt(LA, '2030-01-16T01:00:00Z')) === 'ended')
  ok('LA: still open after the start time', (await stateAt(LA, '2030-01-15T22:00:00Z')) === 'open')

  // Multi-day.
  const M = await ev({ name: 'Multi-day', start: '2030-01-15', end: '2030-01-17', st: '09:00', et: '18:00', tz: 'Asia/Tokyo' })
  ok('multi-day: ends at end_time on end_date (18:00 JST = 09:00Z)', iso(await endsAt(M)) === '2030-01-17T09:00:00.000Z', iso(await endsAt(M)))
  ok('multi-day: open on day 2 after that day\'s end time', (await stateAt(M, '2030-01-16T12:00:00Z')) === 'open')
  ok('multi-day: ended after the last day\'s end time', (await stateAt(M, '2030-01-17T09:00:00Z')) === 'ended')
  const M2 = await ev({ name: 'Multi-day, no end time', start: '2030-01-15', end: '2030-01-17', tz: 'Asia/Tokyo' })
  ok('multi-day, no end time: ends at midnight after the last day (JST)', iso(await endsAt(M2)) === '2030-01-17T15:00:00.000Z', iso(await endsAt(M2)))

  // Overnight one-day event.
  const N = await ev({ name: 'Overnight', start: '2030-01-15', st: '22:00', et: '02:00', tz: 'UTC' })
  ok('overnight (end_time before start_time, no end_date): ends next day', iso(await endsAt(N)) === '2030-01-16T02:00:00.000Z', iso(await endsAt(N)))
  // End time without a start time: same day.
  const ET = await ev({ name: 'End time only', start: '2030-01-15', et: '02:00', tz: 'UTC' })
  ok('end time with no start time: that day', iso(await endsAt(ET)) === '2030-01-15T02:00:00.000Z', iso(await endsAt(ET)))

  // Legacy row with end_date before start_date: the later date counts.
  const BACK = await legacy({ name: 'Backwards dates', start: '2030-01-15', end: '2030-01-10', tz: 'UTC' })
  ok('end_date before start_date: the later date is used', iso(await endsAt(BACK)) === '2030-01-16T00:00:00.000Z', iso(await endsAt(BACK)))

  // No start date (draft): no date-based end.
  const ND = await ev({ name: 'No dates', vis: 'draft', start: null, tz: null })
  ok('no start date: no date-based end', (await endsAt(ND)) === null)
  ok('a draft is unavailable, never open', (await stateAt(ND, new Date().toISOString())) === 'unavailable')
}

// ============================================================================
// Timezones
// ============================================================================
{
  const ins = (vis, tz) => sup(
    `INSERT INTO events (name, visibility, organization_id, created_by, start_date, timezone) VALUES ('T',$1,$2,$3,'2030-01-15',$4) RETURNING id`,
    [vis, org, U.owner, tz]).then((r) => [null, r.rows[0].id], (e) => [e.message, null])
  ok('creating a published event without a timezone is refused', NO_TZ.test((await ins('published', null))[0] ?? ''))
  ok('…also as unlisted', NO_TZ.test((await ins('unlisted', null))[0] ?? ''))
  ok('…and with a blank timezone', NO_TZ.test((await ins('published', '   '))[0] ?? ''))
  ok('creating a published event with an unknown timezone is refused', BAD_TZ.test((await ins('published', 'Mars/Olympus_Mons'))[0] ?? ''))
  ok('a POSIX offset string is refused', BAD_TZ.test((await ins('published', 'UTC-5'))[0] ?? ''))
  ok('an abbreviation is refused', BAD_TZ.test((await ins('published', 'PST'))[0] ?? ''))
  ok('names are matched exactly (case-sensitive)', BAD_TZ.test((await ins('published', 'africa/accra'))[0] ?? ''))
  ok('an invalid timezone is refused on a draft too', BAD_TZ.test((await ins('draft', 'Nowhere/Land'))[0] ?? ''))
  const [e0, okId] = await ins('published', 'Africa/Accra')
  ok('a published event with a valid IANA timezone is created', e0 === null && okId)
  const [e1, draft] = await ins('draft', null)
  ok('a draft may have no timezone', e1 === null)
  const [, blankDraft] = await ins('draft', '  ')
  ok('a blank timezone is stored as NULL', (await row(blankDraft)).timezone === null)

  ok('publishing a draft without a timezone is refused',
    NO_TZ.test((await err(U.owner, `UPDATE events SET visibility='published' WHERE id=$1`, [draft])) ?? ''))
  ok('setting an invalid timezone is refused', BAD_TZ.test((await err(U.owner, `UPDATE events SET timezone='UTC+3' WHERE id=$1`, [draft])) ?? ''))
  ok('setting a valid timezone and publishing works',
    (await err(U.owner, `UPDATE events SET timezone='Europe/London', visibility='published' WHERE id=$1`, [draft])) === null)
  ok('a published event cannot lose its timezone',
    /A published event needs a timezone/.test((await err(U.owner, `UPDATE events SET timezone=NULL WHERE id=$1`, [draft])) ?? ''))
  ok('…nor have it blanked', /A published event needs a timezone/.test((await err(U.owner, `UPDATE events SET timezone='' WHERE id=$1`, [draft])) ?? ''))
  ok('a published event can change to another valid timezone', (await err(U.owner, `UPDATE events SET timezone='Asia/Dubai' WHERE id=$1`, [draft])) === null)

  // A valid name missing from the lookup table (newer tzdata) is accepted and remembered.
  await sup(`DELETE FROM iana_time_zones WHERE name='Africa/Abidjan'`)
  ok('a recognised zone missing from the table is accepted', (await err(U.owner, `UPDATE events SET timezone='Africa/Abidjan' WHERE id=$1`, [draft])) === null)
  ok('…and added to the table', (await sup(`SELECT count(*)::int n FROM iana_time_zones WHERE name='Africa/Abidjan'`)).rows[0].n === 1)

  // Legacy published events without a timezone keep working.
  const LG = await legacy({ name: 'Legacy no tz', start: '2030-01-15' })
  ok('legacy: an edit that leaves the timezone alone saves', (await err(U.owner, `UPDATE events SET name='Legacy renamed', capacity=50 WHERE id=$1`, [LG])) === null)
  ok('legacy: the full form payload (timezone still null) saves',
    (await err(U.owner, `UPDATE events SET name='Legacy again', timezone=NULL, visibility='published' WHERE id=$1`, [LG])) === null)
  ok('legacy: published -> unlisted is allowed', (await err(U.owner, `UPDATE events SET visibility='unlisted' WHERE id=$1`, [LG])) === null)
  ok('legacy: closing registration works', (await err(U.owner, `UPDATE events SET registration_closed_at=now() WHERE id=$1`, [LG])) === null
    && CLOSED.test((await register('a', LG)) ?? ''))
  await reopen('owner', LG)
  ok('legacy: registration works when open', (await register('a', LG)) === null)
  ok('legacy: the stored timezone is not rewritten', (await row(LG)).timezone === null)

  // The fallback: Etc/GMT+12 (UTC-12), the latest wall clock on Earth.
  ok('legacy fallback: ends at the day\'s end in UTC-12 (12:00Z next day)', iso(await endsAt(LG)) === '2030-01-16T12:00:00.000Z', iso(await endsAt(LG)))
  ok('legacy fallback: still open where UTC or UTC+14 would have closed it', (await stateAt(LG, '2030-01-16T11:59:59Z')) === 'open')
  ok('legacy fallback: closed at the AoE end', (await stateAt(LG, '2030-01-16T12:00:00Z')) === 'ended')
  // Never earlier than the true end in any real zone.
  const ends = (await sup(
    `SELECT bool_and(('2030-01-16'::date)::timestamp AT TIME ZONE z.name <= $1::timestamptz) ok
       FROM iana_time_zones z`, [iso(await endsAt(LG))])).rows[0].ok
  ok('legacy fallback is never earlier than the end in any recognised zone', ends === true)
  const flag = (await as(U.a, `SELECT timezone_fallback f FROM get_event_registration_states($1)`, [[LG]])).rows[0]
  ok('states RPC flags the fallback', flag?.f === true, JSON.stringify(flag))
  const flag2 = (await as(U.a, `SELECT timezone_fallback f FROM get_event_registration_states($1)`, [[OPEN]])).rows[0]
  ok('states RPC: no fallback flag for a valid timezone', flag2?.f === false)

  // A legacy POSIX string is not trusted (it would read UTC-5 as UTC+5).
  const LP = await legacy({ name: 'Legacy POSIX', start: '2030-01-15', et: '17:00', tz: 'UTC-5' })
  ok('legacy invalid timezone: fallback used, not the POSIX reading', iso(await endsAt(LP)) === '2030-01-16T05:00:00.000Z', iso(await endsAt(LP)))
  ok('legacy invalid timezone: unrelated edits still save', (await err(U.owner, `UPDATE events SET description='x' WHERE id=$1`, [LP])) === null)
  ok('legacy invalid timezone: not rewritten', (await row(LP)).timezone === 'UTC-5')
  ok('legacy invalid timezone: changing it to another invalid value is refused',
    BAD_TZ.test((await err(U.owner, `UPDATE events SET timezone='UTC-6' WHERE id=$1`, [LP])) ?? ''))
  ok('legacy invalid timezone: fixing it works', (await err(U.owner, `UPDATE events SET timezone='America/New_York' WHERE id=$1`, [LP])) === null
    && iso(await endsAt(LP)) === '2030-01-15T22:00:00.000Z')
}

// ============================================================================
// Waitlist promotion, organizer management and check-in while closed
// ============================================================================
{
  const W = await ev({ name: 'Waitlist', cap: 1 })
  await register('e', W); await tick()
  await register('f', W); await tick()
  await register('g', W); await tick()
  await close('owner', W)
  ok('setup: e registered, f and g waitlisted, registration closed',
    (await regOf(W, 'e')).status === 'registered' && (await regOf(W, 'f')).status === 'waitlisted' && (await regOf(W, 'g')).status === 'waitlisted')

  const r = (await as(U.owner, `SELECT * FROM organizer_cancel_event_registration($1,$2)`, [W, U.e])).rows[0]
  ok('closed: organizer cancel works and promotes the first waitlisted person', r.promoted === 1 && (await regOf(W, 'f')).status === 'registered')
  ok('closed: raising capacity promotes the next', (await err(U.owner, `UPDATE events SET capacity=2 WHERE id=$1`, [W])) === null && (await regOf(W, 'g')).status === 'registered')
  ok('closed: the capacity floor still refuses cutting below confirmed',
    /Capacity cannot be lower than the 2 people already confirmed/.test((await err(U.owner, `UPDATE events SET capacity=1 WHERE id=$1`, [W])) ?? ''))

  const W2 = await ev({ name: 'Manual promote', cap: 1 })
  await register('e', W2); await tick()
  await register('f', W2); await tick()
  await close('mgr', W2).catch(() => null) // mgr is not assigned to W2: no effect
  ok('unassigned manager could not close W2', (await row(W2)).registration_closed_at === null)
  await close('owner', W2)
  // Free a seat without automatic promotion reaching it (as after a restore).
  await sup(`SET session_replication_role = replica`)
  await sup(`UPDATE event_registrations SET status='cancelled', cancelled_at=now() WHERE event_id=$1 AND user_id=$2`, [W2, U.e])
  await sup(`SET session_replication_role = origin`)
  ok('closed: organizer manual promotion still works',
    (await err(U.owner, `SELECT organizer_promote_waitlisted_registration($1,$2)`, [W2, U.f])) === null && (await regOf(W2, 'f')).status === 'registered')
  ok('closed: check-in still works', (await err(U.owner, `SELECT check_in_event_attendee($1,$2)`, [W2, U.f])) === null)
  const ci = (await sup(`SELECT checked_in_at FROM event_registrations WHERE event_id=$1 AND user_id=$2`, [W2, U.f])).rows[0]
  ok('closed: check-in recorded', ci.checked_in_at !== null)
  ok('closed: cancelling after check-in is still refused (unchanged)',
    /already checked in/.test((await err(U.f, `SELECT cancel_event_registration($1)`, [W2])) ?? ''))

  // Lifecycle rule for promotion is unchanged: status 'past' stops it.
  const W3 = await ev({ name: 'Past promote', cap: 1 })
  await register('e', W3); await tick()
  await register('f', W3); await tick()
  await sup(`UPDATE events SET status='past' WHERE id=$1`, [W3])
  ok('finished: cancelling is refused as before', FINISHED.test((await err(U.e, `SELECT cancel_event_registration($1)`, [W3])) ?? ''))
}

// ============================================================================
// Archived events
// ============================================================================
{
  const A = await ev({ name: 'To archive' })
  await sup(`UPDATE events SET registration_deadline='2030-01-01T00:00Z' WHERE id=$1`, [A])
  await close('owner', A)
  const before = await row(A)
  ok('owner archives the event', (await err(U.owner, `UPDATE events SET archived_at=now() WHERE id=$1`, [A])) === null)
  for (const [label, sql] of [
    ['reopen', `UPDATE events SET registration_closed_at=NULL WHERE id=$1`],
    ['change the deadline', `UPDATE events SET registration_deadline='2030-01-05T00:00Z' WHERE id=$1`],
    ['remove the deadline', `UPDATE events SET registration_deadline=NULL WHERE id=$1`],
    ['change the closer', `UPDATE events SET registration_closed_by=$2 WHERE id=$1`],
  ]) {
    const e = await err(U.owner, sql, label === 'change the closer' ? [A, U.admin] : [A])
    ok(`archived: cannot ${label}`, /archived\. Restore it before making changes/.test(e ?? ''), e)
  }
  ok('archived: restoring together with a registration change is refused',
    /Restore this event before making other changes/.test((await err(U.owner, `UPDATE events SET archived_at=NULL, registration_closed_at=NULL WHERE id=$1`, [A])) ?? ''))
  ok('archived: restoring with a deadline change is refused',
    /Restore this event before making other changes/.test((await err(U.owner, `UPDATE events SET archived_at=NULL, registration_deadline=NULL WHERE id=$1`, [A])) ?? ''))
  ok('archived: registration refused (unchanged message)', /no longer available/.test((await register('h', A)) ?? ''))
  ok('archived: state is unavailable', (await stateAt(A, new Date().toISOString())) === 'unavailable')
  ok('restore alone works', (await err(U.owner, `UPDATE events SET archived_at=NULL WHERE id=$1`, [A])) === null)
  const after = await row(A)
  ok('restore keeps the registration settings', iso(after.registration_closed_at) === iso(before.registration_closed_at)
    && after.registration_closed_by === before.registration_closed_by && iso(after.registration_deadline) === iso(before.registration_deadline))
}

// ============================================================================
// Who may change the settings
// ============================================================================
{
  const Z = await ev({ name: 'Auth' })
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [Z, U.mgr])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
  const tryClose = async (k) => {
    const r = await as(U[k], `UPDATE events SET registration_closed_at=now(), registration_deadline='2030-01-01T00:00Z' WHERE id=$1 RETURNING id`, [Z]).catch(() => ({ rows: [] }))
    const e = await row(Z)
    const changed = e.registration_closed_at !== null
    if (changed) await sup(`UPDATE events SET registration_closed_at=NULL, registration_deadline=NULL WHERE id=$1`, [Z])
    return { n: r.rows.length, changed, by: e.registration_closed_by }
  }
  for (const k of ['owner', 'admin', 'mgr']) {
    const r = await tryClose(k)
    ok(`${k} may close registration and set a deadline`, r.n === 1 && r.changed && r.by === U[k], JSON.stringify(r))
  }
  const deadlineOf = async () => (await row(Z)).registration_deadline
  for (const k of ['idle', 'owner2', 'a']) {
    const r = await tryClose(k)
    ok(`${k} cannot close registration`, r.n === 0 && !r.changed && (await deadlineOf()) === null, JSON.stringify(r))
  }
  const e2 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [Z, U.susp])
  if (e2) { console.log('SEED FAILED', e2); process.exit(1) }
  await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.susp])
  const rs = await tryClose('susp')
  ok('a suspended assigned manager cannot close registration', rs.n === 0 && !rs.changed, JSON.stringify(rs))
  const anon = await err(null, `UPDATE events SET registration_closed_at=now() WHERE id=$1`, [Z], 'anon')
  ok('anon cannot close registration', (anon !== null || (await row(Z)).registration_closed_at === null) && (await row(Z)).registration_closed_at === null)

  // The states RPC: visibility gate.
  const DR = await ev({ name: 'Private draft', vis: 'draft' })
  const seen = async (k, ids) => (await as(U[k], `SELECT event_id, registration_state FROM get_event_registration_states($1)`, [ids])).rows
  const rA = await seen('a', [Z, DR])
  ok('states RPC: an attendee sees published events, not other people\'s drafts', rA.length === 1 && rA[0].event_id === Z && rA[0].registration_state === 'open')
  const rO = await seen('owner', [DR])
  ok('states RPC: the organizer sees their draft as unavailable', rO.length === 1 && rO[0].registration_state === 'unavailable')
  ok('states RPC: another organization does not see the draft', (await seen('owner2', [DR])).length === 0)
  ok('states RPC: anon has no EXECUTE', /permission denied/.test((await err(null, `SELECT * FROM get_event_registration_states($1)`, [[Z]], 'anon')) ?? ''))
  const many = Array.from({ length: 201 }, () => Z)
  ok('states RPC: more than 200 ids refused', /at most 200/.test((await err(U.a, `SELECT * FROM get_event_registration_states($1)`, [many])) ?? ''))
  ok('states RPC: null and empty arrays return nothing', (await seen('a', [])).length === 0
    && (await as(U.a, `SELECT * FROM get_event_registration_states(NULL)`)).rows.length === 0)
}

// ============================================================================
// Unchanged rules still hold
// ============================================================================
{
  const D = await ev({ name: 'Draft rules', vis: 'draft' })
  ok('publishing still needs a name first', /needs a name/.test((await err(U.owner, `UPDATE events SET name='  ', visibility='published' WHERE id=$1`, [D])) ?? ''))
  ok('publishing still needs a start date first', /needs a start date/.test((await err(U.owner, `UPDATE events SET start_date=NULL, visibility='published' WHERE id=$1`, [D])) ?? ''))
  const R = await ev({ name: 'Has registrations' })
  await register('h', R)
  ok('return to draft is still refused with registrations', /cannot be returned to draft/.test((await err(U.owner, `UPDATE events SET visibility='draft' WHERE id=$1`, [R])) ?? ''))
  ok('insert still forces status upcoming', (await row(await ev({ name: 'Fresh' }))).status === 'upcoming')
  ok('moving an event to another organization still refused',
    /cannot be moved/.test((await err(U.owner, `UPDATE events SET organization_id=$2 WHERE id=$1`, [R, org2])) ?? ''))
  ok('draft events refuse registration (unchanged message)', /not open for registration/.test((await register('h', D)) ?? ''))
}

// ============================================================================
// Grants and function security
// ============================================================================
{
  const fns = (await sup(
    `SELECT p.proname, p.prosecdef, p.proconfig::text cfg,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') a,
            has_function_privilege('anon', p.oid, 'EXECUTE') n
       FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
      WHERE s.nspname='public' AND p.proname IN (
        'accept_event_timezone','event_effective_timezone','event_ends_at','event_registration_state',
        'get_event_registration_states','register_for_event','enforce_event_write_rules','enforce_registration_rules')`)).rows
  ok('eight functions present', fns.length === 8, JSON.stringify(fns.map((f) => f.proname)))
  ok('all SECURITY DEFINER with search_path = public, pg_temp',
    fns.every((f) => f.prosecdef && (f.cfg ?? '').includes('search_path=public, pg_temp')), JSON.stringify(fns))
  const client = ['get_event_registration_states', 'register_for_event']
  ok('client functions: authenticated only', fns.filter((f) => client.includes(f.proname)).every((f) => f.a && !f.n))
  ok('internal functions and triggers: no client EXECUTE',
    fns.filter((f) => !client.includes(f.proname)).every((f) => !f.a && !f.n), JSON.stringify(fns.filter((f) => f.a || f.n)))
  ok('clients still cannot insert registrations directly',
    /permission denied/.test((await err(U.a, `INSERT INTO event_registrations (event_id, user_id) VALUES ($1,$2)`, [OPEN, U.a])) ?? ''))
  const trg = (await sup(
    `SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.events'::regclass,'public.event_registrations'::regclass)
       AND tgname IN ('check_event_write_rules','check_registration_rules','check_event_archive_authority','promote_waitlist_on_capacity')`)).rows
  ok('event and registration triggers still attached', trg.length === 4, JSON.stringify(trg))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
