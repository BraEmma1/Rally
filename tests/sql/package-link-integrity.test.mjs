// Spec A: a partnership's package link is set once, and only to an active package
// (migration 20261128000000_partnership_package_link_integrity).
//
//   0. rows that existed before the migration -- accepted, archived-since and even ones
//      that came through the old gap -- are not changed by it, and stay editable
//   1. creating a partnership with an active package: allowed for the roles that could
//      before; an archived package or another event's package is refused
//   2. apply_partnership_package still links an unlinked partnership; it and a direct
//      UPDATE are refused for an archived package
//   3. replacing or clearing a link is refused, for every role, including service_role
//   4. permissions and privacy are unchanged: same policies, grants and sponsor surface
//   5. event deletion still cascades; a used package still cannot be deleted; the FK's
//      SET NULL action fails closed; the reverse cascade order is refused identically
//      with and without this migration
//   6. the revert script restores the catalog exactly, and the old behaviour with it
//
// Two sessions racing (archive vs link) cannot be shown on PGlite: see
// package-link-concurrency.pg.mjs, which runs on a real PostgreSQL server.
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import fs from 'node:fs'
import path from 'node:path'
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const MIGRATION = path.join(MIG, '20261128000000_partnership_package_link_integrity.sql')
const REVERT = path.resolve(MIG, '../reverts/20261128000000_partnership_package_link_integrity.revert.sql')

// Replay everything BEFORE Spec A, so rows can exist before it arrives.
const { db, failures } = await boot(MIG, { upTo: '20261127999999' })
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
// The error as the client sees it: message and SQLSTATE.
async function attempt(uid, sql, params = [], role) {
  try { await as(uid, sql, params, role); return null } catch (e) { return { message: String(e.message), code: e.code } }
}
// Without parameters this runs as one simple query, so `SET LOCAL ROLE x; ...` applies to it alone.
async function superAttempt(sql, params = []) {
  try { params.length ? await db.query(sql, params) : await db.exec(sql); return null } catch (e) { return { message: String(e.message), code: e.code } }
}
const refused = (e, re = /./, code) => e !== null && re.test(e.message) && (code === undefined || e.code === code)
const show = (e) => JSON.stringify(e)
const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await sup(sql, params))[0]
const n = async (sql, params = []) => Number((await one(sql, params)).n)
const user = async (email) => (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id`, [email])).id
const setAccount = (uid, type, status = 'active') => sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])
const mkOrg = async (name, creator, type = 'organizer') =>
  (await one(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1, $2, 'approved', $3) RETURNING id`, [name, type, creator])).id
