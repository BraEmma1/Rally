// The organization partner list (migration 20261129000000_organization_partners).
//
//   Section 1. the directory table, its rules and its access: owners, admins and
//              assigned event managers read and create; only owners and admins edit,
//              archive, restore or delete; nobody else reaches it. Names are unique per
//              organization ignoring case and spacing, among active partners.
//   Section 2. linking partnerships to partners: a link fills the six basic columns from
//              the partner and the copy cannot drift from it; same organization and active
//              partners only; the link changes only while the partnership is a draft; a
//              linked partner cannot be deleted; event and organization deletion outcomes.
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import fs from 'node:fs'
import path from 'node:path'
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const MIGRATION = path.join(MIG, '20261129000000_organization_partners.sql')

// Replay everything BEFORE this migration, so rows can exist before it arrives.
const { db, failures } = await boot(MIG, { upTo: '20261128999999' })
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
for (const k of ['owner', 'admin', 'manager', 'unassigned', 'suspendedAdmin', 'formerManager', 'attendee', 'sponsorAdmin', 'owner2'])
  U[k] = await user(`${k.toLowerCase()}@partners.test`)
await setAccount(U.owner, 'organizer')
await setAccount(U.owner2, 'organizer')
await setAccount(U.sponsorAdmin, 'sponsor')
const ORG = await mkOrg('Org', U.owner)
const ORG2 = await mkOrg('Other Org', U.owner2)
const SPONSOR_ORG = await mkOrg('Sponsor Co', U.sponsorAdmin, 'sponsor')
await addMember(ORG, U.admin, 'admin')
await addMember(ORG, U.manager, 'manager')
await addMember(ORG, U.unassigned, 'manager')
await addMember(ORG, U.suspendedAdmin, 'admin')
await addMember(ORG, U.formerManager, 'manager')
await setAccount(U.suspendedAdmin, 'attendee', 'suspended')
const EV_A = await mkEvent('Summit A', ORG, U.owner)
const EV_B = await mkEvent('Summit B', ORG, U.owner)
const EV_OTHER = await mkEvent('Other org event', ORG2, U.owner2)
const EV_LEGACY = await mkEvent('Legacy event', null, U.owner)
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV_A, U.manager, U.owner])
// An assignment left behind by someone who has since left the organization.
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV_B, U.formerManager, U.owner])
await sup(`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, [ORG, U.formerManager])
ok('(setup) the former manager\'s event assignment is still there, without the membership',
  await n(`SELECT count(*) AS n FROM event_team WHERE user_id = $1`, [U.formerManager]) === 1 &&
  await n(`SELECT count(*) AS n FROM organization_members WHERE user_id = $1`, [U.formerManager]) === 0)
ok('(setup) the legacy event has no organization, and the other events do',
  (await one(`SELECT organization_id FROM events WHERE id = $1`, [EV_LEGACY])).organization_id === null &&
  await n(`SELECT count(*) AS n FROM events WHERE id IN ($1, $2, $3) AND organization_id IS NOT NULL`, [EV_A, EV_B, EV_OTHER]) === 3)

// Task 4 fixtures (seeded before the migration)
// -- end of Task 4 fixtures

// ---- apply the migration -------------------------------------------------------
await db.exec(fs.readFileSync(MIGRATION, 'utf8'))
const AFTER_CATALOG = await catalog()

// ==== Section 1: the directory table, its rules and its access ===================
const ins = (who, org, name, role) =>
  as(who, `INSERT INTO organization_partners (organization_id, company_name) VALUES ($1, $2) RETURNING id, created_by`, [org, name], role)
const tryIns = (who, org, name, role) =>
  attempt(who, `INSERT INTO organization_partners (organization_id, company_name) VALUES ($1, $2) RETURNING id`, [org, name], role)
const visible = async (who, org) =>
  (await as(who, `SELECT id FROM organization_partners WHERE organization_id = $1 ORDER BY id`, [org])).rows.map((r) => r.id)
const allIn = async (org) => (await sup(`SELECT id FROM organization_partners WHERE organization_id = $1 ORDER BY id`, [org])).map((r) => r.id)
const row = (id) => one(`SELECT * FROM organization_partners WHERE id = $1`, [id])

// -- 1a. who may create, and who is recorded as the creator
const P_OWNER = (await as(U.owner, `INSERT INTO organization_partners (organization_id, company_name, created_by)
  VALUES ($1, 'Owner Co', $2) RETURNING id, created_by`, [ORG, U.admin])).rows[0]
const P_ADMIN = (await as(U.admin, `INSERT INTO organization_partners (organization_id, company_name, created_by)
  VALUES ($1, 'Admin Co', $2) RETURNING id, created_by`, [ORG, U.owner])).rows[0]
ok('the owner and an admin create partners', typeof P_OWNER.id === 'string' && typeof P_ADMIN.id === 'string')
ok('...and created_by is the caller, even when another creator is supplied',
  P_OWNER.created_by === U.owner && P_ADMIN.created_by === U.admin, show({ P_OWNER, P_ADMIN }))

const P_MGR = (await ins(U.manager, ORG, 'Manager Co')).rows[0]
ok('an event manager assigned to an event in the organization creates a partner',
  typeof P_MGR.id === 'string' && P_MGR.created_by === U.manager, show(P_MGR))
const P_ORG2 = (await ins(U.owner2, ORG2, 'Elsewhere Ltd')).rows[0]
const mgrSees = await visible(U.manager, ORG)
ok('...and sees every partner in the organization, including ones the owner and admin created',
  JSON.stringify(mgrSees) === JSON.stringify(await allIn(ORG)) && mgrSees.includes(P_OWNER.id) && mgrSees.includes(P_ADMIN.id) && mgrSees.length === 3,
  show(mgrSees))
ok('...but nothing from another organization', (await as(U.manager, `SELECT id FROM organization_partners`)).rows.every((r) => r.id !== P_ORG2.id))
ok('the owner and the admin see every partner in the organization',
  JSON.stringify(await visible(U.owner, ORG)) === JSON.stringify(await allIn(ORG)) &&
  JSON.stringify(await visible(U.admin, ORG)) === JSON.stringify(await allIn(ORG)))

const noJwt = await one(`INSERT INTO organization_partners (organization_id, company_name, created_by) VALUES ($1, 'Seeded Co', $2) RETURNING id, created_by`, [ORG, U.admin])
ok('with no signed-in user (a migration), the supplied created_by is kept', noJwt.created_by === U.admin, show(noJwt))
await sup(`DELETE FROM organization_partners WHERE id = $1`, [noJwt.id])

// -- 1b. who may not
const outsiders = { unassigned: U.unassigned, suspendedAdmin: U.suspendedAdmin, attendee: U.attendee, sponsorAdmin: U.sponsorAdmin, formerManager: U.formerManager }
for (const [label, uid] of Object.entries(outsiders)) {
  const seen = (await as(uid, `SELECT id FROM organization_partners`)).rows.length
  const insert = await tryIns(uid, ORG, `By ${label}`)
  ok(`${label} sees no partner and cannot create one`, seen === 0 && refused(insert, /row-level security/), show({ seen, insert }))
}
const anonRead = await attempt(null, `SELECT id FROM organization_partners`, [], 'anon')
const anonInsert = await tryIns(null, ORG, 'By anon', 'anon')
ok('anon can neither read nor create (no table privilege at all)',
  refused(anonRead, /permission denied/) && refused(anonInsert, /permission denied/), show({ anonRead, anonInsert }))
ok('another organization\'s owner sees no partner of this one, and cannot create one in it',
  (await visible(U.owner2, ORG)).length === 0 && refused(await tryIns(U.owner2, ORG, 'By owner2'), /row-level security/))
ok('none of them wrote a row', await n(`SELECT count(*) AS n FROM organization_partners WHERE company_name LIKE 'By %'`) === 0)

await setAccount(U.manager, 'attendee', 'suspended')
const suspMgr = { seen: (await visible(U.manager, ORG)).length, insert: await tryIns(U.manager, ORG, 'By suspended manager') }
await setAccount(U.manager, 'attendee', 'active')
ok('a suspended event manager sees nothing and cannot create', suspMgr.seen === 0 && refused(suspMgr.insert, /row-level security/), show(suspMgr))

// -- 1c. editing is for owners and admins only
const before = JSON.stringify(await sup(`SELECT * FROM organization_partners WHERE organization_id = $1 ORDER BY id`, [ORG]))
const mgrUpd = (await as(U.manager, `UPDATE organization_partners SET description = 'changed' WHERE organization_id = $1 RETURNING id`, [ORG])).rows.length
const mgrArch = (await as(U.manager, `UPDATE organization_partners SET archived_at = now() WHERE id = $1 RETURNING id`, [P_MGR.id])).rows.length
const mgrDel = (await as(U.manager, `DELETE FROM organization_partners WHERE organization_id = $1 RETURNING id`, [ORG])).rows.length
ok('an event manager\'s UPDATE and DELETE affect no row, even on a partner they created',
  mgrUpd === 0 && mgrArch === 0 && mgrDel === 0 &&
  JSON.stringify(await sup(`SELECT * FROM organization_partners WHERE organization_id = $1 ORDER BY id`, [ORG])) === before,
  show({ mgrUpd, mgrArch, mgrDel }))

const created = await row(P_ADMIN.id)
const upd = (await as(U.admin, `UPDATE organization_partners SET description = 'Payments', created_at = '2000-01-01', updated_at = '2000-01-01'
  WHERE id = $1 RETURNING description, created_at, updated_at`, [P_ADMIN.id])).rows[0]
ok('an admin edits a partner; created_at is kept and updated_at is set by the database',
  upd.description === 'Payments' && +upd.created_at === +created.created_at && +upd.updated_at > +new Date('2001-01-01'), show(upd))
const DEL_ME = (await ins(U.manager, ORG, 'Typo Co')).rows[0].id
ok('the owner deletes a partner', (await as(U.owner, `DELETE FROM organization_partners WHERE id = $1 RETURNING id`, [DEL_ME])).rows.length === 1)

// -- 1d. only an organizer organization keeps a partner list
// Its own owner is an admin of it (is_org_admin), so it passes the helpers and is told why.
const sponsorIns = await tryIns(U.sponsorAdmin, SPONSOR_ORG, 'Sponsor list')
ok('a sponsor organization\'s owner cannot start a partner list, with the non-organizer copy',
  refused(sponsorIns, /^Only an organizer organization can keep a partner list$/), show(sponsorIns))
// The type of an organization is told only to someone RLS would let insert there.
const probes = {
  'a non-member into the sponsor organization': await tryIns(U.attendee, SPONSOR_ORG, 'Probe'),
  'a non-member into an organizer organization': await tryIns(U.attendee, ORG2, 'Probe'),
  'another organizer\'s owner into the sponsor organization': await tryIns(U.owner2, SPONSOR_ORG, 'Probe'),
  'this organization\'s manager into the sponsor organization': await tryIns(U.manager, SPONSOR_ORG, 'Probe'),
  'this organization\'s admin into another organizer organization': await tryIns(U.admin, ORG2, 'Probe'),
}
const probeValues = Object.values(probes)
ok('a signed-in caller who may not create there gets the same RLS refusal whether the organization is a sponsor or an organizer one',
  probeValues.every((e) => refused(e, /row-level security/, '42501')) &&
  probeValues.every((e) => e.message === probeValues[0].message && e.code === probeValues[0].code), show(probes))
ok('...and none of the probes wrote a row', await n(`SELECT count(*) AS n FROM organization_partners WHERE company_name = 'Probe'`) === 0)
ok('...not even without a signed-in user',
  refused(await superAttempt(`INSERT INTO organization_partners (organization_id, company_name, created_by) VALUES ($1, 'Sponsor list', $2)`, [SPONSOR_ORG, U.sponsorAdmin]),
    /^Only an organizer organization can keep a partner list$/))

// -- 1e. one active partner per name, ignoring case and spacing
const KORA = (await ins(U.owner, ORG, 'Kora Payments')).rows[0].id
const dup = await tryIns(U.admin, ORG, 'Kora  payments ')
ok('"Kora  payments " after "Kora Payments" is refused as a unique violation', refused(dup, /organization_partners_active_name_unique/, '23505'), show(dup))
ok('...but another organization may have its own Kora Payments', typeof (await ins(U.owner2, ORG2, 'Kora Payments')).rows[0].id === 'string')
await as(U.owner, `UPDATE organization_partners SET archived_at = now() WHERE id = $1`, [KORA])
const KORA2 = (await ins(U.admin, ORG, 'Kora  payments ')).rows[0].id
ok('after archiving the first, the second is created (name trimmed, inner spacing kept)',
  (await row(KORA2)).company_name === 'Kora  payments', show(await row(KORA2)))
const restore = await attempt(U.owner, `UPDATE organization_partners SET archived_at = NULL WHERE id = $1`, [KORA])
ok('restoring the first is then refused, naming it', refused(restore, /^Kora Payments already exists\. Rename one of them first\.$/), show(restore))
ok('...and it stays archived', (await row(KORA)).archived_at !== null)
await as(U.owner, `UPDATE organization_partners SET company_name = 'Kora Payments (old)' WHERE id = $1`, [KORA])
ok('once renamed, it can be restored',
  (await as(U.owner, `UPDATE organization_partners SET archived_at = NULL WHERE id = $1 RETURNING id`, [KORA])).rows.length === 1)
const rename = await attempt(U.owner, `UPDATE organization_partners SET company_name = 'KORA PAYMENTS' WHERE id = $1`, [KORA])
ok('renaming an active partner onto another active one is refused by the index', refused(rename, /organization_partners_active_name_unique/, '23505'), show(rename))

// -- 1f. what cannot change after insert
const move = await attempt(U.owner, `UPDATE organization_partners SET organization_id = $2 WHERE id = $1`, [P_OWNER.id, ORG2])
ok('a partner cannot be moved to another organization', refused(move, /cannot be moved to another organization/), show(move))
const moveSup = await superAttempt(`UPDATE organization_partners SET organization_id = $2 WHERE id = $1`, [P_OWNER.id, ORG2])
ok('...not even by the table owner (the rule is the trigger, not RLS)', refused(moveSup, /cannot be moved to another organization/), show(moveSup))
const reattr = await attempt(U.owner, `UPDATE organization_partners SET created_by = $2 WHERE id = $1`, [P_OWNER.id, U.admin])
ok('the creator of a partner cannot be changed', refused(reattr, /creator of a partner cannot be changed/), show(reattr))
ok('...and both are unchanged', (await row(P_OWNER.id)).organization_id === ORG && (await row(P_OWNER.id)).created_by === U.owner)

// -- 1g. normalization and checks
const EMAIL = (await as(U.owner, `INSERT INTO organization_partners (organization_id, company_name, contact_email)
  VALUES ($1, '  Ops Co  ', ' Ops@Kora.Example ') RETURNING company_name, contact_email`, [ORG])).rows[0]
ok('contact_email is stored trimmed and lower-cased, and the company name trimmed',
  EMAIL.contact_email === 'ops@kora.example' && EMAIL.company_name === 'Ops Co', show(EMAIL))
const blankEmail = (await as(U.owner, `INSERT INTO organization_partners (organization_id, company_name, contact_email)
  VALUES ($1, 'Blank Email Co', '   ') RETURNING contact_email`, [ORG])).rows[0]
ok('...and an empty contact_email is stored as NULL', blankEmail.contact_email === null, show(blankEmail))
const badEmail = await attempt(U.owner, `INSERT INTO organization_partners (organization_id, company_name, contact_email) VALUES ($1, 'Bad Email', 'not-an-email')`, [ORG])
ok('a malformed contact_email is refused by the CHECK', refused(badEmail, /organization_partners_contact_email_normalized/, '23514'), show(badEmail))
const js = await attempt(U.owner, `INSERT INTO organization_partners (organization_id, company_name, website) VALUES ($1, 'JS Co', 'javascript:x')`, [ORG])
ok('the website "javascript:x" is refused by the CHECK', refused(js, /organization_partners_website_safe_url/, '23514'), show(js))
ok('...and so are an unsafe linkedin or logo, a blank name and a 201-character name',
  refused(await attempt(U.owner, `INSERT INTO organization_partners (organization_id, company_name, linkedin) VALUES ($1, 'L', 'data:x')`, [ORG]), /organization_partners_linkedin_safe_url/, '23514') &&
  refused(await attempt(U.owner, `INSERT INTO organization_partners (organization_id, company_name, logo_url) VALUES ($1, 'L', 'ftp://x')`, [ORG]), /organization_partners_logo_safe_url/, '23514') &&
  refused(await attempt(U.owner, `INSERT INTO organization_partners (organization_id, company_name) VALUES ($1, '   ')`, [ORG]), /organization_partners_company_not_blank/, '23514') &&
  refused(await attempt(U.owner, `INSERT INTO organization_partners (organization_id, company_name) VALUES ($1, $2)`, [ORG, 'x'.repeat(201)]), /organization_partners_company_length/, '23514'))
ok('the CHECKs match the partnership ones, so a partner\'s details always fit a partnership',
  (await sup(`SELECT replace(c.conname, 'organization_partners_', '') AS k, pg_get_constraintdef(c.oid) AS d FROM pg_constraint c
               WHERE c.conrelid = 'organization_partners'::regclass AND c.contype = 'c'`))
    .filter((r) => r.k !== 'contact_email_normalized').length === 7 &&
  await n(`SELECT count(*) AS n FROM pg_constraint o JOIN pg_constraint p
             ON p.conrelid = 'event_partnerships'::regclass AND p.conname = replace(o.conname, 'organization_partners_', 'event_partnerships_')
            WHERE o.conrelid = 'organization_partners'::regclass AND o.contype = 'c'
              AND pg_get_constraintdef(o.oid) = pg_get_constraintdef(p.oid)`) === 7)
const emailDefs = await one(`SELECT
  pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'organization_partners'::regclass AND conname = 'organization_partners_contact_email_normalized')) AS partner,
  pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'event_partnerships'::regclass AND conname = 'event_partnerships_rep_email_normalized')) AS rep`)
ok('the contact_email CHECK is the representative_email one, column renamed',
  emailDefs.partner !== null && emailDefs.rep !== null && emailDefs.partner === emailDefs.rep.replaceAll('representative_email', 'contact_email'), show(emailDefs))

// -- 1h. the helper, the grants and the catalog
const mgrOf = async (who, org) => (await as(who, `SELECT is_org_event_manager($1) AS v`, [org])).rows[0].v
ok('is_org_event_manager: true for an assigned manager, in their organization only',
  (await mgrOf(U.manager, ORG)) === true && (await mgrOf(U.manager, ORG2)) === false)
ok('...false for an unassigned manager, an admin with no assignment, an outsider, and a former member with a stale assignment',
  (await mgrOf(U.unassigned, ORG)) === false && (await mgrOf(U.admin, ORG)) === false &&
  (await mgrOf(U.attendee, ORG)) === false && (await mgrOf(U.formerManager, ORG)) === false)
await setAccount(U.manager, 'attendee', 'suspended')
const suspHelper = await mgrOf(U.manager, ORG)
await setAccount(U.manager, 'attendee', 'active')
ok('...and false for a suspended account', suspHelper === false)

const fns = await sup(`SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig::text AS cfg,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
  FROM pg_proc p WHERE p.oid IN ('public.is_org_event_manager(uuid)'::regprocedure, 'public.enforce_organization_partner_rules()'::regprocedure)`)
const helper = fns.find((f) => f.sig === 'is_org_event_manager(uuid)')
const trig = fns.find((f) => f.sig === 'enforce_organization_partner_rules()')
ok('the helper is SECURITY DEFINER STABLE, pins its search_path, and only signed-in users may call it',
  helper.prosecdef && helper.provolatile === 's' && /search_path=public, pg_temp/.test(helper.cfg) && !helper.anon && helper.auth, show(helper))
ok('the trigger function pins its search_path and no client role may call it',
  trig.prosecdef && /search_path=public, pg_temp/.test(trig.cfg) && !trig.anon && !trig.auth, show(trig))

const privs = await one(`SELECT c.relrowsecurity AS rls,
  has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
    OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'REFERENCES')
    OR has_table_privilege('anon', c.oid, 'TRIGGER') AS anon_any,
  has_table_privilege('authenticated', c.oid, 'SELECT') AND has_table_privilege('authenticated', c.oid, 'INSERT')
    AND has_table_privilege('authenticated', c.oid, 'UPDATE') AND has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_crud,
  has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS auth_truncate
  FROM pg_class c WHERE c.oid = 'public.organization_partners'::regclass`)
ok('RLS is on; anon holds no privilege; signed-in users may SELECT, INSERT, UPDATE and DELETE but not TRUNCATE',
  privs.rls && !privs.anon_any && privs.auth_crud && !privs.auth_truncate, show(privs))
const grants = await sup(`SELECT a.grantee::regrole::text AS g, a.privilege_type AS p
  FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.organization_partners'::regclass ORDER BY 1, 2`)
