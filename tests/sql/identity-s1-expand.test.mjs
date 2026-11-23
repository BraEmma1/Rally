// Identity stage S1 (expand): migration 20261125000000_identity_s1_expand.sql.
//
// S1 adds platform_roles, organization_capabilities and their history alongside the
// old account_type / org_type columns, keeps them in sync with triggers, and backfills
// existing data. Nothing reads the new tables yet. This suite proves:
//   1. backfill:      existing accounts and organizations (seeded BEFORE the migration
//                     runs) are mirrored exactly, with history
//   2. preservation:  no existing row changes; every UUID, membership, event and
//                     partnership is untouched
//   3. re-runnable:   applying the migration again changes nothing
//   4. no switch:     authorization still reads the old columns, so S1 cannot change
//                     who may do what (tampering with the new tables has no effect)
//   5. sync:          every path that writes the old columns keeps the new tables right
//   6. boundaries:    no client can read, write or call any of it; no self-escalation;
//                     platform admins still cannot join organizations; suspension holds
//   7. constraints:   one active grant per user and role; history rows are real changes
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import fs from 'node:fs'
import path from 'node:path'
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const S1 = '20261125000000_identity_s1_expand.sql'
const S1_SQL = fs.readFileSync(path.join(MIG, S1), 'utf8')

// Boot everything except S1, seed realistic data, then apply S1 on top of it.
const { db, failures } = await boot(MIG, { skip: [S1] })
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
const refused = (e, re = /./) => e !== null && re.test(e)
const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await sup(sql, params))[0]
const n = async (sql, params = []) => Number(Object.values(await one(sql, params))[0])
const user = async (email) => (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id`, [email])).id
const setAccount = (uid, type, status = 'active') => sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])
// Platform-side writes the immutability trigger only allows through its escape hatch
// (the future approval RPC), performed "as" a given caller so auth.uid() is recorded.
async function platformWrite(asUid, sql, params = []) {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: asUid, role: 'authenticated' })])
  await db.query(`SELECT set_config('rally.allow_org_authority_write', 'on', false)`)
  try { return await db.query(sql, params) } finally {
    await db.query(`SELECT set_config('rally.allow_org_authority_write', 'off', false)`)
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`)
  }
}
// Returns {} when there is no row, so a missing capability fails a check instead of crashing the suite.
const cap = async (org) => (await one(`SELECT capability, status, requested_by, decided_by FROM organization_capabilities WHERE organization_id = $1 ORDER BY capability`, [org])) ?? {}
const caps = (org) => sup(`SELECT capability::text c, status::text s FROM organization_capabilities WHERE organization_id = $1 ORDER BY capability`, [org])
const activeGrants = (uid) => n(`SELECT count(*) FROM platform_roles WHERE user_id = $1 AND role = 'platform_admin' AND revoked_at IS NULL`, [uid])
const drift = () => sup(`SELECT * FROM identity_s1_drift()`)
const history = (org) => sup(`SELECT capability::text c, previous_status::text p, new_status::text s, changed_by, reason FROM organization_capability_changes WHERE organization_id = $1 ORDER BY created_at, id`, [org])

// ---- seed: existing data, written before S1 exists --------------------------
ok('(setup) S1 is not applied yet', (await one(`SELECT to_regclass('public.platform_roles') r`)).r === null)
const U = {}
for (const k of ['admin1', 'admin2', 'organizerA', 'organizerB', 'organizerPending', 'att1', 'att2', 'sponsorU', 'sponsorU2', 'vendorU', 'rep'])
  U[k] = await user(`${k.toLowerCase()}@t.test`)