const addMember = (org, uid, role) => sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, uid, role])
const mkEvent = async (name, org, by) => {
  await sup(`SET session_replication_role = replica`)
  try {
    return (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
                       VALUES ($1, 'upcoming', 'published', $2, $3, '2030-01-01', '2030-01-02') RETURNING id`, [name, org, by])).id
  } finally { await sup(`SET session_replication_role = origin`) }
}

// Every policy, grant, function, trigger and constraint in public, fingerprinted.
const CATALOG = `
  SELECT 'function' AS kind, p.oid::regprocedure::text AS name,
         md5(replace(pg_get_functiondef(p.oid), chr(13), '')) || ' ' || p.prosecdef || ' ' || coalesce(p.proacl::text, '') || ' ' || coalesce(p.proconfig::text, '') AS fp
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'trigger', t.tgrelid::regclass || '.' || t.tgname, md5(pg_get_triggerdef(t.oid)) || ' ' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
  UNION ALL SELECT 'constraint', conrelid::regclass || '.' || conname, md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'policy', tablename || '.' || policyname, md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL SELECT 'table', c.oid::regclass::text, coalesce(c.relacl::text, '') || ' rls=' || c.relrowsecurity
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'S')
  UNION ALL SELECT 'column grant', a.attrelid::regclass || '.' || a.attname, a.attacl::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL
  ORDER BY 1, 2`
const catalog = async () => new Map((await sup(CATALOG)).map((r) => [r.kind + ' ' + r.name, r.fp]))
const catalogDiff = (a, b) => {
  const added = [...b.keys()].filter((k) => !a.has(k))
  const removed = [...a.keys()].filter((k) => !b.has(k))
  const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k))
  return { added, removed, changed }
}
const BEFORE_CATALOG = await catalog()

// ---- fixtures, created BEFORE the migration --------------------------------
const U = {}
for (const k of ['owner', 'admin', 'manager', 'otherManager', 'owner2', 'attendee', 'sponsorAdmin'])
  U[k] = await user(`${k.toLowerCase()}@link.test`)
await setAccount(U.owner, 'organizer')
await setAccount(U.owner2, 'organizer')
const ORG = await mkOrg('Org', U.owner)
const ORG2 = await mkOrg('Other Org', U.owner2)
const SPONSOR_ORG = await mkOrg('Sponsor Co', U.sponsorAdmin, 'sponsor')
await addMember(ORG, U.admin, 'admin')
await addMember(ORG, U.manager, 'manager')
await addMember(ORG, U.otherManager, 'manager')
const EV_A = await mkEvent('Summit A', ORG, U.owner)
const EV_B = await mkEvent('Summit B', ORG, U.owner)
const EV_OTHER = await mkEvent('Other org event', ORG2, U.owner2)
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV_A, U.manager, U.owner])

const mkPackage = async (ev, name, by = U.owner) =>
  (await as(by, `INSERT INTO event_partnership_packages (event_id, name, value_amount, value_currency) VALUES ($1, $2, 1000, 'GHS') RETURNING id`, [ev, name])).rows[0].id
const mkTemplate = (pkg, ev, title, order) =>
  as(U.owner, `INSERT INTO event_partnership_package_deliverables (package_id, event_id, title, display_order) VALUES ($1, $2, $3, $4)`, [pkg, ev, title, order])
const archive = (pkg) => as(U.owner, `UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [pkg])
const restore = (pkg) => as(U.owner, `UPDATE event_partnership_packages SET archived_at = NULL WHERE id = $1`, [pkg])
const insertLinked = (caller, ev, name, pkg) =>
  as(caller, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, $2, $3) RETURNING id`, [ev, name, pkg])
const tryInsertLinked = (caller, ev, name, pkg, role) =>
  attempt(caller, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, $2, $3) RETURNING id`, [ev, name, pkg], role)
const plain = async (caller, ev, name) =>
  (await as(caller, `INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, $2) RETURNING id`, [ev, name])).rows[0].id
const pkgOf = async (p) => (await one(`SELECT package_id FROM event_partnerships WHERE id = $1`, [p])).package_id
const obligationCount = (p) => n(`SELECT count(*) AS n FROM event_partnership_obligations WHERE partnership_id = $1`, [p])

const GOLD = await mkPackage(EV_A, 'Gold')
await mkTemplate(GOLD, EV_A, 'Logo on backdrop', 0)
await mkTemplate(GOLD, EV_A, 'VIP passes', 1)
const SILVER = await mkPackage(EV_A, 'Silver')
const RETIRED = await mkPackage(EV_A, 'Retired')
const GOLD_B = await mkPackage(EV_B, 'Gold B')
const OTHER_PKG = await mkPackage(EV_OTHER, 'Platinum', U.owner2)

// An accepted agreement: created from Gold, invited, accepted by a sponsor organization.
const EX_ACCEPTED = await plain(U.owner, EV_A, 'Accepted Bank')
await as(U.owner, `SELECT apply_partnership_package($1, $2)`, [EX_ACCEPTED, GOLD])
const inv = (await as(U.owner, `SELECT invite_partnership_representative($1, 'sponsoradmin@link.test') id`, [EX_ACCEPTED])).rows[0].id
await as(U.sponsorAdmin, `SELECT accept_partnership_invitation_with_organization($1, $2)`, [inv, SPONSOR_ORG])
// Linked while Silver was active; Silver archived afterwards (legitimate history).
const EX_SINCE = (await insertLinked(U.owner, EV_A, 'Linked then archived', SILVER)).rows[0].id
await archive(SILVER)
// Came through the old gap: linked while Retired was already archived.
await archive(RETIRED)
const EX_GAP = (await insertLinked(U.owner, EV_A, 'Through the gap', RETIRED)).rows[0].id
const EX_CUSTOM = await plain(U.admin, EV_A, 'Custom Ltd')