const authPrivs = grants.filter((r) => r.g === 'authenticated').map((r) => r.p)
ok('signed-in users hold exactly SELECT, INSERT, UPDATE and DELETE (no REFERENCES, TRIGGER or TRUNCATE)',
  JSON.stringify(authPrivs) === JSON.stringify(['DELETE', 'INSERT', 'SELECT', 'UPDATE']), show(authPrivs))
ok('...and no grant names anon or PUBLIC', grants.every((r) => r.g !== 'anon' && r.g !== '-'), show(grants))
const pols = await sup(`SELECT policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'organization_partners' ORDER BY policyname`)
ok('four policies, all for signed-in users only',
  JSON.stringify(pols.map((p) => [p.policyname, p.cmd, p.roles])) === JSON.stringify([
    ['create_organization_partners', 'INSERT', '{authenticated}'],
    ['delete_organization_partners', 'DELETE', '{authenticated}'],
    ['read_organization_partners', 'SELECT', '{authenticated}'],
    ['update_organization_partners', 'UPDATE', '{authenticated}'],
  ]), show(pols))
const idx = await one(`SELECT pg_get_indexdef('public.organization_partners_active_name_unique'::regclass) AS d`)
ok('the unique index is on the organization and the normalized name, among active partners',
  /UNIQUE INDEX organization_partners_active_name_unique ON public\.organization_partners USING btree \(organization_id, lower\(btrim\(regexp_replace\(company_name, '\\s\+'::text, ' '::text, 'g'::text\)\)\)\) WHERE \(archived_at IS NULL\)/.test(idx.d), idx.d)

