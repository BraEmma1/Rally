// Organizer registration management (migration 20261102000000): registration
// detail, organizer cancellation, manual waitlist promotion, waitlist position in
// the attendee list. Runs on PGlite; see boot.mjs for what that does and does not
// prove.
//   node tests/sql/organizer-registration-management.test.mjs
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
for (const k of ['owner', 'admin', 'mgr', 'idle', 'susp', 'owner2', 'a', 'b', 'c', 'd', 'e', 'f']) U[k] = await user(`${k}@t.test`)
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
const mkEvent = async (name, capacity) => (await sup(
  `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, published_at, capacity)
   VALUES ($1,'upcoming','published',$2,$3,'2030-01-01','2030-01-02', now(), $4) RETURNING id`, [name, org, U.owner, capacity])).rows[0].id
const E = await mkEvent('Big event', 2)
const PAST = await mkEvent('Finished event', null)
await sup(`SET session_replication_role = origin`)
for (const m of ['mgr', 'susp']) {
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [E, U[m]])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}
for (const [k, name] of [['a', 'Ada'], ['b', 'Bob'], ['c', 'Cy'], ['d', 'Dee'], ['e', 'Eve'], ['f', 'Fay']]) {
  await sup(`UPDATE profiles SET full_name=$2 WHERE id=$1`, [U[k], name])
}

// A one-question form, answered by everyone who registers.
{
  const e1 = await err(U.owner, `SELECT set_event_registration_questions($1,$2::jsonb)`,
    [E, JSON.stringify([{ label: 'Dietary needs', kind: 'short_text', required: false }])])
  if (e1) { console.log('FORM FAILED', e1); process.exit(1) }
}
const qid = (await sup(`SELECT id FROM event_registration_questions WHERE event_id=$1`, [E])).rows[0].id
const reg = async (k, ev = E) => {
  const r = await as(U[k], `SELECT * FROM register_for_event($1,$2::jsonb)`, [ev, JSON.stringify(ev === E ? { [qid]: `${k} answer` } : {})])
  // created_at drives waitlist order; keep it strictly increasing.
  await sup(`SELECT pg_sleep(0.002)`)
  return r.rows[0]
}
for (const k of ['a', 'b', 'c', 'd', 'e']) await reg(k)
await reg('f', PAST)
await sup(`UPDATE events SET status='past' WHERE id=$1`, [PAST])

const DETAIL = `SELECT * FROM event_registration_detail($1,$2)`
const CANCEL = `SELECT * FROM organizer_cancel_event_registration($1,$2)`
const PROMOTE = `SELECT organizer_promote_waitlisted_registration($1,$2) AS s`
const status = async (k) => (await sup(`SELECT status, checked_in_at, cancelled_at, cancelled_by FROM event_registrations WHERE event_id=$1 AND user_id=$2`, [E, U[k]])).rows[0]
const notes = async (k, type) => (await sup(`SELECT title, message FROM notifications WHERE user_id=$1 AND type=$2 ORDER BY created_at`, [U[k], type])).rows

ok('seed: two registered, three waitlisted',
  (await status('a')).status === 'registered' && (await status('b')).status === 'registered' &&
  (await status('c')).status === 'waitlisted' && (await status('e')).status === 'waitlisted')

// ---- detail ---------------------------------------------------------------
const dA = (await as(U.owner, DETAIL, [E, U.a])).rows[0]
ok('detail: status, date and answers of a registration',
  dA.status === 'registered' && dA.registered_at && dA.full_name === 'Ada' &&
  dA.answers.length === 1 && dA.answers[0].label === 'Dietary needs' && dA.answers[0].answer === 'a answer', JSON.stringify(dA))
ok('detail: a confirmed registration can be cancelled, not promoted', dA.can_cancel === true && dA.can_promote === false)
ok('detail: capacity and seats taken', dA.capacity === 2 && dA.seats_taken === 2 && dA.waitlist_length === 3, JSON.stringify(dA))
const dC = (await as(U.mgr, DETAIL, [E, U.c])).rows[0]
ok('detail: waitlist position', dC.status === 'waitlisted' && dC.waitlist_position === 1, JSON.stringify(dC))
ok('detail: first in line but the event is full, so no promotion', dC.can_promote === false)
const dE = (await as(U.admin, DETAIL, [E, U.e])).rows[0]
ok('detail: later waitlist positions count up', dE.waitlist_position === 3)
ok('detail: someone with no registration', /not registered/.test((await err(U.owner, DETAIL, [E, U.owner2])) ?? ''))