const linked = await one(`SELECT status, sponsor_organization_id FROM event_partnerships WHERE id = $1`, [EX_ACCEPTED])
ok('(setup) the accepted agreement is active and linked to its sponsor organization',
  linked.status === 'active' && linked.sponsor_organization_id === SPONSOR_ORG, JSON.stringify(linked))
ok('(setup) before Spec A, the old gap really let an archived package be linked', (await pkgOf(EX_GAP)) === RETIRED)

const ROWS = `SELECT to_jsonb(p) AS r FROM event_partnerships p ORDER BY id`
const OBLIGATIONS = `SELECT to_jsonb(o) AS r FROM event_partnership_obligations o ORDER BY id`
const rowsBefore = JSON.stringify(await sup(ROWS))
const obligationsBefore = JSON.stringify(await sup(OBLIGATIONS))
const workspaceBefore = JSON.stringify((await as(U.sponsorAdmin, `SELECT * FROM my_sponsor_partnerships()`)).rows)

// ---- apply the migration (twice: it must be idempotent) ---------------------
const migrationSql = fs.readFileSync(MIGRATION, 'utf8')
await db.exec(migrationSql)
const AFTER_CATALOG = await catalog()
await db.exec(migrationSql)
ok('the migration applies, and re-applying it changes nothing', catalogDiff(AFTER_CATALOG, await catalog()).changed.length === 0 &&
  catalogDiff(AFTER_CATALOG, await catalog()).added.length === 0)

// ---- 0. existing rows -------------------------------------------------------
ok('the migration changes no partnership row', JSON.stringify(await sup(ROWS)) === rowsBefore)
ok('...and no obligation', JSON.stringify(await sup(OBLIGATIONS)) === obligationsBefore)
ok('the accepted agreement reads the same in the sponsor workspace',
  JSON.stringify((await as(U.sponsorAdmin, `SELECT * FROM my_sponsor_partnerships()`)).rows) === workspaceBefore)
ok('a partnership whose package was archived after linking stays linked', (await pkgOf(EX_SINCE)) === SILVER)
ok('...and so does one that came through the old gap', (await pkgOf(EX_GAP)) === RETIRED)
ok('...and both can still be edited normally',
  (await as(U.owner, `UPDATE event_partnerships SET tier_label = 'Silver (renewed)', value_amount = 900 WHERE id = $1 RETURNING id`, [EX_SINCE])).rows.length === 1 &&
  (await as(U.manager, `UPDATE event_partnerships SET internal_notes = 'Call back' WHERE id = $1 RETURNING id`, [EX_GAP])).rows.length === 1 &&
  (await pkgOf(EX_SINCE)) === SILVER && (await pkgOf(EX_GAP)) === RETIRED)
ok('...including their lifecycle (cancel, then back to draft)',
  (await as(U.owner, `UPDATE event_partnerships SET status = 'cancelled' WHERE id = $1 RETURNING id`, [EX_SINCE])).rows.length === 1 &&
  (await as(U.owner, `UPDATE event_partnerships SET status = 'draft' WHERE id = $1 RETURNING id`, [EX_SINCE])).rows.length === 1)
ok('the accepted agreement can still be edited and completed by its organizer',
  (await as(U.owner, `UPDATE event_partnerships SET tier_label = 'Gold (founding)' WHERE id = $1 RETURNING id`, [EX_ACCEPTED])).rows.length === 1 &&
  (await as(U.owner, `UPDATE event_partnerships SET status = 'completed' WHERE id = $1 RETURNING status`, [EX_ACCEPTED])).rows[0]?.status === 'completed' &&
  (await pkgOf(EX_ACCEPTED)) === GOLD)