const d = catalogDiff(BEFORE_CATALOG, AFTER_CATALOG)
ok('the migration changes and removes nothing that existed before it',
  d.removed.length === 0 && d.changed.length === 0, show({ removed: d.removed, changed: d.changed }))

// ==== Section 2: linking partnerships to partners ================================
const BASIC = ['company_name', 'description', 'logo_url', 'industry', 'website', 'linkedin']
const DRIFT = /^These details belong to the partner\. Edit the partner to change them everywhere\.$/
const CROSS = /^That partner belongs to another organization$/
const ARCHIVED = /^That partner is archived\. Restore it before adding it to an event\.$/
const FROZEN = /^The partner on this partnership can only be changed while it is a draft$/
const pship = (id) => one(`SELECT * FROM event_partnerships WHERE id = $1`, [id])
const basics = (r) => Object.fromEntries(BASIC.map((k) => [k, r[k]]))
const sameBasics = (a, b) => BASIC.every((k) => a[k] === b[k])
const mkPartner = async (who, org, name, d = {}) =>
  (await as(who, `INSERT INTO organization_partners (organization_id, company_name, description, logo_url, industry, website, linkedin)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [org, name, d.description ?? null, d.logo_url ?? null, d.industry ?? null, d.website ?? null, d.linkedin ?? null])).rows[0].id
const link = async (who, ev, partner, role) =>
  (await as(who, `INSERT INTO event_partnerships (event_id, partner_id) VALUES ($1, $2) RETURNING id`, [ev, partner], role)).rows[0].id
const tryLink = (who, ev, partner, role) =>
  attempt(who, `INSERT INTO event_partnerships (event_id, partner_id) VALUES ($1, $2)`, [ev, partner], role)
const setOn = (who, id, sets, params = []) =>
  attempt(who, `UPDATE event_partnerships SET ${sets} WHERE id = $1`, [id, ...params])

// Website NULL and LinkedIn '' on purpose: NULL versus '' is a difference (Review Focus 3).
const LK = await mkPartner(U.owner, ORG, 'Kora Group', {
  description: 'Payments across Africa', logo_url: 'https://kora.example/logo.png', industry: 'Fintech', website: null, linkedin: '' })
const LB = await mkPartner(U.owner, ORG, 'Baobab Capital', {
  description: 'Growth equity', logo_url: 'https://baobab.example/logo.png', industry: 'Finance',
  website: 'https://baobab.example', linkedin: 'https://www.linkedin.com/company/baobab' })
const KORA_ROW = await row(LK)
const BAOBAB_ROW = await row(LB)

// -- 2a. the link fills the copy
const L1 = await link(U.owner, EV_A, LK)
const l1 = await pship(L1)
ok('an owner links a partnership with no company details, and all six basic columns are the partner\'s',
  l1.partner_id === LK && sameBasics(l1, KORA_ROW), show({ l1: basics(l1), kora: basics(KORA_ROW) }))
const wrong = (await as(U.owner, `INSERT INTO event_partnerships (event_id, partner_id, company_name, website, linkedin)
  VALUES ($1, $2, 'Wrong', 'https://wrong.example', NULL) RETURNING *`, [EV_A, LK])).rows[0]
ok('company details sent with a link are replaced by the partner\'s (the fill wins)',
  wrong.company_name === 'Kora Group' && sameBasics(wrong, KORA_ROW), show(basics(wrong)))
const LM = await link(U.manager, EV_A, LK)
ok('the event manager links a partnership on the event they manage', sameBasics(await pship(LM), KORA_ROW))
const mgrB = await tryLink(U.manager, EV_B, LK)
ok('...but not on an event they are not assigned to (RLS)', refused(mgrB, /row-level security/, '42501'), show(mgrB))

// -- 2b. same organization only
const countIn = (ev) => n(`SELECT count(*) AS n FROM event_partnerships WHERE event_id = $1`, [ev])
const otherBefore = await countIn(EV_OTHER)
const forged = await tryLink(U.owner2, EV_OTHER, LK)
ok('another organization\'s owner linking this organization\'s partner on their own event gets the cross-organization copy',
  refused(forged, CROSS), show(forged))
const legacy = await tryLink(U.owner, EV_LEGACY, LK, 'postgres')
ok('...and so does an event with no organization, even for the table owner', refused(legacy, CROSS), show(legacy))
const ghost = await tryLink(U.owner, EV_A, '00000000-0000-4000-8000-000000000000')
ok('a partner id that does not exist gets the same copy, so the message never tells one from the other',
  refused(ghost, CROSS), show(ghost))
const repoint = await setOn(U.owner, L1, 'partner_id = $2', [P_ORG2.id])
ok('re-pointing a draft to another organization\'s partner gets the cross-organization copy too', refused(repoint, CROSS), show(repoint))
ok('...and none of them wrote anything',
  await countIn(EV_OTHER) === otherBefore && await countIn(EV_LEGACY) === 0 && (await pship(L1)).partner_id === LK)

// -- 2c. only an active partner can be linked
const RETIRED = await mkPartner(U.owner, ORG, 'Retired Co')
await as(U.owner, `UPDATE organization_partners SET archived_at = now() WHERE id = $1`, [RETIRED])
const toArchived = await tryLink(U.owner, EV_A, RETIRED)
ok('linking an archived partner is refused with the archived-link copy', refused(toArchived, ARCHIVED), show(toArchived))
const repointArchived = await setOn(U.owner, L1, 'partner_id = $2', [RETIRED])
ok('...and so is re-pointing a draft to it', refused(repointArchived, ARCHIVED), show(repointArchived))
const LATER = await mkPartner(U.owner, ORG, 'Later Co')
const L_LATER = await link(U.owner, EV_A, LATER)
await as(U.owner, `UPDATE organization_partners SET archived_at = now() WHERE id = $1`, [LATER])
const laterEdit = await setOn(U.owner, L_LATER, `tier_label = 'Gold'`)
ok('a partnership linked before its partner was archived stays editable',
  laterEdit === null && (await pship(L_LATER)).tier_label === 'Gold', show(laterEdit))

// -- 2d. a linked copy cannot drift from its partner
const resend = await setOn(U.owner, L1,
  `company_name = $2, description = $3, logo_url = $4, industry = $5, website = $6, linkedin = $7, tier_label = 'Headline'`,
  BASIC.map((k) => KORA_ROW[k]))
ok('saving the six details unchanged, as today\'s Edit Partner dialog does, succeeds',
  resend === null && (await pship(L1)).tier_label === 'Headline', show(resend))
const renamed = await setOn(U.owner, L1, `company_name = 'Kora Ltd'`)
ok('changing the company name of a linked partnership is refused with the exact drift copy',
  refused(renamed, DRIFT), show(renamed))
const webEmpty = await setOn(U.owner, L1, `website = ''`)
const linkedinNull = await setOn(U.owner, L1, `linkedin = NULL`)
ok('an empty website where the partner has NULL is a difference, and so is NULL where the partner has \'\'',
  refused(webEmpty, DRIFT) && refused(linkedinNull, DRIFT), show({ webEmpty, linkedinNull }))
ok('...and each refused edit left the copy as it was', sameBasics(await pship(L1), KORA_ROW))
const perEvent = {
  internal_notes: await setOn(U.owner, L1, `internal_notes = 'Prefers email'`),
  tier_label: await setOn(U.owner, L1, `tier_label = 'Gold'`),
  value_amount: await setOn(U.owner, L1, `value_amount = 5000, value_currency = 'usd'`),
  representative_email: await setOn(U.owner, L1, `representative_email = ' Rep@Kora.Example '`),
}
const l1After = await pship(L1)
ok('what is agreed per event stays editable: internal notes, tier label, value and representative email',
  Object.values(perEvent).every((e) => e === null) && l1After.internal_notes === 'Prefers email' && l1After.tier_label === 'Gold' &&
  Number(l1After.value_amount) === 5000 && l1After.representative_email === 'rep@kora.example', show(perEvent))
const mgrDrift = await setOn(U.manager, LM, `description = 'Edited by a manager'`)
ok('an event manager is held to the same rule', refused(mgrDrift, DRIFT), show(mgrDrift))

// -- 2e. the link changes only while the partnership is a draft
const D1 = await link(U.owner, EV_A, LK)
const swap = await setOn(U.owner, D1, `partner_id = $2, company_name = 'Wrong'`, [LB])
const d1 = await pship(D1)
ok('re-pointing a draft from one partner to another succeeds, and the copy becomes the new partner\'s',
  swap === null && d1.partner_id === LB && sameBasics(d1, BAOBAB_ROW), show({ swap, d1: basics(d1) }))
const clear = await setOn(U.owner, D1, `partner_id = NULL`)
const d1Cleared = await pship(D1)
ok('clearing a draft\'s link succeeds and keeps the copy',
  clear === null && d1Cleared.partner_id === null && sameBasics(d1Cleared, BAOBAB_ROW), show(clear))
const freeEdit = await setOn(U.owner, D1, `company_name = 'Baobab Capital Partners', website = ''`)
ok('...and the copy is then editable', freeEdit === null && (await pship(D1)).company_name === 'Baobab Capital Partners', show(freeEdit))

const INV1 = await link(U.owner, EV_A, LK)
await as(U.owner, `SELECT invite_partnership_representative($1, 'rep@kora.example')`, [INV1])
ok('(setup) a linked partnership can be invited, and is then invited', (await pship(INV1)).status === 'invited')
const invSwap = await setOn(U.owner, INV1, `partner_id = $2`, [LB])
const invClear = await setOn(U.owner, INV1, `partner_id = NULL`)
ok('an invited partnership cannot be re-pointed or cleared, with the frozen-link copy',
  refused(invSwap, FROZEN) && refused(invClear, FROZEN) && (await pship(INV1)).partner_id === LK, show({ invSwap, invClear }))

const INV2 = (await as(U.owner, `INSERT INTO event_partnerships (event_id, company_name, description, website)
  VALUES ($1, 'Kora (typed)', 'Typed by hand', 'https://typed.example') RETURNING id`, [EV_A])).rows[0].id
await as(U.owner, `SELECT invite_partnership_representative($1, 'rep2@kora.example')`, [INV2])
const firstLink = await setOn(U.owner, INV2, `partner_id = $2`, [LK])
const inv2 = await pship(INV2)
ok('an invited partnership with no link takes its first link (the backfill path), and the copy becomes the partner\'s',
  firstLink === null && inv2.status === 'invited' && inv2.partner_id === LK && sameBasics(inv2, KORA_ROW), show({ firstLink, inv2: basics(inv2) }))

// -- 2f. deleting a partner, an event, an organization
const linkedCount = await n(`SELECT count(*) AS n FROM event_partnerships WHERE partner_id = $1`, [LK])
const delLinked = await attempt(U.owner, `DELETE FROM organization_partners WHERE id = $1`, [LK])
ok('deleting a linked partner is refused with the delete-guard copy and the number of partnerships',
  refused(delLinked, new RegExp(`^This partner has been added to ${linkedCount} event partnership\\(s\\)\\. Archive it instead of deleting it\\.$`)) &&
  (await row(LK)) !== undefined, show({ linkedCount, delLinked }))
const UNLINKED = await mkPartner(U.owner, ORG, 'Never Linked Co')
ok('deleting an unlinked partner succeeds',
  (await as(U.owner, `DELETE FROM organization_partners WHERE id = $1 RETURNING id`, [UNLINKED])).rows.length === 1)

const EV_DEL = await mkEvent('Draft-only event', ORG, U.owner)
await link(U.owner, EV_DEL, LB)
await link(U.owner, EV_DEL, LB)
const delEvent = await superAttempt(`DELETE FROM events WHERE id = $1`, [EV_DEL])
ok('deleting an event whose linked partnerships are all drafts succeeds, and the partner survives',
  delEvent === null && await countIn(EV_DEL) === 0 && (await row(LB)) !== undefined, show(delEvent))

// An organization with events cannot be deleted at all (events.organization_id is
// ON DELETE RESTRICT), so a linked partner never decides that outcome. Check that it is
// exactly what it was before this migration, in both RI firing orders.
const orgDeleteOutcome = async (q, linkPartner) => {
  const o = (await q(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'od-' || gen_random_uuid() || '@partners.test', now()) RETURNING id`))[0].id
  await q(`UPDATE user_accounts SET account_type = 'organizer', status = 'active' WHERE user_id = $1`, [o])
  const org = (await q(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ('To delete', 'organizer', 'approved', $1) RETURNING id`, [o]))[0].id
  await q(`SET session_replication_role = replica`)
  const ev = (await q(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
                       VALUES ('Doomed', 'upcoming', 'published', $1, $2, '2030-01-01', '2030-01-02') RETURNING id`, [org, o]))[0].id
  await q(`SET session_replication_role = origin`)
  await q(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: o, role: 'authenticated' })])
  try {
    if (linkPartner) {
      const p = (await q(`INSERT INTO organization_partners (organization_id, company_name) VALUES ($1, 'Doomed Partner') RETURNING id`, [org]))[0].id
      await q(`INSERT INTO event_partnerships (event_id, partner_id) VALUES ($1, $2)`, [ev, p])
    } else {
      await q(`INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, 'Doomed Partner')`, [ev])
    }
  } finally { await q(`SELECT set_config('request.jwt.claims', '', false)`) }
  try { await q(`DELETE FROM organizations WHERE id = $1`, [org]); return { outcome: 'deleted' } } catch (e) { return { outcome: String(e.message), code: e.code } }
}
const { db: base, failures: baseFailures } = await boot(MIG, { upTo: '20261128999999' })
if (baseFailures.length) { console.log('MIGRATION FAILURES (baseline database)', baseFailures); process.exit(1) }
const bq = async (sql, params = []) => (await base.query(sql, params)).rows
const baseline = await orgDeleteOutcome(bq, false)