// ---- the gate -------------------------------------------------------------
const DENIED = /do not manage/
for (const [label, sql] of [['detail', DETAIL], ['cancel', CANCEL], ['promote', PROMOTE]]) {
  ok(`${label}: unassigned manager refused`, DENIED.test((await err(U.idle, sql, [E, U.c])) ?? ''))
  ok(`${label}: another organization's owner refused`, DENIED.test((await err(U.owner2, sql, [E, U.c])) ?? ''))
  ok(`${label}: an attendee of the event refused`, DENIED.test((await err(U.a, sql, [E, U.c])) ?? ''))
  ok(`${label}: anon cannot execute`, /permission denied/.test((await err(null, sql, [E, U.c], 'anon')) ?? ''))
}
await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.susp])
ok('suspended assigned manager refused', DENIED.test((await err(U.susp, CANCEL, [E, U.c])) ?? ''))
ok('refusals changed nothing', (await status('c')).status === 'waitlisted')

// ---- organizer cancel: seat goes to the waitlist in order ------------------
const c1 = (await as(U.mgr, CANCEL, [E, U.a])).rows[0]
ok('assigned manager cancels a confirmed registration', c1.previous_status === 'registered' && c1.promoted === 1, JSON.stringify(c1))
const sa = await status('a')
ok('the cancelled registration is kept, with when and by whom',
  sa.status === 'cancelled' && sa.cancelled_at !== null && sa.cancelled_by === U.mgr, JSON.stringify(sa))
ok('the freed seat went to the first person waiting', (await status('c')).status === 'registered')
ok('the next person moved up', (await as(U.owner, DETAIL, [E, U.d])).rows[0].waitlist_position === 1)
ok('the attendee is told', (await notes('a', 'event_registration')).some((n) => n.title === 'Registration cancelled'))
ok('the promoted person is told', (await notes('c', 'registration_promoted')).length === 1)
const dA2 = (await as(U.owner, DETAIL, [E, U.a])).rows[0]
ok('detail of a cancelled registration: kept answers, cancelled by organizer, no actions',
  dA2.status === 'cancelled' && dA2.cancelled_by_organizer === true && dA2.answers.length === 1 &&
  dA2.can_cancel === false && dA2.can_promote === false, JSON.stringify(dA2))
ok('cancelling twice is refused', /already cancelled/.test((await err(U.owner, CANCEL, [E, U.a])) ?? ''))
ok('a stranger cannot be cancelled', /not registered/.test((await err(U.owner, CANCEL, [E, U.owner2])) ?? ''))

// ---- check-in is never rewritten ------------------------------------------
await as(U.owner, `SELECT * FROM check_in_event_attendee($1,$2)`, [E, U.b])
const arrived = (await status('b')).checked_in_at
ok('detail: an arrived attendee cannot be cancelled', (await as(U.owner, DETAIL, [E, U.b])).rows[0].can_cancel === false)
ok('cancel refused after check-in', /checked in/.test((await err(U.owner, CANCEL, [E, U.b])) ?? ''))
{
  const sb = await status('b')
  ok('the check-in record is untouched', sb.status === 'checked_in' && String(sb.checked_in_at) === String(arrived), JSON.stringify(sb))
}

// ---- removing a waitlist place --------------------------------------------
const c2 = (await as(U.owner, CANCEL, [E, U.e])).rows[0]
ok('an organizer can remove someone from the waitlist', c2.previous_status === 'waitlisted' && c2.promoted === 0, JSON.stringify(c2))
ok('they are told they left the waitlist', (await notes('e', 'event_registration')).some((n) => n.title === 'Removed from the waitlist'))

// ---- manual promotion -----------------------------------------------------
ok('promotion refused while the event is full', /full/.test((await err(U.owner, PROMOTE, [E, U.d])) ?? ''))
ok('promotion of someone not waiting is refused', /not on the waitlist/.test((await err(U.owner, PROMOTE, [E, U.c])) ?? ''))

