// Authorization baseline for identity, organizations and invitations (minimum security
// foundation PR-3; backlog B-05 / B-16 subset).
//
// These are the functions and tables the proposed identity migration (Approach C,
// RALLY_IDENTITY_ORG_ARCHITECTURE.md) will rewrite, and none of them had a behaviour
// test before this file. It pins down today's authorization behaviour so each migration
// stage can prove it kept it:
//   1. signup cannot choose a privileged account type
//   2. platform administrator powers: who has them, and that suspension removes them
//   3. capability escalation: no client path changes an account type, an organization
//      type, an approval or a membership
//   4. organization roles: owner/admin/manager boundaries, last-owner protection,
//      cross-organization isolation
//   5. organization invitations: wrong address, unconfirmed address, expiry, revocation,
//      replay, archived organization, platform administrators
//   6. partnership invitations: the same, plus "an organization you administer"
//   7. suspension and removed membership
//
// "GAP-n" checks record behaviour that is NOT what CLAUDE.md promises (for example "a
// suspended account keeps its rows but loses its access"). They assert today's behaviour
// so this file stays green and the gap stays visible; each is listed in the pull request
// with a proposed fix. When a gap is fixed, flip its check to assert the secure behaviour.
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

let pass = 0, fail = 0, gaps = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
// A known gap: passes while today's (insecure) behaviour holds, and says so.
const gap = (id, name, cond, detail = '') => {
  if (cond) { pass++; gaps++; console.log(`GAP  ${id} (current behaviour, see PR) ${name}`) } else { fail++; console.log(`FAIL ${id} behaviour changed, update this check:`, name, detail) }
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
const user = async (email, { meta = {}, confirmed = true } = {}) =>
  (await one(`INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
              VALUES (gen_random_uuid(), $1, $2, ${confirmed ? 'now()' : 'NULL'}) RETURNING id`, [email, meta])).id
const account = (uid) => one(`SELECT account_type, status FROM user_accounts WHERE user_id = $1`, [uid])
const setAccount = (uid, type, status = 'active') =>
  sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])
const memberRole = async (org, uid) => (await one(`SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`, [org, uid]))?.role ?? null
const addMember = (org, uid, role) => sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, uid, role])
const mkOrg = async (name, creator, type = 'organizer', approval = 'approved') =>
  (await one(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [name, type, approval, creator])).id

// ---- 1. signup ------------------------------------------------------------
const U = {}
U.signupOrganizer = await user('signup-organizer@t.test', { meta: { account_type: 'organizer' } })
U.signupAdmin = await user('signup-admin@t.test', { meta: { account_type: 'platform_admin' } })
U.signupSponsor = await user('signup-sponsor@t.test', { meta: { account_type: 'sponsor' } })
U.signupVendor = await user('signup-vendor@t.test', { meta: { account_type: 'vendor' } })
U.signupPlain = await user('signup-plain@t.test')
const a1 = await account(U.signupOrganizer)
ok('signup asking for organizer gets an organizer account awaiting approval', a1.account_type === 'organizer' && a1.status === 'pending_approval', JSON.stringify(a1))
for (const [k, label] of [['signupAdmin', 'platform_admin'], ['signupSponsor', 'sponsor'], ['signupVendor', 'vendor'], ['signupPlain', 'nothing']]) {
  const a = await account(U[k])
  ok(`signup asking for ${label} gets an active attendee account`, a.account_type === 'attendee' && a.status === 'active', JSON.stringify(a))
}
ok('every signup gets a profile', Number((await one(`SELECT count(*) n FROM profiles WHERE id = ANY($1)`, [Object.values(U)])).n) === 5)

// ---- fixtures -------------------------------------------------------------
for (const n of ['padmin', 'padmin2', 'owner', 'admin', 'manager', 'attendee', 'owner2', 'suspAdmin', 'pendingOrganizer', 'rep', 'sponsorAdmin'])
  U[n] = await user(`${n.toLowerCase()}@t.test`)
U.unconfirmed = await user('unconfirmed@t.test', { confirmed: false })
await setAccount(U.padmin, 'platform_admin')
await setAccount(U.padmin2, 'platform_admin')
await setAccount(U.owner, 'organizer')
await setAccount(U.owner2, 'organizer')
await setAccount(U.pendingOrganizer, 'organizer', 'pending_approval')
const ORG = await mkOrg('Org', U.owner)
const ORG2 = await mkOrg('Other Org', U.owner2)
const SPONSOR_ORG = await mkOrg('Sponsor Co', U.sponsorAdmin, 'sponsor')
await addMember(ORG, U.admin, 'admin')
await addMember(ORG, U.manager, 'manager')
await addMember(ORG, U.suspAdmin, 'admin')
ok('(setup) the organization trigger made each creator the owner', (await memberRole(ORG, U.owner)) === 'owner' && (await memberRole(ORG2, U.owner2)) === 'owner' && (await memberRole(SPONSOR_ORG, U.sponsorAdmin)) === 'owner')