const P_ORG2_LINKED = await link(U.owner2, EV_OTHER, P_ORG2.id)
const org2Rows = () => n(`SELECT (SELECT count(*) FROM organization_partners WHERE organization_id = $1)
  + (SELECT count(*) FROM event_partnerships WHERE event_id = $2) AS n`, [ORG2, EV_OTHER])
const org2Before = await org2Rows()
const delOrg2 = await superAttempt(`DELETE FROM organizations WHERE id = $1`, [ORG2])
ok('deleting ORG2 (a linked draft on its event) is refused by the events foreign key, exactly as before this migration',
  /violates foreign key constraint "events_organization_id_fkey"/.test(baseline.outcome) &&
  delOrg2 !== null && delOrg2.message === baseline.outcome && delOrg2.code === baseline.code, show({ baseline, delOrg2 }))
ok('...and every ORG2 partner and partnership is still there',
  await org2Rows() === org2Before && (await pship(P_ORG2_LINKED)).partner_id === P_ORG2.id, show({ org2Before }))
const EMPTY_ORG = await mkOrg('No events yet', U.owner)
await mkPartner(U.owner, EMPTY_ORG, 'Listed Co')
const delEmpty = await superAttempt(`DELETE FROM organizations WHERE id = $1`, [EMPTY_ORG])
ok('an organization with partners but no events can still be deleted, and its partner list goes with it',
  delEmpty === null && (await allIn(EMPTY_ORG)).length === 0, show(delEmpty))

