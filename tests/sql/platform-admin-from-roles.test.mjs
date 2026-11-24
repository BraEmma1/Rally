// Identity PR-2: is_platform_admin() reads platform_roles (20261127000000_platform_admin_from_roles.sql).
//
// The owner approved option 1 (decision D-43, Q-31): an active account AND an active
// platform_admin grant in platform_roles, with no second gate on user_accounts.account_type.
// The S1 sync (account_type -> platform_roles) stays until the platform-role write switch.
//
// How this suite checks it:
//   1. ordering       - the migration is a no-op (not an error) when S1 has not run yet,
//                       because identity-s1-expand.test.mjs replays later migrations first.
//   2. data           - realistic data is seeded BEFORE the migration; no row in any table
//                       changes when it is applied, re-applied or reverted.
//   3. equivalence    - a behaviour matrix (is_platform_admin(), the 7 read-only admin RPCs,
//                       and the 2 policies that call it) for 12 people, captured with the old
//                       definition, after the migration, after the revert script and after
//                       re-applying: all four must be identical.
//   4. lifecycle      - grants and revocations through the real RPCs (set_account_type,
//                       set_account_status) mirror correctly and take effect.
//   5. fail closed    - a missing or revoked grant denies, whatever account_type says.
//   6. tampering      - only the database owner can write platform_roles; the drift check
//                       reports any owner-level tampering.
//   7. escalation     - ordinary users, organization owners and suspended admins cannot grant
//                       themselves anything.
//   8. memberships    - a platform admin still cannot join an organization.
//   9. S1 sync        - the sync triggers and functions are untouched and still mirror.
//  10. the function   - SECURITY DEFINER, owner, pinned search_path, grants, body and comment.
//
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node tests/sql/platform-admin-from-roles.test.mjs [migrations-dir]
import fs from 'node:fs'
import path from 'node:path'
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const S1 = '20261125000000_identity_s1_expand.sql'
const PR2 = '20261127000000_platform_admin_from_roles.sql'
const PR2_SQL = fs.readFileSync(path.join(MIG, PR2), 'utf8')
const REVERT_SQL = fs.readFileSync(path.join(MIG, '..', 'reverts', '20261127000000_platform_admin_from_roles.revert.sql'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
const run = async (db, sql) => { try { await db.exec(sql); return null } catch (e) { return String(e.message) } }

// ---- 1. ordering ------------------------------------------------------------------------
{
  const { db, failures } = await boot(MIG, { skip: [S1] })
  ok('the migration is a no-op, not an error, when S1 has not created platform_roles yet', failures.length === 0, JSON.stringify(failures))
  const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.is_platform_admin()'::regprocedure`)).rows[0].prosrc
  ok('...and leaves is_platform_admin() as it was (no half-applied state)', /account_type/.test(src) && !/platform_roles/.test(src))
  await db.close()
}

// ---- the main database: every migration except PR-2, then realistic data ----------------
const { db, failures } = await boot(MIG, { skip: [PR2] })
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await sup(sql, params))[0]
async function as(uid, sql, params = [], role = 'authenticated') {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [uid ? JSON.stringify({ sub: uid, role }) : ''])
  try { return await db.query(sql, params) } finally {
    await db.exec(`RESET ROLE`)
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`)
  }
}
const err = async (uid, sql, params = [], role = 'authenticated') => { try { await as(uid, sql, params, role); return null } catch (e) { return String(e.message) } }
const classify = (e) => e === null ? 'ok'
  : /platform administrator/i.test(e) ? 'denied: not a platform administrator'
  : /permission denied/i.test(e) ? 'denied: no privilege'
  : 'error: ' + e.split('\n')[0]
const ipa = async (uid) => (await as(uid, `SELECT is_platform_admin() v`)).rows[0].v
const drift = () => sup(`SELECT kind, subject_id FROM identity_s1_drift()`)
const activeGrants = async (uid) => Number((await one(`SELECT count(*) n FROM platform_roles WHERE user_id = $1 AND role = 'platform_admin' AND revoked_at IS NULL`, [uid])).n)
const allGrants = async (uid) => Number((await one(`SELECT count(*) n FROM platform_roles WHERE user_id = $1 AND role = 'platform_admin'`, [uid])).n)

const user = async (email, meta = {}) =>
  (await one(`INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (gen_random_uuid(), $1, now(), $2) RETURNING id`, [email, JSON.stringify(meta)])).id
const setAccount = (uid, type, status = 'active') => sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])

const U = {}
U.admin = await user('admin@pr2.test')
await setAccount(U.admin, 'platform_admin')                       // trigger mirrors a grant
U.adminSusp = await user('admin-suspended@pr2.test')
await setAccount(U.adminSusp, 'platform_admin', 'suspended')
U.adminPending = await user('admin-pending@pr2.test')
await setAccount(U.adminPending, 'platform_admin', 'pending_approval')
U.organizer = await user('organizer@pr2.test', { account_type: 'organizer' })
await sup(`UPDATE user_accounts SET status = 'active', approved_by = $2, approved_at = now() WHERE user_id = $1`, [U.organizer, U.admin])
U.organizerPending = await user('organizer-pending@pr2.test', { account_type: 'organizer' })
U.attendee = await user('attendee@pr2.test')
U.attendeeSusp = await user('attendee-suspended@pr2.test')
await setAccount(U.attendeeSusp, 'attendee', 'suspended')
U.member = await user('member@pr2.test')
U.sponsor = await user('sponsor@pr2.test')
U.vendor = await user('vendor@pr2.test')
U.target = await user('target@pr2.test')
await sup(`SET session_replication_role = replica`)                // a signed-in user with no account row
U.noAccount = (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'no-account@pr2.test', now()) RETURNING id`)).id
await sup(`SET session_replication_role = origin`)

