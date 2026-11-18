// Organizer registration counts and check-in eligibility (migration 20261030000000).
// Confirmed = registered or checked_in. event_activity_counts and
// organization_event_counts count confirmed registrations only (waitlisted and
// cancelled are not), checked-in from checked_in_at. Only a confirmed registration
// can check in: waitlisted and cancelled are refused by the RPC, and no direct
// write can set a status. Runs on PGlite; see boot.mjs for what that does and
// does not prove. The statuses are registered, waitlisted, cancelled, checked_in;
// there is no "rejected".
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
const user = async (email) => (await sup(`INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),$1) RETURNING id`, [email])).rows[0].id
const status = async (uid, e) => (await sup(`SELECT status FROM event_registrations WHERE user_id=$1 AND event_id=$2`, [uid, e])).rows[0]?.status

// ---- seed -----------------------------------------------------------------
const U = {}
for (const n of ['owner', 'mgr', 'other', 'a', 'b', 'c', 'x']) U[n] = await user(`${n}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id=$1`, [U.owner])
const org = (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Org','organizer','approved',$1) RETURNING id`, [U.owner])).rows[0].id
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`SET session_replication_role = replica`)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'manager')`, [org, U.mgr])
const E = (await sup(
  `INSERT INTO events (name, status, visibility, capacity, organization_id, created_by, start_date, end_date, published_at)
   VALUES ('Cap 2','upcoming','published',2,$1,$2,'2030-01-01','2030-01-02', now()) RETURNING id`, [org, U.owner])).rows[0].id
await sup(`SET session_replication_role = origin`)
{
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [E, U.mgr])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}

// a and b take the two seats; x and c join the waitlist; x then cancels (no seat
// frees, so nobody is promoted). Final: a, b registered; c waitlisted; x cancelled.
const reg = (uid) => as(uid, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [E])
for (const n of ['a', 'b', 'x', 'c']) await reg(U[n])
await as(U.x, `SELECT cancel_event_registration($1)`, [E])
ok('seed: a registered', (await status(U.a, E)) === 'registered')
ok('seed: b registered', (await status(U.b, E)) === 'registered')
ok('seed: c waitlisted', (await status(U.c, E)) === 'waitlisted')
ok('seed: x cancelled', (await status(U.x, E)) === 'cancelled')

const CHECK_IN = `SELECT * FROM check_in_event_attendee($1,$2)`
const UNDO = `SELECT * FROM undo_event_check_in($1,$2)`
const activity = async (uid) => (await as(uid, `SELECT * FROM event_activity_counts($1)`, [E])).rows[0]
const orgCounts = async (uid) => (await as(uid, `SELECT * FROM organization_event_counts($1)`, [org])).rows.find((r) => r.event_id === E)

// ---- check-in eligibility -------------------------------------------------
ok('waitlisted registration cannot check in', /waitlist/.test((await err(U.owner, CHECK_IN, [E, U.c])) ?? ''))
ok('cancelled registration cannot check in', /cancelled/.test((await err(U.owner, CHECK_IN, [E, U.x])) ?? ''))
ok('no registration cannot check in', /not registered/.test((await err(U.owner, CHECK_IN, [E, U.other])) ?? ''))
ok('refusals left waitlisted / cancelled unchanged',
  (await status(U.c, E)) === 'waitlisted' && (await status(U.x, E)) === 'cancelled')

ok('owner checks in a confirmed registration', (await err(U.owner, CHECK_IN, [E, U.a])) === null && (await status(U.a, E)) === 'checked_in')
ok('assigned manager checks in a confirmed registration', (await err(U.mgr, CHECK_IN, [E, U.b])) === null)
ok('assigned manager undoes a check-in', (await err(U.mgr, UNDO, [E, U.b])) === null)
ok('an undone check-in can check in again', (await err(U.owner, CHECK_IN, [E, U.b])) === null)
ok('undo again so b is confirmed but not arrived', (await err(U.owner, UNDO, [E, U.b])) === null)
ok('unrelated user cannot check anyone in', /do not manage/.test((await err(U.other, CHECK_IN, [E, U.b])) ?? ''))

// ---- no direct path around the RPC ------------------------------------------
const direct = await err(U.owner, `UPDATE event_registrations SET status='checked_in', checked_in_at=now() WHERE event_id=$1 AND user_id=$2 RETURNING id`, [E, U.c])
ok('direct UPDATE cannot check in a waitlisted registration', (await status(U.c, E)) === 'waitlisted', String(direct))
const forged = await err(U.other, `INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1,$2,'checked_in')`, [E, U.other])
ok('self-registration cannot forge a status', forged !== null && (await status(U.other, E)) === undefined, String(forged))

// ---- counts ---------------------------------------------------------------
// Confirmed: a (checked in) + b (undone, status still checked_in) = 2.
// c (waitlisted) and x (cancelled) are not registrations.
const act = await activity(U.owner)
ok('event_activity_counts: registrations = confirmed only (2)', Number(act.registrations) === 2, JSON.stringify(act))
ok('event_activity_counts: checked_in = arrived (1)', Number(act.checked_in) === 1, JSON.stringify(act))
ok('event_activity_counts: cancelled unchanged (1)', Number(act.cancelled) === 1, JSON.stringify(act))
const oc = await orgCounts(U.owner)
ok('organization_event_counts: registrations = confirmed only (2)', Number(oc?.registrations) === 2, JSON.stringify(oc))
ok('organization_event_counts: checked_in = arrived (1)', Number(oc?.checked_in) === 1, JSON.stringify(oc))
ok('counts agree with the public count and capacity', Number((await as(U.owner, `SELECT * FROM get_event_registration_counts(ARRAY[$1]::uuid[])`, [E])).rows[0].registration_count) === 2)
ok('assigned manager gets the same counts', Number((await activity(U.mgr)).registrations) === 2 && Number((await orgCounts(U.mgr))?.registrations) === 2)
ok('unrelated user is refused event_activity_counts', /do not manage/.test((await err(U.other, `SELECT * FROM event_activity_counts($1)`, [E])) ?? ''))

// ---- unchanged security model ---------------------------------------------
const fn = async (name) => (await sup(
  `SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid) AS result,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
     FROM pg_proc p WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`, [name])).rows
for (const name of ['event_activity_counts', 'organization_event_counts']) {
  const rows = await fn(name)
  ok(`${name}: one signature, SECURITY DEFINER, search_path pinned`,
    rows.length === 1 && rows[0].prosecdef && String(rows[0].proconfig).includes('search_path=public, pg_temp'), JSON.stringify(rows))
  ok(`${name}: authenticated only`, rows[0]?.auth === true && rows[0]?.anon === false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
