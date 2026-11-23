// Sequence privileges (Q-18, identity stage S2-0): migration
// 20261126000000_revoke_capability_history_sequence_grants.sql and its revert script.
//
// Supabase's default privileges give anon, authenticated and service_role USAGE, SELECT
// and UPDATE on every sequence created in public (boot.mjs reproduces them; rally-dev's
// pg_default_acl was checked read-only on 2026-11-23). A client holding them could read
// a sequence (SELECT, currval), advance it (nextval) or reset it (setval). For the
// capability history, a setval back to an earlier value would make the next history
// insert collide on the UNIQUE seq, so the sync trigger, and the organization change that
// fired it, would fail. No exposed function calls nextval or setval today, so this is
// defence in depth (decision log D-33).
//
// No client needs a privilege on that sequence: organization_capability_changes.seq is
// GENERATED ALWAYS AS IDENTITY (Postgres checks no sequence privilege when it generates
// an identity value), and the only writer is sync_organization_capability(), a SECURITY
// DEFINER trigger owned by postgres.
//
// This suite proves:
//   1. detection:   on the schema just before the fix, the check flags exactly anon and
//                   authenticated on this sequence, with rally-dev's exact ACL
//   2. fix:         the migration removes exactly those grants; postgres and service_role
//                   keep theirs
//   3. revert:      the revert script restores the previous ACL exactly; the migration
//                   then re-applies cleanly and is safe to re-run
//   4. ordering:    the migration is a no-op when S1 has not run yet (the S1 suite replays
//                   S1 after every later migration)
//   5. inventory:   with every migration applied, every sequence in public is listed below,
//                   and PUBLIC, anon and authenticated hold no privilege on any of them,
//                   directly or through role membership, unless allow-listed with a reason
//   6. behaviour:   history is still written, in order, by a client-initiated RPC and by a
//                   platform-side status change; direct nextval / setval / currval / reads
//                   are refused to anon and authenticated; drift stays at zero
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import fs from 'node:fs'
import path from 'node:path'
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const S1 = '20261125000000_identity_s1_expand.sql'
const FIX = '20261126000000_revoke_capability_history_sequence_grants.sql'
const REVERT_PATH = path.join(MIG, '..', 'reverts', '20261126000000_revoke_capability_history_sequence_grants.revert.sql')
const SEQ = 'organization_capability_changes_seq_seq'

// ---- the reviewed inventory ------------------------------------------------
// Every sequence in public and the column that owns it. A new sequence fails here until
// it is added in the same PR, with a note on who writes the column.
const SEQUENCES = {
  // Identity stage S1 (20261125000000): orders the capability history. Identity column,
  // written only by sync_organization_capability() (SECURITY DEFINER, owned by postgres).
  [SEQ]: 'organization_capability_changes.seq',
}
// Sequences a client role may hold a privilege on, as { sequence: { role: [privileges], reason } }.
// Empty: no client needs one. An identity column needs none, even for a direct client
// INSERT. A serial / DEFAULT nextval() column that clients INSERT into directly would need
// USAGE (and only USAGE); add it here with its reason in the PR that creates it.
const CLIENT_ALLOWED = {}
const allowed = Object.entries(CLIENT_ALLOWED).flatMap(([seq, { reason, ...roles }]) =>
  Object.entries(roles).flatMap(([role, privs]) => privs.map((p) => `${seq}:${role}:${p}`)))

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
const same = (actual, expected) => {
  const a = new Set(actual), e = new Set(expected)
  const added = [...a].filter((x) => !e.has(x)), removed = [...e].filter((x) => !a.has(x))
  return { same: added.length === 0 && removed.length === 0, detail: JSON.stringify({ added, removed }) }
}

if (!fs.existsSync(path.join(MIG, FIX))) { console.log('FAIL migration file missing:', FIX); process.exit(1) }
if (!fs.existsSync(REVERT_PATH)) { console.log('FAIL revert script missing:', REVERT_PATH); process.exit(1) }
const FIX_SQL = fs.readFileSync(path.join(MIG, FIX), 'utf8')
const REVERT_SQL = fs.readFileSync(REVERT_PATH, 'utf8')

// Every privilege PUBLIC, anon or authenticated hold on a sequence in public, as
// "sequence:role:PRIVILEGE". has_sequence_privilege() also counts PUBLIC grants and
// inherited role memberships; the aclexplode branch names PUBLIC grants explicitly.
const clientPrivileges = async (db) => (await db.query(`
  SELECT c.relname || ':' || r.role || ':' || p.priv AS k
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
  CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
  WHERE n.nspname = 'public' AND c.relkind = 'S' AND has_sequence_privilege(r.role, c.oid, p.priv)
  UNION
  SELECT c.relname || ':PUBLIC:' || a.privilege_type
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
  WHERE n.nspname = 'public' AND c.relkind = 'S' AND a.grantee = 0
  ORDER BY 1`)).rows.map((r) => r.k)