// Account-type changes through the real RPC, as the (old-definition) admin: audit rows exist.
await as(U.admin, `SELECT set_account_type($1, 'sponsor', 'pr2 fixture')`, [U.sponsor])
await as(U.admin, `SELECT set_account_type($1, 'vendor', 'pr2 fixture')`, [U.vendor])

const ORG = (await as(U.organizer, `SELECT create_organizer_organization('PR2 Org') AS id`)).rows[0].id
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'manager')`, [ORG, U.member])
await sup(`SET session_replication_role = replica`)
const EV = (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
  VALUES ('PR2 Event', 'upcoming', 'published', $1, $2, '2030-01-01', '2030-01-02') RETURNING id`, [ORG, U.organizer])).id
await sup(`SET session_replication_role = origin`)

// The pre-PR-2 helper, kept under another name so the old answer can be computed next to the new one.
const OLD_DEF = (await one(`SELECT pg_get_functiondef('public.is_platform_admin()'::regprocedure) d`)).d
const OLD_SRC_MD5 = (await one(`SELECT md5(prosrc) h FROM pg_proc WHERE oid = 'public.is_platform_admin()'::regprocedure`)).h
await db.exec(OLD_DEF.replace('FUNCTION public.is_platform_admin()', 'FUNCTION public._pr2_old_is_platform_admin()'))
await db.exec(`GRANT EXECUTE ON FUNCTION public._pr2_old_is_platform_admin() TO authenticated`)
const oldIpa = async (uid) => (await as(uid, `SELECT _pr2_old_is_platform_admin() v`)).rows[0].v

// ---- 2. data fingerprint ----------------------------------------------------------------
const TRACKED = ['auth.users', 'profiles', 'user_accounts', 'account_type_changes', 'organizations', 'organization_members',
  'organization_invitations', 'events', 'event_partnerships', 'platform_roles', 'organization_capabilities', 'organization_capability_changes']
