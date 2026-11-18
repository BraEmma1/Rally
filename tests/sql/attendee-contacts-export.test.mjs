// Organizer attendee contact details, CSV export reads and event marketing
// consent (migration 20261101000000). Runs on PGlite; see boot.mjs for what that
// does and does not prove.
//   node tests/sql/attendee-contacts-export.test.mjs
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
for (const k of ['owner', 'admin', 'mgr', 'idle', 'susp', 'owner2', 'a', 'b', 'c', 'outsider']) U[k] = await user(`${k}@t.test`)
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
const mkEvent = async (name, o, by, visibility = 'published') => (await sup(
  `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, published_at)
   VALUES ($1,'upcoming',$4,$2,$3,'2030-01-01','2030-01-02', now()) RETURNING id`, [name, o, by, visibility])).rows[0].id
const E = await mkEvent('Big event', org, U.owner)
const E2 = await mkEvent('Unassigned event', org, U.owner)
const DRAFT = await mkEvent('Draft event', org, U.owner, 'draft')
await sup(`SET session_replication_role = origin`)
for (const [e, m] of [[E, 'mgr'], [E, 'susp']]) {
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [e, U[m]])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}

// Three named attendees with known contact details, registered through the real flow.
await sup(`UPDATE profiles SET full_name='Ada Lovelace', company='Engines', phone='+44 20 7946 0000', email='ada.contact@example.com' WHERE id=$1`, [U.a])
await sup(`UPDATE profiles SET full_name='Bob Byron', company='Poetry', phone='   ', email='' WHERE id=$1`, [U.b])
await sup(`UPDATE auth.users SET email=NULL WHERE id=$1`, [U.c])
await sup(`UPDATE profiles SET full_name='Cy Clark', company='Clocks', phone=NULL, email='cy.profile@example.com' WHERE id=$1`, [U.c])
for (const k of ['a', 'b', 'c']) {
  const e1 = await err(U[k], `SELECT * FROM register_for_event($1)`, [E])
  if (e1) { console.log('REGISTER FAILED', k, e1); process.exit(1) }
}

const PAGE = `SELECT * FROM event_attendee_page($1,$2,$3,$4,$5)`
const EXPORT = `SELECT * FROM event_attendee_export($1,$2,$3,$4,$5)`
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.full_name, r]))

// ---- contact details ------------------------------------------------------
const list = (await as(U.mgr, PAGE, [E, '', 'all', 20, 0])).rows[0]
const P = byName(list.attendees)
ok('email is the account email the attendee registered with', P['Ada Lovelace']?.email === 'a@t.test', JSON.stringify(P['Ada Lovelace']))
ok('phone comes from the profile', P['Ada Lovelace']?.phone === '+44 20 7946 0000')
ok('a blank phone reads as null, not whitespace', P['Bob Byron']?.phone === null, JSON.stringify(P['Bob Byron']))
ok('no account email falls back to the profile email', P['Cy Clark']?.email === 'cy.profile@example.com', JSON.stringify(P['Cy Clark']))
ok('registering alone never means marketing consent',
  list.attendees.every((r) => r.marketing_consent === false && r.marketing_consent_at === null), JSON.stringify(list.attendees))

// ---- contact data stays behind the gate -----------------------------------
const DENIED = /do not manage/
for (const [label, sql] of [['page', PAGE], ['export', EXPORT]]) {
  ok(`${label}: owner allowed`, (await err(U.owner, sql, [E, '', 'all', 20, 0])) === null)
  ok(`${label}: admin allowed`, (await err(U.admin, sql, [E, '', 'all', 20, 0])) === null)
  ok(`${label}: assigned manager allowed`, (await err(U.mgr, sql, [E, '', 'all', 20, 0])) === null)
  ok(`${label}: assigned manager refused on an unassigned event`, DENIED.test((await err(U.mgr, sql, [E2, '', 'all', 20, 0])) ?? ''))
  ok(`${label}: unassigned manager refused`, DENIED.test((await err(U.idle, sql, [E, '', 'all', 20, 0])) ?? ''))
  ok(`${label}: another organization's owner refused`, DENIED.test((await err(U.owner2, sql, [E, '', 'all', 20, 0])) ?? ''))
  ok(`${label}: an attendee of the event refused`, DENIED.test((await err(U.a, sql, [E, '', 'all', 20, 0])) ?? ''))
  ok(`${label}: anon cannot execute`, /permission denied/.test((await err(null, sql, [E, '', 'all', 20, 0], 'anon')) ?? ''))
}
await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.susp])
ok('suspended assigned manager refused (export)', DENIED.test((await err(U.susp, EXPORT, [E, '', 'all', 20, 0])) ?? ''))

