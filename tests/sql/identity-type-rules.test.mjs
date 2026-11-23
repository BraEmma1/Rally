// Account-type and organization-type rules (minimum security foundation PR-4; backlog B-16).
//
// The identity migration (Approach C, RALLY_IDENTITY_ORG_ARCHITECTURE.md) rewrites 25
// functions that read account_type or org_type. identity-authorization.test.mjs covers 21
// of them; this file covers the remaining four, plus the type rules spread across all 25:
//   - invite_event_attendee          (only "attendee" accounts may be invited to an event)
//   - admin_get_event                (platform administrators only)
//   - enforce_event_owner_org_type   (only "organizer" organizations own events)
//   - my_eligible_sponsor_organizations
//   - get_my_organization_access     (the session's view of its own memberships)
//
// Two kinds of check:
//   - plain checks are security properties every migration stage must KEEP;
//   - "TYPE RULE" checks record a rule of the current one-account-one-persona model that
//     Approach C changes ON PURPOSE (decision D-18). Stage S2 flips them, explicitly, in
//     the same pull request that changes the rule, so no type rule changes silently.
// "GAP-n" checks record current behaviour that falls short of CLAUDE.md (see the PR).
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

let pass = 0, fail = 0, rules = 0, gaps = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
const typeRule = (name, cond, detail = '') => {
  if (cond) { pass++; rules++; console.log('RULE', name) } else { fail++; console.log('FAIL TYPE RULE changed; flip it deliberately in the migration PR:', name, detail) }
}
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
const user = async (email) => (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id`, [email])).id
const setAccount = (uid, type, status = 'active') => sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])
const mkOrg = async (name, creator, type = 'organizer') =>
  (await one(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1, $2, 'approved', $3) RETURNING id`, [name, type, creator])).id
