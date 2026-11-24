// The data contract behind the workspace switcher (frontend phase 1). No
// migration is added: this checks what the EXISTING functions already guarantee,
// because the switcher builds on them and adds no authorization of its own.
//
//   - get_my_organization_access lists exactly the caller's own memberships, each
//     with the caller's own role and own event assignments, and nothing for a
//     suspended account. Memberships are created and removed through the real
//     invitation, acceptance and removal RPCs.
//   - Every organization-scoped read a switch triggers (the dashboard, Events,
//     People and Team pages) gives a non-member nothing private: so a stale
//     selection, a stored id or a hand-edited request cannot show another
//     organization's members, invitations, people, counts or drafts.
//   - Losing a membership removes the organization from the list AND closes those
//     reads at once; event-level authorization (can_manage_event) is unchanged.
//
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node tests/sql/workspace-memberships.test.mjs [migrations-dir]
import { boot, MIGRATIONS } from './boot.mjs'

const { db, failures } = await boot(process.argv[2] || MIGRATIONS)
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
const err = async (uid, sql, params = []) => { try { await as(uid, sql, params); return null } catch (e) { return String(e.message) } }
const rowsOrRefused = async (uid, sql, params = []) => { try { return (await as(uid, sql, params)).rows } catch { return 'refused' } }
const nothing = (r) => r === 'refused' || (Array.isArray(r) && r.length === 0)
const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await sup(sql, params))[0]
const user = async (email) =>
  (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id`, [email])).id
const setAccount = (uid, type, status = 'active') => sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])
const access = async (uid) => (await as(uid, `SELECT organization_id, organization_name, organization_role, event_assignments FROM get_my_organization_access()`)).rows

// ---- people and organizations -------------------------------------------------
const U = {}
U.padmin = await user('padmin@ws.test'); await setAccount(U.padmin, 'platform_admin')
U.ownerA = await user('owner-a@ws.test'); await setAccount(U.ownerA, 'organizer')
U.ownerB = await user('owner-b@ws.test'); await setAccount(U.ownerB, 'organizer')
U.ownerC = await user('owner-c@ws.test'); await setAccount(U.ownerC, 'organizer')
U.person = await user('person@ws.test') // an attendee who will belong to two organizations
U.other = await user('other@ws.test') // an attendee in organization C only

const ORG_A = (await as(U.ownerA, `SELECT create_organizer_organization('Accra Events') id`)).rows[0].id
const ORG_B = (await as(U.ownerB, `SELECT create_organizer_organization('Kente Foods') id`)).rows[0].id
const ORG_C = (await as(U.ownerC, `SELECT create_organizer_organization('TechGhana Summit') id`)).rows[0].id

const invite = async (caller, org, email, role) => (await as(caller, `SELECT invite_organization_member($1, $2, $3) id`, [org, email, role])).rows[0].id
const accept = (caller, id) => err(caller, `SELECT accept_organization_invitation($1)`, [id])

ok('the person joins A as admin through an invitation', (await accept(U.person, await invite(U.ownerA, ORG_A, 'person@ws.test', 'admin'))) === null)
ok('the person joins B as event manager through an invitation', (await accept(U.person, await invite(U.ownerB, ORG_B, 'person@ws.test', 'manager'))) === null)
ok('someone else joins C', (await accept(U.other, await invite(U.ownerC, ORG_C, 'other@ws.test', 'manager'))) === null)
// A pending invitation is not a membership. And invitations to other people,
// which members of C may see but the person may not.
await invite(U.ownerC, ORG_C, 'person@ws.test', 'admin')
await invite(U.ownerC, ORG_C, 'someone-else@ws.test', 'manager')
await invite(U.ownerB, ORG_B, 'someone-else@ws.test', 'manager')

// Events: B has two, one assigned to the person; C has a draft and a published one.
const mkEvent = async (org, name, visibility = 'published') => {
  await sup(`SET session_replication_role = replica`)
  const id = (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, timezone)
    VALUES ($1, 'upcoming', $2, $3, $4, '2030-01-01', '2030-01-02', 'Africa/Accra') RETURNING id`, [name, visibility, org, U.ownerA])).id
  await sup(`SET session_replication_role = origin`)
  return id
}
const EV_A = await mkEvent(ORG_A, 'A Summit', 'draft')
const EV_B1 = await mkEvent(ORG_B, 'B Forum')
const EV_B2 = await mkEvent(ORG_B, 'B Expo', 'draft')
const EV_C_DRAFT = await mkEvent(ORG_C, 'C Secret Draft', 'draft')
await mkEvent(ORG_C, 'C Public Summit', 'published')
ok('B\'s owner assigns the person to one of B\'s events', (await err(U.ownerB, `SELECT assign_event_manager($1, $2)`, [EV_B1, U.person])) === null)

