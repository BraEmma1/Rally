// Organizer attendee list (migration 20261031000000): event_attendee_page searches
// name and company case-insensitively, filters by the shared registration rules,
// pages deterministically after search and filter, returns the total matching
// count, and is reachable only by owners/admins of the event's organization and
// managers assigned to the event, on an active account. Runs on PGlite; see
// boot.mjs for what that does and does not prove.
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
let n = 0
const user = async (email, name = null, company = null) => {
  const id = (await sup(`INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),$1) RETURNING id`, [email])).rows[0].id
  if (name !== null || company !== null) {
    await sup(`UPDATE profiles SET full_name=$2, company=$3 WHERE id=$1`, [id, name, company])
  }
  n++
  return id
}

// ---- seed -----------------------------------------------------------------
const U = {}
for (const k of ['owner', 'admin', 'mgr', 'idle', 'susp', 'owner2']) U[k] = await user(`${k}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id = ANY($1)`, [[U.owner, U.owner2]])
const mkOrg = async (name, by) =>
  (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1,'organizer','approved',$2) RETURNING id`, [name, by])).rows[0].id
const org = await mkOrg('Org', U.owner)
const org2 = await mkOrg('Other', U.owner2)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org2, U.owner2])
await sup(`SET session_replication_role = replica`)
for (const [k, r] of [['admin', 'admin'], ['mgr', 'manager'], ['idle', 'manager'], ['susp', 'manager']]) {
  await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [org, U[k], r])
}
const mkEvent = async (name, o, by) => (await sup(
  `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, published_at)
   VALUES ($1,'upcoming','published',$2,$3,'2030-01-01','2030-01-02', now()) RETURNING id`, [name, o, by])).rows[0].id
const E = await mkEvent('Big event', org, U.owner)
const E2 = await mkEvent('Unassigned event', org, U.owner)
const E3 = await mkEvent('Other org event', org2, U.owner2)
await sup(`SET session_replication_role = origin`)
for (const [e, m] of [[E, 'mgr'], [E, 'susp']]) {
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [e, U[m]])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}
await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.susp])

// 25 registrations on E, written directly (statuses are fixtures, not a flow under test):
//   confirmed 17 = 12 registered + 5 checked_in (one of them undone); 4 waitlisted; 4 cancelled.
// Names include case variants and LIKE metacharacters.
const people = [
  ['Ada Lovelace', 'Analytical Engines', 'checked_in'],
  ['ada byron', 'Poetry Ltd', 'registered'],
  ['ADA KING', '100% Club', 'waitlisted'],
  ['Grace Hopper', 'under_score Inc', 'registered'],
  ['Grace Hopper', 'Navy', 'cancelled'], // same name: tie broken by registration time, then id
]
for (let i = 1; people.length < 25; i++) {
  const status = i <= 4 ? 'checked_in' : i <= 14 ? 'registered' : i <= 17 ? 'waitlisted' : 'cancelled'
  people.push([`Person ${String(i).padStart(2, '0')}`, 'Acme', status])
}
// Users first, with triggers on, so the signup trigger creates their profiles.
const ids = []
for (const [i, [name, company]] of people.entries()) ids.push(await user(`p${i}@t.test`, name, company))
await sup(`SET session_replication_role = replica`)
let t = 0
for (const [i, [, , status]] of people.entries()) {
  const uid = ids[i]
  await sup(
    `INSERT INTO event_registrations (event_id, user_id, status, checked_in_at, created_at)
     VALUES ($1,$2,$3,$4, '2029-01-01'::timestamptz + make_interval(mins => $5))`,
    [E, uid, status, status === 'checked_in' ? '2030-01-01 09:00' : null, t++])
}
// An undone check-in: status stays checked_in, timestamp cleared. Confirmed, not arrived.
await sup(`UPDATE event_registrations SET checked_in_at = NULL WHERE event_id=$1 AND user_id=$2`, [E, ids[5]])
// Someone on the unassigned event, to prove the manager cannot read it.
await sup(`INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1,$2,'registered')`, [E2, ids[0]])
await sup(`SET session_replication_role = origin`)

const PAGE = `SELECT * FROM event_attendee_page($1,$2,$3,$4,$5)`
// The function returns exactly one row: { total_count, attendees }. raw() gives
// that row; page() gives the attendee array with the total attached as .total.
const raw = async (uid, { event = E, search = '', filter = 'all', size = 20, offset = 0 } = {}) =>
  (await as(uid, PAGE, [event, search, filter, size, offset])).rows
const unwrap = (rows) => Object.assign([...(rows[0]?.attendees ?? [])], { total: Number(rows[0]?.total_count ?? NaN) })
const page = async (uid, opts) => unwrap(await raw(uid, opts))
const total = (rows) => rows.total
const names = (rows) => rows.map((r) => r.full_name)

// ---- pagination -----------------------------------------------------------
const def = unwrap((await as(U.owner, `SELECT * FROM event_attendee_page($1)`, [E])).rows)
ok('default page size is 20 with the total of all matches', def.length === 20 && total(def) === 25, `${def.length}/${total(def)}`)
const p1 = await page(U.owner, { offset: 0 })
const p2 = await page(U.owner, { offset: 20 })
ok('second page holds the remaining 5', p2.length === 5 && total(p2) === 25)
const all = [...p1, ...p2].map((r) => r.user_id)
ok('pages do not overlap and cover every registration', new Set(all).size === 25)
// ---- empty pages still carry the total -------------------------------------
const past = await raw(U.owner, { offset: 40 })
ok('out-of-range page: one row, no attendees, total still 25',
  past.length === 1 && past[0].attendees.length === 0 && Number(past[0].total_count) === 25, JSON.stringify(past))
const none = await raw(U.owner, { search: 'zzz' })
ok('search with no match: one row, no attendees, total 0',
  none.length === 1 && none[0].attendees.length === 0 && Number(none[0].total_count) === 0, JSON.stringify(none))
const noneFiltered = await raw(U.owner, { search: 'ada', filter: 'cancelled' })
ok('search + filter with no match: total 0', noneFiltered.length === 1 && Number(noneFiltered[0].total_count) === 0)
ok('order is deterministic across calls', JSON.stringify(await page(U.owner)) === JSON.stringify(p1))
ok('sorted by name, case-insensitive', names(p1).slice(0, 3).join('|') === 'ada byron|ADA KING|Ada Lovelace', names(p1).slice(0, 3).join('|'))
const graces = p1.filter((r) => r.full_name === 'Grace Hopper')
ok('equal names are ordered by registration time', graces.length === 2 && graces[0].company === 'under_score Inc' && graces[1].company === 'Navy')
ok('page size is clamped to 100', (await page(U.owner, { size: 1000 })).length === 25)
ok('page size below 1 is clamped to 1', (await page(U.owner, { size: 0 })).length === 1)
ok('negative offset is treated as 0', JSON.stringify(await page(U.owner, { offset: -5 })) === JSON.stringify(p1))

// ---- filters (shared registration rules) ----------------------------------
const count = async (filter, search = '') => total(await page(U.owner, { filter, search, size: 100 }))
ok('all = 25', (await count('all')) === 25)
ok('confirmed = registered + checked_in = 17', (await count('confirmed')) === 17, String(await count('confirmed')))
ok('checked in = confirmed with a check-in time = 4 (one was undone)', (await count('checked_in')) === 4, String(await count('checked_in')))
ok('not checked in = confirmed without a check-in time = 13', (await count('not_checked_in')) === 13, String(await count('not_checked_in')))
ok('waitlisted = 4', (await count('waitlisted')) === 4)
ok('cancelled = 4', (await count('cancelled')) === 4, String(await count('cancelled')))
const wl = await page(U.owner, { filter: 'waitlisted', size: 100 })
ok('waitlisted filter returns only waitlisted rows', wl.every((r) => r.status === 'waitlisted'))
const nci = await page(U.owner, { filter: 'not_checked_in', size: 100 })
ok('not checked in excludes waitlisted and cancelled', nci.every((r) => ['registered', 'checked_in'].includes(r.status) && r.checked_in_at === null))
ok('unknown filter is refused', /Unknown attendee filter/.test((await err(U.owner, PAGE, [E, '', 'rejected', 20, 0])) ?? ''))

// ---- search ---------------------------------------------------------------
ok('search is case-insensitive and partial on name', (await count('all', 'ADA')) === 3)
ok('search matches company', (await count('all', 'analytical')) === 1)
ok('search trims surrounding spaces', (await count('all', '  ada  ')) === 3)
ok('"%" matches literally, not everything', (await count('all', '%')) === 1)
ok('"_" matches literally, not any character', (await count('all', '_')) === 1)
ok('search and filter combine', (await count('confirmed', 'ada')) === 2 && (await count('waitlisted', 'ada')) === 1)
ok('search narrows before paging', (await count('all', 'person')) === 20 && (await page(U.owner, { search: 'person', size: 5, offset: 15 })).length === 5)

// ---- authorization --------------------------------------------------------
ok('owner reads the event', total(await page(U.owner)) === 25)
ok('admin reads the event', total(await page(U.admin)) === 25)
ok('assigned manager reads the event', total(await page(U.mgr)) === 25)
const DENIED = /do not manage/
ok('assigned manager cannot read an unassigned event', DENIED.test((await err(U.mgr, PAGE, [E2, '', 'all', 20, 0])) ?? ''))
ok('unassigned manager is refused', DENIED.test((await err(U.idle, PAGE, [E, '', 'all', 20, 0])) ?? ''))
ok('suspended assigned manager is refused', DENIED.test((await err(U.susp, PAGE, [E, '', 'all', 20, 0])) ?? ''))
ok('another organization\'s owner is refused', DENIED.test((await err(U.owner2, PAGE, [E, '', 'all', 20, 0])) ?? ''))
ok('owner cannot read another organization\'s event', DENIED.test((await err(U.owner, PAGE, [E3, '', 'all', 20, 0])) ?? ''))
ok('anonymous callers cannot execute it', /permission denied/.test((await err(null, PAGE, [E, '', 'all', 20, 0], 'anon')) ?? ''))

// ---- fields and security model --------------------------------------------
// 20261101000000 adds contact details and marketing consent for event
// administration; tests/sql/attendee-contacts-export.test.mjs covers them.
const one = await as(U.owner, PAGE, [E, '', 'all', 1, 0])
const cols = one.fields.map((f) => f.name)
ok('returns one row of total_count and attendees', JSON.stringify(cols) === JSON.stringify(['total_count', 'attendees']), JSON.stringify(cols))
const keys = Object.keys(one.rows[0].attendees[0]).sort()
ok('each attendee carries the card, contact details, status, times and marketing consent',
  JSON.stringify(keys) === JSON.stringify(['checked_in_at', 'company', 'email', 'full_name', 'job_title', 'marketing_consent', 'marketing_consent_at', 'phone', 'photo_url', 'registered_at', 'status', 'user_id']), JSON.stringify(keys))
const fn = (await sup(
  `SELECT p.prosecdef, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
     FROM pg_proc p WHERE p.proname='event_attendee_page' AND p.pronamespace='public'::regnamespace`)).rows
ok('one signature, SECURITY DEFINER, search_path pinned',
  fn.length === 1 && fn[0].prosecdef && String(fn[0].proconfig).includes('search_path=public, pg_temp'), JSON.stringify(fn))
ok('execute granted to authenticated only', fn[0]?.auth === true && fn[0]?.anon === false)
const fea = (await sup(`SELECT count(*)::int c FROM pg_proc WHERE proname='find_event_attendees'`)).rows[0].c
ok('find_event_attendees still exists for the check-in desk', fea === 1)

// ---- a page becomes invalid after registrations change --------------------
// Last, because it changes the fixtures. Confirmed = 17: with 10 per page, page 2
// holds 7. Then every 'registered' attendee cancels (cancel_event_registration
// refuses a 'checked_in' status, so only those 12 are picked). The event has no
// capacity, so the 4 waitlisted are promoted: confirmed becomes 17 - 12 + 4 = 9.
// Page 2 is now past the end, yet the total is still reported, and page 1 holds
// everyone left. Expected numbers are read back from the table, not assumed.
const before = await page(U.mgr, { filter: 'confirmed', size: 10, offset: 10 })
ok('before: confirmed page 2 (size 10) holds 7 of 17', before.length === 7 && before.total === 17, `${before.length}/${before.total}`)
const toCancel = (await sup(
  `SELECT user_id FROM event_registrations WHERE event_id=$1 AND status = 'registered' ORDER BY created_at`, [E])).rows.map((r) => r.user_id)
for (const uid of toCancel) await as(uid, `SELECT cancel_event_registration($1)`, [E])
const confirmedNow = (await sup(
  `SELECT count(*)::int c FROM event_registrations WHERE event_id=$1 AND status IN ('registered','checked_in')`, [E])).rows[0].c
ok('after: confirmed shrank below one page (17 - 12 cancelled + 4 promoted = 9)', confirmedNow === 9, String(confirmedNow))
const after = await raw(U.mgr, { filter: 'confirmed', size: 10, offset: 10 })
ok('after: the same page is empty but the total is still returned',
  after.length === 1 && after[0].attendees.length === 0 && Number(after[0].total_count) === confirmedNow, JSON.stringify(after))
const first = await page(U.mgr, { filter: 'confirmed', size: 10, offset: 0 })
ok('after: page 1 holds every remaining confirmed registration', first.length === confirmedNow && first.total === confirmedNow)
ok('after: waitlist is empty and cancelled counts 16',
  (await page(U.owner, { filter: 'waitlisted' })).total === 0 && (await page(U.owner, { filter: 'cancelled', size: 100 })).total === 16)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