// The other RI order: re-creating the events foreign key gives its trigger a newer name,
// so the partner list cascades first. The delete guard lets a cascade from its own
// organization through, and the events foreign key still decides.
await base.exec(fs.readFileSync(MIGRATION, 'utf8'))
await bq(`ALTER TABLE events DROP CONSTRAINT events_organization_id_fkey`)
await bq(`ALTER TABLE events ADD CONSTRAINT events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT`)
const riOrder = (await bq(`SELECT c.conrelid::regclass::text AS child FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint
  WHERE t.tgrelid = 'organizations'::regclass AND t.tgfoid IN ('"RI_FKey_cascade_del"'::regproc, '"RI_FKey_restrict_del"'::regproc)
    AND c.conrelid IN ('events'::regclass, 'organization_partners'::regclass) ORDER BY t.tgname`)).map((r) => r.child)
const flipped = await orgDeleteOutcome(bq, true)
ok('(setup) in the second database, the partner list cascades before the events foreign key is checked',
  riOrder.join() === 'organization_partners,events', riOrder.join())
ok('...and deleting an organization with a linked draft still ends exactly as before this migration',
  flipped.outcome === baseline.outcome && flipped.code === baseline.code, show({ baseline, flipped }))

// -- 2g. the column, the triggers and their functions
const fk = await one(`SELECT confrelid::regclass::text AS target, confdeltype, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'event_partnerships'::regclass AND contype = 'f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
    WHERE attrelid = 'event_partnerships'::regclass AND attname = 'partner_id')]::smallint[]`)