const fingerprint = async () => {
  const out = {}
  for (const t of TRACKED) out[t] = (await one(`SELECT count(*)::int c, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM ${t} x`))
  return out
}
const SYNC_FNS = ['sync_platform_role', 'sync_organization_capability', 'identity_s1_drift', 'org_has_capability', 'account_is_active']
const syncState = async () => (await sup(`SELECT p.proname, md5(p.prosrc) h FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [SYNC_FNS]))
  .map((r) => r.proname + ':' + r.h).join(',') + '|' + (await sup(`SELECT tgname, tgenabled::text e FROM pg_trigger WHERE tgname IN ('sync_platform_role','sync_organization_capability') ORDER BY 1`))
  .map((r) => r.tgname + '=' + r.e).join(',')

// ---- 3. behaviour matrix ----------------------------------------------------------------
const PEOPLE = [
  ['active platform admin', U.admin], ['suspended platform admin', U.adminSusp], ['pending platform admin', U.adminPending],
  ['organizer (organization owner)', U.organizer], ['pending organizer', U.organizerPending], ['attendee', U.attendee],
  ['suspended attendee', U.attendeeSusp], ['organization manager', U.member], ['sponsor account', U.sponsor],
  ['vendor account', U.vendor], ['signed in, no account row', U.noAccount], ['anonymous', null, 'anon'],
]
const READS = [
  ['admin_activity_series', `SELECT admin_activity_series('accounts') r`, []],
  ['admin_get_event', `SELECT admin_get_event($1) r`, [EV]],
  ['admin_get_organization', `SELECT admin_get_organization($1) r`, [ORG]],
  ['admin_list_events', `SELECT admin_list_events() r`, []],
  ['admin_list_organizations', `SELECT admin_list_organizations() r`, []],
  ['admin_list_users', `SELECT admin_list_users() r`, []],
  ['admin_platform_overview', `SELECT admin_platform_overview() r`, []],
]
const outcome = async (uid, role, sql, params, map) => {
  try { const r = await as(uid, sql, params, role); return map ? map(r) : 'ok' } catch (e) { return classify(String(e.message)) }
}
async function matrix() {
  const out = {}
  for (const [label, uid, role = 'authenticated'] of PEOPLE) {
    const row = { is_platform_admin: await outcome(uid, role, `SELECT is_platform_admin() v`, [], (r) => r.rows[0].v) }
    for (const [name, sql, params] of READS) row[name] = await outcome(uid, role, sql, params)
    row['policy user_accounts.select_own_account'] = await outcome(uid, role, `SELECT count(*)::int n FROM user_accounts`, [], (r) => r.rows[0].n)
    row['policy account_type_changes.select_account_changes_as_admin'] = await outcome(uid, role, `SELECT count(*)::int n FROM account_type_changes`, [], (r) => r.rows[0].n)
    out[label] = row
  }
  return out
}
const diff = (a, b) => {
  const d = []
  for (const k of Object.keys(a)) for (const c of Object.keys(a[k])) if (JSON.stringify(a[k][c]) !== JSON.stringify(b[k]?.[c])) d.push(`${k} / ${c}: ${JSON.stringify(a[k][c])} -> ${JSON.stringify(b[k]?.[c])}`)
  return d
}

const M_before = await matrix()
const F_before = await fingerprint()
const S_before = await syncState()
ok('fixtures: before PR-2, drift is 0 and the active admin holds exactly one active grant', (await drift()).length === 0 && (await activeGrants(U.admin)) === 1)

// Apply PR-2 on top of the seeded data.
const applyErr = await run(db, PR2_SQL)
ok('the migration applies on top of existing data', applyErr === null, applyErr ?? '')
const M_after = await matrix()
const F_after = await fingerprint()
const d1 = diff(M_before, M_after)
ok('equivalence: every person gets the same answer from is_platform_admin(), the 7 admin read RPCs and both policies', d1.length === 0, d1.join('; '))
ok('data: no row in any of the 12 tracked tables changed', JSON.stringify(F_before) === JSON.stringify(F_after), JSON.stringify({ F_before, F_after }))
ok('S1 sync: the sync triggers, sync functions, drift check and account_is_active() are untouched', (await syncState()) === S_before, `${S_before} -> ${await syncState()}`)

// Explicit expectations for the post-PR-2 matrix (not only "same as before").
const totalAccounts = Number((await one(`SELECT count(*) n FROM user_accounts`)).n)
const totalChanges = Number((await one(`SELECT count(*) n FROM account_type_changes`)).n)
const A = M_after['active platform admin']
ok('an active admin with a valid grant is a platform admin', A.is_platform_admin === true)
ok('an active admin with a valid grant can use all 7 admin read RPCs', READS.every(([n]) => A[n] === 'ok'), JSON.stringify(A))
ok('an active admin reads every account and every account-type change through the two policies', A['policy user_accounts.select_own_account'] === totalAccounts && A['policy account_type_changes.select_account_changes_as_admin'] === totalChanges && totalChanges > 0)
for (const [label] of PEOPLE.slice(1)) {
  const r = M_after[label]
  const expectOwn = label === 'signed in, no account row' ? 0 : 1
  const denied = READS.every(([n]) => r[n].startsWith('denied'))
  if (label === 'anonymous') {
    ok('anonymous: no privilege on is_platform_admin(), the admin RPCs or either table', [r.is_platform_admin, ...READS.map(([n]) => r[n]), r['policy user_accounts.select_own_account'], r['policy account_type_changes.select_account_changes_as_admin']].every((v) => v === 'denied: no privilege'), JSON.stringify(r))
  } else {
    ok(`${label}: not a platform admin, denied every admin RPC, sees only its own account row and no account-type changes`,
      r.is_platform_admin === false && denied && r['policy user_accounts.select_own_account'] === expectOwn && r['policy account_type_changes.select_account_changes_as_admin'] === 0, JSON.stringify(r))
  }
}
ok('a suspended admin is denied even though its grant is active', (await activeGrants(U.adminSusp)) === 1 && M_after['suspended platform admin'].is_platform_admin === false)
ok('a pending-approval admin is denied even though its grant is active', (await activeGrants(U.adminPending)) === 1 && M_after['pending platform admin'].is_platform_admin === false)

// ---- revert script, then re-apply ---------------------------------------------------------
const revErr = await run(db, REVERT_SQL)
ok('the revert script applies', revErr === null, revErr ?? '')
ok('...and restores the previous body exactly', (await one(`SELECT md5(prosrc) h FROM pg_proc WHERE oid = 'public.is_platform_admin()'::regprocedure`)).h === OLD_SRC_MD5)
ok('...and clears the comment the migration added', (await one(`SELECT obj_description('public.is_platform_admin()'::regprocedure, 'pg_proc') c`)).c === null)
const d2 = diff(M_before, await matrix())
ok('...and behaviour after the revert equals behaviour before PR-2', d2.length === 0, d2.join('; '))
ok('...and changes no row', JSON.stringify(await fingerprint()) === JSON.stringify(F_before))
const re1 = await run(db, PR2_SQL), re2 = await run(db, PR2_SQL)
ok('the migration re-applies after a revert, and can be re-run', re1 === null && re2 === null, `${re1} / ${re2}`)
const d3 = diff(M_before, await matrix())
ok('...with the same behaviour and no row changed', d3.length === 0 && JSON.stringify(await fingerprint()) === JSON.stringify(F_before), d3.join('; '))
ok('...and the S1 sync is still untouched', (await syncState()) === S_before)

// ---- 4. lifecycle through the real RPCs ---------------------------------------------------
const T = U.target
let e = await err(U.admin, `SELECT set_account_type($1, 'platform_admin', 'pr2: grant')`, [T])
ok('an admin grants the platform-admin type through set_account_type', e === null, e ?? '')
ok('...the S1 trigger mirrors exactly one active grant', (await activeGrants(T)) === 1)
ok('...and the new admin is a platform admin, old and new definitions agreeing', (await ipa(T)) === true && (await oldIpa(T)) === true)
ok('...and can use an admin RPC', (await err(T, `SELECT admin_list_users()`)) === null)
e = await err(U.admin, `SELECT set_account_type($1, 'attendee', 'pr2: revoke')`, [T])
ok('revoking the type through set_account_type revokes the grant (kept as history, not deleted)', e === null && (await activeGrants(T)) === 0 && (await allGrants(T)) === 1, e ?? '')
ok('...and removes platform administration at once', (await ipa(T)) === false && classify(await err(T, `SELECT admin_list_users()`)) === 'denied: not a platform administrator')
await as(U.admin, `SELECT set_account_type($1, 'platform_admin', 'pr2: grant again')`, [T])
ok('granting again adds a new active grant beside the revoked one', (await activeGrants(T)) === 1 && (await allGrants(T)) === 2 && (await ipa(T)) === true)
await as(U.admin, `SELECT set_account_status($1, 'suspended', 'pr2: suspend')`, [T])
ok('suspending the account denies platform administration although the grant stays active', (await activeGrants(T)) === 1 && (await ipa(T)) === false && classify(await err(T, `SELECT admin_platform_overview()`)) === 'denied: not a platform administrator')
await as(U.admin, `SELECT set_account_status($1, 'active', 'pr2: reactivate')`, [T])
ok('reactivating restores it', (await ipa(T)) === true)
await as(U.admin, `SELECT set_account_type($1, 'attendee', 'pr2: cleanup')`, [T])
ok('after the lifecycle, drift is 0', (await drift()).length === 0)

// ---- 5. fail closed -------------------------------------------------------------------------
// (a) A revoked grant, behind an account_type that still says platform_admin.
await sup(`UPDATE platform_roles SET revoked_at = now(), revoke_reason = 'pr2 test: revoked behind the old column' WHERE user_id = $1 AND revoked_at IS NULL`, [U.admin])
ok('a revoked grant denies, although account_type still says platform_admin (the old definition would allow)', (await ipa(U.admin)) === false && (await oldIpa(U.admin)) === true)
ok('...through every admin read RPC', (await Promise.all(READS.map(([, sql, params]) => err(U.admin, sql, params)))).every((x) => classify(x) === 'denied: not a platform administrator'))
ok('...and through the write RPCs', classify(await err(U.admin, `SELECT set_account_type($1, 'vendor', 'x')`, [U.attendee])) === 'denied: not a platform administrator' && classify(await err(U.admin, `SELECT set_account_status($1, 'suspended', 'x')`, [U.attendee])) === 'denied: not a platform administrator')
ok('...and through both policies (own row only, no account-type changes)', (await as(U.admin, `SELECT count(*)::int n FROM user_accounts`)).rows[0].n === 1 && (await as(U.admin, `SELECT count(*)::int n FROM account_type_changes`)).rows[0].n === 0)
ok('...and the drift check reports the platform_admin account without an active grant', (await drift()).some((d) => d.subject_id === U.admin && /platform_admin without/.test(d.kind)))
await sup(`INSERT INTO platform_roles (user_id, role, granted_by, grant_reason) VALUES ($1, 'platform_admin', NULL, 'pr2 test: restore')`, [U.admin])
ok('restoring an active grant restores access', (await ipa(U.admin)) === true && (await drift()).length === 0)

// (b) A missing grant: the account says platform_admin but no grant was ever written
//     (set behind the trigger's back, as an owner-level change would).
U.legacyOnly = await user('legacy-only@pr2.test')
await sup(`SET session_replication_role = replica`)
await sup(`UPDATE user_accounts SET account_type = 'platform_admin' WHERE user_id = $1`, [U.legacyOnly])
await sup(`SET session_replication_role = origin`)
ok('a missing grant: the old account classification alone grants nothing', (await allGrants(U.legacyOnly)) === 0 && (await oldIpa(U.legacyOnly)) === true && (await ipa(U.legacyOnly)) === false)
ok('...no admin read RPC, write RPC or policy opens up', (await Promise.all(READS.map(([, sql, params]) => err(U.legacyOnly, sql, params)))).every((x) => classify(x) === 'denied: not a platform administrator')
  && classify(await err(U.legacyOnly, `SELECT set_account_type($1, 'vendor', 'x')`, [U.attendee])) === 'denied: not a platform administrator'
  && (await as(U.legacyOnly, `SELECT count(*)::int n FROM user_accounts`)).rows[0].n === 1)
ok('...and the drift check reports it', (await drift()).some((d) => d.subject_id === U.legacyOnly))
await sup(`SET session_replication_role = replica`)
await sup(`UPDATE user_accounts SET account_type = 'attendee' WHERE user_id = $1`, [U.legacyOnly])
await sup(`SET session_replication_role = origin`)

// ---- 6. tampering (database owner only) ------------------------------------------------------
await sup(`INSERT INTO platform_roles (user_id, role, grant_reason) VALUES ($1, 'platform_admin', 'pr2 test: owner-level tamper')`, [U.attendee])
ok('platform_roles is now authoritative: an owner-written grant makes an attendee a platform admin (option 1, no account_type gate)', (await ipa(U.attendee)) === true && (await oldIpa(U.attendee)) === false)
ok('...and the drift check reports that grant as having no platform_admin account', (await drift()).some((d) => d.subject_id === U.attendee && /active grant without/.test(d.kind)))
await sup(`UPDATE platform_roles SET revoked_at = now(), revoke_reason = 'pr2 test: cleanup' WHERE user_id = $1 AND revoked_at IS NULL`, [U.attendee])
ok('...revoking that grant ends it', (await ipa(U.attendee)) === false && (await drift()).length === 0)

// ---- 7. escalation: nobody but the database owner can write a grant ---------------------------
const ESCALATORS = [['attendee', U.attendee], ['organization owner', U.organizer], ['suspended admin', U.adminSusp], ['organization manager', U.member]]
for (const [label, uid] of ESCALATORS) {
  const attempts = [
    ['insert a grant', `INSERT INTO platform_roles (user_id, role, grant_reason) VALUES ($1, 'platform_admin', 'self')`, [uid]],
    ['clear a revocation', `UPDATE platform_roles SET revoked_at = NULL, revoke_reason = NULL WHERE user_id = $1`, [uid]],
    ['revoke the real admin', `UPDATE platform_roles SET revoked_at = now(), revoke_reason = 'x' WHERE user_id = $1`, [U.admin]],
    ['delete grants', `DELETE FROM platform_roles`, []],
    ['read grants', `SELECT count(*) FROM platform_roles`, []],
    ['set their own account_type', `UPDATE user_accounts SET account_type = 'platform_admin' WHERE user_id = $1`, [uid]],
    ['insert an account row', `INSERT INTO user_accounts (user_id, account_type, status) VALUES (gen_random_uuid(), 'platform_admin', 'active')`, []],
    ['call the sync trigger function', `SELECT sync_platform_role()`, []],
    ['call the drift check', `SELECT * FROM identity_s1_drift()`, []],
  ]
  const grantsBefore = await allGrants(uid)
  const results = []
  for (const [what, sql, params] of attempts) results.push([what, classify(await err(uid, sql, params))])
  ok(`${label}: every direct attempt to write, read or forge a grant is refused for lack of privilege`, results.every(([, r]) => r === 'denied: no privilege'), JSON.stringify(results.filter(([, r]) => r !== 'denied: no privilege')))
  ok(`${label}: cannot make itself a platform admin through set_account_type or reactivate through set_account_status`,
    classify(await err(uid, `SELECT set_account_type($1, 'platform_admin', 'self')`, [uid])) === 'denied: not a platform administrator'
    && classify(await err(uid, `SELECT set_account_status($1, 'active', 'self')`, [uid])) === 'denied: not a platform administrator')
  ok(`${label}: is still not a platform admin, and its grants are exactly what they were`, (await ipa(uid)) === false && (await allGrants(uid)) === grantsBefore)
}
ok('an active admin still cannot change its own account type (existing rule)', /your own account type/i.test(await err(U.admin, `SELECT set_account_type($1, 'attendee', 'self')`, [U.admin]) ?? '') && (await ipa(U.admin)) === true)
ok('the real admin\'s grant survived every attempt', (await activeGrants(U.admin)) === 1 && (await ipa(U.admin)) === true)

// ---- 8. organization membership protections (still enforced; switch to platform_roles is PR-3) --
let memErr = null
try { await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')`, [ORG, U.admin]) } catch (x) { memErr = String(x.message) }
ok('a platform admin still cannot be inserted as an organization member, even by the database owner', /platform administrator/i.test(memErr ?? ''), memErr ?? 'inserted')
ok('an organization owner still cannot invite a platform admin', /platform administrator/i.test(await err(U.organizer, `SELECT invite_organization_member($1, 'admin@pr2.test', 'manager')`, [ORG]) ?? ''))
ok('membership in an organization gives no platform administration (owner and manager denied above)', M_after['organizer (organization owner)'].is_platform_admin === false && M_after['organization manager'].is_platform_admin === false)

