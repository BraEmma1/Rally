// Event registration flow (migration 20261026000000): the form, capacity, the waitlist and
// its automatic promotion, cancellation, privacy, and what the client may no longer write.
// Runs on PGlite; see boot.mjs for what that does and does not prove. Not covered: two
// sessions racing for the last seat (one embedded connection cannot race); that rests on
// the FOR UPDATE lock on the event row in register_for_event.
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}

async function as(uid, sql, params = []) {
  await db.exec(`SET ROLE authenticated`)
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { return await db.query(sql, params) } finally {
    await db.exec(`RESET ROLE`)
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`)
  }
}
async function err(uid, sql, params = []) {
  try { await as(uid, sql, params); return null } catch (e) { return String(e.message) }
}
const sup = (sql, params = []) => db.query(sql, params)
const user = async (email) => (await sup(`INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),$1) RETURNING id`, [email])).rows[0].id

// ---- seed -----------------------------------------------------------------
const [A, B, C, D, S, X, O] = await Promise.all(['a', 'b', 'c', 'd', 's', 'x', 'o'].map(async (n) => user(`${n}@t.test`)))
// users are created one after another because of the signup trigger; Promise.all above is fine on one connection.
await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [S])
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id=$1`, [O])
const org = (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Org','organizer','approved',$1) RETURNING id`, [O])).rows[0].id
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, O])

const ev = async (name, opts = {}) => { await sup(`SET session_replication_role = replica`); try { return await ev0(name, opts) } finally { await sup(`SET session_replication_role = origin`) } }
const ev0 = async (name, { cap = null, status = 'upcoming', vis = 'published', archived = false } = {}) =>
  (await sup(
    `INSERT INTO events (name, status, visibility, capacity, organization_id, created_by, start_date, end_date, published_at, archived_at)
     VALUES ($1,$2,$3,$4,$5,$6,'2030-01-01','2030-01-02', now(), ${archived ? 'now()' : 'NULL'}) RETURNING id`,
    [name, status, vis, cap, org, O])).rows[0].id
const E1 = await ev('E1 cap2', { cap: 2 })
const E2 = await ev('E2 open')
const E3 = await ev('E3 draft', { vis: 'draft' })
const E4 = await ev('E4 past', { status: 'past' })
const E5 = await ev('E5 archived', { archived: true })
const E6 = await ev('E6 unlisted cap1', { cap: 1, vis: 'unlisted' })

const reg = (uid, e, answers = {}) => as(uid, `SELECT * FROM register_for_event($1,$2::jsonb)`, [e, JSON.stringify(answers)])
const status = async (uid, e) => (await sup(`SELECT status FROM event_registrations WHERE user_id=$1 AND event_id=$2`, [uid, e])).rows[0]?.status

// ---- the form -------------------------------------------------------------
const Q = [
  { label: 'Company', kind: 'short_text', required: true },
  { label: 'Interests', kind: 'multi_choice', options: ['Talks', 'Workshops'] },
  { label: 'First time?', kind: 'yes_no' },
]
ok('attendee cannot edit the form', /do not have access/.test(await err(A, `SELECT set_event_registration_questions($1,$2::jsonb)`, [E1, JSON.stringify(Q)]) ?? ''))
ok('organizer sets the form', (await err(O, `SELECT set_event_registration_questions($1,$2::jsonb)`, [E1, JSON.stringify(Q)])) === null)
const form = (await as(A, `SELECT * FROM get_event_registration_form($1)`, [E1])).rows
ok('attendee reads 3 ordered questions', form.length === 3 && form[0].label === 'Company' && form[0].required === true, JSON.stringify(form))
ok('draft event form is hidden', /does not exist/.test(await err(A, `SELECT * FROM get_event_registration_form($1)`, [E3]) ?? ''))
const [qCompany, qInterests, qFirst] = form.map((f) => f.id)