await setAccount(U.admin1, 'platform_admin')
await setAccount(U.admin2, 'platform_admin', 'suspended')
await setAccount(U.organizerA, 'organizer')
await setAccount(U.organizerB, 'organizer')
await setAccount(U.organizerPending, 'organizer', 'pending_approval')
await setAccount(U.sponsorU, 'sponsor')
await setAccount(U.sponsorU2, 'sponsor')
await setAccount(U.vendorU, 'vendor')
await sup(`UPDATE user_accounts SET approved_by = $2, approved_at = '2026-10-01T10:00:00Z' WHERE user_id = $1`, [U.admin1, U.admin2])
const org = async (name, type, approval, creator, { approvedBy = null, archived = false } = {}) =>
  (await one(`INSERT INTO organizations (name, org_type, approval_status, created_by, approved_by, approved_at, archived_at)
              VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::uuid IS NULL THEN NULL ELSE '2026-10-02T09:00:00Z'::timestamptz END, ${archived ? 'now()' : 'NULL'}) RETURNING id`,
    [name, type, approval, creator, approvedBy])).id
const O = {}
O.approved = await org('Approved Organizer', 'organizer', 'approved', U.organizerA, { approvedBy: U.admin1 })
O.pending = await org('Pending Organizer', 'organizer', 'pending', U.organizerB)
O.rejected = await org('Rejected Organizer', 'organizer', 'rejected', U.organizerB, { approvedBy: U.admin1 })
O.suspended = await org('Suspended Organizer', 'organizer', 'suspended', U.organizerB, { approvedBy: U.admin1 })
O.archived = await org('Archived Organizer', 'organizer', 'approved', U.organizerA, { archived: true })
O.sponsor = await org('Sponsor Co', 'sponsor', 'approved', U.sponsorU)
O.sponsorSuspended = await org('Suspended Sponsor', 'sponsor', 'suspended', U.sponsorU2)
O.vendor = await org('Vendor Co', 'vendor', 'pending', U.vendorU)
await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')`, [O.approved, U.att1])
await sup(`SET session_replication_role = replica`)
const EV = (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date) VALUES ('Summit', 'upcoming', 'published', $1, $2, '2030-01-01', '2030-01-02') RETURNING id`, [O.approved, U.organizerA])).id
await sup(`SET session_replication_role = origin`)
const PARTNER = (await as(U.organizerA, `INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, 'Sponsor Co') RETURNING id`, [EV])).rows[0].id
// A partnership is normally linked by accepting an invitation; seed the end state directly.
await sup(`SET session_replication_role = replica`)
await sup(`UPDATE event_partnerships SET sponsor_organization_id = $2, acknowledged_at = now(), status = 'active' WHERE id = $1`, [PARTNER, O.sponsor])
await sup(`SET session_replication_role = origin`)

const TRACKED = ['user_accounts', 'organizations', 'organization_members', 'events', 'event_partnerships', 'account_type_changes', 'profiles']
const fingerprint = async () => {
  const out = {}
  for (const t of TRACKED) out[t] = (await one(`SELECT count(*)::int AS c, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.${t} x`))
  return out
}
const before = await fingerprint()
const orgCount = await n(`SELECT count(*) FROM organizations`)

// ---- apply S1 -----------------------------------------------------------------
let applyErr = null
try { await db.exec(S1_SQL) } catch (e) { applyErr = String(e.message) }
ok('S1 applies on top of existing data', applyErr === null, applyErr ?? '')

// ---- 1. backfill ----------------------------------------------------------------
ok('every platform_admin account gets exactly one active platform_admin grant (active and suspended alike)', (await activeGrants(U.admin1)) === 1 && (await activeGrants(U.admin2)) === 1)
ok('no other account gets a grant', (await n(`SELECT count(*) FROM platform_roles WHERE user_id <> ALL($1)`, [[U.admin1, U.admin2]])) === 0)
const g1 = await one(`SELECT granted_by, granted_at, grant_reason FROM platform_roles WHERE user_id = $1`, [U.admin1])
ok('a backfilled grant records who approved the account, when, and why', g1.granted_by === U.admin2 && new Date(g1.granted_at).toISOString() === '2026-10-01T10:00:00.000Z' && /S1 backfill/.test(g1.grant_reason), JSON.stringify(g1))
ok('every organization gets exactly one capability', (await n(`SELECT count(*) FROM organization_capabilities`)) === orgCount && (await n(`SELECT count(DISTINCT organization_id) FROM organization_capabilities`)) === orgCount)
const expected = [
  [O.approved, 'organize_events', 'active'], [O.pending, 'organize_events', 'pending'],
  [O.rejected, 'organize_events', 'revoked'], [O.suspended, 'organize_events', 'suspended'],
  [O.archived, 'organize_events', 'active'], [O.sponsor, 'sponsor', 'active'],
  [O.sponsorSuspended, 'sponsor', 'suspended'], [O.vendor, 'supply', 'pending'],
]
for (const [id, c, s] of expected) {
  const got = await caps(id)
  ok(`backfill maps ${(await one(`SELECT org_type::text || '/' || approval_status::text v FROM organizations WHERE id = $1`, [id])).v} to ${c}=${s}`, got.length === 1 && got[0].c === c && got[0].s === s, JSON.stringify(got))
}
const ca = await cap(O.approved), cp = await cap(O.pending)
ok('an approved capability records the approver as decider and the creator as requester', ca.decided_by === U.admin1 && ca.requested_by === U.organizerA, JSON.stringify(ca))
ok('a pending capability has no decider yet', cp.decided_by === null && cp.requested_by === U.organizerB)
const hist = await sup(`SELECT previous_status, reason FROM organization_capability_changes`)
ok('the backfill writes one history row per capability, each a creation', hist.length === orgCount && hist.every((h) => h.previous_status === null && /S1 backfill/.test(h.reason)))
ok('identity_s1_drift() reports no disagreement after the backfill', (await drift()).length === 0, JSON.stringify(await drift()))

// ---- 2. preservation -------------------------------------------------------------
const after = await fingerprint()
for (const t of TRACKED) ok(`no ${t} row changed (count and content identical)`, after[t].c === before[t].c && after[t].h === before[t].h, JSON.stringify([before[t], after[t]]))
ok('the old columns are untouched', (await one(`SELECT count(*) FILTER (WHERE account_type = 'platform_admin')::int a FROM user_accounts`)).a === 2 && (await one(`SELECT org_type::text t, approval_status::text s FROM organizations WHERE id = $1`, [O.pending])).s === 'pending')

// ---- 3. re-runnable -----------------------------------------------------------------
const counts = async () => [await n(`SELECT count(*) FROM platform_roles`), await n(`SELECT count(*) FROM organization_capabilities`), await n(`SELECT count(*) FROM organization_capability_changes`)].join('/')
const c0 = await counts()
let rerunErr = null
try { await db.exec(S1_SQL) } catch (e) { rerunErr = String(e.message) }
ok('the migration can be re-run', rerunErr === null, rerunErr ?? '')
ok('...and re-running adds no grants, capabilities or history', (await counts()) === c0, `${c0} -> ${await counts()}`)
ok('...and changes no existing row', JSON.stringify(await fingerprint()) === JSON.stringify(after))
ok('...and leaves no drift', (await drift()).length === 0)

// ---- 4. no switch: authorization still reads the old columns ----------------------
// Tamper with the new tables directly (as the database owner) and show nothing obeys them.
await sup(`INSERT INTO platform_roles (user_id, role, grant_reason) VALUES ($1, 'platform_admin', 'test: unmirrored grant')`, [U.att2])
ok('an unmirrored platform_admin grant does not make an attendee a platform administrator', (await as(U.att2, `SELECT is_platform_admin() v`)).rows[0].v === false && refused(await err(U.att2, `SELECT admin_list_users()`), /platform administrator/))
ok('identity_s1_drift() reports the unmirrored grant', (await drift()).some((d) => d.subject_id === U.att2))
await sup(`UPDATE platform_roles SET revoked_at = now(), revoke_reason = 'test cleanup' WHERE user_id = $1 AND revoked_at IS NULL`, [U.att2])
await sup(`UPDATE platform_roles SET revoked_at = now(), revoke_reason = 'test: revoked behind the old column' WHERE user_id = $1 AND revoked_at IS NULL`, [U.admin1])
ok('revoking a grant in the new table does not remove platform administration (still read from account_type)', (await as(U.admin1, `SELECT is_platform_admin() v`)).rows[0].v === true)
await sup(`INSERT INTO platform_roles (user_id, role, grant_reason) VALUES ($1, 'platform_admin', 'test restore')`, [U.admin1])
await sup(`INSERT INTO organization_capabilities (organization_id, capability, status) VALUES ($1, 'organize_events', 'active')`, [O.sponsor])
let evErr = null
try { await sup(`INSERT INTO events (name, organization_id, created_by) VALUES ('X', $1, $2)`, [O.sponsor, U.sponsorU]) } catch (e) { evErr = String(e.message) }
ok('an organize_events capability on a sponsor organization does not let it own events (still read from org_type)', refused(evErr, /organizer organization/))
await sup(`DELETE FROM organization_capabilities WHERE organization_id = $1 AND capability = 'organize_events'`, [O.sponsor])
await sup(`UPDATE organization_capabilities SET status = 'suspended' WHERE organization_id = $1`, [O.approved])
ok('suspending a capability in the new table does not stop its organization managing events (yet)', (await as(U.organizerA, `SELECT can_manage_event($1) v`, [EV])).rows[0].v === true)
await sup(`UPDATE organization_capabilities SET status = 'active' WHERE organization_id = $1`, [O.approved])
ok('(cleanup) no drift after the tampering checks', (await drift()).length === 0, JSON.stringify(await drift()))

// ---- 5. sync --------------------------------------------------------------------------
U.newAttendee = await user('new-attendee@t.test')
const orgSignup = (await one(`INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (gen_random_uuid(), 'new-organizer@t.test', now(), '{"account_type":"organizer"}') RETURNING id`)).id
const adminSignup = (await one(`INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (gen_random_uuid(), 'wants-admin@t.test', now(), '{"account_type":"platform_admin"}') RETURNING id`)).id
ok('new signups get no platform grant, including one that asks for platform_admin', (await activeGrants(U.newAttendee)) + (await activeGrants(orgSignup)) + (await activeGrants(adminSignup)) === 0)

ok('(setup) a platform administrator makes an attendee a platform administrator', (await err(U.admin1, `SELECT set_account_type($1, 'platform_admin', 'promoted')`, [U.att2])) === null)
const g2 = (await one(`SELECT granted_by, grant_reason FROM platform_roles WHERE user_id = $1 AND revoked_at IS NULL`, [U.att2])) ?? {}
ok('...which grants exactly one active platform_admin role, recording who granted it', (await activeGrants(U.att2)) === 1 && g2.granted_by === U.admin1 && /mirrored/.test(g2.grant_reason), JSON.stringify(g2))
ok('...and the old and new models agree', (await drift()).length === 0)
await err(U.admin1, `SELECT set_account_type($1, 'attendee', 'demoted')`, [U.att2])
const rv = (await one(`SELECT revoked_by, revoke_reason FROM platform_roles WHERE user_id = $1 ORDER BY granted_at DESC LIMIT 1`, [U.att2])) ?? {}
ok('changing the type away revokes the grant, recording who revoked it, without deleting it', (await activeGrants(U.att2)) === 0 && rv.revoked_by === U.admin1 && (await n(`SELECT count(*) FROM platform_roles WHERE user_id = $1`, [U.att2])) >= 1, JSON.stringify(rv))
await err(U.admin1, `SELECT set_account_type($1, 'platform_admin', 'again')`, [U.att2])
ok('granting again adds a new active grant and keeps the earlier ones as history', (await activeGrants(U.att2)) === 1 && (await n(`SELECT count(*) FROM platform_roles WHERE user_id = $1 AND revoked_at IS NOT NULL`, [U.att2])) >= 2)
await err(U.admin1, `SELECT set_account_type($1, 'attendee', 'done')`, [U.att2])
await err(U.admin1, `SELECT set_account_status($1, 'suspended', 'test')`, [U.organizerA])
ok('changing an account status does not touch platform grants', (await n(`SELECT count(*) FROM platform_roles WHERE user_id = $1`, [U.organizerA])) === 0)
await err(U.admin1, `SELECT set_account_status($1, 'active', 'test')`, [U.organizerA])
await sup(`UPDATE user_accounts SET status = 'active' WHERE user_id = $1`, [U.admin2])
ok('a platform administrator\'s grant survives their own status changes', (await activeGrants(U.admin2)) === 1)
await sup(`UPDATE user_accounts SET status = 'suspended' WHERE user_id = $1`, [U.admin2])

const created = (await as(U.organizerA, `SELECT create_organizer_organization('Created After S1') id`)).rows[0].id
const cc = await cap(created)
ok('a new organization from the app gets a pending organize_events capability requested by its creator', cc.capability === 'organize_events' && cc.status === 'pending' && cc.requested_by === U.organizerA && cc.decided_by === null, JSON.stringify(cc))
const h0 = await history(created)
ok('...with one history row recording its creation', h0.length === 1 && h0[0].p === null && h0[0].s === 'pending' && h0[0].changed_by === U.organizerA, JSON.stringify(h0))

await platformWrite(U.admin1, `UPDATE organizations SET approval_status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [created, U.admin1])
const ap = await cap(created)
ok('platform approval activates the capability and records the approver', ap.status === 'active' && ap.decided_by === U.admin1, JSON.stringify(ap))
await platformWrite(U.admin1, `UPDATE organizations SET approval_status = 'suspended' WHERE id = $1`, [created])
ok('platform suspension suspends the capability', (await cap(created)).status === 'suspended')
await platformWrite(U.admin1, `UPDATE organizations SET approval_status = 'rejected' WHERE id = $1`, [created])
ok('platform rejection revokes the capability', (await cap(created)).status === 'revoked')
const h1 = await history(created)
ok('every status change is in the history, in order, with who made it', JSON.stringify(h1.map((h) => [h.p, h.s])) === JSON.stringify([[null, 'pending'], ['pending', 'active'], ['active', 'suspended'], ['suspended', 'revoked']]) && h1.slice(1).every((h) => h.changed_by === U.admin1), JSON.stringify(h1))
await as(U.organizerA, `UPDATE organizations SET description = 'renamed' WHERE id = $1`, [created])
ok('an ordinary organization edit adds no history', (await history(created)).length === 4)
await as(U.organizerA, `SELECT set_organization_archived($1, true)`, [O.approved])
ok('archiving an organization leaves its capability as it was (archival is separate)', (await cap(O.approved)).status === 'active')
await as(U.organizerA, `SELECT set_organization_archived($1, false)`, [O.approved])