// ---- 1. creation --------------------------------------------------------------
const P_OWNER = (await insertLinked(U.owner, EV_A, 'Owner Co', GOLD)).rows[0].id
const P_ADMIN = (await insertLinked(U.admin, EV_A, 'Admin Co', GOLD)).rows[0].id
const P_MGR = (await insertLinked(U.manager, EV_A, 'Manager Co', GOLD)).rows[0].id
ok('an owner, an admin and an assigned manager create partnerships linked to an active package',
  (await pkgOf(P_OWNER)) === GOLD && (await pkgOf(P_ADMIN)) === GOLD && (await pkgOf(P_MGR)) === GOLD)
ok('...and a custom partnership needs no package', (await pkgOf(EX_CUSTOM)) === null && typeof (await plain(U.manager, EV_A, 'Custom 2')) === 'string')

const archivedInsert = await tryInsertLinked(U.owner, EV_A, 'Archived insert', RETIRED)
ok('creating a partnership linked to an archived package is refused', refused(archivedInsert, /archived/), show(archivedInsert))
ok('...as a foreign-key violation naming the package, which the Add Partner wizard maps to "no longer available"',
  refused(archivedInsert, /package/, '23503'), show(archivedInsert))
ok('...even for an assigned manager, or for service_role',
  refused(await tryInsertLinked(U.manager, EV_A, 'Archived insert', RETIRED), /archived/, '23503') &&
  refused(await superAttempt(`SET LOCAL ROLE service_role; INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ('${EV_A}', 'Archived insert', '${RETIRED}')`), /archived/))
