// Event-manager assignment: assign_event_manager, unassign_event_manager and
// event_team_list, and what assignment does to a manager's reach. Runs on PGlite;
// see boot.mjs for what that does and does not prove.
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
const U = {}
for (const n of ['owner', 'admin', 'm1', 'm2', 'outsider', 'owner2']) U[n] = await user(`${n}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id = ANY($1)`, [[U.owner, U.owner2]])
const mkOrg = async (name, creator) =>
  (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1,'organizer','approved',$2) RETURNING id`, [name, creator])).rows[0].id
const org = await mkOrg('Org', U.owner)
const org2 = await mkOrg('Other Org', U.owner2)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org2, U.owner2])
await sup(`SET session_replication_role = replica`)
for (const [u, r] of [['admin', 'admin'], ['m1', 'manager'], ['m2', 'manager']]) {
  await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [org, U[u], r])
}
const ev = async (name, { vis = 'published', archived = false, orgId = org, by = U.owner } = {}) =>
  (await sup(
    `INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, published_at, archived_at)
     VALUES ($1,'upcoming',$2,$3,$4,'2030-01-01','2030-01-02', now(), ${archived ? 'now()' : 'NULL'}) RETURNING id`,
    [name, vis, orgId, by])).rows[0].id
// Drafts, because a published event is readable by every signed-in user and so
// cannot show assignment-based access.
const E1 = await ev('E1 draft', { vis: 'draft' })
const E2 = await ev('E2 draft', { vis: 'draft' })
const E3 = await ev('E3 archived', { archived: true })
const EX = await ev('Other org event', { orgId: org2, by: U.owner2 })
await sup(`SET session_replication_role = origin`)

const assign = (caller, e, target) => err(caller, `SELECT assign_event_manager($1,$2)`, [e, target])
const unassign = (caller, e, target) => err(caller, `SELECT unassign_event_manager($1,$2)`, [e, target])
const team = async (e) => (await sup(`SELECT user_id FROM event_team WHERE event_id=$1`, [e])).rows.map((r) => r.user_id)
const seesEvents = async (u) => (await as(u, `SELECT id FROM events WHERE organization_id=$1`, [org])).rows.map((r) => r.id)
const canManage = async (u, e) => (await as(u, `SELECT can_manage_event($1) AS ok`, [e])).rows[0].ok

// ---- a manager with no assignment reaches nothing -------------------------
ok('unassigned manager sees no organization event', (await seesEvents(U.m1)).length === 0)
ok('unassigned manager cannot manage E1', (await canManage(U.m1, E1)) === false)

// ---- who may assign -------------------------------------------------------
ok('manager cannot assign themselves', (await assign(U.m1, E1, U.m1)) !== null && (await team(E1)).length === 0)
ok('manager cannot assign another manager', (await assign(U.m1, E1, U.m2)) !== null && (await team(E1)).length === 0)
ok('outsider cannot assign', (await assign(U.outsider, E1, U.m1)) !== null && (await team(E1)).length === 0)
ok('admin of another organization cannot assign here', (await assign(U.owner2, E1, U.m1)) !== null && (await team(E1)).length === 0)
ok('admin assigns a manager', (await assign(U.admin, E1, U.m1)) === null && (await team(E1)).join() === U.m1)
ok('owner assigns a manager', (await assign(U.owner, E2, U.m2)) === null && (await team(E2)).join() === U.m2)
ok('assigning twice is harmless (one row)', (await assign(U.admin, E1, U.m1)) === null && (await team(E1)).length === 1)
ok('assigned_by records the caller', (await sup(`SELECT assigned_by FROM event_team WHERE event_id=$1`, [E1])).rows[0].assigned_by === U.admin)

// ---- what is refused ------------------------------------------------------
ok('archived event refused', /archived/.test((await assign(U.admin, E3, U.m1)) ?? '') && (await team(E3)).length === 0)
ok('owner target refused', /Only event managers/.test((await assign(U.admin, E1, U.owner)) ?? ''))
ok('admin target refused', /Only event managers/.test((await assign(U.owner, E1, U.admin)) ?? ''))
ok('non-member target refused', /not a member/.test((await assign(U.admin, E1, U.outsider)) ?? ''))
ok('event in another organization refused', (await assign(U.admin, EX, U.m1)) !== null && (await team(EX)).length === 0)
ok('unknown event refused', (await assign(U.admin, crypto.randomUUID(), U.m1)) !== null)

// ---- what assignment grants -----------------------------------------------
ok('assigned manager sees exactly the assigned event', (await seesEvents(U.m1)).join() === E1, JSON.stringify(await seesEvents(U.m1)))
ok('assigned manager can manage E1', (await canManage(U.m1, E1)) === true)
ok('...but not an unassigned event (E2)', (await canManage(U.m1, E2)) === false)
ok('...and not an event of another organization', (await canManage(U.m1, EX)) === false)
ok('the other manager sees only theirs (the draft)', (await seesEvents(U.m2)).join() === E2)
const counts = (await as(U.m1, `SELECT event_id FROM organization_event_counts($1)`, [org])).rows.map((r) => r.event_id)
ok('org-wide counts cover only the assigned event', counts.join() === E1, JSON.stringify(counts))

// ---- event_team_list ------------------------------------------------------
ok('admin can list the event team', (await as(U.admin, `SELECT * FROM event_team_list($1)`, [E1])).rows.map((r) => r.user_id).join() === U.m1)
ok('assigned manager can list their event team', (await as(U.m1, `SELECT * FROM event_team_list($1)`, [E1])).rows.length === 1)
ok('manager not assigned to E2 cannot list it', /do not manage/.test((await err(U.m1, `SELECT * FROM event_team_list($1)`, [E2])) ?? ''))
ok('outsider cannot list', (await err(U.outsider, `SELECT * FROM event_team_list($1)`, [E1])) !== null)

// ---- removing -------------------------------------------------------------
ok('manager cannot unassign', (await unassign(U.m1, E1, U.m1)) !== null && (await team(E1)).length === 1)
ok('outsider cannot unassign', (await unassign(U.outsider, E1, U.m1)) !== null && (await team(E1)).length === 1)
ok('admin unassigns', (await unassign(U.admin, E1, U.m1)) === null && (await team(E1)).length === 0)
ok('unassigning someone not assigned is harmless', (await unassign(U.admin, E1, U.m1)) === null)
ok('access disappears with the assignment', (await seesEvents(U.m1)).length === 0 && (await canManage(U.m1, E1)) === false)

// removal still works once the event is archived
await assign(U.admin, E1, U.m1)
await sup(`UPDATE events SET archived_at = now() WHERE id=$1`, [E1])
ok('an assignment on a now-archived event can still be removed', (await unassign(U.admin, E1, U.m1)) === null && (await team(E1)).length === 0)
await sup(`UPDATE events SET archived_at = NULL WHERE id=$1`, [E1])

// ---- a manager who leaves the organization loses an old assignment -------
await assign(U.admin, E1, U.m1)
await sup(`DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2`, [org, U.m1])
ok('a stale assignment grants nothing after leaving the organization', (await canManage(U.m1, E1)) === false)

// ---- grants ----------------------------------------------------------------
for (const f of ['assign_event_manager(uuid,uuid)', 'unassign_event_manager(uuid,uuid)', 'event_team_list(uuid)']) {
  const p = async (role) => (await sup(`SELECT has_function_privilege($1, $2, 'EXECUTE') ok`, [role, `public.${f}`])).rows[0].ok
  ok(`${f}: authenticated yes, anon no`, (await p('authenticated')) && !(await p('anon')))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
