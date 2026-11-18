// Archiving and restoring an event is an owner/admin act (migration 20261029000000):
// owners and admins may archive and restore; an assigned manager keeps every other
// right on the event but may not archive or restore it, however the request is made;
// unassigned managers, other organizations, suspended accounts and anonymous callers
// change nothing; the existing archived-event rules still hold. Runs on PGlite; see
// boot.mjs for what that does and does not prove.
import fs from 'node:fs'
import path from 'node:path'
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
// null when the statement succeeded, else the error message.
async function err(uid, sql, params = [], role) {
  try { await as(uid, sql, params, role); return null } catch (e) { return String(e.message) }
}
// Rows the statement actually changed (RLS hides rows silently).
async function changed(uid, sql, params = [], role) {
  return (await as(uid, sql, params, role)).rows.length
}
const sup = (sql, params = []) => db.query(sql, params)
const user = async (email) => (await sup(`INSERT INTO auth.users (id,email) VALUES (gen_random_uuid(),$1) RETURNING id`, [email])).rows[0].id
const archivedAt = async (e) => (await sup(`SELECT archived_at FROM events WHERE id=$1`, [e])).rows[0].archived_at
const field = async (e, col) => (await sup(`SELECT ${col} AS v FROM events WHERE id=$1`, [e])).rows[0].v

// ---- seed -----------------------------------------------------------------
const U = {}
for (const n of ['owner', 'admin', 'm1', 'm2', 'suspAdmin', 'suspMgr', 'suspOwner', 'owner2']) U[n] = await user(`${n}@t.test`)
await sup(`UPDATE user_accounts SET account_type='organizer' WHERE user_id = ANY($1)`, [[U.owner, U.owner2]])
const mkOrg = async (name, creator) =>
  (await sup(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1,'organizer','approved',$2) RETURNING id`, [name, creator])).rows[0].id
const org = await mkOrg('Org', U.owner)
const org2 = await mkOrg('Other Org', U.owner2)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, U.owner])
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org2, U.owner2])
await sup(`SET session_replication_role = replica`)
for (const [u, r] of [['admin', 'admin'], ['m1', 'manager'], ['m2', 'manager'], ['suspAdmin', 'admin'], ['suspMgr', 'manager'], ['suspOwner', 'owner']]) {
  await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [org, U[u], r])
}
const ev = async (name, { orgId = org, by = U.owner } = {}) =>
  (await sup(
    `INSERT INTO events (name, description, status, visibility, organization_id, created_by, start_date, end_date)
     VALUES ($1,'original','upcoming','draft',$2,$3,'2030-01-01','2030-01-02') RETURNING id`,
    [name, orgId, by])).rows[0].id
const E1 = await ev('E1')
const E2 = await ev('E2')
const E3 = await ev('E3')
await sup(`SET session_replication_role = origin`)

// Managers get their events the supported way, through the assignment RPC.
for (const [e, m] of [[E1, 'm1'], [E2, 'm1'], [E3, 'm1'], [E1, 'suspMgr']]) {
  const e1 = await err(U.owner, `SELECT assign_event_manager($1,$2)`, [e, U[m]])
  if (e1) { console.log('SEED FAILED', e1); process.exit(1) }
}
await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id = ANY($1)`, [[U.suspAdmin, U.suspMgr, U.suspOwner]])

const ARCHIVE = `UPDATE events SET archived_at = now() WHERE id = $1 RETURNING id`
const RESTORE = `UPDATE events SET archived_at = NULL WHERE id = $1 RETURNING id`
const REFUSED = /Only an organization owner or admin can archive or restore an event/

// ---- owners and admins ----------------------------------------------------
ok('owner archives an event', (await err(U.owner, ARCHIVE, [E1])) === null && (await archivedAt(E1)) !== null)
ok('owner restores it', (await err(U.owner, RESTORE, [E1])) === null && (await archivedAt(E1)) === null)
ok('admin archives an event', (await err(U.admin, ARCHIVE, [E1])) === null && (await archivedAt(E1)) !== null)
ok('admin restores it', (await err(U.admin, RESTORE, [E1])) === null && (await archivedAt(E1)) === null)