// ---- validation -----------------------------------------------------------
ok('required question enforced', /required/.test(await err(A, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [E1]) ?? ''))
ok('blank required answer rejected', /required/.test(await err(A, `SELECT * FROM register_for_event($1,$2::jsonb)`, [E1, JSON.stringify({ [qCompany]: '   ' })]) ?? ''))
ok('option outside the list rejected', /do not match/.test(await err(A, `SELECT * FROM register_for_event($1,$2::jsonb)`, [E1, JSON.stringify({ [qCompany]: 'Acme', [qInterests]: ['Parties'] })]) ?? ''))
ok('unknown question id rejected', /do not match/.test(await err(A, `SELECT * FROM register_for_event($1,$2::jsonb)`, [E1, JSON.stringify({ [qCompany]: 'Acme', [crypto.randomUUID()]: 'x' })]) ?? ''))
ok('wrong type rejected (yes/no given text)', /do not match/.test(await err(A, `SELECT * FROM register_for_event($1,$2::jsonb)`, [E1, JSON.stringify({ [qCompany]: 'Acme', [qFirst]: 'yes' })]) ?? ''))
ok('over-long answer rejected', /too long/.test(await err(A, `SELECT * FROM register_for_event($1,$2::jsonb)`, [E1, JSON.stringify({ [qCompany]: 'x'.repeat(501) })]) ?? ''))
ok('nothing was written by the failed attempts', (await status(A, E1)) === undefined)

// ---- capacity + waitlist --------------------------------------------------
const rA = (await reg(A, E1, { [qCompany]: 'Acme', [qInterests]: ['Talks'], [qFirst]: true })).rows[0]
ok('A registered', rA.registration_status === 'registered' && rA.waitlist_position === null, JSON.stringify(rA))
ok('registering twice is refused', /already registered/.test(await err(A, `SELECT * FROM register_for_event($1,$2::jsonb)`, [E1, JSON.stringify({ [qCompany]: 'Acme' })]) ?? ''))
const rB = (await reg(B, E1, { [qCompany]: 'Beta' })).rows[0]
ok('B registered (2/2)', rB.registration_status === 'registered')
const rC = (await reg(C, E1, { [qCompany]: 'Gamma' })).rows[0]
ok('C waitlisted #1', rC.registration_status === 'waitlisted' && rC.waitlist_position === 1, JSON.stringify(rC))
const rD = (await reg(D, E1, { [qCompany]: 'Delta' })).rows[0]
ok('D waitlisted #2', rD.registration_status === 'waitlisted' && rD.waitlist_position === 2, JSON.stringify(rD))
ok('suspended account refused', /not active/.test(await err(S, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [E2]) ?? ''))
ok('draft event refused', /not open/.test(await err(A, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [E3]) ?? ''))
ok('past event refused', /finished/.test(await err(A, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [E4]) ?? ''))
ok('archived event refused', /no longer available/.test(await err(A, `SELECT * FROM register_for_event($1,'{}'::jsonb)`, [E5]) ?? ''))
ok('open event, no questions, no capacity', (await reg(A, E2)).rows[0].registration_status === 'registered')

// ---- the table cannot be written directly ---------------------------------
ok('direct INSERT is blocked', /permission denied/.test(await err(X, `INSERT INTO event_registrations (event_id, user_id) VALUES ($1,$2)`, [E2, X]) ?? ''))
ok('direct DELETE is blocked', /permission denied/.test(await err(A, `DELETE FROM event_registrations WHERE user_id=$1`, [A]) ?? ''))
ok('direct UPDATE cannot self-promote', (await as(C, `UPDATE event_registrations SET status='registered' WHERE user_id=$1 RETURNING id`, [C])).rows.length === 0 || (await status(C, E1)) === 'waitlisted')
ok('answers table is not readable', /permission denied/.test(await err(A, `SELECT * FROM event_registration_answers`) ?? ''))
ok('questions table is not readable', /permission denied/.test(await err(A, `SELECT * FROM event_registration_questions`) ?? ''))