// ---- 9. S1 sync still intact at the end ---------------------------------------------------------
ok('both S1 sync triggers exist and are enabled', (await sup(`SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('sync_platform_role','sync_organization_capability') AND tgenabled = 'O'`))[0].n === 2)
ok('no client role holds a privilege on platform_roles', (await sup(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'platform_roles' AND grantee IN ('anon','authenticated','PUBLIC')`))[0].n === 0)
ok('drift is 0 at the end', (await drift()).length === 0, JSON.stringify(await drift()))

// ---- 10. the function itself --------------------------------------------------------------------
const fn = await one(`SELECT p.prosecdef, pg_get_userbyid(p.proowner) owner, p.provolatile, p.proconfig::text cfg, p.prosrc,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') n,
  EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') pub,
  obj_description(p.oid, 'pg_proc') c
  FROM pg_proc p WHERE p.oid = 'public.is_platform_admin()'::regprocedure`)
ok('SECURITY DEFINER, owned by postgres, STABLE, search_path pinned to public, pg_temp', fn.prosecdef && fn.owner === 'postgres' && fn.provolatile === 's' && /search_path=public, pg_temp/.test(fn.cfg), JSON.stringify(fn))
ok('EXECUTE: signed-in users yes; anon and PUBLIC no (unchanged)', fn.a === true && fn.n === false && fn.pub === false)
ok('the body requires an active account and an unrevoked platform_admin grant', /account_is_active\(\)/.test(fn.prosrc) && /platform_roles/.test(fn.prosrc) && /revoked_at IS NULL/.test(fn.prosrc) && /'platform_admin'/.test(fn.prosrc))
ok('the body no longer reads user_accounts.account_type (no second gate, option 1)', !/account_type/.test(fn.prosrc) && !/user_accounts/.test(fn.prosrc))
ok('the function carries a comment explaining its source of truth', /platform_roles/.test(fn.c ?? ''))
ok('the 10 callers and 2 policies are unchanged by the migration (still call is_platform_admin())',
  Number((await one(`SELECT count(*) n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname <> 'is_platform_admin' AND proname NOT LIKE '\\_pr2%' AND prosrc ~ 'is_platform_admin\\s*\\('`)).n) === 10
  && Number((await one(`SELECT count(*) n FROM pg_policies WHERE (coalesce(qual,'') || coalesce(with_check,'')) ~ 'is_platform_admin'`)).n) === 2)

await db.exec(`DROP FUNCTION public._pr2_old_is_platform_admin()`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