// ---- the assigned manager -------------------------------------------------
{
  const e = await err(U.m1, ARCHIVE, [E1])
  ok('assigned manager cannot archive (refused, in words)', REFUSED.test(e ?? ''), e)
  ok('...and the event is still unarchived', (await archivedAt(E1)) === null)
}
{
  await err(U.owner, ARCHIVE, [E3])
  const e = await err(U.m1, RESTORE, [E3])
  ok('assigned manager cannot restore (refused, in words)', REFUSED.test(e ?? ''), e)
  ok('...and the event is still archived', (await archivedAt(E3)) !== null)
}
{
  const e = await err(U.m1, `UPDATE events SET description='sneaky', archived_at=now() WHERE id=$1`, [E1])
  ok('archiving cannot ride along with an ordinary edit', REFUSED.test(e ?? '') && (await field(E1, 'description')) === 'original' && (await archivedAt(E1)) === null, e)
}
{
  const e = await err(U.m1, `UPDATE events SET archived_at = '2031-01-01' WHERE id=$1`, [E3])
  ok('assigned manager cannot re-stamp an archived event either', REFUSED.test(e ?? ''), e)
}
ok('assigned manager can still edit the details',
  (await changed(U.m1, `UPDATE events SET description='edited by manager', location='Accra' WHERE id=$1 RETURNING id`, [E1])) === 1
  && (await field(E1, 'description')) === 'edited by manager')
ok('assigned manager can still publish', (await err(U.m1, `UPDATE events SET visibility='published' WHERE id=$1`, [E1])) === null && (await field(E1, 'visibility')) === 'published')
ok('assigned manager can still mark it live', (await err(U.m1, `UPDATE events SET status='live' WHERE id=$1`, [E1])) === null && (await field(E1, 'status')) === 'live')
ok('assigned manager can still mark it finished', (await err(U.m1, `UPDATE events SET status='past' WHERE id=$1`, [E1])) === null && (await field(E1, 'status')) === 'past')
ok('naming archived_at without changing it is not an archive (manager edit passes)',
  (await err(U.m1, `UPDATE events SET name='E2 renamed', archived_at=NULL WHERE id=$1`, [E2])) === null && (await field(E2, 'name')) === 'E2 renamed')
ok('assigned manager still runs the agenda', (await err(U.m1, `INSERT INTO event_sessions (event_id, title, start_at) VALUES ($1,'Keynote','2030-01-01T09:00:00Z')`, [E2])) === null)

// ---- people who could not manage the event at all -------------------------
ok('unassigned manager cannot edit it (no rows)', (await changed(U.m2, `UPDATE events SET description='x' WHERE id=$1 RETURNING id`, [E2])) === 0)
ok('unassigned manager cannot archive it (no rows, unchanged)', (await changed(U.m2, ARCHIVE, [E2])) === 0 && (await archivedAt(E2)) === null)
ok('owner of another organization cannot archive it', (await changed(U.owner2, ARCHIVE, [E2])) === 0 && (await archivedAt(E2)) === null)
ok('anonymous caller cannot archive it', (await err(null, ARCHIVE, [E2], 'anon')) !== null || (await archivedAt(E2)) === null)
ok('...and it is still unarchived', (await archivedAt(E2)) === null)

// ---- suspended accounts ---------------------------------------------------
// The events UPDATE policy already requires account_is_active(), so these are
// stopped before the trigger: nothing matches, nothing changes.
ok('suspended admin cannot archive (no rows, unchanged)', (await changed(U.suspAdmin, ARCHIVE, [E2])) === 0 && (await archivedAt(E2)) === null)
ok('suspended admin cannot restore (no rows, unchanged)', (await changed(U.suspAdmin, RESTORE, [E3])) === 0 && (await archivedAt(E3)) !== null)
ok('suspended assigned manager cannot edit (no rows, unchanged)', (await changed(U.suspMgr, `UPDATE events SET description='y' WHERE id=$1 RETURNING id`, [E1])) === 0 && (await field(E1, 'description')) === 'edited by manager')