const addMember = (org, uid, role) => sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, uid, role])
const mkEvent = async (name, org, by, visibility = 'published', archived = false) => {
  await sup(`SET session_replication_role = replica`)
  try {
    return (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, archived_at)
                       VALUES ($1, 'upcoming', $2, $3, $4, '2030-01-01', '2030-01-02', ${archived ? 'now()' : 'NULL'}) RETURNING id`, [name, visibility, org, by])).id
  } finally { await sup(`SET session_replication_role = origin`) }
}

// ---- fixtures -------------------------------------------------------------
const U = {}
for (const n of ['owner', 'manager', 'owner2', 'padmin', 'attendee', 'organizerTwo', 'sponsorUser', 'vendorUser', 'suspended', 'pendingOrg', 'invitee'])
  U[n] = await user(`${n.toLowerCase()}@t.test`)
await setAccount(U.owner, 'organizer')
await setAccount(U.owner2, 'organizer')
await setAccount(U.organizerTwo, 'organizer')
await setAccount(U.padmin, 'platform_admin')
await setAccount(U.sponsorUser, 'sponsor')
await setAccount(U.vendorUser, 'vendor')
await setAccount(U.suspended, 'attendee', 'suspended')
await setAccount(U.pendingOrg, 'organizer', 'pending_approval')
const ORG = await mkOrg('Org', U.owner)
const ORG2 = await mkOrg('Org Two', U.owner2)
await addMember(ORG, U.manager, 'manager')
const PUB = await mkEvent('Published', ORG, U.owner)
const DRAFT = await mkEvent('Draft', ORG, U.owner, 'draft')
const ARCHIVED = await mkEvent('Archived', ORG, U.owner, 'published', true)
const OTHER = await mkEvent('Other org', ORG2, U.owner2)

// ---- invite_event_attendee ------------------------------------------------
const invite = async (caller, ev, email) => {
  try { return (await as(caller, `SELECT invite_event_attendee($1, $2) id`, [ev, email])).rows[0].id } catch (e) { return { error: String(e.message) } }
}
ok('an event owner invites an attendee to a published event', typeof (await invite(U.owner, PUB, 'Attendee@t.test ')) === 'string')
ok('...the row is for that attendee, sent by the owner, Pending', JSON.stringify(await one(`SELECT invited_user_id = $1 u, invited_by = $2 b, status FROM event_invitations WHERE event_id = $3`, [U.attendee, U.owner, PUB])) === JSON.stringify({ u: true, b: true, status: 'Pending' }))
ok('an organization member who does not manage the event cannot invite', refused((await invite(U.manager, PUB, 'attendee@t.test')).error ?? null, /do not manage/))
ok('another organization\'s owner cannot invite to this event', refused((await invite(U.owner2, PUB, 'attendee@t.test')).error ?? null, /do not manage/))
ok('an attendee cannot invite', refused((await invite(U.attendee, PUB, 'invitee@t.test')).error ?? null, /do not manage/))
ok('a draft event cannot receive invitations', refused((await invite(U.owner, DRAFT, 'invitee@t.test')).error ?? null, /Publish/))
ok('an archived event cannot receive invitations', refused((await invite(U.owner, ARCHIVED, 'invitee@t.test')).error ?? null, /archived/))
ok('an invalid address is refused', refused((await invite(U.owner, PUB, 'nope')).error ?? null, /valid email/))
ok('a suspended account cannot be invited', refused((await invite(U.owner, PUB, 'suspended@t.test')).error ?? null, /No Rally attendee account/))
await setAccount(U.owner, 'organizer', 'suspended')
ok('a suspended event owner cannot invite', refused((await invite(U.owner, PUB, 'invitee@t.test')).error ?? null, /do not manage/))
await setAccount(U.owner, 'organizer', 'active')
ok('a client cannot insert an invitation for an event they do not manage', refused(await err(U.attendee, `INSERT INTO event_invitations (event_id, invited_user_id, invited_by) VALUES ($1, $2, $2)`, [OTHER, U.attendee]), /row-level security/))
for (const [who, type] of [['organizerTwo', 'organizer'], ['sponsorUser', 'sponsor'], ['vendorUser', 'vendor'], ['padmin', 'platform_admin']]) {
  typeRule(`only attendee accounts can be invited to an event: ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} account is refused`, refused((await invite(U.owner, PUB, `${who.toLowerCase()}@t.test`)).error ?? null, /No Rally attendee account/))
}

// An invitee may update their own invitation; the app only ever sets status and responded_at.
const myInvitation = (await one(`SELECT id FROM event_invitations WHERE event_id = $1 AND invited_user_id = $2`, [PUB, U.attendee])).id
ok('the invitee accepts their own invitation', (await as(U.attendee, `UPDATE event_invitations SET status = 'Accepted', responded_at = now() WHERE id = $1`, [myInvitation])).affectedRows === 1)
ok('nobody else can update it', (await as(U.invitee, `UPDATE event_invitations SET status = 'Declined' WHERE id = $1`, [myInvitation])).affectedRows === 0)
gap('GAP-6a', 'the invitee can move their invitation to another organization\'s event (it then appears in that organizer\'s invitation list)',
  (await as(U.attendee, `UPDATE event_invitations SET event_id = $1 WHERE id = $2`, [OTHER, myInvitation])).affectedRows === 1)
gap('GAP-6b', 'the invitee can rewrite who the invitation is from (the response notification goes to that user)',
  (await as(U.attendee, `UPDATE event_invitations SET invited_by = $1 WHERE id = $2`, [U.owner2, myInvitation])).affectedRows === 1)
await sup(`UPDATE event_invitations SET event_id = $1, invited_by = $2 WHERE id = $3`, [PUB, U.owner, myInvitation])

// ---- admin_get_event ------------------------------------------------------
ok('admin_get_event is refused to the event owner', refused(await err(U.owner, `SELECT admin_get_event($1)`, [PUB]), /platform administrator/))
ok('admin_get_event is refused to an attendee', refused(await err(U.attendee, `SELECT admin_get_event($1)`, [PUB]), /platform administrator/))
const detail = (await as(U.padmin, `SELECT admin_get_event($1) d`, [PUB])).rows[0].d
ok('admin_get_event returns the event, its organization and counts to a platform administrator', detail?.event?.id === PUB && detail?.organization?.id === ORG && detail?.organization?.org_type === 'organizer' && typeof detail?.registrations?.total === 'number', JSON.stringify(detail))
ok('admin_get_event returns null for an unknown event', (await as(U.padmin, `SELECT admin_get_event(gen_random_uuid()) d`)).rows[0].d === null)
await setAccount(U.padmin, 'platform_admin', 'suspended')
ok('admin_get_event is refused to a suspended platform administrator', refused(await err(U.padmin, `SELECT admin_get_event($1)`, [PUB]), /platform administrator/))
await setAccount(U.padmin, 'platform_admin', 'active')

// ---- enforce_event_owner_org_type ------------------------------------------
const SPONSOR_ORG = await mkOrg('Sponsor Co', U.sponsorUser, 'sponsor')
const VENDOR_ORG = await mkOrg('Vendor Co', U.vendorUser, 'vendor')
const insertEvent = async (org, by) => {
  try { await sup(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date) VALUES ('T', 'upcoming', 'draft', $1, $2, '2030-01-01', '2030-01-02')`, [org, by]); return null } catch (e) { return String(e.message) }
}
ok('an organizer organization can own an event', (await insertEvent(ORG, U.owner)) === null)
typeRule('a sponsor organization cannot own an event', refused(await insertEvent(SPONSOR_ORG, U.sponsorUser), /organizer organization/))
typeRule('a vendor organization cannot own an event', refused(await insertEvent(VENDOR_ORG, U.vendorUser), /organizer organization/))
ok('an event cannot be moved to a sponsor organization', refused(await (async () => { try { await sup(`UPDATE events SET organization_id = $1 WHERE id = $2`, [SPONSOR_ORG, PUB]); return null } catch (e) { return String(e.message) } })(), /organizer organization/))
typeRule('a sponsor organization\'s owner cannot create an event through the client either', refused(await err(U.sponsorUser, `INSERT INTO events (name, organization_id, created_by) VALUES ('X', $1, $2)`, [SPONSOR_ORG, U.sponsorUser]), /organizer organization/))
ok('an organization owner cannot create an event in another organization', refused(await err(U.owner2, `INSERT INTO events (name, organization_id, created_by) VALUES ('X', $1, $2)`, [ORG, U.owner2]), /row-level security/))
ok('a manager cannot create an organization event (owners and admins only)', refused(await err(U.manager, `INSERT INTO events (name, organization_id, created_by) VALUES ('X', $1, $2)`, [ORG, U.manager]), /row-level security/))