// The sequence's ACL entry by entry ("grantee:PRIVILEGE:grantor:grantable"), so two
// ACLs compare as sets regardless of entry order.
const aclEntries = async (db) => (await db.query(`
  SELECT coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type || ':' || pg_get_userbyid(a.grantor) || ':' || a.is_grantable AS k
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee
  WHERE c.oid = $1::regclass ORDER BY 1`, [`public.${SEQ}`])).rows.map((r) => r.k)

const run = async (db, sql) => { try { await db.exec(sql); return null } catch (e) { return String(e.message) } }
const PRIVS = ['SELECT', 'UPDATE', 'USAGE']
const forRoles = (roles) => roles.flatMap((role) => PRIVS.map((p) => `${SEQ}:${role}:${p}`))

// ---- 1-3: detection, fix, revert, re-run (schema exactly as S1 left it) -----
{
  const { db, failures } = await boot(MIG, { upTo: S1.slice(0, 14) })
  if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

  const before = await aclEntries(db)
  const beforeText = (await db.query(`SELECT relacl::text t FROM pg_class WHERE oid = $1::regclass`, [`public.${SEQ}`])).rows[0].t
  ok('(detection) before the fix, the sequence ACL is the one found on rally-dev',
    beforeText === '{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}', beforeText)
  const flagged = same(await clientPrivileges(db), forRoles(['anon', 'authenticated']))
  ok('(detection) the check flags exactly anon and authenticated USAGE, SELECT and UPDATE on the history sequence', flagged.same, flagged.detail)

  const e1 = await run(db, FIX_SQL)
  ok('the migration applies', e1 === null, e1 ?? '')
  const afterFix = await clientPrivileges(db)
  ok('after the fix, no client role holds any privilege on the history sequence', afterFix.length === 0, JSON.stringify(afterFix))
  const kept = same(await aclEntries(db), before.filter((k) => !/^(anon|authenticated|PUBLIC):/.test(k)))
  ok('the fix removes only the anon and authenticated entries (postgres and service_role untouched)', kept.same, kept.detail)

  const e2 = await run(db, REVERT_SQL)
  ok('the revert script applies', e2 === null, e2 ?? '')
  const restored = same(await aclEntries(db), before)
  ok('the revert script restores the previous ACL exactly (grantee, privilege, grantor, grant option)', restored.same, restored.detail)

  const e3 = await run(db, FIX_SQL)
  const e4 = await run(db, FIX_SQL)
  ok('the migration re-applies after a revert, and can be re-run', e3 === null && e4 === null, `${e3} / ${e4}`)
  ok('after re-applying, no client role holds any privilege on the history sequence', (await clientPrivileges(db)).length === 0)
  await db.close()
}

// ---- 4: ordering (the S1 suite boots every later migration before S1) --------
{
  const { db, failures } = await boot(MIG, { skip: [S1] })
  ok('the migration is a no-op, not an error, when S1 has not created the sequence yet', failures.length === 0, JSON.stringify(failures))
  await db.close()
}

// ---- 5-6: the final schema (every migration) --------------------------------
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }
const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await sup(sql, params))[0]

// Inventory
const seqs = await sup(`
  SELECT c.relname AS seq, pg_get_userbyid(c.relowner) AS owner,
         (SELECT t.relname || '.' || a.attname
            FROM pg_depend d
            JOIN pg_class t ON t.oid = d.refobjid
            JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
           WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
             AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')) AS owned_by
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1`)
console.log(`(info) ${seqs.length} sequence(s) in public: ${seqs.map((s) => `${s.seq} -> ${s.owned_by}`).join(', ')}`)
const inv = same(seqs.map((s) => `${s.seq}=${s.owned_by}`), Object.entries(SEQUENCES).map(([s, col]) => `${s}=${col}`))
ok(`every sequence in public is in the reviewed inventory (${Object.keys(SEQUENCES).length}), with its owning column`, inv.same, inv.detail)
ok('every sequence in public is owned by postgres', seqs.every((s) => s.owner === 'postgres'), JSON.stringify(seqs))

const clientNow = await clientPrivileges(db)
const unexpected = clientNow.filter((k) => !allowed.includes(k))
ok('PUBLIC, anon and authenticated hold no privilege on any sequence in public beyond the allow-list', unexpected.length === 0,
  `${JSON.stringify(unexpected)} -- revoke it in the migration that created the sequence, or allow-list it with a reason`)
const stale = allowed.filter((k) => !clientNow.includes(k))
ok('every allow-listed client privilege still exists (no stale entries)', stale.length === 0, JSON.stringify(stale))