// The trigger's own check, with RLS out of the way — what any future path that
// skips the policy (a SECURITY DEFINER function, say) would meet. Run as the
// table owner with the caller's identity set, so only the trigger decides.
async function bypassingRls(uid, sql, params) {
  await sup(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { await sup(sql, params); return null } catch (x) { return String(x.message) } finally {
    await sup(`SELECT set_config('request.jwt.claims', '', false)`)
  }
}
{
  const e = await bypassingRls(U.suspAdmin, ARCHIVE, [E2])
  ok('trigger refuses a suspended admin even past RLS', REFUSED.test(e ?? '') && (await archivedAt(E2)) === null, e)
}
{
  const e = await bypassingRls(U.m1, ARCHIVE, [E2])
  ok('trigger refuses an assigned manager even past RLS', REFUSED.test(e ?? '') && (await archivedAt(E2)) === null, e)
}
{
  const e = await bypassingRls(U.owner2, ARCHIVE, [E2])
  ok('trigger refuses another organization\'s owner even past RLS', REFUSED.test(e ?? '') && (await archivedAt(E2)) === null, e)
}
{
  await sup(`UPDATE user_accounts SET status='active' WHERE user_id=$1`, [U.suspAdmin])
  ok('the same admin, reactivated, may archive again', (await err(U.suspAdmin, ARCHIVE, [E2])) === null && (await archivedAt(E2)) !== null)
  await err(U.suspAdmin, RESTORE, [E2])
  await sup(`UPDATE user_accounts SET status='suspended' WHERE user_id=$1`, [U.suspAdmin])
}

// ---- existing archived-event rules still hold -----------------------------
{
  const e = await err(U.owner, `UPDATE events SET archived_at=NULL, name='renamed while restoring' WHERE id=$1`, [E3])
  ok('owner restoring must make it the only change (existing rule)', /Restore this event before making other changes/.test(e ?? '') && (await archivedAt(E3)) !== null, e)
}
{
  const e = await err(U.m1, `UPDATE events SET description='edit while archived' WHERE id=$1`, [E3])
  ok('an archived event stays frozen for its manager (existing rule)', /archived/i.test(e ?? '') && (await field(E3, 'description')) === 'original', e)
}
{
  const e = await err(U.m1, `INSERT INTO event_sessions (event_id, title, start_at) VALUES ($1,'Late','2030-01-01T10:00:00Z')`, [E3])
  ok('an archived event refuses new sessions (existing rule)', e !== null, e)
}
ok('owner can then restore it on its own', (await err(U.owner, RESTORE, [E3])) === null && (await archivedAt(E3)) === null)

// ---- who is exempt and who is not: database sessions -----------------------
// How a caller is identified on Supabase (read from the project's auth schema):
// auth.uid() = request.jwt.claim.sub or request.jwt.claims->>'sub'; auth.jwt() is
// NULL when no claims are set; API requests log in as `authenticator` and SET ROLE
// to the JWT's role; an administrative session logs in as a database role
// (postgres) and carries no claims. These cases run as postgres, with RLS bypassed,
// so only the trigger decides. The API cases are at the end of the file (PGlite
// cannot switch the session user back once it has been changed).
async function direct(sql, params = [], { claims = null, legacyRole = null } = {}) {
  if (claims) await sup(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
  if (legacyRole) await sup(`SELECT set_config('request.jwt.claim.role', $1, false)`, [legacyRole])
  try { await sup(sql, params); return null } catch (x) { return String(x.message) } finally {
    await sup(`SELECT set_config('request.jwt.claims', '', false)`)
    await sup(`SELECT set_config('request.jwt.claim.role', '', false)`)
  }
}
const archived3 = async () => (await archivedAt(E3)) !== null

ok('administrative session, no JWT claims at all (SQL editor / migrations / cron): may archive', (await direct(ARCHIVE, [E3])) === null && await archived3())
ok('...and restore', (await direct(RESTORE, [E3])) === null && !(await archived3()))
ok('administrative session with an empty claims object counts as no claims', (await direct(ARCHIVE, [E3], { claims: {} })) === null && await archived3())
await direct(RESTORE, [E3])
{
  const e = await direct(ARCHIVE, [E3], { claims: { role: 'service_role' } })
  ok('service-role claims with no user: exempt', e === null && await archived3(), e)
  await direct(RESTORE, [E3])
}
{
  const e = await direct(ARCHIVE, [E3], { claims: { role: 'service_role', sub: U.m1 } })
  ok('service-role claims carrying a manager\'s identity: refused', REFUSED.test(e ?? '') && !(await archived3()), e)
}
{
  const e = await direct(ARCHIVE, [E3], { claims: { role: 'service_role', sub: U.owner } })
  ok('service-role claims carrying an owner\'s identity: allowed', e === null && await archived3(), e)
  await direct(RESTORE, [E3])
}
{
  const e = await direct(ARCHIVE, [E3], { claims: { role: 'anon' } })
  ok('anonymous claims with RLS bypassed: refused (was exempt before)', REFUSED.test(e ?? '') && !(await archived3()), e)
}
{
  const e = await direct(ARCHIVE, [E3], { claims: { role: 'authenticated' } })
  ok('authenticated claims without a user, RLS bypassed: refused (was exempt before)', REFUSED.test(e ?? '') && !(await archived3()), e)
}
{
  const e = await direct(ARCHIVE, [E3], { claims: { iss: 'supabase' } })
  ok('claims present but naming no role and no user: refused', REFUSED.test(e ?? '') && !(await archived3()), e)
}
{
  const e = await direct(ARCHIVE, [E3], { legacyRole: 'anon' })
  ok('legacy request.jwt.claim.role = anon, RLS bypassed: refused', REFUSED.test(e ?? '') && !(await archived3()), e)
}
{
  const e1 = await direct(ARCHIVE, [E3], { claims: { role: 'authenticated', sub: U.suspOwner } })
  ok('suspended owner with RLS bypassed: refused by the trigger', REFUSED.test(e1 ?? '') && !(await archived3()), e1)
  const e2 = await direct(ARCHIVE, [E3], { claims: { role: 'service_role', sub: U.suspAdmin } })
  ok('suspended admin on a service-role token: refused by the trigger', REFUSED.test(e2 ?? '') && !(await archived3()), e2)
}

// A future SECURITY DEFINER function that archives events, reachable by anyone,
// runs as its owner and bypasses RLS: the trigger must still judge the CALLER.
// Created here (needs a superuser); called through the API at the end.
await sup(`CREATE FUNCTION public.zz_test_archive(e uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
           AS $$ UPDATE events SET archived_at = now() WHERE id = e $$`)
await sup(`GRANT EXECUTE ON FUNCTION public.zz_test_archive(uuid) TO anon, authenticated`)

// ---- shape of the change --------------------------------------------------
{
  const t = (await sup(`SELECT tgname, pg_get_triggerdef(t.oid) d FROM pg_trigger t WHERE tgrelid='public.events'::regclass AND NOT tgisinternal ORDER BY 1`)).rows
  const mine = t.find((r) => r.tgname === 'check_event_archive_authority')
  ok('trigger exists: BEFORE UPDATE, row level, only when archived_at changes',
    !!mine && /BEFORE UPDATE ON public\.events FOR EACH ROW WHEN \(\(old\.archived_at IS DISTINCT FROM new\.archived_at\)\)/.test(mine.d), mine?.d)
  ok('the existing write-rules trigger is still in place', t.some((r) => r.tgname === 'check_event_write_rules'))
  const f = (await sup(`SELECT p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') n
    FROM pg_proc p WHERE p.oid = 'public.enforce_event_archive_authority()'::regprocedure`)).rows[0]
  ok('function is SECURITY DEFINER with a pinned search_path', f.prosecdef === true && (f.proconfig ?? []).some((c) => c === 'search_path=public, pg_temp'), JSON.stringify(f))
  ok('function is not executable by anon or authenticated', f.a === false && f.n === false, JSON.stringify(f))
  const pol = (await sup(`SELECT polname, pg_get_expr(polqual, polrelid) q FROM pg_policy WHERE polrelid='public.events'::regclass AND polcmd='w'`)).rows
  ok('the events UPDATE policy is unchanged (can_manage_event AND account_is_active)',
    pol.length === 1 && pol[0].polname === 'update_organization_event' && /can_manage_event\(id\).*account_is_active\(\)/.test(pol[0].q), JSON.stringify(pol))
}
{
  const file = fs.readdirSync(MIG).find((f) => f.startsWith('20261029000000'))
  const e = await (async () => { try { await db.exec(fs.readFileSync(path.join(MIG, file), 'utf8')); return null } catch (x) { return String(x.message) } })()
  const n = Number((await sup(`SELECT count(*) n FROM pg_trigger WHERE tgname='check_event_archive_authority'`)).rows[0].n)
  ok('the migration can be re-run safely (one trigger afterwards)', e === null && n === 1, e)
}


// ---- who is exempt and who is not: through the API (must run LAST) ---------
// PostgREST logs in as `authenticator` and, per request, SET LOCAL ROLE to the
// verified JWT's role with the claims in request.jwt.claims. PGlite cannot return
// to the postgres session user afterwards, so from here on setup and inspection
// go through a service-role request (exempt by design) — nothing after this
// section may use sup().
await sup(`GRANT anon, authenticated, service_role TO authenticator`) // as on Supabase; the STUBS omit it
await db.exec(`SET SESSION AUTHORIZATION authenticator`)
async function api(role, claims, sql, params = []) {
  await db.exec('BEGIN')
  try {
    await db.exec(`SET LOCAL ROLE ${role}`)
    if (claims) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    const r = await db.query(sql, params)
    await db.exec('COMMIT')
    return { rows: r.rows.length, error: null }
  } catch (x) {
    await db.exec('ROLLBACK')
    return { rows: 0, error: String(x.message) }
  }
}
const SVC = { role: 'service_role', iss: 'supabase' }
const apiArchived = async () => {
  await db.exec('BEGIN')
  try {
    await db.exec(`SET LOCAL ROLE service_role`)
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(SVC)])
    return (await db.query(`SELECT archived_at FROM events WHERE id=$1`, [E3])).rows[0].archived_at !== null
  } finally { await db.exec('COMMIT') }
}
const apiRestore = () => api('service_role', SVC, RESTORE, [E3])

