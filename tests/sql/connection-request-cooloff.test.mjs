// 30-day cool-off on repeated connection requests (migration 20261027000000).
// Runs on PGlite; see boot.mjs for what that does and does not prove.
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

// ---- seed: one event, everyone registered ---------------------------------
const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'o']
const ids = {}
for (const n of names) ids[n] = await user(`${n}@t.test`)
const { a: A, b: B, c: C, d: D, e: E, f: F, g: G, o: O } = ids
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id=$1`, [O])
const org = (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('Org','organizer','approved',$1) RETURNING id`, [O])).rows[0].id
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, O])
await sup(`SET session_replication_role = replica`)
const EV = (await sup(
  `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, published_at)
   VALUES ('Ev','upcoming','published',$1,$2,'2030-01-01','2030-01-02', now()) RETURNING id`, [org, O])).rows[0].id
for (const u of [A, B, C, D, E, F, G]) {
  await sup(`INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1,$2,'registered')`, [EV, u])
}
await sup(`SET session_replication_role = origin`)

const send = (from, to) => as(from, `SELECT send_connection_request($1,$2) AS id`, [EV, to])
const respond = (who, id, accept) => as(who, `SELECT respond_to_connection_request($1,$2)`, [id, accept])
const RIGHT_NOW = /cannot send a request to this person right now/

// ---- baseline: nothing changed for a first request ------------------------
const ab = (await send(A, B)).rows[0].id
ok('first request still succeeds', !!ab)
ok('duplicate pending request keeps its own message', /already sent this person a request/.test(await err(A, `SELECT send_connection_request($1,$2)`, [EV, B]) ?? ''))

// ---- declined -> cool-off -------------------------------------------------
await respond(B, ab, false)
ok('re-asking right after a decline is refused', RIGHT_NOW.test(await err(A, `SELECT send_connection_request($1,$2)`, [EV, B]) ?? ''))
ok('the refused attempt wrote nothing', Number((await sup(`SELECT count(*) n FROM connection_requests WHERE requester_id=$1 AND recipient_id=$2`, [A, B])).rows[0].n) === 1)

// ---- cancelled -> cool-off ------------------------------------------------
const ac = (await send(A, C)).rows[0].id
await as(A, `SELECT cancel_connection_request($1)`, [ac])
ok('re-asking right after cancelling is refused', RIGHT_NOW.test(await err(A, `SELECT send_connection_request($1,$2)`, [EV, C]) ?? ''))

// ---- the window is 30 days ------------------------------------------------
const ad = (await send(A, D)).rows[0].id
await respond(D, ad, false)
await sup(`UPDATE connection_requests SET responded_at = now() - interval '29 days' WHERE id=$1`, [ad])
ok('29 days after a decline: still refused', RIGHT_NOW.test(await err(A, `SELECT send_connection_request($1,$2)`, [EV, D]) ?? ''))
await sup(`UPDATE connection_requests SET responded_at = now() - interval '31 days' WHERE id=$1`, [ad])
ok('31 days after a decline: allowed again', (await err(A, `SELECT send_connection_request($1,$2)`, [EV, D])) === null)

// ---- scope: directional, per pair -----------------------------------------
const ae = (await send(A, E)).rows[0].id
await respond(E, ae, false)
ok('A declined by E: A may still ask someone else (B is unaffected by E)', (await err(A, `SELECT send_connection_request($1,$2)`, [EV, F])) === null)
const fg = (await send(F, G)).rows[0].id
await respond(G, fg, false)
ok('directional: the decliner (G) may ask the requester (F)', (await err(G, `SELECT send_connection_request($1,$2)`, [EV, F])) === null)

// ---- security shape unchanged ---------------------------------------------
const fn = (await sup(`SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid) res
                       FROM pg_proc p WHERE p.proname='send_connection_request'`)).rows
ok('single overload', fn.length === 1)
ok('SECURITY DEFINER with fixed search_path', fn[0].prosecdef === true && /search_path=public, pg_temp/.test((fn[0].proconfig ?? []).join(',')), JSON.stringify(fn[0]))
ok('still returns uuid', fn[0].res === 'uuid')
const priv = async (role) => (await sup(`SELECT has_function_privilege($1, 'public.send_connection_request(uuid,uuid)', 'EXECUTE') ok`, [role])).rows[0].ok
ok('authenticated may execute', await priv('authenticated'))
ok('anon may not execute', !(await priv('anon')))
ok('unauthenticated call is refused', /Authentication required/.test(await (async () => { try { await sup(`SELECT send_connection_request($1,$2)`, [EV, B]); return '' } catch (e) { return String(e.message) } })()))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