// ---- counts and privacy ---------------------------------------------------
const cnt = (await as(X, `SELECT * FROM get_event_registration_counts(ARRAY[$1]::uuid[])`, [E1])).rows[0]
ok('public count is active registrations only (2, not 4)', Number(cnt.registration_count) === 2, JSON.stringify(cnt))
const seenByA = (await as(A, `SELECT user_id FROM event_registrations WHERE event_id=$1`, [E1])).rows.map((r) => r.user_id)
ok('attendee sees active co-attendees, not waitlisted', seenByA.includes(A) && seenByA.includes(B) && !seenByA.includes(C) && !seenByA.includes(D), JSON.stringify(seenByA))
const seenByC = (await as(C, `SELECT user_id FROM event_registrations WHERE event_id=$1`, [E1])).rows.map((r) => r.user_id)
ok('waitlisted person sees only their own row', seenByC.length === 1 && seenByC[0] === C, JSON.stringify(seenByC))
const seenByO = (await as(O, `SELECT user_id FROM event_registrations WHERE event_id=$1`, [E1])).rows.length
ok('organizer still sees every row (4)', seenByO === 4, String(seenByO))

// ---- cancel + auto-promotion ---------------------------------------------
ok('cancel returns previous status', (await as(A, `SELECT cancel_event_registration($1) AS s`, [E1])).rows[0].s === 'registered')
ok('cancelled keeps a row', (await status(A, E1)) === 'cancelled')
ok('C auto-promoted', (await status(C, E1)) === 'registered')
ok('D is now #1', (await as(D, `SELECT waitlist_position FROM my_event_registration($1)`, [E1])).rows[0].waitlist_position === 1)
const notes = (await sup(`SELECT user_id, type FROM notifications WHERE type='registration_promoted'`)).rows
ok('promotion notified C only', notes.length === 1 && notes[0].user_id === C, JSON.stringify(notes))
ok('cancelling again is refused', /not registered/.test(await err(A, `SELECT cancel_event_registration($1)`, [E1]) ?? ''))
const rA2 = (await reg(A, E1, { [qCompany]: 'Acme again' })).rows[0]
ok('A re-registers to the back of the waitlist (#2)', rA2.registration_status === 'waitlisted' && rA2.waitlist_position === 2, JSON.stringify(rA2))
const a2answers = (await as(A, `SELECT answers FROM my_event_registration($1)`, [E1])).rows[0].answers
ok('old answers replaced on re-register', a2answers[qCompany] === 'Acme again' && a2answers[qInterests] === undefined, JSON.stringify(a2answers))

// ---- check-in guard -------------------------------------------------------
ok('waitlisted person cannot be checked in', /waitlist/.test(await err(O, `SELECT * FROM check_in_event_attendee($1,$2)`, [E1, D]) ?? ''))
const ci = await err(O, `SELECT * FROM check_in_event_attendee($1,$2)`, [E1, B])
ok('registered person can be checked in', ci === null, String(ci))
ok('checked-in person cannot cancel', /already checked in/.test(await err(B, `SELECT cancel_event_registration($1)`, [E1]) ?? ''))

// ---- capacity change promotes --------------------------------------------
await sup(`UPDATE events SET capacity = 4 WHERE id=$1`, [E1])
ok('raising capacity promotes D then A, in order', (await status(D, E1)) === 'registered' && (await status(A, E1)) === 'registered')
await sup(`UPDATE events SET capacity = 4 WHERE id=$1`, [E1])
const E7 = await ev('E7 cap1', { cap: 1 })
await reg(B, E7); await reg(C, E7); await reg(D, E7)
await sup(`UPDATE events SET capacity = NULL WHERE id=$1`, [E7])
ok('removing the cap promotes everyone', (await status(C, E7)) === 'registered' && (await status(D, E7)) === 'registered')
// organizer removing a registration (hard delete as superuser) frees a seat too
const E8 = await ev('E8 cap1', { cap: 1 })
await reg(B, E8); await reg(C, E8)
await sup(`DELETE FROM event_registrations WHERE event_id=$1 AND user_id=$2`, [E8, B])
ok('deleting an attending row promotes the waitlist', (await status(C, E8)) === 'registered')