// ---- my_eligible_sponsor_organizations ------------------------------------
const P = (await as(U.owner, `INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, 'Acme') RETURNING id`, [PUB])).rows[0].id
const pInv = (await as(U.owner, `SELECT invite_partnership_representative($1, 'sponsoruser@t.test') id`, [P])).rows[0].id
const ARCHIVED_SPONSOR = await mkOrg('Old Sponsor', U.sponsorUser, 'sponsor')
await sup(`UPDATE organizations SET archived_at = now() WHERE id = $1`, [ARCHIVED_SPONSOR])
const MANAGED_SPONSOR = await mkOrg('Managed Sponsor', U.invitee, 'sponsor')
await setAccount(U.sponsorUser, 'sponsor')
await addMember(MANAGED_SPONSOR, U.sponsorUser, 'manager')
const eligible = (await as(U.sponsorUser, `SELECT organization_id, my_role FROM my_eligible_sponsor_organizations($1)`, [pInv])).rows
ok('the invitee sees the sponsor organizations they own or administer', eligible.some((r) => r.organization_id === SPONSOR_ORG && r.my_role === 'owner'), JSON.stringify(eligible))
ok('...but not an archived one', !eligible.some((r) => r.organization_id === ARCHIVED_SPONSOR))
ok('...nor one where they are only a manager', !eligible.some((r) => r.organization_id === MANAGED_SPONSOR))
ok('...nor any non-sponsor organization', !eligible.some((r) => r.organization_id === VENDOR_ORG || r.organization_id === ORG))
ok('someone the invitation was not sent to is refused', refused(await err(U.attendee, `SELECT * FROM my_eligible_sponsor_organizations($1)`, [pInv]), /No pending invitation/))
ok('the event owner cannot use the invitee\'s invitation', refused(await err(U.owner, `SELECT * FROM my_eligible_sponsor_organizations($1)`, [pInv]), /No pending invitation/))
ok('an unknown invitation is refused', refused(await err(U.sponsorUser, `SELECT * FROM my_eligible_sponsor_organizations(gen_random_uuid())`), /No pending invitation/))
await sup(`UPDATE event_partnership_invitations SET status = 'revoked' WHERE id = $1`, [pInv])
ok('a revoked invitation is refused', refused(await err(U.sponsorUser, `SELECT * FROM my_eligible_sponsor_organizations($1)`, [pInv]), /No pending invitation/))

// ---- get_my_organization_access -------------------------------------------
const access = async (uid) => (await as(uid, `SELECT organization_id, organization_type, organization_role FROM get_my_organization_access()`)).rows
const ownerAccess = await access(U.owner)
ok('get_my_organization_access lists exactly the caller\'s memberships', ownerAccess.length === 1 && ownerAccess[0].organization_id === ORG && ownerAccess[0].organization_role === 'owner', JSON.stringify(ownerAccess))
ok('...never another organization\'s', !(await access(U.owner)).some((r) => r.organization_id === ORG2))
ok('...and nothing for someone with no memberships', (await access(U.attendee)).length === 0)
const sponsorAccess = await access(U.sponsorUser)
typeRule('an account belongs only to organizations of its own type (a sponsor account: sponsor organizations only)',
  sponsorAccess.length > 0 && sponsorAccess.every((r) => r.organization_type === 'sponsor'), JSON.stringify(sponsorAccess))
let crossErr = null
try { await addMember(ORG, U.sponsorUser, 'manager') } catch (e) { crossErr = String(e.message) }
typeRule('a sponsor account cannot join an organizer organization', refused(crossErr, /cannot join/))
crossErr = null
try { await addMember(SPONSOR_ORG, U.organizerTwo, 'admin') } catch (e) { crossErr = String(e.message) }
typeRule('an organizer account cannot join a sponsor organization', refused(crossErr, /cannot join/))
ok('an attendee account can join any organization (their account type is unchanged)', await (async () => { await addMember(SPONSOR_ORG, U.attendee, 'manager'); return (await one(`SELECT account_type FROM user_accounts WHERE user_id = $1`, [U.attendee])).account_type === 'attendee' })())
typeRule('one organization has exactly one type, fixed at creation', refused(await err(U.owner, `UPDATE organizations SET org_type = 'sponsor' WHERE id = $1`, [ORG]), /cannot be changed/))

console.log(`\n${pass} passed (${rules} type rules, ${gaps} known gaps), ${fail} failed`)
process.exit(fail ? 1 : 0)