ok('partner_id references organization_partners with ON DELETE NO ACTION', fk?.target === 'organization_partners' && fk.confdeltype === 'a', show(fk))
const pidx = await one(`SELECT pg_get_indexdef('public.idx_event_partnerships_partner'::regclass) AS d`)
ok('...and is indexed', /ON public\.event_partnerships USING btree \(partner_id\)$/.test(pidx.d), pidx.d)
const order = (await sup(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'event_partnerships'::regclass AND NOT tgisinternal
  AND tgname IN ('check_event_partnership_rules', 'check_partnership_package_link', 'check_partnership_partner_link') ORDER BY tgname`)).map((r) => r.tgname)
ok('the link trigger fires after the partnership rules and the package link',
  order.join() === 'check_event_partnership_rules,check_partnership_package_link,check_partnership_partner_link', order.join())
const trigDefs = await sup(`SELECT tgname, pg_get_triggerdef(oid) AS d FROM pg_trigger
  WHERE tgname IN ('check_partnership_partner_link', 'check_organization_partner_delete_rules') ORDER BY tgname`)
ok('...BEFORE INSERT OR UPDATE on event_partnerships; the delete guard BEFORE DELETE on organization_partners',
  trigDefs.length === 2 &&
  /BEFORE DELETE ON public\.organization_partners FOR EACH ROW EXECUTE FUNCTION (public\.)?enforce_organization_partner_delete_rules\(\)$/.test(trigDefs[0].d) &&
  /BEFORE INSERT OR UPDATE ON public\.event_partnerships FOR EACH ROW EXECUTE FUNCTION (public\.)?enforce_partnership_partner_link\(\)$/.test(trigDefs[1].d), show(trigDefs))
const s2fns = await sup(`SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig::text AS cfg,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
  FROM pg_proc p WHERE p.oid IN ('public.enforce_partnership_partner_link()'::regprocedure, 'public.enforce_organization_partner_delete_rules()'::regprocedure)`)
ok('both trigger functions are SECURITY DEFINER, pin their search_path, and no client role may call them',
  s2fns.length === 2 && s2fns.every((f) => f.prosecdef && /search_path=public, pg_temp/.test(f.cfg) && !f.anon && !f.auth), show(s2fns))
const wsCols = (await one(`SELECT pg_get_function_result('public.my_sponsor_partnerships()'::regprocedure) AS r`)).r
ok('the sponsor workspace contract carries no partner column', !/partner_id/.test(wsCols), wsCols)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