const colPriv = (await sup(
  `SELECT bool_or(has_column_privilege('authenticated', 'public.event_registrations', c, 'SELECT')) s,
          bool_or(has_column_privilege('authenticated', 'public.event_registrations', c, 'UPDATE')) u
     FROM unnest(ARRAY['marketing_consent','marketing_consent_at','share_contact','contact_email','contact_phone']) c`)).rows[0]
ok('clients cannot read or write the consent columns directly', colPriv.s === false && colPriv.u === false, JSON.stringify(colPriv))
ok('clients cannot read the consent log', /permission denied/.test((await err(U.a, `SELECT * FROM event_marketing_consents`)) ?? ''))
ok('clients cannot write the consent log', /permission denied/.test((await err(U.a,
  `INSERT INTO event_marketing_consents (registration_id,event_id,user_id,consented,statement,statement_version) VALUES (gen_random_uuid(),$1,$2,true,'x','x')`, [E, U.a])) ?? ''))
for (const fn of ['event_attendee_rows(uuid,text,text)', 'event_attendee_page_rows(uuid,text,text,integer,integer)', 'event_marketing_consent_statement(uuid)']) {
  const priv = (await sup(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') a, has_function_privilege('anon', $1, 'EXECUTE') n`, [`public.${fn}`])).rows[0]
  ok(`internal ${fn.split('(')[0]} is not executable by clients`, priv.a === false && priv.n === false)
}
{
  const e1 = await err(U.outsider, `SELECT email, phone FROM profiles WHERE id=$1`, [U.a])
  const rows = e1 ? [] : (await as(U.outsider, `SELECT email, phone FROM profiles WHERE id=$1`, [U.a])).rows
  ok('another user still cannot read an attendee email or phone from profiles', rows.length === 0, e1 ?? JSON.stringify(rows))
}
const fea = (await as(U.owner, `SELECT * FROM find_event_attendees($1,'')`, [E])).rows[0]
ok('find_event_attendees still returns no contact details', fea && !('email' in fea) && !('phone' in fea), JSON.stringify(fea))
const fns = (await sup(
  `SELECT p.proname, p.prosecdef, p.proconfig::text cfg FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('event_attendee_page','event_attendee_export','my_event_marketing_consent','set_event_marketing_consent')`)).rows
ok('four public functions, one signature each, SECURITY DEFINER, search_path pinned',
  fns.length === 4 && fns.every((f) => f.prosecdef && f.cfg.includes('search_path=public, pg_temp')), JSON.stringify(fns))

// ---- marketing consent ----------------------------------------------------
const MINE = `SELECT * FROM my_event_marketing_consent($1)`
const SET = `SELECT * FROM set_event_marketing_consent($1,$2)`
const log = async (uid) => (await sup(
  `SELECT consented, statement, statement_version FROM event_marketing_consents WHERE user_id=$1 AND event_id=$2 ORDER BY recorded_at, id`, [uid, E])).rows

const before = (await as(U.outsider, MINE, [E])).rows[0]
ok('the statement is available before registering, unchecked',
  before.consented === false && before.recorded_at === null &&
  before.statement === 'Send me news and offers about future events from Acme Events. I can turn this off at any time.', JSON.stringify(before))
ok('a draft event is not described to outsiders', /does not exist/.test((await err(U.outsider, MINE, [DRAFT])) ?? ''))
ok('anon cannot read consent', /permission denied/.test((await err(null, MINE, [E], 'anon')) ?? ''))
ok('consent needs a registration', /not registered/.test((await err(U.outsider, SET, [E, true])) ?? ''))
ok('consent must be yes or no', /Choose yes or no/.test((await err(U.a, SET, [E, null])) ?? ''))

const given = (await as(U.a, SET, [E, true])).rows[0]
ok('an attendee can opt in', given.consented === true && given.recorded_at !== null)
let L = await log(U.a)
ok('opting in is logged with the exact statement and its version',
  L.length === 1 && L[0].consented === true && L[0].statement === before.statement && L[0].statement_version === 'event-marketing-v1', JSON.stringify(L))
await as(U.a, SET, [E, true])
ok('repeating the same choice adds no log entry', (await log(U.a)).length === 1)
const mine = (await as(U.a, MINE, [E])).rows[0]
ok('the attendee reads their own choice back', mine.consented === true && mine.recorded_at !== null)
const orgView = byName((await as(U.mgr, PAGE, [E, 'ada', 'all', 20, 0])).rows[0].attendees)['Ada Lovelace']
ok('organizers see the consent and when it was recorded', orgView?.marketing_consent === true && orgView?.marketing_consent_at !== null, JSON.stringify(orgView))
ok('consent is per attendee: others stay opted out',
  (await as(U.mgr, PAGE, [E, 'bob', 'all', 20, 0])).rows[0].attendees[0].marketing_consent === false)

await as(U.a, SET, [E, false])
L = await log(U.a)
ok('withdrawing is logged too', L.length === 2 && L[1].consented === false, JSON.stringify(L))
ok('organizers see the withdrawal', byName((await as(U.owner, PAGE, [E, 'ada', 'all', 20, 0])).rows[0].attendees)['Ada Lovelace'].marketing_consent === false)

// Cancelled: can withdraw, cannot opt in.
await as(U.b, SET, [E, true])
await as(U.b, `SELECT cancel_event_registration($1)`, [E])
await as(U.c, `SELECT cancel_event_registration($1)`, [E])
ok('a cancelled registration cannot opt in', /not registered/.test((await err(U.c, SET, [E, true])) ?? ''))
ok('a cancelled registration can still withdraw', (await err(U.b, SET, [E, false])) === null)
// Suspended: can withdraw, cannot opt in.
await as(U.a, SET, [E, true])
await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.a])
ok('a suspended account can withdraw', (await err(U.a, SET, [E, false])) === null)
ok('a suspended account cannot opt in again', /not active/.test((await err(U.a, SET, [E, true])) ?? ''))
await sup(`UPDATE user_accounts SET status='active' WHERE user_id=$1`, [U.a])