const internal = await one(`SELECT
  has_sequence_privilege('postgres', $1, 'USAGE') AND has_sequence_privilege('postgres', $1, 'SELECT') AND has_sequence_privilege('postgres', $1, 'UPDATE') AS pg,
  has_sequence_privilege('service_role', $1, 'USAGE') AND has_sequence_privilege('service_role', $1, 'SELECT') AND has_sequence_privilege('service_role', $1, 'UPDATE') AS svc,
  has_table_privilege('service_role', 'public.organization_capability_changes', 'SELECT,INSERT') AS svc_table`, [`public.${SEQ}`])
ok('postgres and service_role keep USAGE, SELECT and UPDATE on the history sequence', internal.pg && internal.svc)
ok('service_role keeps its access to the history table itself (unchanged by this migration)', internal.svc_table)

const col = await one(`SELECT a.attidentity, pg_get_serial_sequence('public.organization_capability_changes', 'seq') AS s
  FROM pg_attribute a WHERE a.attrelid = 'public.organization_capability_changes'::regclass AND a.attname = 'seq'`)
ok('seq is still GENERATED ALWAYS AS IDENTITY on this sequence', col.attidentity === 'a' && col.s === `public.${SEQ}`, JSON.stringify(col))

// Behaviour: the history is still written, in order
async function as(uid, sql, params = [], role = 'authenticated') {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role })])
  try { return await db.query(sql, params) } finally {
    await db.exec(`RESET ROLE`)
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`)
  }
}
const err = async (uid, sql, role) => { try { await as(uid, sql, [], role); return null } catch (e) { return String(e.message) } }

const organizer = (await one(`INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (gen_random_uuid(), 'seq.organizer@example.com', now(), '{"account_type":"organizer"}') RETURNING id`)).id
const admin = (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'seq.admin@example.com', now()) RETURNING id`)).id
await sup(`UPDATE user_accounts SET status = 'active', approved_by = $2, approved_at = now() WHERE user_id = $1`, [organizer, admin])
await sup(`UPDATE user_accounts SET account_type = 'platform_admin' WHERE user_id = $1`, [admin])

const maxSeq = async () => Number((await one(`SELECT coalesce(max(seq), 0) AS m FROM organization_capability_changes`)).m)
const seq0 = await maxSeq()
let orgId = null, rpcErr = null
try { orgId = (await as(organizer, `SELECT create_organizer_organization('Sequence Test Org') AS id`)).rows[0].id } catch (e) { rpcErr = String(e.message) }
ok('an organizer can still create an organization through the RPC (history row written on a client-initiated path)', orgId !== null, rpcErr ?? '')

await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: admin, role: 'authenticated' })])
await db.query(`SELECT set_config('rally.allow_org_authority_write', 'on', false)`)
let approveErr = null
try {
  await db.query(`UPDATE organizations SET approval_status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [orgId, admin])
} catch (e) { approveErr = String(e.message) } finally {
  await db.query(`SELECT set_config('rally.allow_org_authority_write', 'off', false)`)
  await db.query(`SELECT set_config('request.jwt.claims', '', false)`)
}
ok('a platform-side approval still succeeds (history row written by the sync trigger)', approveErr === null, approveErr ?? '')

const hist = await sup(`SELECT seq, previous_status::text p, new_status::text s FROM organization_capability_changes WHERE organization_id = $1 ORDER BY seq`, [orgId])
ok('both changes are in the history, in order, after every earlier row',
  hist.length === 2 && hist[0].p === null && hist[0].s === 'pending' && hist[1].p === 'pending' && hist[1].s === 'active'
    && Number(hist[0].seq) > seq0 && Number(hist[1].seq) > Number(hist[0].seq), JSON.stringify(hist))

// Behaviour: no direct access for clients
const ref = `'public.${SEQ}'`
for (const [who, uid, role] of [['anon', null, 'anon'], ['a signed-in user', organizer, 'authenticated']]) {
  const denied = []
  for (const [what, sql] of [
    ['nextval', `SELECT nextval(${ref})`],
    ['setval', `SELECT setval(${ref}, 1)`],
    ['currval', `SELECT currval(${ref})`],
    ['SELECT from the sequence', `SELECT last_value FROM public.${SEQ}`],
    ['pg_sequence_last_value', `SELECT pg_sequence_last_value(${ref}::regclass)`],
  ]) {
    const e = await err(uid, sql, role)
    if (e === null || !/permission denied for sequence/.test(e)) denied.push(`${what}: ${e ?? 'allowed'}`)
  }
  ok(`${who} cannot call nextval, setval or currval, or read the sequence`, denied.length === 0, JSON.stringify(denied))
}
ok('the history sequence was not advanced by the refused calls', Number(hist[1].seq) === await maxSeq()
  && Number((await one(`SELECT last_value FROM public.${SEQ}`)).last_value) === Number(hist[1].seq))

const drift = await sup(`SELECT * FROM identity_s1_drift()`)
ok('identity_s1_drift() is empty', drift.length === 0, JSON.stringify(drift))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
