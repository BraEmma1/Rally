// The capacity floor counts confirmed registrations only (migration
// 20261103000000): raising capacity past the confirmed count is accepted even
// while a waitlist exists, the raise promotes the oldest waitlisted people in
// order, cutting below the confirmed count is still refused, and every other
// rule in enforce_event_write_rules is unchanged. Runs on PGlite; see boot.mjs
// for what that does and does not prove.
//   node tests/sql/event-capacity-floor.test.mjs
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

// ---- seed -----------------------------------------------------------------
const U = {}
for (const k of ['owner', 'mgr', 'idle', 'attendee']) U[k] = await user(`${k}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id=$1`, [U.owner])
const org = (await sup(
  `INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Acme','organizer','approved',$1) RETURNING id`,
  [U.owner])).rows[0].id
const org2 = (await sup(
  `INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Other','organizer','approved',$1) RETURNING id`,
  [U.owner])).rows[0].id
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`SET session_replication_role = replica`)
for (const k of ['mgr', 'idle']) {
  await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'manager')`, [org, U[k]])
}
await sup(`SET session_replication_role = origin`)

const mkEvent = async (name, capacity, visibility = 'published') => (await sup(
  `INSERT INTO events (name, visibility, organization_id, created_by, start_date, end_date, capacity, timezone)
   VALUES ($1,$2,$3,$4,'2030-01-01','2030-01-02',$5,'Africa/Accra') RETURNING id`, [name, visibility, org, U.owner, capacity])).rows[0].id

// People who register. Each gets an explicit created_at, because created_at is
// what the waitlist is ordered by.
const people = (await sup(
  `INSERT INTO auth.users (id, email) SELECT gen_random_uuid(), 'p' || g || '@t.test' FROM generate_series(1, 200) g RETURNING id`
)).rows.map((r) => r.id)
let next = 0
const take = (n) => people.slice(next, (next += n))
// Rows are written as the superuser to set up state quickly; enforce_registration_rules
// still runs on them (a 'registered' insert must fit the capacity).
async function seat(eventId, ids, status, startMinute) {
  for (let i = 0; i < ids.length; i++) {
    await sup(
      `INSERT INTO event_registrations (event_id, user_id, status, created_at, checked_in_at)
       VALUES ($1,$2,$3, timestamptz '2029-06-01 00:00' + make_interval(mins => $4), CASE WHEN $3 = 'checked_in' THEN now() END)`,
      [eventId, ids[i], status, startMinute + i])
  }
}
const statusCount = async (eventId, status) => Number((await sup(
  `SELECT count(*) AS n FROM event_registrations WHERE event_id=$1 AND status = ANY($2)`, [eventId, status])).rows[0].n)
const confirmed = (e) => statusCount(e, ['registered', 'checked_in'])
const waitlisted = (e) => statusCount(e, ['waitlisted'])
const setCapacity = (uid, e, cap) =>
  err(uid, `UPDATE events SET capacity=$2 WHERE id=$1`, [e, cap])
const capacityOf = async (e) => (await sup(`SELECT capacity FROM events WHERE id=$1`, [e])).rows[0].capacity

// ---- the reported case: 100 confirmed, 20 waitlisted, raise to 110 --------
const BIG = await mkEvent('Big event', 100)
{
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [BIG, U.mgr])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}
const bigConfirmed = take(100)
// Cancelled rows first: enforce_registration_rules judges any non-waitlisted
// insert against the capacity, so they cannot be added once the event is full.
await seat(BIG, take(3), 'cancelled', 100)
await seat(BIG, bigConfirmed.slice(0, 95), 'registered', 0)
await seat(BIG, bigConfirmed.slice(95), 'checked_in', 95)
// The waitlist joins in an order that differs from insertion order, so the
// test proves promotion follows created_at and not the row's physical order.
const wait = take(20)
const joinOrder = [...wait].reverse() // wait[19] joined first, wait[0] last
for (let i = 0; i < joinOrder.length; i++) await seat(BIG, [joinOrder[i]], 'waitlisted', 200 + i)

ok('seed: 100 confirmed (incl. 5 checked in), 20 waitlisted, 3 cancelled',
  (await confirmed(BIG)) === 100 && (await waitlisted(BIG)) === 20 && (await statusCount(BIG, ['cancelled'])) === 3)

// The form reads its numbers from event_attendee_page's 'confirmed' and
// 'waitlisted' totals; they must be the numbers the floor uses.
const pageTotal = async (uid, e, filter) =>
  Number((await as(uid, `SELECT total_count FROM event_attendee_page($1,'',$2,1,0)`, [e, filter])).rows[0].total_count)
ok('form counts match the floor: confirmed 100, waitlisted 20',
  (await pageTotal(U.owner, BIG, 'confirmed')) === 100 && (await pageTotal(U.owner, BIG, 'waitlisted')) === 20)

{
  const e1 = await setCapacity(U.owner, BIG, 110)
  ok('owner raises capacity 100 -> 110 with 20 waitlisted', e1 === null, e1)
}
ok('capacity is now 110', (await capacityOf(BIG)) === 110)
ok('exactly 10 promoted: 110 confirmed, 10 still waitlisted',
  (await confirmed(BIG)) === 110 && (await waitlisted(BIG)) === 10)
{
  const promoted = (await sup(
    `SELECT user_id FROM event_registrations WHERE event_id=$1 AND status='registered' AND user_id = ANY($2)`,
    [BIG, wait])).rows.map((r) => r.user_id).sort()
  const expected = joinOrder.slice(0, 10).sort()
  ok('the ten promoted are the ten who joined the waitlist first',
    JSON.stringify(promoted) === JSON.stringify(expected))
  const notified = (await sup(
    `SELECT user_id FROM notifications WHERE type='registration_promoted' AND user_id = ANY($1)`, [wait])).rows
    .map((r) => r.user_id).sort()
  ok('each promoted person is notified once, nobody else', JSON.stringify(notified) === JSON.stringify(expected))
}
ok('cancelled and checked-in rows untouched',
  (await statusCount(BIG, ['cancelled'])) === 3 && (await statusCount(BIG, ['checked_in'])) === 5)
ok('form counts follow: confirmed 110, waitlisted 10',
  (await pageTotal(U.owner, BIG, 'confirmed')) === 110 && (await pageTotal(U.owner, BIG, 'waitlisted')) === 10)
{
  const pos = (await as(U.owner, `SELECT attendees FROM event_attendee_page($1,'','waitlisted',100,0)`, [BIG])).rows[0].attendees
  const order = [...pos].sort((a, b) => a.waitlist_position - b.waitlist_position).map((a) => a.user_id)
  ok('remaining waitlist keeps its order, positions 1..10', JSON.stringify(order) === JSON.stringify(joinOrder.slice(10))
    && pos.map((a) => a.waitlist_position).sort((a, b) => a - b).join() === '1,2,3,4,5,6,7,8,9,10')
}

// An assigned manager may raise it too; the next in line move up.
{
  const e1 = await setCapacity(U.mgr, BIG, 115)
  ok('assigned manager raises 110 -> 115', e1 === null, e1)
  const promoted = (await sup(
    `SELECT user_id FROM event_registrations WHERE event_id=$1 AND status='registered' AND user_id = ANY($2)`,
    [BIG, joinOrder.slice(10)])).rows.map((r) => r.user_id).sort()
  ok('the next five in line are promoted, in order',
    JSON.stringify(promoted) === JSON.stringify(joinOrder.slice(10, 15).sort()) && (await waitlisted(BIG)) === 5)
}

// ---- the floor still holds for confirmed people ---------------------------
{
  const e1 = await setCapacity(U.owner, BIG, 114)
  ok('cutting below the confirmed count (115 -> 114) is refused',
    e1 !== null && /cannot be lower than the 115 people already confirmed/.test(e1), e1)
  ok('refused cut leaves capacity and the waitlist alone', (await capacityOf(BIG)) === 115 && (await waitlisted(BIG)) === 5)
  const e2 = await setCapacity(U.mgr, BIG, 1)
  ok('manager cannot cut below confirmed either', e2 !== null && /already confirmed/.test(e2), e2)
}

const SMALL = await mkEvent('Small event', 10)
await seat(SMALL, take(4), 'registered', 0)
await seat(SMALL, take(2), 'checked_in', 10)
await seat(SMALL, take(3), 'cancelled', 20)
{
  ok('capacity equal to the confirmed count is accepted (10 -> 6)', (await setCapacity(U.owner, SMALL, 6)) === null)
  const e1 = await setCapacity(U.owner, SMALL, 5)
  ok('one below confirmed is refused (checked-in people count)', e1 !== null && /already confirmed/.test(e1), e1)
  ok('cancelled registrations never count toward the floor', (await capacityOf(SMALL)) === 6)
}

// Lowering to exactly the confirmed count with a waitlist: the waitlist does
// not stop it, and nobody is promoted (no seat opened).
{
  await seat(SMALL, take(2), 'waitlisted', 30)
  const e1 = await setCapacity(U.owner, BIG, 115)
  ok('no-op capacity write is accepted', e1 === null, e1)
  ok('with a waitlist, capacity can still sit at the confirmed count',
    (await setCapacity(U.owner, SMALL, 6)) === null && (await confirmed(SMALL)) === 6 && (await waitlisted(SMALL)) === 2)
  ok('removing the limit promotes everyone left (unchanged behaviour)',
    (await setCapacity(U.owner, SMALL, null)) === null && (await confirmed(SMALL)) === 8 && (await waitlisted(SMALL)) === 0)
}

// ---- who may change it (unchanged) ----------------------------------------
{
  const r1 = await as(U.idle, `UPDATE events SET capacity=200 WHERE id=$1 RETURNING id`, [BIG])
  const r2 = await as(U.attendee, `UPDATE events SET capacity=200 WHERE id=$1 RETURNING id`, [BIG])
  const r3 = await err(null, `UPDATE events SET capacity=200 WHERE id=$1`, [BIG], 'anon')
  ok('unassigned manager, attendee and anon cannot change capacity',
    r1.rows.length === 0 && r2.rows.length === 0 && (await capacityOf(BIG)) === 115, r3)
  await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.mgr])
  const r4 = await as(U.mgr, `UPDATE events SET capacity=200 WHERE id=$1 RETURNING id`, [BIG])
  ok('suspended assigned manager cannot change capacity', r4.rows.length === 0 && (await capacityOf(BIG)) === 115)
  await sup(`UPDATE user_accounts SET status='active' WHERE user_id=$1`, [U.mgr])
}

// ---- every other rule in the function is unchanged ------------------------
{
  // INSERT: status forced, archived cleared, publishing needs a start date.
  const ins = (await as(U.owner,
    `INSERT INTO events (name, visibility, organization_id, created_by, status, archived_at, start_date, timezone)
     VALUES ('Fresh','published',$1,$2,'past',now(),'2030-02-01','Africa/Accra') RETURNING status, archived_at, published_at`,
    [org, U.owner])).rows[0]
  ok('insert forces upcoming, unarchived, stamps published_at',
    ins.status === 'upcoming' && ins.archived_at === null && ins.published_at !== null)
  const e1 = await err(U.owner,
    `INSERT INTO events (name, visibility, organization_id, created_by) VALUES ('No date','published',$1,$2)`, [org, U.owner])
  ok('insert published without a start date is refused', /needs a start date/.test(e1 ?? ''), e1)

  const D = await mkEvent('Draft event', 50, 'draft')
  const e2 = await err(U.owner, `UPDATE events SET start_date=NULL, visibility='published' WHERE id=$1`, [D])
  ok('publishing without a start date is refused', /needs a start date/.test(e2 ?? ''), e2)
  const e3 = await err(U.owner, `UPDATE events SET name='  ', visibility='published' WHERE id=$1`, [D])
  ok('publishing without a name is refused', /needs a name/.test(e3 ?? ''), e3)
  ok('publishing a complete draft works', (await err(U.owner, `UPDATE events SET visibility='unlisted' WHERE id=$1`, [D])) === null)

  // Return to draft still counts every non-cancelled registration, waitlist included.
  const W = await mkEvent('Waitlist only', 1)
  await seat(W, take(1), 'cancelled', 0)
  await seat(W, take(1), 'waitlisted', 1)
  const e4 = await err(U.owner, `UPDATE events SET visibility='draft' WHERE id=$1`, [W])
  ok('return to draft refused while anyone is waitlisted (unchanged)', /1 registration\(s\) and cannot be returned to draft/.test(e4 ?? ''), e4)
  const e5 = await err(U.owner, `UPDATE events SET visibility='draft' WHERE id=$1`, [BIG])
  ok('return to draft refused with confirmed registrations, count includes waitlist',
    /120 registration\(s\)/.test(e5 ?? ''), e5)

  const e6 = await err(U.owner, `UPDATE events SET organization_id=$2 WHERE id=$1`, [BIG, org2])
  ok('moving an event to another organization is refused', /cannot be moved/.test(e6 ?? ''), e6)
  const e7 = await err(U.owner, `UPDATE events SET created_by=$2 WHERE id=$1`, [BIG, U.mgr])
  ok('changing the creator is refused', /creator of an event cannot be changed/.test(e7 ?? ''), e7)

  // Archived events are frozen; capacity included.
  ok('owner archives the event', (await err(U.owner, `UPDATE events SET archived_at=now() WHERE id=$1`, [BIG])) === null)
  const e8 = await setCapacity(U.owner, BIG, 200)
  ok('capacity on an archived event is refused', /archived|Restore/.test(e8 ?? ''), e8)
  const e9 = await err(U.owner, `UPDATE events SET archived_at=NULL, capacity=200 WHERE id=$1`, [BIG])
  ok('restore plus another change in one write is refused', /Restore this event before making other changes/.test(e9 ?? ''), e9)
  ok('waitlist untouched while archived', (await waitlisted(BIG)) === 5)
  const e10 = await err(U.mgr, `UPDATE events SET archived_at=NULL WHERE id=$1`, [BIG])
  ok('manager still cannot restore (archive authority unchanged)', e10 !== null, e10)
  ok('owner restores as the only change', (await err(U.owner, `UPDATE events SET archived_at=NULL WHERE id=$1`, [BIG])) === null)
  ok('after restore, raising capacity works again', (await setCapacity(U.owner, BIG, 117)) === null
    && (await confirmed(BIG)) === 117 && (await waitlisted(BIG)) === 3)
}

// ---- registration and check-in still behave ---------------------------------
{
  const FULL = await mkEvent('Full event', 1)
  const [x, y] = take(2)
  const r1 = (await as(x, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [FULL])).rows[0]
  const r2 = (await as(y, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [FULL])).rows[0]
  ok('register_for_event: first registered, second waitlisted',
    r1.registration_status === 'registered' && r2.registration_status === 'waitlisted')
  const e1 = await err(U.owner, `SELECT * FROM check_in_event_attendee($1,$2)`, [FULL, y])
  ok('waitlisted person still cannot be checked in', e1 !== null, e1)
  ok('confirmed person checks in', (await err(U.owner, `SELECT * FROM check_in_event_attendee($1,$2)`, [FULL, x])) === null)
  ok('raising capacity 1 -> 2 promotes the waitlisted person',
    (await setCapacity(U.owner, FULL, 2)) === null && (await confirmed(FULL)) === 2)
  const e2 = await setCapacity(U.owner, FULL, 1)
  ok('cannot cut back below the two now confirmed', /2 people already confirmed/.test(e2 ?? ''), e2)
}

// ---- security model of the function is unchanged ----------------------------
{
  const f = (await sup(
    `SELECT p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
     FROM pg_proc p WHERE p.oid = 'public.enforce_event_write_rules()'::regprocedure`)).rows[0]
  ok('still SECURITY DEFINER with search_path = public, pg_temp',
    f.prosecdef === true && (f.proconfig ?? []).some((c) => /^search_path=public, ?pg_temp$/.test(c)), JSON.stringify(f.proconfig))
  ok('no EXECUTE for authenticated or anon', f.auth_exec === false && f.anon_exec === false)
  const t = (await sup(
    `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.events'::regclass
       AND tgname IN ('check_event_write_rules', 'check_event_archive_authority', 'promote_waitlist_on_capacity')
     ORDER BY tgname`)).rows
  ok('the three event triggers are still attached and enabled',
    t.length === 3 && t.every((r) => r.tgenabled === 'O'), JSON.stringify(t))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