// ---- 1. the list is the caller's own memberships ----------------------------------
let mine = await access(U.person)
ok('a person in two organizations sees exactly those two', JSON.stringify(mine.map((r) => r.organization_id).sort()) === JSON.stringify([ORG_A, ORG_B].sort()), JSON.stringify(mine))
ok('...never an organization they only have a pending invitation to', !mine.some((r) => r.organization_id === ORG_C))
ok('...in name order, as the switcher shows them', mine.map((r) => r.organization_name).join('|') === 'Accra Events|Kente Foods')
ok('...each with the person\'s OWN role (admin in A, event manager in B)',
  mine.find((r) => r.organization_id === ORG_A).organization_role === 'admin' && mine.find((r) => r.organization_id === ORG_B).organization_role === 'manager')
const bAssign = mine.find((r) => r.organization_id === ORG_B).event_assignments
ok('...and only their own event assignments, within that organization', bAssign.length === 1 && bAssign[0].event_id === EV_B1 && mine.find((r) => r.organization_id === ORG_A).event_assignments.length === 0, JSON.stringify(bAssign))
ok('a co-member sees only the organizations THEY belong to (A\'s owner sees A, not B)', JSON.stringify((await access(U.ownerA)).map((r) => r.organization_id)) === JSON.stringify([ORG_A]))
ok('a co-member\'s role is not shown as the person\'s (A\'s owner is owner, the person admin)', (await access(U.ownerA))[0].organization_role === 'owner')
ok('someone in neither organization sees neither', JSON.stringify((await access(U.other)).map((r) => r.organization_id)) === JSON.stringify([ORG_C]))
ok('no client can call it without signing in (anon has no EXECUTE)', (await (async () => { try { await db.exec(`SET ROLE anon`); await db.query(`SELECT * FROM get_my_organization_access()`); return false } catch { return true } finally { await db.exec(`RESET ROLE`) } })()))

// ---- 2. the reads a switch triggers give a non-member nothing private ----------------
// What OrganizerDashboardPage, EventsListPage, PeoplePage and TeamPage request for
// the selected organization.
const orgReads = (org) => ({
  members: [`SELECT * FROM organization_member_directory($1)`, [org]],
  invitations: [`SELECT * FROM organization_invitation_list($1)`, [org]],
  counts: [`SELECT * FROM organization_event_counts($1)`, [org]],
  people: [`SELECT * FROM organization_people($1)`, [org]],
  memberRows: [`SELECT * FROM organization_members WHERE organization_id = $1`, [org]],
  // The person's OWN invitations stay readable to them (select_own_or_admin_invitations:
  // invited_user_id = auth.uid()); that is the My invitations page, not the organization's data.
  othersInvitations: [`SELECT * FROM organization_invitations WHERE organization_id = $1 AND invited_user_id IS DISTINCT FROM auth.uid()`, [org]],
  draftEvents: [`SELECT * FROM events WHERE organization_id = $1 AND visibility = 'draft'`, [org]],
})
for (const [name, [sql, params]] of Object.entries(orgReads(ORG_C))) {
  ok(`with C selected by a non-member (a stale or forged id): ${name} returns nothing`, nothing(await rowsOrRefused(U.person, sql, params)))
}
ok('...the only C invitation the person can read is the one addressed to them',
  JSON.stringify((await as(U.person, `SELECT invited_email FROM organization_invitations WHERE organization_id = $1`, [ORG_C])).rows.map((r) => r.invited_email)) === JSON.stringify(['person@ws.test']))