// ---- 2. platform administrator powers -------------------------------------
const changes = async (uid) => Number((await one(`SELECT count(*) n FROM account_type_changes WHERE user_id = $1`, [uid])).n)
for (const [who, label] of [['attendee', 'an attendee'], ['owner', 'an organization owner'], ['admin', 'an organization admin']]) {
  ok(`${label} cannot change an account type`, refused(await err(U[who], `SELECT set_account_type($1, 'platform_admin', 'x')`, [U.attendee]), /platform administrator/))
  ok(`${label} cannot change an account status`, refused(await err(U[who], `SELECT set_account_status($1, 'suspended', 'x')`, [U.padmin]), /platform administrator/))
}
ok('nobody can make themselves a platform administrator', refused(await err(U.attendee, `SELECT set_account_type($1, 'platform_admin', 'x')`, [U.attendee])) && (await account(U.attendee)).account_type === 'attendee')
ok('anon cannot call the account RPCs at all', refused(await err(null, `SELECT set_account_type($1, 'platform_admin', 'x')`, [U.attendee], 'anon'), /permission denied/))
ok('a platform administrator cannot change their own type', refused(await err(U.padmin, `SELECT set_account_type($1, 'attendee', 'x')`, [U.padmin]), /your own/))
ok('a platform administrator cannot change their own status', refused(await err(U.padmin, `SELECT set_account_status($1, 'suspended', 'x')`, [U.padmin]), /your own/))
const before = await changes(U.signupOrganizer)
ok('a platform administrator approves an organizer', (await err(U.padmin, `SELECT set_account_status($1, 'active', 'approved')`, [U.signupOrganizer])) === null && (await account(U.signupOrganizer)).status === 'active')
const log = await one(`SELECT changed_by, previous_status, new_status FROM account_type_changes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [U.signupOrganizer])
ok('...and the change is audited with who made it', (await changes(U.signupOrganizer)) === before + 1 && log.changed_by === U.padmin && log.previous_status === 'pending_approval' && log.new_status === 'active', JSON.stringify(log))

const ADMIN_READS = [
  [`SELECT admin_platform_overview()`, []],
  [`SELECT admin_list_users()`, []],
  [`SELECT admin_list_organizations()`, []],
  [`SELECT admin_list_events()`, []],
  [`SELECT admin_get_organization($1)`, [ORG]],
  [`SELECT admin_activity_series('accounts', 'day', current_date - 7, current_date)`, []],
]
for (const [sql] of ADMIN_READS) {
  const name = sql.match(/admin_\w+/)[0]
  ok(`${name}: refused to an organization owner`, refused(await err(U.owner, sql, ADMIN_READS.find((r) => r[0] === sql)[1]), /platform administrator/))
  ok(`${name}: works for a platform administrator`, (await err(U.padmin, sql, ADMIN_READS.find((r) => r[0] === sql)[1])) === null)
}
ok('only platform administrators read the account audit log', (await as(U.owner, `SELECT * FROM account_type_changes`)).rows.length === 0 && (await as(U.padmin, `SELECT * FROM account_type_changes`)).rows.length > 0)
ok('a user reads only their own account row', (await as(U.attendee, `SELECT user_id FROM user_accounts`)).rows.every((r) => r.user_id === U.attendee))

// A suspended platform administrator has no powers left.
await setAccount(U.padmin2, 'platform_admin', 'suspended')
ok('a suspended platform administrator cannot change types', refused(await err(U.padmin2, `SELECT set_account_type($1, 'organizer', 'x')`, [U.attendee]), /platform administrator/))
ok('a suspended platform administrator cannot change status', refused(await err(U.padmin2, `SELECT set_account_status($1, 'suspended', 'x')`, [U.attendee]), /platform administrator/))
ok('a suspended platform administrator cannot read admin data', refused(await err(U.padmin2, `SELECT admin_list_users()`), /platform administrator/))
ok('is_platform_admin() is false once suspended', (await as(U.padmin2, `SELECT is_platform_admin() v`)).rows[0].v === false)
await setAccount(U.padmin2, 'platform_admin', 'active')

// Platform administrators cannot belong to an organization.
let joinErr = null
try { await addMember(ORG, U.padmin, 'admin') } catch (e) { joinErr = String(e.message) }
ok('a platform administrator cannot be made an organization member, even directly', refused(joinErr, /platform administrator/))
ok('a platform administrator cannot be invited', refused(await err(U.owner, `SELECT invite_organization_member($1, 'padmin@t.test', 'manager')`, [ORG]), /platform administrator/))

// ---- 3. capability escalation baseline -----------------------------------
// The identity migration replaces account_type / org_type with platform roles and
// organization capabilities. Whatever replaces them must keep every one of these.
ok('a user cannot update their own account row', refused(await err(U.attendee, `UPDATE user_accounts SET account_type = 'platform_admin' WHERE user_id = $1`, [U.attendee]), /permission denied/))
ok('a user cannot insert an account row', refused(await err(U.attendee, `INSERT INTO user_accounts (user_id, account_type, status) VALUES (gen_random_uuid(), 'platform_admin', 'active')`), /permission denied/))
ok('a user cannot write the account audit log', refused(await err(U.attendee, `INSERT INTO account_type_changes (user_id, changed_by, previous_type, new_type, previous_status, new_status, reason) VALUES ($1, $1, 'attendee', 'platform_admin', 'active', 'active', 'x')`, [U.attendee]), /permission denied/))
ok('an owner cannot change their organization\'s type', refused(await err(U.owner, `UPDATE organizations SET org_type = 'sponsor' WHERE id = $1`, [ORG]), /type cannot be changed/))
const PENDING_ORG = await mkOrg('Pending Org', U.owner2, 'organizer', 'pending')
ok('an owner cannot approve a pending organization by UPDATE', refused(await err(U.owner2, `UPDATE organizations SET approval_status = 'approved' WHERE id = $1`, [PENDING_ORG]), /platform administrator/))
ok('an owner cannot forge approval details by UPDATE', refused(await err(U.owner2, `UPDATE organizations SET approved_by = $2, approved_at = now() WHERE id = $1`, [PENDING_ORG, U.owner2]), /not client-writable/))
ok('an owner cannot change who created the organization', refused(await err(U.owner2, `UPDATE organizations SET created_by = $2 WHERE id = $1`, [PENDING_ORG, U.attendee]), /creator/))
ok('a user cannot insert themselves into an organization', refused(await err(U.attendee, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, [ORG, U.attendee]), /row-level security|permission denied/) && (await memberRole(ORG, U.attendee)) === null)
ok('an admin cannot promote themselves by direct UPDATE', refused(await err(U.admin, `UPDATE organization_members SET role = 'owner' WHERE user_id = $1`, [U.admin]), /row-level security|permission denied/) || (await memberRole(ORG, U.admin)) === 'admin')
ok('...and the admin is still an admin', (await memberRole(ORG, U.admin)) === 'admin')
ok('an attendee cannot create an organization', refused(await err(U.attendee, `SELECT create_organizer_organization('Mine')`), /organizer account/))
ok('an organizer awaiting approval cannot create an organization', refused(await err(U.pendingOrganizer, `SELECT create_organizer_organization('Mine')`), /awaiting approval/))
const created = (await as(U.owner, `SELECT create_organizer_organization('Created by RPC') id`)).rows[0].id
const createdRow = await one(`SELECT org_type, approval_status, approved_by FROM organizations WHERE id = $1`, [created])
ok('an active organizer creates an organizer organization that starts pending', createdRow.org_type === 'organizer' && createdRow.approval_status === 'pending' && createdRow.approved_by === null, JSON.stringify(createdRow))
ok('...and becomes its owner', (await memberRole(created, U.owner)) === 'owner')
ok('an attendee cannot insert an organization directly', refused(await err(U.attendee, `INSERT INTO organizations (name, org_type, created_by) VALUES ('X', 'organizer', $1)`, [U.attendee]), /permission denied/))
ok('nobody can insert a sponsor organization directly', refused(await err(U.owner, `INSERT INTO organizations (name, org_type, created_by) VALUES ('X', 'sponsor', $1)`, [U.owner]), /permission denied/))
const forgeErr = await err(U.owner, `INSERT INTO organizations (name, org_type, created_by, approval_status, approved_by, approved_at) VALUES ('Self-approved', 'organizer', $1, 'approved', $1, now())`, [U.owner])
const forged = await one(`SELECT approval_status, approved_by FROM organizations WHERE name = 'Self-approved'`)
// GAP-5, fixed by migration 20261123000100: no client INSERT on organizations at all.
ok('an active organizer cannot INSERT an organization directly, so cannot forge approval (GAP-5 fixed)',
  refused(forgeErr, /permission denied/) && forged === undefined, String(forgeErr))

// ---- 4. organization roles ------------------------------------------------
const setRole = (caller, org, target, role) => err(caller, `SELECT set_organization_member_role($1, $2, $3)`, [org, target, role])
const remove = (caller, org, target) => err(caller, `SELECT remove_organization_member($1, $2)`, [org, target])
ok('a manager cannot change roles', refused(await setRole(U.manager, ORG, U.admin, 'manager'), /owner or admin/) && (await memberRole(ORG, U.admin)) === 'admin')
ok('an admin cannot mint an owner', refused(await setRole(U.admin, ORG, U.manager, 'owner'), /owner role/) && (await memberRole(ORG, U.manager)) === 'manager')
ok('an admin cannot demote the owner', refused(await setRole(U.admin, ORG, U.owner, 'admin'), /owner role/) && (await memberRole(ORG, U.owner)) === 'owner')
ok('nobody can change their own role', refused(await setRole(U.owner, ORG, U.owner, 'admin'), /your own/))
ok('the last owner cannot be demoted', refused(await setRole(U.owner, ORG, U.owner, 'admin')) && (await memberRole(ORG, U.owner)) === 'owner')
ok('an owner of another organization has no authority here', refused(await setRole(U.owner2, ORG, U.manager, 'admin'), /not a member/) && (await memberRole(ORG, U.manager)) === 'manager')
ok('an admin changes a manager to admin and back', (await setRole(U.admin, ORG, U.manager, 'admin')) === null && (await setRole(U.admin, ORG, U.manager, 'manager')) === null && (await memberRole(ORG, U.manager)) === 'manager')
ok('a manager cannot remove anyone', refused(await remove(U.manager, ORG, U.admin), /owner or admin/) && (await memberRole(ORG, U.admin)) === 'admin')
ok('an admin cannot remove the owner', refused(await remove(U.admin, ORG, U.owner), /owner/) && (await memberRole(ORG, U.owner)) === 'owner')
ok('nobody can remove themselves this way', refused(await remove(U.admin, ORG, U.admin), /yourself/))
ok('an owner of another organization cannot remove members here', refused(await remove(U.owner2, ORG, U.manager), /not a member/) && (await memberRole(ORG, U.manager)) === 'manager')
ok('an admin cannot archive the organization', refused(await err(U.admin, `SELECT set_organization_archived($1, true)`, [ORG]), /owner/))
ok('another organization\'s owner cannot archive it', refused(await err(U.owner2, `SELECT set_organization_archived($1, true)`, [ORG]), /not a member/))
ok('members of one organization cannot read another organization\'s members', (await as(U.owner2, `SELECT * FROM organization_members WHERE organization_id = $1`, [ORG])).rows.length === 0)
ok('members of one organization cannot read another organization', (await as(U.owner2, `SELECT * FROM organizations WHERE id = $1`, [ORG])).rows.length === 0)
ok('an admin of another organization cannot update this one', (await as(U.owner2, `UPDATE organizations SET description = 'x' WHERE id = $1`, [ORG])).affectedRows === 0)
ok('the member directory is refused to another organization', refused(await err(U.owner2, `SELECT * FROM organization_member_directory($1)`, [ORG])))

// ---- 5. organization invitations ------------------------------------------
const invite = async (caller, org, email, role = 'manager') => {
  try { return (await as(caller, `SELECT invite_organization_member($1, $2, $3) id`, [org, email, role])).rows[0].id } catch (e) { return { error: String(e.message) } }
}
const accept = (caller, id) => err(caller, `SELECT accept_organization_invitation($1)`, [id])
const invStatus = async (id) => (await one(`SELECT status FROM organization_invitations WHERE id = $1`, [id]))?.status
ok('a manager cannot invite', refused((await invite(U.manager, ORG, 'x@t.test')).error ?? null, /owner or admin/))
ok('an admin cannot invite an owner', refused((await invite(U.admin, ORG, 'x@t.test', 'owner')).error ?? null, /owner/))
ok('an owner of another organization cannot invite here', refused((await invite(U.owner2, ORG, 'x@t.test')).error ?? null, /not a member/))
ok('an invalid address is refused', refused((await invite(U.owner, ORG, 'not-an-email')).error ?? null, /valid email/))

const invA = await invite(U.owner, ORG, 'ATTENDEE@t.test  ')
ok('an owner invites an existing attendee (address normalised)', typeof invA === 'string' && (await one(`SELECT invited_email FROM organization_invitations WHERE id = $1`, [invA])).invited_email === 'attendee@t.test')
ok('the wrong person cannot accept it', refused(await accept(U.rep, invA), /No pending invitation/) && (await memberRole(ORG, U.rep)) === null)
ok('an organization admin cannot accept it on the invitee\'s behalf', refused(await accept(U.admin, invA), /No pending invitation/))
ok('the invitee only sees invitations sent to their own confirmed address', (await as(U.attendee, `SELECT id FROM my_pending_organization_invitations()`)).rows.map((r) => r.id).join() === invA && (await as(U.rep, `SELECT id FROM my_pending_organization_invitations()`)).rows.length === 0)
ok('the invitee accepts and joins with the invited role', (await accept(U.attendee, invA)) === null && (await memberRole(ORG, U.attendee)) === 'manager' && (await invStatus(invA)) === 'accepted')
ok('...and their account type and status are unchanged', JSON.stringify(await account(U.attendee)) === JSON.stringify({ account_type: 'attendee', status: 'active' }))
ok('an accepted invitation cannot be replayed', refused(await accept(U.attendee, invA), /No pending invitation/))
ok('an already-accepted invitation cannot be revoked', refused(await err(U.owner, `SELECT revoke_organization_invitation($1)`, [invA]), /No pending invitation/))
ok('inviting someone already on the team is refused', refused((await invite(U.owner, ORG, 'attendee@t.test')).error ?? null, /already on the team/))

const invU = await invite(U.owner, ORG, 'unconfirmed@t.test')
ok('an unconfirmed address cannot accept', refused(await accept(U.unconfirmed, invU), /Confirm your email/) && (await memberRole(ORG, U.unconfirmed)) === null)

const invR = await invite(U.owner, ORG, 'rep@t.test')
ok('another organization\'s owner cannot revoke it', refused(await err(U.owner2, `SELECT revoke_organization_invitation($1)`, [invR]), /not a member/) && (await invStatus(invR)) === 'pending')
ok('a manager cannot revoke it', refused(await err(U.manager, `SELECT revoke_organization_invitation($1)`, [invR]), /owner or admin/))
ok('an admin revokes it', (await err(U.admin, `SELECT revoke_organization_invitation($1)`, [invR])) === null && (await invStatus(invR)) === 'revoked')
ok('a revoked invitation cannot be accepted', refused(await accept(U.rep, invR), /No pending invitation/) && (await memberRole(ORG, U.rep)) === null)
const reinvite = await invite(U.owner, ORG, 'rep@t.test')
ok('BUG-1 fixed: revoked invitation may be replaced with a fresh token',
  typeof reinvite === 'string' && reinvite !== invR, JSON.stringify(reinvite))
ok('revoked old token remains unusable after replacement', refused(await accept(U.rep, invR), /No pending invitation/))
ok('replacement invitation is pending', typeof reinvite === 'string' && (await invStatus(reinvite)) === 'pending', JSON.stringify(reinvite))
const invOwner = await invite(U.owner, ORG, 'future-owner@t.test', 'owner')
ok('an admin cannot revoke an owner invitation', refused(await err(U.admin, `SELECT revoke_organization_invitation($1)`, [invOwner]), /owner/))
await err(U.owner, `SELECT revoke_organization_invitation($1)`, [invOwner])

U.expiring = await user('expiring@t.test')
const invE = await invite(U.owner, ORG, 'expiring@t.test')
await sup(`UPDATE organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [invE])
ok('an expired invitation cannot be accepted', refused(await accept(U.expiring, invE), /No pending invitation/) && (await memberRole(ORG, U.expiring)) === null)

