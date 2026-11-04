// event_team writes only through the RPCs (migration 20261028000000): direct client
// INSERT / UPDATE / DELETE are refused, the RPCs keep working, reads keep working, and
// organization isolation is unchanged. Runs on PGlite; see boot.mjs for what that does
// and does not prove.
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
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role })])
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

// ---- seed -----------------------------------------------------------------
const U = {}
for (const n of ['owner', 'admin', 'm1', 'm2', 'outsider', 'owner2', 'm3']) U[n] = await user(`${n}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id = ANY($1)`, [[U.owner, U.owner2]])
const mkOrg = async (name, creator) =>
  (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1,'organizer','approved',$2) RETURNING id`, [name, creator])).rows[0].id
const org = await mkOrg('Org', U.owner)
const org2 = await mkOrg('Other Org', U.owner2)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org2, U.owner2])
await sup(`SET session_replication_role = replica`)
for (const [o, u, r] of [[org, 'admin', 'admin'], [org, 'm1', 'manager'], [org, 'm2', 'manager'], [org, 'm3', 'manager'], [org2, 'outsider', 'manager']]) {
  await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [o, U[u], r])
}
const ev = async (name, { archived = false, orgId = org, by = U.owner } = {}) =>
  (await sup(
    `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, published_at, archived_at)
     VALUES ($1,'upcoming','draft',$2,$3,'2030-01-01','2030-01-02', now(), ${archived ? 'now()' : 'NULL'}) RETURNING id`,
    [name, orgId, by])).rows[0].id
const E1 = await ev('E1')
const E2 = await ev('E2')
const EA = await ev('Archived', { archived: true })
const EX = await ev('Other org event', { orgId: org2, by: U.owner2 })
await sup(`SET session_replication_role = origin`)

const team = async (e) => (await sup(`SELECT user_id FROM event_team WHERE event_id=$1 ORDER BY user_id`, [e])).rows.map((r) => r.user_id)
const total = async () => Number((await sup(`SELECT count(*) n FROM event_team`)).rows[0].n)
const assign = (caller, e, target) => err(caller, `SELECT assign_event_manager($1,$2)`, [e, target])
const unassign = (caller, e, target) => err(caller, `SELECT unassign_event_manager($1,$2)`, [e, target])
const DENIED = /permission denied|row-level security/
const directInsert = (caller, e, target, by = null) =>
  err(caller, `INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1,$2,$3)`, [e, target, by])

// ---- the RPCs still work --------------------------------------------------
ok('admin assigns an eligible manager through the RPC', (await assign(U.admin, E1, U.m1)) === null && (await team(E1)).join() === U.m1)
ok('owner assigns an eligible manager through the RPC', (await assign(U.owner, E2, U.m2)) === null && (await team(E2)).join() === U.m2)
ok('assigned_by is the caller, set by the RPC', (await sup(`SELECT assigned_by FROM event_team WHERE event_id=$1`, [E1])).rows[0].assigned_by === U.admin)
ok('admin removes an assignment through the RPC', (await unassign(U.admin, E1, U.m1)) === null && (await team(E1)).length === 0)
ok('re-assigning after removal works', (await assign(U.admin, E1, U.m1)) === null && (await team(E1)).length === 1)

// ---- who may use them -----------------------------------------------------
const before = await total()
ok('a manager cannot assign themselves', (await assign(U.m3, E1, U.m3)) !== null && (await total()) === before)
ok('a manager cannot assign another manager', (await assign(U.m1, E1, U.m3)) !== null && (await total()) === before)
ok('a manager cannot unassign', (await unassign(U.m1, E1, U.m1)) !== null && (await total()) === before)
ok('an archived event cannot receive an assignment', /archived/.test((await assign(U.admin, EA, U.m1)) ?? '') && (await team(EA)).length === 0)
ok('an admin of another organization cannot assign here', (await assign(U.owner2, E1, U.m3)) !== null && (await total()) === before)
ok('an owner or admin cannot be assigned', /Only event managers/.test((await assign(U.owner, E1, U.admin)) ?? '') && (await total()) === before)

// ---- direct client writes are refused -------------------------------------
ok('direct INSERT by an org admin is refused (valid manager, live event)', DENIED.test((await directInsert(U.admin, E2, U.m3)) ?? '') && (await total()) === before)
ok('direct INSERT by an org owner is refused', DENIED.test((await directInsert(U.owner, E2, U.m3)) ?? '') && (await total()) === before)
ok('direct INSERT cannot assign an archived event', DENIED.test((await directInsert(U.admin, EA, U.m3)) ?? '') && (await team(EA)).length === 0)
ok('direct INSERT cannot assign an owner or admin', DENIED.test((await directInsert(U.admin, E1, U.owner)) ?? '') && DENIED.test((await directInsert(U.owner, E1, U.admin)) ?? ''))
ok('direct INSERT cannot assign a non-member', DENIED.test((await directInsert(U.admin, E1, U.outsider)) ?? ''))
ok('assigned_by cannot be forged by a direct INSERT', DENIED.test((await directInsert(U.admin, E2, U.m3, U.owner)) ?? '') && (await total()) === before)
ok('a manager cannot insert for themselves directly', DENIED.test((await directInsert(U.m3, E2, U.m3)) ?? ''))
ok('an outsider cannot insert directly', DENIED.test((await directInsert(U.outsider, E1, U.outsider)) ?? ''))
ok('a cross-organization direct INSERT is refused', DENIED.test((await directInsert(U.admin, EX, U.m1)) ?? '') && (await team(EX)).length === 0)

const delErr = await err(U.admin, `DELETE FROM event_team WHERE event_id=$1`, [E1])
ok('direct DELETE by an org admin is refused', DENIED.test(delErr ?? ''), String(delErr))
ok('...and the row is still there', (await team(E1)).join() === U.m1)
ok('a manager cannot delete their own row directly', DENIED.test((await err(U.m1, `DELETE FROM event_team WHERE user_id=$1`, [U.m1])) ?? '') && (await team(E1)).join() === U.m1)
const updErr = await err(U.admin, `UPDATE event_team SET assigned_by=$1 WHERE event_id=$2`, [U.owner, E1])
ok('direct UPDATE (forging assigned_by) is refused', DENIED.test(updErr ?? ''), String(updErr))
ok('assigned_by is unchanged', (await sup(`SELECT assigned_by FROM event_team WHERE event_id=$1`, [E1])).rows[0].assigned_by === U.admin)
ok('anon cannot read or write the table', DENIED.test((await err(U.admin, `SELECT * FROM event_team`, [], 'anon')) ?? '') && DENIED.test((await err(U.admin, `INSERT INTO event_team (event_id,user_id) VALUES ($1,$2)`, [E2, U.m3], 'anon')) ?? ''))

// ---- reads keep working ---------------------------------------------------
const adminRows = (await as(U.admin, `SELECT user_id, event_id FROM event_team`)).rows
ok('an admin reads their organization\'s assignments (the TeamPage query)', adminRows.length === 2 && adminRows.some((r) => r.user_id === U.m1 && r.event_id === E1) && adminRows.some((r) => r.user_id === U.m2 && r.event_id === E2), JSON.stringify(adminRows))
ok('a manager still reads their own assignment', (await as(U.m1, `SELECT event_id FROM event_team WHERE user_id=$1`, [U.m1])).rows.map((r) => r.event_id).join() === E1)
ok('a member of another organization sees none of these rows', (await as(U.outsider, `SELECT * FROM event_team WHERE event_id = ANY($1)`, [[E1, E2]])).rows.length === 0)
ok('an outsider with no membership sees none either', (await as(U.owner2, `SELECT * FROM event_team WHERE event_id = ANY($1)`, [[E1, E2]])).rows.length === 0)
ok('event_team_list still works for the owner', (await as(U.owner, `SELECT user_id FROM event_team_list($1)`, [E1])).rows.map((r) => r.user_id).join() === U.m1)
ok('can_manage_event still reflects assignments', (await as(U.m1, `SELECT can_manage_event($1) ok`, [E1])).rows[0].ok === true && (await as(U.m1, `SELECT can_manage_event($1) ok`, [E2])).rows[0].ok === false)
ok('organization isolation: m1 cannot manage another organization\'s event', (await as(U.m1, `SELECT can_manage_event($1) ok`, [EX])).rows[0].ok === false)

// ---- other writers still work (they run as the table owner) ---------------
await assign(U.admin, E2, U.m3)
await as(U.owner, `SELECT remove_organization_member($1,$2)`, [org, U.m3])
ok('remove_organization_member still clears a removed member\'s assignments', (await sup(`SELECT count(*) n FROM event_team WHERE user_id=$1`, [U.m3])).rows[0].n == 0)
await sup(`DELETE FROM events WHERE id=$1`, [E2])
ok('deleting an event still cascades to its assignments', (await team(E2)).length === 0)

// ---- the final shape ------------------------------------------------------
const pol = (await sup(`SELECT policyname, cmd FROM pg_policies WHERE tablename='event_team' ORDER BY 1`)).rows
ok('only the SELECT policy remains', pol.length === 1 && pol[0].policyname === 'select_event_team' && pol[0].cmd === 'SELECT', JSON.stringify(pol))
const priv = async (p) => (await sup(`SELECT has_table_privilege('authenticated','public.event_team',$1) ok`, [p])).rows[0].ok
ok('authenticated holds SELECT only', (await priv('SELECT')) && !(await priv('INSERT')) && !(await priv('UPDATE')) && !(await priv('DELETE')) && !(await priv('TRUNCATE')) && !(await priv('REFERENCES')) && !(await priv('TRIGGER')))
const colPriv = async (c, p) => (await sup(`SELECT has_column_privilege('authenticated','public.event_team',$1,$2) ok`, [c, p])).rows[0].ok
ok('no column-level write privileges survive', !(await colPriv('assigned_by', 'INSERT')) && !(await colPriv('assigned_by', 'UPDATE')) && !(await colPriv('user_id', 'INSERT')))
ok('anon has no privileges at all', !(await sup(`SELECT has_table_privilege('anon','public.event_team','SELECT') ok`)).rows[0].ok)
ok('RLS is still on and not forced (so the RPCs, run as the owner, are unaffected)', (await sup(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE relname='event_team'`)).rows[0].r === true)

// ---- the RPCs' own security model -----------------------------------------
const fns = (await sup(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('assign_event_manager','unassign_event_manager','event_team_list') ORDER BY 1`)).rows
ok('all three are SECURITY DEFINER with a fixed search_path', fns.length === 3 && fns.every((f) => f.prosecdef && /search_path=public, pg_temp/.test((f.proconfig ?? []).join(','))), JSON.stringify(fns))
for (const f of ['assign_event_manager(uuid,uuid)', 'unassign_event_manager(uuid,uuid)', 'event_team_list(uuid)']) {
  const p = async (role) => (await sup(`SELECT has_function_privilege($1, $2, 'EXECUTE') ok`, [role, `public.${f}`])).rows[0].ok
  ok(`${f}: authenticated yes; anon no`, (await p('authenticated')) && !(await p('anon')))
}
const pub = (await sup(`SELECT count(*) n FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('assign_event_manager','unassign_event_manager','event_team_list') AND a.grantee = 0`)).rows[0].n
ok('EXECUTE is not granted to PUBLIC', Number(pub) === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