await db.exec(`RESET ROLE`)
ok('...and wrote nothing', await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Archived insert'`) === 0)
const mixed = await attempt(U.owner, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Mixed 1', $2), ($1, 'Mixed 2', $3)`, [EV_A, GOLD, RETIRED])
ok('a multi-row insert with one archived package fails as a whole', refused(mixed, /archived/) &&
  await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name LIKE 'Mixed %'`) === 0, show(mixed))

const crossEvent = await tryInsertLinked(U.owner, EV_A, 'Cross', GOLD_B)
ok('another event\'s package is refused by the composite foreign key, as before', refused(crossEvent, /event_partnerships_package_fk/, '23503'), show(crossEvent))
const crossOrg = await tryInsertLinked(U.owner, EV_A, 'Cross', OTHER_PKG)
ok('...and another organization\'s', refused(crossOrg, /event_partnerships_package_fk/, '23503'), show(crossOrg))
const missing = await tryInsertLinked(U.owner, EV_A, 'Missing', '00000000-0000-4000-8000-000000000000')
ok('a package that does not exist is still reported by the foreign key', refused(missing, /event_partnerships_package_fk/, '23503'), show(missing))

await restore(RETIRED)
const P_RESTORED = (await insertLinked(U.owner, EV_A, 'After restore', RETIRED)).rows[0].id
ok('a restored package can be linked again', (await pkgOf(P_RESTORED)) === RETIRED)
await archive(RETIRED)

// ---- 2. apply_partnership_package and first assignment ------------------------
const P_APPLY = await plain(U.manager, EV_A, 'Apply Co')
const copied = (await as(U.manager, `SELECT apply_partnership_package($1, $2) AS n`, [P_APPLY, GOLD])).rows[0].n
ok('apply_partnership_package still links an unlinked partnership and copies its deliverables',
  (await pkgOf(P_APPLY)) === GOLD && Number(copied) === 2 && (await obligationCount(P_APPLY)) === 2)

const P_APPLY_ARCH = await plain(U.owner, EV_A, 'Apply archived')
const applyArch = await attempt(U.owner, `SELECT apply_partnership_package($1, $2)`, [P_APPLY_ARCH, RETIRED])
ok('apply_partnership_package is refused for an archived package', refused(applyArch, /archived/), show(applyArch))
ok('...leaving no link and no copied deliverable', (await pkgOf(P_APPLY_ARCH)) === null && (await obligationCount(P_APPLY_ARCH)) === 0)

const directArch = await attempt(U.owner, `UPDATE event_partnerships SET package_id = $2 WHERE id = $1`, [P_APPLY_ARCH, RETIRED])
ok('a direct UPDATE linking an archived package is refused too (apply was the only check before)',
  refused(directArch, /archived/, '23503') && (await pkgOf(P_APPLY_ARCH)) === null, show(directArch))
const directCross = await attempt(U.owner, `UPDATE event_partnerships SET package_id = $2 WHERE id = $1`, [P_APPLY_ARCH, GOLD_B])
ok('...and so is linking another event\'s package', refused(directCross, /event_partnerships_package_fk/, '23503'), show(directCross))
ok('a direct UPDATE may set the first link to an active package (set once)',
  (await as(U.owner, `UPDATE event_partnerships SET package_id = $2 WHERE id = $1 RETURNING id`, [P_APPLY_ARCH, GOLD])).rows.length === 1 &&
  (await pkgOf(P_APPLY_ARCH)) === GOLD)
const applyAgain = await attempt(U.owner, `SELECT apply_partnership_package($1, $2)`, [P_APPLY, SILVER])
ok('applying a package to a linked partnership is still refused by the function', refused(applyAgain, /already has a package applied/), show(applyAgain))

// ---- 3. replace and clear ------------------------------------------------------
const reassign = (who, p, pkg, role) => attempt(who, `UPDATE event_partnerships SET package_id = $2 WHERE id = $1`, [p, pkg], role)
const r1 = await reassign(U.owner, P_OWNER, SILVER)
ok('replacing a package link with another package is refused', refused(r1, /cannot be changed/), show(r1))
await restore(SILVER)
ok('...also when the new package is active, for an admin and an assigned manager',
  refused(await reassign(U.admin, P_ADMIN, SILVER), /cannot be changed/) && refused(await reassign(U.manager, P_MGR, SILVER), /cannot be changed/))
const c1 = await attempt(U.owner, `UPDATE event_partnerships SET package_id = NULL WHERE id = $1`, [P_OWNER])
ok('clearing a package link is refused', refused(c1, /cannot be removed/), show(c1))
ok('...for the accepted agreement too', refused(await attempt(U.owner, `UPDATE event_partnerships SET package_id = NULL WHERE id = $1`, [EX_ACCEPTED]), /cannot be removed/) &&
  refused(await reassign(U.owner, EX_ACCEPTED, SILVER), /cannot be changed/))
ok('...and for links made before the migration, including through the old gap',
  refused(await attempt(U.owner, `UPDATE event_partnerships SET package_id = NULL WHERE id = $1`, [EX_GAP]), /cannot be removed/) &&
  refused(await reassign(U.owner, EX_SINCE, GOLD), /cannot be changed/))
const svcClear = await superAttempt(`SET LOCAL ROLE service_role; UPDATE event_partnerships SET package_id = NULL WHERE id = '${P_OWNER}'`)
await db.exec(`RESET ROLE`)
const pgSwap = await superAttempt(`UPDATE event_partnerships SET package_id = $2 WHERE id = $1`, [P_OWNER, SILVER])
ok('no role is exempt: service_role cannot clear and the table owner cannot replace',
  refused(svcClear, /cannot be removed/) && refused(pgSwap, /cannot be changed/), show({ svcClear, pgSwap }))
ok('a bulk UPDATE clearing every link is refused as a whole',
  refused(await attempt(U.owner, `UPDATE event_partnerships SET package_id = NULL WHERE event_id = $1`, [EV_A]), /cannot be removed/) &&
  await n(`SELECT count(*) AS n FROM event_partnerships WHERE event_id = $1 AND package_id IS NOT NULL`, [EV_A]) >= 8)
ok('setting a link to the package it already has is not a change',
  (await as(U.owner, `UPDATE event_partnerships SET package_id = package_id, tier_label = 'Gold' WHERE id = $1 RETURNING id`, [P_OWNER])).rows.length === 1)
ok('no setting a caller can change switches the rule off',
  refused(await superAttempt(`SELECT set_config('rally.allow_partnership_link', 'on', false); UPDATE event_partnerships SET package_id = NULL WHERE id = '${P_OWNER}'`), /cannot be removed/))
await sup(`SELECT set_config('rally.allow_partnership_link', '', false)`)
ok('every link above is still what it was', (await pkgOf(P_OWNER)) === GOLD && (await pkgOf(P_ADMIN)) === GOLD &&
  (await pkgOf(EX_ACCEPTED)) === GOLD && (await pkgOf(EX_GAP)) === RETIRED && (await pkgOf(EX_SINCE)) === SILVER)

// ---- 4. permissions and privacy ----------------------------------------------
const d = catalogDiff(BEFORE_CATALOG, AFTER_CATALOG)
ok('the migration adds exactly one function and one trigger, and changes or removes nothing',
  JSON.stringify(d) === JSON.stringify({
    added: ['function enforce_partnership_package_link()', 'trigger event_partnerships.check_partnership_package_link'],
    removed: [], changed: [],
  }), JSON.stringify(d))
const fn = await one(`SELECT p.prosecdef, p.proconfig::text AS cfg,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
  FROM pg_proc p WHERE p.oid = 'public.enforce_partnership_package_link()'::regprocedure`)
ok('the trigger function pins its search_path and no client role may call it',
  fn.prosecdef === true && /search_path=public, pg_temp/.test(fn.cfg) && fn.anon === false && fn.auth === false, JSON.stringify(fn))
const order = (await sup(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'event_partnerships'::regclass AND NOT tgisinternal
  AND tgtype & 2 = 2 AND tgtype & (4 | 16) <> 0 ORDER BY tgname`)).map((r) => r.tgname)
ok('it runs after check_event_partnership_rules, so it sees the row as that leaves it',
  order.indexOf('check_event_partnership_rules') < order.indexOf('check_partnership_package_link') && order.includes('check_event_partnership_rules'), order.join())

ok('an unassigned manager still cannot create a linked partnership', refused(await tryInsertLinked(U.otherManager, EV_A, 'Who', GOLD), /row-level security/))
ok('...nor another organization\'s owner, an attendee or anon',
  refused(await tryInsertLinked(U.owner2, EV_A, 'Who', GOLD), /row-level security/) &&
  refused(await tryInsertLinked(U.attendee, EV_A, 'Who', GOLD), /row-level security/) &&
  refused(await tryInsertLinked(null, EV_A, 'Who', GOLD, 'anon')))
await setAccount(U.manager, 'attendee', 'suspended')
ok('...nor a suspended manager', refused(await tryInsertLinked(U.manager, EV_A, 'Who', GOLD)))
await setAccount(U.manager, 'attendee', 'active')
ok('none of them wrote a row', await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Who'`) === 0)
ok('outsiders still cannot even reach a link to try to change it (RLS hides the row)',
  (await as(U.otherManager, `UPDATE event_partnerships SET package_id = NULL WHERE id = $1 RETURNING id`, [P_OWNER])).rows.length === 0 &&
  (await as(U.sponsorAdmin, `UPDATE event_partnerships SET package_id = NULL WHERE id = $1 RETURNING id`, [EX_ACCEPTED])).rows.length === 0)
ok('a linked sponsor member still sees the accepted agreement, and no package',
  (await as(U.sponsorAdmin, `SELECT * FROM my_sponsor_partnerships()`)).rows.length === 1 &&
  (await as(U.sponsorAdmin, `SELECT id FROM event_partnership_packages`)).rows.length === 0)
const wsCols = (await one(`SELECT pg_get_function_result('public.my_sponsor_partnerships()'::regprocedure) r`)).r
ok('...and the sponsor workspace contract still carries no package column', !/package/i.test(wsCols), wsCols)

// ---- 5. deletion -----------------------------------------------------------------
const usedDelete = await attempt(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1`, [GOLD])
ok('a package used by partnerships still cannot be deleted, with the same message as before',
  refused(usedDelete, /used by \d+ partnership\(s\)\. Archive it instead/), show(usedDelete))
const UNUSED = await mkPackage(EV_A, 'Unused')
ok('an unused package can still be deleted', (await as(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1 RETURNING id`, [UNUSED])).rows.length === 1)
const DRAFT = (await insertLinked(U.owner, EV_A, 'Draft to discard', GOLD)).rows[0].id
ok('a linked draft can still be deleted (the wizard\'s rollback)',
  (await as(U.owner, `DELETE FROM event_partnerships WHERE id = $1 RETURNING id`, [DRAFT])).rows.length === 1)