// BUG-1: expired invitation remains unusable after a new one is issued.
const renewedExpired = await invite(U.owner, ORG, 'expiring@t.test')
ok('an expired invitation is replaced with a new token', typeof renewedExpired === 'string' && renewedExpired !== invE, JSON.stringify(renewedExpired))
ok('expired old link stays invalid after renewal', refused(await accept(U.expiring, invE), /No pending invitation/))
await setAccount(U.expiring, 'organizer')
ok('renewed expired invitation can be accepted once', typeof renewedExpired === 'string' && (await accept(U.expiring, renewedExpired)) === null && (await memberRole(ORG, U.expiring)) !== null)
ok('renewed expired invitation cannot be replayed', typeof renewedExpired === 'string' && refused(await accept(U.expiring, renewedExpired), /No pending invitation/))

const ARCH = await mkOrg('Archived Org', U.owner2)
const invX = await invite(U.owner2, ARCH, 'rep@t.test')
await sup(`UPDATE organizations SET archived_at = now() WHERE id = $1`, [ARCH])
ok('an invitation to an archived organization cannot be accepted', refused(await accept(U.rep, invX), /No pending invitation/) && (await memberRole(ARCH, U.rep)) === null)
ok('an archived organization cannot send invitations', refused((await invite(U.owner2, ARCH, 'other@t.test')).error ?? null, /archived/))