await platformWrite(U.admin1, `UPDATE organizations SET org_type = 'sponsor' WHERE id = $1`, [O.pending])
const moved = await caps(O.pending)
ok('a platform-side organization type change revokes the old capability and adds the new one', JSON.stringify(moved) === JSON.stringify([{ c: 'organize_events', s: 'revoked' }, { c: 'sponsor', s: 'pending' }]), JSON.stringify(moved))
ok('...with both changes in the history', (await history(O.pending)).slice(-2).map((h) => `${h.c}:${h.p}->${h.s}`).join() === 'organize_events:pending->revoked,sponsor:null->pending')

const P2 = (await as(U.organizerA, `INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, 'Rep Co') RETURNING id`, [EV])).rows[0].id
const inv = (await as(U.organizerA, `SELECT invite_partnership_representative($1, 'rep@t.test') id`, [P2])).rows[0].id
const repOrg = (await as(U.rep, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'Rep Co') id`, [inv])).rows[0].id
const rc = await cap(repOrg)
ok('a sponsor organization created by accepting an invitation gets an active sponsor capability', rc.capability === 'sponsor' && rc.status === 'active' && rc.requested_by === U.rep, JSON.stringify(rc))
ok('...without recording the invitee as having approved themselves', rc.decided_by === null)
ok('after every sync path, the old and new models still agree', (await drift()).length === 0, JSON.stringify(await drift()))

// ---- 6. security boundaries -------------------------------------------------------------
const TABLES = ['platform_roles', 'organization_capabilities', 'organization_capability_changes']
const callers = [['anon', null, 'anon'], ['an attendee', U.att1, 'authenticated'], ['an organization owner', U.organizerA, 'authenticated'], ['a platform administrator', U.admin1, 'authenticated']]
for (const [who, uid, role] of callers) {
  for (const t of TABLES) {
    ok(`${who} cannot read ${t}`, refused(await err(uid, `SELECT * FROM ${t}`, [], role), /permission denied/))
  }
  ok(`${who} cannot write any of the new tables`, refused(await err(uid, `INSERT INTO platform_roles (user_id, role, grant_reason) VALUES (${uid ? `'${uid}'` : 'gen_random_uuid()'}, 'platform_admin', 'x')`, [], role), /permission denied/) &&
    refused(await err(uid, `UPDATE organization_capabilities SET status = 'active'`, [], role), /permission denied/) &&
    refused(await err(uid, `DELETE FROM organization_capability_changes`, [], role), /permission denied/))
  for (const fn of [`org_has_capability('${O.approved}', 'organize_events')`, 'identity_s1_drift()', `capability_for_org_type('organizer')`, `capability_status_for_approval('approved')`])
    ok(`${who} cannot call ${fn.split('(')[0]}()`, refused(await err(uid, `SELECT ${fn}`, [], role), /permission denied/))
}
ok('an owner still cannot approve their own organization, so its capability stays pending',
  refused(await err(U.organizerB, `UPDATE organizations SET approval_status = 'approved' WHERE id = $1`, [O.suspended]), /platform administrator/) && (await cap(O.suspended)).status === 'suspended')
const ownPending = (await as(U.organizerB, `SELECT create_organizer_organization('Mine') id`)).rows[0].id
ok('...including a brand-new one', refused(await err(U.organizerB, `UPDATE organizations SET approval_status = 'approved' WHERE id = $1`, [ownPending]), /platform administrator/) && (await cap(ownPending)).status === 'pending')
ok('an owner cannot change their organization type to pick up another capability', refused(await err(U.organizerB, `UPDATE organizations SET org_type = 'sponsor' WHERE id = $1`, [ownPending]), /cannot be changed/) && (await caps(ownPending)).length === 1)
let joinErr = null
try { await sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')`, [O.approved, U.admin1]) } catch (e) { joinErr = String(e.message) }
ok('a platform administrator (now with a platform_roles grant) still cannot join an organization (D-27)', refused(joinErr, /platform administrator/))
ok('a suspended platform administrator keeps the grant row but has no platform powers', (await activeGrants(U.admin2)) === 1 && (await as(U.admin2, `SELECT is_platform_admin() v`)).rows[0].v === false)