// ---- organizer answers ----------------------------------------------------
const ans = (await as(O, `SELECT * FROM get_event_registration_answers($1,50,0)`, [E1])).rows
ok('organizer reads answers', ans.length >= 3 && ans.some((r) => r.answers.some((a) => a.label === 'Company' && a.answer === 'Beta')), JSON.stringify(ans[0]))
ok('cancelled registrations are not listed', !ans.some((r) => r.registration_status === 'cancelled'))
ok('attendee cannot read the answers', /do not have access/.test(await err(A, `SELECT * FROM get_event_registration_answers($1,50,0)`, [E1]) ?? ''))
ok('another organizer-less user cannot either', /do not have access/.test(await err(X, `SELECT * FROM get_event_registration_answers($1,50,0)`, [E1]) ?? ''))

// ---- editing the form after answers --------------------------------------
await sup(`UPDATE events SET capacity = NULL WHERE id=$1`, [E1])
await reg(X, E1, { [qCompany]: 'Xco', [qInterests]: ['Talks'] })
ok('changing the type of an answered question is refused',
  /cannot change/.test(await err(O, `SELECT set_event_registration_questions($1,$2::jsonb)`, [E1,
    JSON.stringify([{ id: qCompany, label: 'Company', kind: 'long_text', required: true }])]) ?? ''))
await as(O, `SELECT set_event_registration_questions($1,$2::jsonb)`, [E1,
  JSON.stringify([{ id: qCompany, label: 'Employer', kind: 'short_text', required: true }, { label: 'Role', kind: 'single_choice', options: ['Dev', 'PM'] }])])
const form2 = (await as(A, `SELECT * FROM get_event_registration_form($1)`, [E1])).rows
ok('removed questions leave the form; new ones appear in order', form2.length === 2 && form2[0].label === 'Employer' && form2[1].label === 'Role', JSON.stringify(form2.map((f) => f.label)))
const ans2 = (await as(O, `SELECT * FROM get_event_registration_answers($1,50,0)`, [E1])).rows
ok('archived questions keep their answers for the organizer', ans2.some((r) => r.answers.some((a) => a.archived === true)), JSON.stringify(ans2[0]?.answers))
ok('bad option list refused', /different options/.test(await err(O, `SELECT set_event_registration_questions($1,$2::jsonb)`, [E1,
  JSON.stringify([{ label: 'Pick', kind: 'single_choice', options: ['a', 'a'] }])]) ?? ''))
ok('21 questions refused', /at most 20/.test(await err(O, `SELECT set_event_registration_questions($1,$2::jsonb)`, [E1,
  JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ label: `q${i}`, kind: 'yes_no' })))]) ?? ''))

// ---- unlisted event: a waitlisted person can still open it ----------------
await reg(A, E6); await reg(B, E6)
ok('unlisted: first is registered, second waitlisted', (await status(A, E6)) === 'registered' && (await status(B, E6)) === 'waitlisted')
ok('waitlisted person can read the unlisted event', (await as(B, `SELECT id FROM events WHERE id=$1`, [E6])).rows.length === 1)
ok('stranger cannot read the unlisted event row', (await as(X, `SELECT id FROM events WHERE id=$1`, [E6])).rows.length === 0)
await as(B, `SELECT cancel_event_registration($1)`, [E6])
ok('after cancelling they lose the unlisted event', (await as(B, `SELECT id FROM events WHERE id=$1`, [E6])).rows.length === 0)

// ---- permissions ----------------------------------------------------------
for (const fn of ['register_for_event(uuid,jsonb)', 'cancel_event_registration(uuid)', 'my_event_registration(uuid)', 'get_event_registration_form(uuid)',
  'set_event_registration_questions(uuid,jsonb)', 'get_event_registration_answers(uuid,integer,integer)']) {
  const r = (await sup(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') a, has_function_privilege('authenticated','public.${fn}','EXECUTE') b`)).rows[0]
  ok(`${fn}: anon no, authenticated yes`, !r.a && r.b)
}
for (const fn of ['promote_event_waitlist(uuid)', 'validate_registration_answers(uuid,jsonb)']) {
  const r = (await sup(`SELECT has_function_privilege('authenticated','public.${fn}','EXECUTE') b`)).rows[0]
  ok(`${fn}: internal only`, !r.b)
}
ok('RLS on both new tables', (await sup(`SELECT bool_and(relrowsecurity) v FROM pg_class WHERE relname IN ('event_registration_questions','event_registration_answers')`)).rows[0].v)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