ok('...while C\'s owner sees both of C\'s invitations', (await as(U.ownerC, `SELECT count(*)::int n FROM organization_invitations WHERE organization_id = $1 AND status = 'pending'`, [ORG_C])).rows[0].n === 2)
ok('...C\'s published event is public information, and is all a non-member can read about C\'s events',
  JSON.stringify((await as(U.person, `SELECT name FROM events WHERE organization_id = $1`, [ORG_C])).rows.map((r) => r.name)) === JSON.stringify(['C Public Summit']))
ok('...and C\'s draft cannot be read by id either', (await as(U.person, `SELECT id FROM events WHERE id = $1`, [EV_C_DRAFT])).rows.length === 0)
ok('as a member, A\'s member directory answers', Array.isArray(await rowsOrRefused(U.person, `SELECT * FROM organization_member_directory($1)`, [ORG_A])) && (await rowsOrRefused(U.person, `SELECT * FROM organization_member_directory($1)`, [ORG_A])).length === 2)
ok('as a member, B\'s member directory answers', (await rowsOrRefused(U.person, `SELECT * FROM organization_member_directory($1)`, [ORG_B])).length === 2)
ok('A\'s directory never contains B\'s members, and the reverse',
  !(await as(U.person, `SELECT user_id FROM organization_member_directory($1)`, [ORG_A])).rows.some((r) => r.user_id === U.ownerB)
  && !(await as(U.person, `SELECT user_id FROM organization_member_directory($1)`, [ORG_B])).rows.some((r) => r.user_id === U.ownerA))

// ---- 3. event-level authorization is unchanged --------------------------------------
const canManage = async (uid, ev) => (await as(uid, `SELECT can_manage_event($1) v`, [ev])).rows[0].v
ok('admin of A may manage A\'s event', await canManage(U.person, EV_A) === true)
ok('event manager in B may manage the B event assigned to them', await canManage(U.person, EV_B1) === true)
ok('...but not the B event they are not assigned to', await canManage(U.person, EV_B2) === false)
ok('...nor any C event', await canManage(U.person, EV_C_DRAFT) === false)

// ---- 4. losing a membership ---------------------------------------------------------
ok('B\'s owner removes the person from B', (await err(U.ownerB, `SELECT remove_organization_member($1, $2)`, [ORG_B, U.person])) === null)
mine = await access(U.person)
ok('B disappears from the person\'s list on the next load', JSON.stringify(mine.map((r) => r.organization_id)) === JSON.stringify([ORG_A]), JSON.stringify(mine))
for (const [name, [sql, params]] of Object.entries(orgReads(ORG_B))) {
  ok(`after removal, B selected: ${name} returns nothing`, nothing(await rowsOrRefused(U.person, sql, params)))
}
ok('after removal, the former assignment no longer grants event management', await canManage(U.person, EV_B1) === false)
ok('A is untouched', await canManage(U.person, EV_A) === true && (await rowsOrRefused(U.person, `SELECT * FROM organization_member_directory($1)`, [ORG_A])).length === 2)

// ---- 5. a suspended account sees no organization ------------------------------------
ok('a platform admin suspends the person', (await err(U.padmin, `SELECT set_account_status($1, 'suspended', 'workspace test')`, [U.person])) === null)
ok('a suspended account\'s list is empty', (await access(U.person)).length === 0)
ok('...and A\'s private reads close too', nothing(await rowsOrRefused(U.person, `SELECT * FROM organization_member_directory($1)`, [ORG_A])) && await canManage(U.person, EV_A) === false)
ok('reactivating restores the membership that still exists', (await err(U.padmin, `SELECT set_account_status($1, 'active', 'workspace test')`, [U.person])) === null
  && JSON.stringify((await access(U.person)).map((r) => r.organization_id)) === JSON.stringify([ORG_A]))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