// org_has_capability semantics (as the database owner; S2 will grant it to clients).
const hasCap = async (id, c) => (await one(`SELECT org_has_capability($1, $2) v`, [id, c])).v
ok('org_has_capability is true for an active capability', (await hasCap(O.approved, 'organize_events')) === true && (await hasCap(O.sponsor, 'sponsor')) === true)
ok('org_has_capability is false for pending, suspended and revoked capabilities', (await hasCap(ownPending, 'organize_events')) === false && (await hasCap(O.suspended, 'organize_events')) === false && (await hasCap(O.rejected, 'organize_events')) === false)
ok('org_has_capability is false for a capability the organization does not hold, and for an unknown organization', (await hasCap(O.approved, 'sponsor')) === false && (await one(`SELECT org_has_capability(gen_random_uuid(), 'organize_events') v`)).v === false)

// ---- 7. constraints --------------------------------------------------------------------------
const tryRaw = async (sql, params = []) => { try { await sup(sql, params); return null } catch (e) { return String(e.message) } }
ok('a second active grant of the same role is impossible', refused(await tryRaw(`INSERT INTO platform_roles (user_id, role, grant_reason) VALUES ($1, 'platform_admin', 'dup')`, [U.admin1]), /platform_roles_one_active_grant/))
ok('a revocation must say why', refused(await tryRaw(`UPDATE platform_roles SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [U.admin1]), /platform_roles_revocation_complete/))
ok('a history row must be a real change', refused(await tryRaw(`INSERT INTO organization_capability_changes (organization_id, capability, previous_status, new_status, reason) VALUES ($1, 'organize_events', 'active', 'active', 'x')`, [O.approved]), /is_a_change/))
ok('an organization holds each capability at most once', refused(await tryRaw(`INSERT INTO organization_capabilities (organization_id, capability, status) VALUES ($1, 'organize_events', 'active')`, [O.approved]), /duplicate key/))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