// The FK's ON DELETE SET NULL is unreachable while the delete guard stands. With the
// guard switched off (never in production), Spec A refuses it rather than lose history.
await db.exec('BEGIN')
await db.exec(`ALTER TABLE event_partnership_packages DISABLE TRIGGER check_partnership_package_delete_rules`)
const setNull = await superAttempt(`DELETE FROM event_partnership_packages WHERE id = '${GOLD}'`)
await db.exec('ROLLBACK')
ok('if a used package were ever deleted past the guard, the SET NULL action is refused (fails closed)',
  refused(setNull, /cannot be removed/), show(setNull))
ok('...and the guard is back in place', (await one(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'check_partnership_package_delete_rules'`)).tgenabled === 'O')

// Event deletion: only privileged roles may delete events (no client DELETE grant).
const cascadeOrder = (await sup(`SELECT c.conrelid::regclass::text AS child FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint
  WHERE t.tgrelid = 'events'::regclass AND t.tgfoid = '"RI_FKey_cascade_del"'::regproc
    AND c.conrelid IN ('event_partnerships'::regclass, 'event_partnership_packages'::regclass) ORDER BY t.tgname`)).map((r) => r.child)
ok('deleting an event removes its partnerships before its packages (the reasoning in the migration depends on it)',
  cascadeOrder.join() === 'event_partnerships,event_partnership_packages', cascadeOrder.join())
ok('clients still cannot delete an event', refused(await attempt(U.owner, `DELETE FROM events WHERE id = $1`, [EV_B]), /permission denied/))

async function eventToDelete(name) {
  const ev = await mkEvent(name, ORG, U.owner)
  const pkg = await mkPackage(ev, 'Gold')
  await mkTemplate(pkg, ev, 'Banner', 0)
  await mkPackage(ev, 'Never used')
  const arch = await mkPackage(ev, 'Archived')
  const direct = (await insertLinked(U.owner, ev, 'Direct', pkg)).rows[0].id
  await as(U.owner, `SELECT set_event_partnership_roles($1, '{sponsor}'::text[])`, [direct])
  await as(U.owner, `INSERT INTO event_partnership_obligations (partnership_id, event_id, direction, title) VALUES ($1, $2, 'partner_to_organizer', 'Logo')`, [direct, ev])
  const applied = await plain(U.owner, ev, 'Applied')
  await as(U.owner, `SELECT apply_partnership_package($1, $2)`, [applied, pkg])
  const archLinked = (await insertLinked(U.owner, ev, 'Linked then archived', arch)).rows[0].id
  await archive(arch)
  await plain(U.owner, ev, 'Custom')
  return { ev, archLinked }
}
const leftovers = (ev) => n(`SELECT (SELECT count(*) FROM event_partnerships WHERE event_id = $1)
  + (SELECT count(*) FROM event_partnership_packages WHERE event_id = $1)
  + (SELECT count(*) FROM event_partnership_package_deliverables WHERE event_id = $1)
  + (SELECT count(*) FROM event_partnership_obligations WHERE event_id = $1)
  + (SELECT count(*) FROM event_partnership_roles WHERE event_id = $1) AS n`, [ev])
const DEL1 = await eventToDelete('To delete (service_role)')
ok('(setup) the event to delete has linked partnerships, packages, deliverables, obligations and roles', await leftovers(DEL1.ev) >= 10)
const delSvc = await superAttempt(`SET LOCAL ROLE service_role; DELETE FROM events WHERE id = '${DEL1.ev}'`)
await db.exec(`RESET ROLE`)
ok('service_role deletes an event with linked draft partnerships, and everything under it goes', delSvc === null && await leftovers(DEL1.ev) === 0, show(delSvc))
const DEL2 = await eventToDelete('To delete (postgres)')
ok('...and so does the table owner', (await superAttempt(`DELETE FROM events WHERE id = '${DEL2.ev}'`)) === null && await leftovers(DEL2.ev) === 0)
const DEL3 = await eventToDelete('Has an accepted partner')
await sup(`UPDATE event_partnerships SET status = 'invited' WHERE id = $1`, [DEL3.archLinked])
const delActive = await superAttempt(`DELETE FROM events WHERE id = '${DEL3.ev}'`)
ok('an event with a partnership past draft still cannot be deleted, as before (not a package rule)',
  refused(delActive, /Only a draft partnership can be deleted/), show(delActive))

// ---- 6. revert ------------------------------------------------------------------
await db.exec(fs.readFileSync(REVERT, 'utf8'))
const reverted = catalogDiff(BEFORE_CATALOG, await catalog())
ok('the revert script restores the catalog exactly as it was before the migration',
  reverted.added.length === 0 && reverted.removed.length === 0 && reverted.changed.length === 0, JSON.stringify(reverted))
ok('...it touched no row', (await pkgOf(EX_GAP)) === RETIRED && (await pkgOf(EX_ACCEPTED)) === GOLD)
const oldGap = await tryInsertLinked(U.owner, EV_A, 'Gap again', RETIRED)
ok('...and the old behaviour is back: an archived package can be linked directly', oldGap === null, show(oldGap))
await db.exec(migrationSql)
ok('the migration applies again cleanly after a revert', catalogDiff(AFTER_CATALOG, await catalog()).changed.length === 0 &&
  refused(await tryInsertLinked(U.owner, EV_A, 'Gap again', RETIRED), /archived/))

// ---- 5b. the opposite cascade order --------------------------------------------
// Re-creating the partnerships->events foreign key gives its cascade trigger a newer
// name, so packages are deleted first. Then the package delete guard refuses the event
// deletion -- before Spec A as well as after it, so Spec A changes no outcome there.
{
  const { db: db2, failures: f2 } = await boot(MIG)
  if (f2.length) { console.log('MIGRATION FAILURES (second database)', f2); process.exit(1) }
  const q = async (sql, params = []) => (await db2.query(sql, params)).rows
  await q(`ALTER TABLE event_partnerships DROP CONSTRAINT event_partnerships_event_id_fkey`)
  await q(`ALTER TABLE event_partnerships ADD CONSTRAINT event_partnerships_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`)
  const flipped = (await q(`SELECT c.conrelid::regclass::text AS child FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint
    WHERE t.tgrelid = 'events'::regclass AND t.tgfoid = '"RI_FKey_cascade_del"'::regproc
      AND c.conrelid IN ('event_partnerships'::regclass, 'event_partnership_packages'::regclass) ORDER BY t.tgname`)).map((r) => r.child)
  const owner = (await q(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'o@flip.test', now()) RETURNING id`))[0].id
  await q(`UPDATE user_accounts SET account_type = 'organizer', status = 'active' WHERE user_id = $1`, [owner])
  await q(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: owner, role: 'authenticated' })])
  const org = (await q(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('O', 'organizer', 'approved', $1) RETURNING id`, [owner]))[0].id
  const outcome = async () => {
    await q(`SET session_replication_role = replica`)
    const ev = (await q(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
                         VALUES ('Flip', 'upcoming', 'published', $1, $2, '2030-01-01', '2030-01-02') RETURNING id`, [org, owner]))[0].id
    await q(`SET session_replication_role = origin`)
    const pkg = (await q(`INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Gold') RETURNING id`, [ev]))[0].id
    await q(`INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Linked draft', $2)`, [ev, pkg])
    try { await q(`DELETE FROM events WHERE id = $1`, [ev]); return 'deleted' } catch (e) { return String(e.message) }
  }
  const withSpecA = await outcome()
  await db2.exec(fs.readFileSync(REVERT, 'utf8'))
  const withoutSpecA = await outcome()
  ok('(setup) in the second database, packages now cascade before partnerships', flipped.join() === 'event_partnership_packages,event_partnerships', flipped.join())
  ok('in that order, deleting an event with a linked draft is refused by the package delete guard, with or without Spec A',
    /used by 1 partnership\(s\)/.test(withSpecA) && withSpecA === withoutSpecA, JSON.stringify({ withSpecA, withoutSpecA }))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