// ---- export: the full result, in chunks -------------------------------------
// 2,500 more registrations, written directly (fixtures, not the flow under test).
await sup(`INSERT INTO auth.users (id, email) SELECT gen_random_uuid(), 'bulk' || g || '@t.test' FROM generate_series(1, 2500) g`)
await sup(`UPDATE profiles p SET full_name = 'Bulk ' || lpad(substring(u.email from 'bulk(\\d+)@'), 4, '0'), company = CASE WHEN substring(u.email from 'bulk(\\d+)@')::int % 2 = 0 THEN 'Even Co' ELSE 'Odd Co' END
             FROM auth.users u WHERE u.id = p.id AND u.email LIKE 'bulk%'`)
await sup(`SET session_replication_role = replica`)
await sup(`INSERT INTO event_registrations (event_id, user_id, status)
           SELECT $1, u.id, CASE WHEN substring(u.email from 'bulk(\\d+)@')::int % 10 = 0 THEN 'waitlisted' ELSE 'registered' END
             FROM auth.users u WHERE u.email LIKE 'bulk%'`, [E])
await sup(`SET session_replication_role = origin`)

const exportAll = async (uid, search, filter, size) => {
  const rows = []
  let total = null
  for (let offset = 0; ; offset += size) {
    const r = (await as(uid, EXPORT, [E, search, filter, size, offset])).rows[0]
    total = Number(r.total_count)
    rows.push(...r.attendees)
    if (r.attendees.length < size || rows.length >= total) break
  }
  return { rows, total }
}
const all = await exportAll(U.mgr, '', 'all', 1000)
const expectAll = (await sup(`SELECT count(*)::int c FROM event_registrations WHERE event_id=$1`, [E])).rows[0].c
ok('export covers every registration across chunks', all.rows.length === expectAll && all.total === expectAll, `${all.rows.length}/${all.total}/${expectAll}`)
ok('no registration appears twice', new Set(all.rows.map((r) => r.user_id)).size === all.rows.length)
const pageOrder = []
for (let o = 0; o < expectAll; o += 100) pageOrder.push(...(await as(U.mgr, PAGE, [E, '', 'all', 100, o])).rows[0].attendees.map((r) => r.user_id))
ok('export order is the list order', JSON.stringify(pageOrder) === JSON.stringify(all.rows.map((r) => r.user_id)))
const big = (await as(U.mgr, EXPORT, [E, '', 'all', 5000, 0])).rows[0]
ok('an export chunk is capped at 1000 rows', big.attendees.length === 1000 && Number(big.total_count) === expectAll)
ok('the list page is still capped at 100', (await as(U.mgr, PAGE, [E, '', 'all', 5000, 0])).rows[0].attendees.length === 100)

const filtered = await exportAll(U.owner, 'even co', 'waitlisted', 1000)
const expectFiltered = (await sup(
  `SELECT count(*)::int c FROM event_registrations r JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id=$1 AND r.status='waitlisted' AND p.company='Even Co'`, [E])).rows[0].c
ok('export honours search and filter together', filtered.rows.length === expectFiltered && filtered.total === expectFiltered && expectFiltered === 250,
  `${filtered.rows.length}/${expectFiltered}`)
ok('every exported row matches the filter', filtered.rows.every((r) => r.status === 'waitlisted' && r.company === 'Even Co'))
ok('exported rows carry contact details and consent',
  ['email', 'phone', 'marketing_consent', 'marketing_consent_at', 'registered_at', 'checked_in_at'].every((k) => k in filtered.rows[0]))
ok('export refuses an unknown filter', /Unknown attendee filter/.test((await err(U.owner, EXPORT, [E, '', 'everyone', 10, 0])) ?? ''))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