// A waitlist that automatic promotion could not reach: a seat freed while the
// event was archived (promotion skips archived events), then the event restored.
await reg('e') // back of the queue: d(1), e(2)
await sup(`UPDATE events SET archived_at=now() WHERE id=$1`, [E])
ok('archived: organizer cancel refused', /archived/.test((await err(U.owner, CANCEL, [E, U.d])) ?? ''))
ok('archived: promotion refused', /archived/.test((await err(U.owner, PROMOTE, [E, U.d])) ?? ''))
ok('archived: detail offers no actions', (await as(U.owner, DETAIL, [E, U.d])).rows[0].can_cancel === false)
await as(U.c, `SELECT cancel_event_registration($1)`, [E])
await sup(`UPDATE events SET archived_at=NULL WHERE id=$1`, [E])
ok('stuck waitlist: a seat is free and d is still waiting', (await status('d')).status === 'waitlisted')
const dD = (await as(U.owner, DETAIL, [E, U.d])).rows[0]
const dE2 = (await as(U.owner, DETAIL, [E, U.e])).rows[0]
ok('detail: the first in line can be promoted, the second cannot', dD.can_promote === true && dE2.can_promote === false, JSON.stringify([dD, dE2]))
ok('promotion out of order is refused', /waiting longer/.test((await err(U.mgr, PROMOTE, [E, U.e])) ?? ''))
ok('the first in line is promoted', (await as(U.mgr, PROMOTE, [E, U.d])).rows[0].s === 'registered')
ok('promotion notifies the attendee', (await notes('d', 'registration_promoted')).length === 1)
ok('capacity is never exceeded', /full/.test((await err(U.owner, PROMOTE, [E, U.e])) ?? ''))
ok('confirmed seats equal the capacity',
  Number((await sup(`SELECT count(*) n FROM event_registrations WHERE event_id=$1 AND status IN ('registered','checked_in')`, [E])).rows[0].n) === 2)

// ---- who cancelled stays accurate -----------------------------------------
await as(U.c, `SELECT cancel_event_registration($1)`, [E]).catch(() => {})
ok('a self-cancellation is not attributed to the organizer',
  (await as(U.owner, DETAIL, [E, U.c])).rows[0].cancelled_by_organizer === false)
await reg('a') // organizer-cancelled earlier; registers again, then cancels themselves
await as(U.a, `SELECT cancel_event_registration($1)`, [E])
ok('after re-registering and cancelling, no stale organizer attribution',
  (await as(U.owner, DETAIL, [E, U.a])).rows[0].cancelled_by_organizer === false)
ok('re-registering reused the row: no duplicate',
  Number((await sup(`SELECT count(*) n FROM event_registrations WHERE event_id=$1 AND user_id=$2`, [E, U.a])).rows[0].n) === 1)

// ---- finished events ------------------------------------------------------
ok('a finished event refuses cancellation', /finished/.test((await err(U.owner, CANCEL, [PAST, U.f])) ?? ''))
ok('a finished event offers no actions', (await as(U.owner, DETAIL, [PAST, U.f])).rows[0].can_cancel === false)

// ---- attendee list --------------------------------------------------------
const page = (await as(U.owner, `SELECT * FROM event_attendee_page($1,'','waitlisted',20,0)`, [E])).rows[0]
ok('the list shows waitlist positions', page.attendees.length === 1 && page.attendees[0].waitlist_position === 1, JSON.stringify(page.attendees))
const all = (await as(U.owner, `SELECT * FROM event_attendee_page($1,'','all',20,0)`, [E])).rows[0]
ok('position is null for everyone not waiting',
  all.attendees.filter((r) => r.status !== 'waitlisted').every((r) => r.waitlist_position === null), JSON.stringify(all.attendees))

// ---- no back doors --------------------------------------------------------
// No UPDATE policy exists on event_registrations, so RLS matches no row: the
// write is refused or silently changes nothing.
{
  const before = (await status('e')).status
  const e1 = await err(U.owner, `UPDATE event_registrations SET status='registered' WHERE event_id=$1 AND user_id=$2`, [E, U.e])
  const after = (await status('e')).status
  ok('organizers still cannot write a status directly', before === 'waitlisted' && after === 'waitlisted', `${e1} ${before}->${after}`)
}
const colPriv = (await sup(
  `SELECT has_column_privilege('authenticated','public.event_registrations','cancelled_by','SELECT') s,
          has_column_privilege('authenticated','public.event_registrations','cancelled_by','UPDATE') u,
          has_column_privilege('anon','public.event_registrations','cancelled_by','SELECT') n`)).rows[0]
ok('cancelled_by is not readable or writable by clients', !colPriv.s && !colPriv.u && !colPriv.n, JSON.stringify(colPriv))
const fns = (await sup(
  `SELECT p.proname, p.prosecdef, p.proconfig::text cfg,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') a,
          has_function_privilege('anon', p.oid, 'EXECUTE') n
     FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('event_registration_detail','organizer_cancel_event_registration',
                        'organizer_promote_waitlisted_registration','cancel_event_registration')`)).rows
ok('four functions, one signature each, SECURITY DEFINER, search_path pinned, authenticated only',
  fns.length === 4 && fns.every((f) => f.prosecdef && f.cfg.includes('search_path=public, pg_temp') && f.a && !f.n), JSON.stringify(fns))
const internal = (await sup(`SELECT has_function_privilege('authenticated','public.event_attendee_page_rows(uuid,text,text,integer,integer)','EXECUTE') a`)).rows[0]
ok('the list builder stays internal', internal.a === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