ok('session user is now the API login (authenticator)', (await db.query(`SELECT session_user::text s`)).rows[0].s === 'authenticator')
{
  const r = await api('service_role', SVC, ARCHIVE, [E3])
  ok('API: service-role request with no end user is exempt', r.error === null && r.rows === 1 && await apiArchived(), JSON.stringify(r))
  await apiRestore()
}
{
  const r = await api('service_role', { role: 'service_role', sub: U.m1 }, ARCHIVE, [E3])
  ok('API: service-role token carrying a manager\'s identity is refused', REFUSED.test(r.error ?? '') && !(await apiArchived()), JSON.stringify(r))
}
{
  // Service-role code that forwards the user's own token runs as that user.
  const r = await api('authenticated', { role: 'authenticated', sub: U.m1 }, ARCHIVE, [E3])
  ok('API: server code forwarding an assigned manager\'s token is refused', REFUSED.test(r.error ?? '') && !(await apiArchived()), JSON.stringify(r))
}
{
  const r = await api('authenticated', { role: 'authenticated', sub: U.admin }, ARCHIVE, [E3])
  ok('API: active admin may archive', r.error === null && r.rows === 1 && await apiArchived(), JSON.stringify(r))
  const r2 = await api('authenticated', { role: 'authenticated', sub: U.owner }, RESTORE, [E3])
  ok('API: active owner may restore', r2.error === null && r2.rows === 1 && !(await apiArchived()), JSON.stringify(r2))
}
{
  const r = await api('anon', { role: 'anon', iss: 'supabase' }, ARCHIVE, [E3])
  ok('API: anonymous request changes nothing', r.rows === 0 && !(await apiArchived()), JSON.stringify(r))
}
{
  const r = await api('authenticated', { role: 'authenticated' }, ARCHIVE, [E3])
  ok('API: authenticated token without a user changes nothing', r.rows === 0 && !(await apiArchived()), JSON.stringify(r))
}
{
  const r = await api('authenticated', { role: 'authenticated', sub: U.suspOwner }, ARCHIVE, [E3])
  ok('API: suspended owner changes nothing', r.rows === 0 && !(await apiArchived()), JSON.stringify(r))
}
{
  // Missing claims inside the API login is not an administrative session, even in
  // a role that bypasses RLS.
  const r = await api('service_role', null, ARCHIVE, [E3])
  ok('API login with no claims, even as service_role, is refused', REFUSED.test(r.error ?? '') && !(await apiArchived()), JSON.stringify(r))
}
{
  const viaAnon = await api('anon', { role: 'anon' }, `SELECT public.zz_test_archive($1)`, [E3])
  ok('API: anonymous caller through a SECURITY DEFINER function is refused', REFUSED.test(viaAnon.error ?? '') && !(await apiArchived()), JSON.stringify(viaAnon))
  const viaNoUser = await api('authenticated', { role: 'authenticated' }, `SELECT public.zz_test_archive($1)`, [E3])
  ok('API: user-less token through a SECURITY DEFINER function is refused', REFUSED.test(viaNoUser.error ?? '') && !(await apiArchived()), JSON.stringify(viaNoUser))
  const viaMgr = await api('authenticated', { role: 'authenticated', sub: U.m1 }, `SELECT public.zz_test_archive($1)`, [E3])
  ok('API: assigned manager through a SECURITY DEFINER function is refused', REFUSED.test(viaMgr.error ?? '') && !(await apiArchived()), JSON.stringify(viaMgr))
  const viaOwner = await api('authenticated', { role: 'authenticated', sub: U.owner }, `SELECT public.zz_test_archive($1)`, [E3])
  ok('API: active owner through a SECURITY DEFINER function is allowed', viaOwner.error === null && await apiArchived(), JSON.stringify(viaOwner))
  await apiRestore()
}
{
  // Event authority itself is unchanged for the assigned manager.
  const r = await api('authenticated', { role: 'authenticated', sub: U.m1 }, `UPDATE events SET description='edited via API' WHERE id=$1 RETURNING id`, [E2])
  ok('API: assigned manager can still edit the event', r.error === null && r.rows === 1, JSON.stringify(r))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