// A platform administrator who receives an invitation sent before they became one.
U.late = await user('late@t.test')
const invLate = await invite(U.owner, ORG, 'late@t.test')
await setAccount(U.late, 'platform_admin')
ok('a platform administrator cannot accept an invitation, even one sent earlier', refused(await accept(U.late, invLate), /platform administrator/) && (await memberRole(ORG, U.late)) === null)

// Organizer approval through an invitation (organization-level vs person-level approval).
const invPend = await invite(U.owner2, PENDING_ORG, 'pendingorganizer@t.test')
ok('(setup) an organization still awaiting platform approval can invite', typeof invPend === 'string')
gap('GAP-3', 'an organizer awaiting platform approval is activated by accepting an invitation from an organization that is itself unapproved',
  (await accept(U.pendingOrganizer, invPend)) === null && (await account(U.pendingOrganizer)).status === 'active')
ok('...the activation is audited as such', /Activated by accepting an organization invitation/.test((await one(`SELECT reason FROM account_type_changes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [U.pendingOrganizer])).reason))

// Direct table writes on organization_invitations bypass the RPC's checks.
const directInvite = (caller, org, email, role = 'manager', expires = '30 days') =>
  err(caller, `INSERT INTO organization_invitations (organization_id, invited_email, role, status, invited_by, expires_at) VALUES ($1, $2, $3, 'pending', $4, now() + $5::interval)`, [org, email, role, caller, expires])
// GAP-1, fixed by migration 20261123000100: invitations are written only through the RPCs.
ok('a manager cannot insert an invitation directly', refused(await directInvite(U.manager, ORG, 'direct@t.test'), /permission denied/))
ok('an admin cannot insert an owner invitation directly', refused(await directInvite(U.admin, ORG, 'direct@t.test', 'owner'), /permission denied/))
ok('an owner of another organization cannot insert one directly', refused(await directInvite(U.owner2, ORG, 'direct@t.test'), /permission denied/))
ok('an admin cannot INSERT an invitation directly, so cannot choose its expiry (GAP-1a fixed)',
  refused(await directInvite(U.admin, ORG, 'ten-years@t.test', 'manager', '10 years'), /permission denied/) &&
  (await one(`SELECT id FROM organization_invitations WHERE invited_email = 'ten-years@t.test'`)) === undefined)
ok('an admin cannot UPDATE an invitation directly, so cannot re-open a revoked one (GAP-1b fixed)',
  refused(await err(U.admin, `UPDATE organization_invitations SET status = 'pending', expires_at = now() + interval '10 years' WHERE id = $1`, [invR]), /permission denied/) && (await invStatus(invR)) === 'revoked')
ok('an admin cannot DELETE an invitation directly', refused(await err(U.admin, `DELETE FROM organization_invitations WHERE id = $1`, [invR]), /permission denied/) && (await invStatus(invR)) === 'revoked')
ok('admins still read their organization\'s invitations', (await as(U.admin, `SELECT id FROM organization_invitations WHERE id = $1`, [invR])).rows.length === 1)

// ---- 6. partnership invitations -----------------------------------------
await sup(`SET session_replication_role = replica`)
const EV = (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date) VALUES ('Expo', 'upcoming', 'draft', $1, $2, '2030-01-01', '2030-01-02') RETURNING id`, [ORG, U.owner])).id
await sup(`SET session_replication_role = origin`)
const partnership = async (name) => (await as(U.owner, `INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, $2) RETURNING id`, [EV, name])).rows[0].id
const pInvite = async (caller, p, email) => {
  try { return (await as(caller, `SELECT invite_partnership_representative($1, $2) id`, [p, email])).rows[0].id } catch (e) { return { error: String(e.message) } }
}
const pAccept = (caller, inv, org) => err(caller, `SELECT accept_partnership_invitation_with_organization($1, $2)`, [inv, org])
const pStatus = async (p) => (await one(`SELECT status, sponsor_organization_id FROM event_partnerships WHERE id = $1`, [p]))
const P1 = await partnership('Acme')
ok('someone who does not manage the event cannot invite a representative', refused((await pInvite(U.owner2, P1, 'sponsoradmin@t.test')).error ?? null, /do not manage/))
ok('an unassigned manager cannot invite a representative', refused((await pInvite(U.manager, P1, 'sponsoradmin@t.test')).error ?? null, /do not manage/))
const pi1 = await pInvite(U.owner, P1, 'sponsoradmin@t.test')
ok('the event owner invites a representative', typeof pi1 === 'string' && (await pStatus(P1)).status === 'invited')
ok('a client cannot write partnership invitations directly', refused(await err(U.owner, `UPDATE event_partnership_invitations SET status = 'accepted' WHERE id = $1`, [pi1]), /permission denied/))
ok('the wrong person cannot accept', refused(await pAccept(U.attendee, pi1, SPONSOR_ORG), /No pending invitation/))
ok('the invitee cannot accept for an organization they do not administer', refused(await pAccept(U.sponsorAdmin, pi1, ORG2), /do not administer/) && (await pStatus(P1)).sponsor_organization_id === null)
await addMember(ORG2, U.sponsorAdmin, 'admin').catch(() => {})
ok('the invitee cannot link a non-sponsor organization', refused(await pAccept(U.sponsorAdmin, pi1, ORG2)) && (await pStatus(P1)).sponsor_organization_id === null)
ok('the invitee accepts for the sponsor organization they own', (await pAccept(U.sponsorAdmin, pi1, SPONSOR_ORG)) === null && (await pStatus(P1)).sponsor_organization_id === SPONSOR_ORG && (await pStatus(P1)).status === 'active')
ok('an accepted partnership invitation cannot be replayed', refused(await pAccept(U.sponsorAdmin, pi1, SPONSOR_ORG), /already been accepted|No pending/))
ok('...nor used to create a second sponsor organization', refused(await err(U.sponsorAdmin, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'Second')`, [pi1]), /already been accepted|No pending/))

const P2 = await partnership('Beta')
const pi2 = await pInvite(U.owner, P2, 'rep@t.test')
ok('an unconfirmed address cannot respond', refused(await err(U.unconfirmed, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'U')`, [pi2]), /Confirm your email|No pending/))
ok('another organization\'s owner cannot revoke it', refused(await err(U.owner2, `SELECT revoke_partnership_invitation($1)`, [pi2]), /do not manage/))
ok('the event owner revokes it', (await err(U.owner, `SELECT revoke_partnership_invitation($1)`, [pi2])) === null && (await pStatus(P2)).status === 'draft')
ok('a revoked partnership invitation cannot be accepted', refused(await err(U.rep, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'R')`, [pi2]), /already been revoked|no longer open/))
const pi3 = await pInvite(U.owner, P2, 'rep@t.test')
await sup(`UPDATE event_partnership_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [pi3])
ok('an expired partnership invitation cannot be accepted', refused(await err(U.rep, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'E')`, [pi3]), /expired/))
const P3 = await partnership('Gamma')
const pi4 = await pInvite(U.owner, P3, 'owner2@t.test')
ok('an organizer account cannot accept a partnership (account type rule the migration replaces)', refused(await err(U.owner2, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'O2')`, [pi4]), /cannot join a sponsor organization/))
const P4 = await partnership('Delta')
const pi5 = await pInvite(U.owner, P4, 'rep@t.test')
const newSponsor = (await as(U.rep, `SELECT create_sponsor_organization_for_partnership_invitation($1, 'Rep Co') id`, [pi5])).rows[0].id
ok('accepting by creating a sponsor organization makes the caller its owner and links it', (await memberRole(newSponsor, U.rep)) === 'owner' && (await pStatus(P4)).sponsor_organization_id === newSponsor)
ok('...a sponsor organization created this way is approved (organizer\'s invitation vouches for it)', (await one(`SELECT approval_status, org_type FROM organizations WHERE id = $1`, [newSponsor])).approval_status === 'approved')

// ---- 7. suspension and removed membership ---------------------------------
await setAccount(U.suspAdmin, 'attendee', 'suspended')
ok('a suspended admin cannot invite through the RPC', refused((await invite(U.suspAdmin, ORG, 's1@t.test')).error ?? null, /not active/))
ok('a suspended admin cannot change roles', refused(await setRole(U.suspAdmin, ORG, U.manager, 'admin'), /not active/))
ok('a suspended admin cannot remove members', refused(await remove(U.suspAdmin, ORG, U.manager), /not active/))
ok('a suspended admin cannot read the member directory', refused(await err(U.suspAdmin, `SELECT * FROM organization_member_directory($1)`, [ORG]), /not active/))
ok('a suspended admin cannot update the organization', (await as(U.suspAdmin, `UPDATE organizations SET description = 'x' WHERE id = $1`, [ORG])).affectedRows === 0)
ok('a suspended admin cannot invite a partnership representative', refused((await pInvite(U.suspAdmin, await partnership('Zeta'), 'z@t.test')).error ?? null, /do not manage/))
ok('a suspended admin cannot write event partnerships directly', (await as(U.suspAdmin, `UPDATE event_partnerships SET description = 'x' WHERE event_id = $1`, [EV])).affectedRows === 0)
ok('a suspended admin cannot update the organization\'s events', (await as(U.suspAdmin, `UPDATE events SET description = 'x' WHERE id = $1`, [EV])).affectedRows === 0)
// can_manage_event() is a membership test only; write policies and RPCs add account_is_active()
// themselves, most read policies do not. So suspension stops writes but not reads.
ok('GAP-2d fixed: a suspended admin cannot manage an event',
  (await as(U.suspAdmin, `SELECT can_manage_event($1) v`, [EV])).rows[0].v === false)
await sup(`SET session_replication_role = replica`)
await sup(`INSERT INTO event_registrations (event_id, user_id, status, contact_email) VALUES ($1, $2, 'registered', 'reg@t.test')`, [EV, U.rep])
await sup(`SET session_replication_role = origin`)
ok('a suspended admin cannot read registrations directly (no client SELECT on the table)',
  refused(await err(U.suspAdmin, `SELECT contact_email FROM event_registrations WHERE event_id = $1`, [EV]), /permission denied/))
ok('...nor through the attendee page RPC', refused(await err(U.suspAdmin, `SELECT * FROM event_attendee_page($1)`, [EV])))
const invS = await invite(U.owner2, ORG2, 'suspadmin@t.test')
ok('a suspended account cannot accept an invitation', refused(await accept(U.suspAdmin, invS), /not active/) && (await memberRole(ORG2, U.suspAdmin)) === null)
ok('a suspended admin cannot INSERT an invitation directly either (GAP-1c fixed)',
  refused(await directInvite(U.suspAdmin, ORG, 'suspended-direct@t.test'), /permission denied/))
ok('GAP-2a fixed: suspended accounts cannot read their organization or members',
  (await as(U.suspAdmin, `SELECT id FROM organizations WHERE id = $1`, [ORG])).rows.length === 0 && (await as(U.suspAdmin, `SELECT user_id FROM organization_members WHERE organization_id = $1`, [ORG])).rows.length === 0)
ok('GAP-2b fixed: suspended admins cannot read organization invitations',
  (await as(U.suspAdmin, `SELECT id FROM organization_invitations WHERE organization_id = $1`, [ORG])).rows.length === 0)
ok('GAP-2c fixed: suspended accounts see no organization access',
  (await as(U.suspAdmin, `SELECT organization_id FROM get_my_organization_access()`)).rows.length === 0)
await setAccount(U.suspAdmin, 'attendee', 'active')

// Removed membership: every path closes.
await sup(`SET session_replication_role = replica`)
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV, U.manager, U.owner])
await sup(`SET session_replication_role = origin`)
ok('(setup) an assigned manager can manage the event', (await as(U.manager, `SELECT can_manage_event($1) v`, [EV])).rows[0].v === true)
ok('an admin removes the manager', (await remove(U.admin, ORG, U.manager)) === null && (await memberRole(ORG, U.manager)) === null)
ok('...their event assignments are cleared', Number((await one(`SELECT count(*) n FROM event_team WHERE user_id = $1`, [U.manager])).n) === 0)
ok('...they can no longer manage the event', (await as(U.manager, `SELECT can_manage_event($1) v`, [EV])).rows[0].v === false)
ok('...or read the organization or its members', (await as(U.manager, `SELECT id FROM organizations WHERE id = $1`, [ORG])).rows.length === 0 && (await as(U.manager, `SELECT user_id FROM organization_members WHERE organization_id = $1`, [ORG])).rows.length === 0)
ok('...or invite anyone', refused((await invite(U.manager, ORG, 'after@t.test')).error ?? null, /not a member/))
ok('...or invite a partnership representative', refused((await pInvite(U.manager, await partnership('Epsilon'), 'after@t.test')).error ?? null, /do not manage/))

// The account-type rule the migration replaces, recorded as-is.
gap('GAP-4', 'a platform administrator can turn an organization member into a platform administrator, who then stays a member',
  (await err(U.padmin, `SELECT set_account_type($1, 'platform_admin', 'x')`, [U.admin])) === null && (await memberRole(ORG, U.admin)) === 'admin')

console.log(`\n${pass} passed (${gaps} of them known gaps), ${fail} failed`)
process.exit(fail ? 1 : 0)
