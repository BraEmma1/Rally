// Add Partner with a package (PR-B) -- the backend behaviour the wizard's save path
// relies on. No migration accompanies this file: it pins down EXISTING behaviour.
//
// The wizard saves a partnership the way it always has (insert the partnership, set
// its roles, insert its obligations in one statement, delete the draft if a later step
// fails), with one addition: the partnership row carries `package_id`, and the
// obligations are the organizer's own -- prefilled from the package, then edited.
// apply_partnership_package is NOT called.
//
//   1. a manager can save a customized agreement linked to a package, and exactly
//      those deliverables are stored -- no template copies alongside them
//   2. apply_partnership_package afterwards is refused, so nothing can duplicate them
//   3. the saved agreement is independent of later template edits, archiving and use
//   4. another event's (or organization's) package cannot be linked
//   5. a package deleted between choosing and saving fails the insert, writes nothing,
//      and names the package constraint (the wizard's message depends on that)
//   6. who may save: assigned managers, admins, owners -- nobody else
//   7. the draft rollback still works for a linked draft
//   8. a direct insert linking an ARCHIVED package is refused (Spec A, migration
//      20261128000000; this was the pinned known gap before it)
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
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

// ---- fixtures -------------------------------------------------------------
const U = {}
for (const k of ['owner', 'admin', 'manager', 'otherManager', 'owner2', 'attendee'])
  U[k] = await user(`${k.toLowerCase()}@sel.test`)
await setAccount(U.owner, 'organizer')
await setAccount(U.owner2, 'organizer')
const ORG = await mkOrg('Org', U.owner)
const ORG2 = await mkOrg('Other Org', U.owner2)
await addMember(ORG, U.admin, 'admin')
await addMember(ORG, U.manager, 'manager')
await addMember(ORG, U.otherManager, 'manager')
const EV_A = await mkEvent('Summit A', ORG, U.owner)
const EV_B = await mkEvent('Summit B', ORG, U.owner)
const EV_OTHER = await mkEvent('Other org event', ORG2, U.owner2)
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV_A, U.manager, U.owner])

const mkPackage = async (ev, name, value = null, currency = null, by = U.owner) =>
  (await as(by, `INSERT INTO event_partnership_packages (event_id, name, value_amount, value_currency) VALUES ($1, $2, $3, $4) RETURNING id`,
    [ev, name, value, currency])).rows[0].id
const mkTemplate = async (pkg, ev, title, order, extra = {}) =>
  (await as(U.owner, `INSERT INTO event_partnership_package_deliverables (package_id, event_id, title, category, quantity, display_order)
                      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [pkg, ev, title, extra.category ?? null, extra.quantity ?? null, order])).rows[0].id

const GOLD = await mkPackage(EV_A, 'Gold', 50000, 'GHS')
const T1 = await mkTemplate(GOLD, EV_A, 'Logo on backdrop', 0, { category: 'Branding' })
await mkTemplate(GOLD, EV_A, 'VIP passes', 1, { quantity: 4 })
await mkTemplate(GOLD, EV_A, 'Stage mention', 2)
const GOLD_B = await mkPackage(EV_B, 'Gold', 9000, 'USD')
const OTHER_PKG = await mkPackage(EV_OTHER, 'Platinum', null, null, U.owner2)

// The wizard's save, statement for statement (createPartnershipWithDetails).
async function wizardSave(caller, ev, pkg, partnership, obligations, roles = ['sponsor']) {
  const p = (await as(caller, `INSERT INTO event_partnerships (event_id, company_name, tier_label, value_amount, value_currency, package_id)
                               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [ev, partnership.company, partnership.tier, partnership.value, partnership.currency, pkg])).rows[0].id
  await as(caller, `SELECT set_event_partnership_roles($1, $2::text[])`, [p, `{${roles.join(',')}}`])
  if (obligations.length) {
    const values = obligations.map((o, i) => `($1, $2, '${o.direction}', $${3 + i * 3}, $${4 + i * 3}, $${5 + i * 3}, ${o.order})`).join(', ')
    const params = [p, ev, ...obligations.flatMap((o) => [o.title, o.category ?? null, o.quantity ?? null])]
    await as(caller, `INSERT INTO event_partnership_obligations (partnership_id, event_id, direction, title, category, quantity, display_order) VALUES ${values}`, params)
  }
  return p
}
const agreement = async (p) => (await one(
  `SELECT p.tier_label, p.value_amount::text AS value, p.value_currency, p.package_id,
          (SELECT string_agg(concat_ws('|', ob.direction, ob.title, ob.category, ob.quantity, ob.display_order), ' ; '
                             ORDER BY ob.direction, ob.display_order)
             FROM event_partnership_obligations ob WHERE ob.partnership_id = p.id) AS obligations,
          (SELECT count(*) FROM event_partnership_obligations ob WHERE ob.partnership_id = p.id) AS n
     FROM event_partnerships p WHERE p.id = $1`, [p]))

// ---- 1. a customized agreement linked to a package ------------------------
// Prefilled from Gold, then customized: tier renamed, value lowered, one template
// deliverable edited, one removed, one added by hand, plus a requirement.
const customized = [
  { direction: 'organizer_to_partner', title: 'Logo on backdrop and lanyards', category: 'Branding', order: 0 },
  { direction: 'organizer_to_partner', title: 'VIP passes', quantity: 6, order: 1 },
  { direction: 'organizer_to_partner', title: 'Panel seat', order: 2 },
  { direction: 'partner_to_organizer', title: 'High-resolution logo', order: 0 },
]
const ACME = await wizardSave(U.manager, EV_A, GOLD, { company: 'Acme Bank', tier: 'Gold (founding)', value: 42000, currency: 'GHS' }, customized)
let a = await agreement(ACME)
ok('an assigned manager saves a partnership linked to the package', a.package_id === GOLD, JSON.stringify(a))
ok('...with the customized tier label and commercial value', a.tier_label === 'Gold (founding)' && Number(a.value) === 42000 && a.value_currency === 'GHS', JSON.stringify(a))
ok('...and exactly the customized deliverables and requirement, nothing from the template besides',
  Number(a.n) === 4 && a.obligations ===
    'organizer_to_partner|Logo on backdrop and lanyards|Branding|0 ; organizer_to_partner|VIP passes|6|1 ; organizer_to_partner|Panel seat|2 ; partner_to_organizer|High-resolution logo|0', a.obligations)
ok('the partnership is born a draft', (await one(`SELECT status FROM event_partnerships WHERE id = $1`, [ACME])).status === 'draft')
ok('the package now counts one partner', Number((await as(U.owner, `SELECT partnership_count FROM get_event_partnership_packages($1) WHERE id = $2`, [EV_A, GOLD])).rows[0].partnership_count) === 1)

// An unedited package save stores the template as it was, once.
const PLAIN = await wizardSave(U.owner, EV_A, GOLD, { company: 'Plain Co', tier: 'Gold', value: 50000, currency: 'GHS' }, [
  { direction: 'organizer_to_partner', title: 'Logo on backdrop', category: 'Branding', order: 0 },
  { direction: 'organizer_to_partner', title: 'VIP passes', quantity: 4, order: 1 },
  { direction: 'organizer_to_partner', title: 'Stage mention', order: 2 },
])
const plainBefore = await agreement(PLAIN)
ok('an untouched package save stores each template deliverable once', Number(plainBefore.n) === 3, plainBefore.obligations)

// A custom partnership has no package.
const CUSTOM = await wizardSave(U.admin, EV_A, null, { company: 'Custom Ltd', tier: 'Media partner', value: null, currency: null }, [
  { direction: 'organizer_to_partner', title: 'Press pass', order: 0 },
])
ok('a custom partnership saves with no package', (await agreement(CUSTOM)).package_id === null)

// ---- 2. no duplicates -----------------------------------------------------
const dup = await err(U.owner, `SELECT apply_partnership_package($1, $2)`, [ACME, GOLD])
ok('applying the package again is refused: it already has one', refused(dup, /already has a package applied/), dup)
ok('...and its deliverables are unchanged', Number((await agreement(ACME)).n) === 4)

// ---- 3. independent of later template changes -----------------------------
const acmeBefore = await agreement(ACME)
await as(U.owner, `UPDATE event_partnership_packages SET name = 'Gold 2031', value_amount = 99000, value_currency = 'USD' WHERE id = $1`, [GOLD])
await as(U.owner, `UPDATE event_partnership_package_deliverables SET title = 'Logo everywhere', quantity = 9 WHERE id = $1`, [T1])
await mkTemplate(GOLD, EV_A, 'Added to the template later', 3)
await as(U.owner, `DELETE FROM event_partnership_package_deliverables WHERE package_id = $1 AND title = 'Stage mention'`, [GOLD])
ok('renaming, repricing and editing the template leaves the saved agreement untouched',
  JSON.stringify(await agreement(ACME)) === JSON.stringify(acmeBefore), JSON.stringify(await agreement(ACME)))
ok('...including the one saved without changes', JSON.stringify(await agreement(PLAIN)) === JSON.stringify(plainBefore), JSON.stringify(await agreement(PLAIN)))
await as(U.owner, `UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [GOLD])
ok('archiving the package leaves both agreements and their link untouched',
  JSON.stringify(await agreement(ACME)) === JSON.stringify(acmeBefore) && (await agreement(PLAIN)).package_id === GOLD)
const delUsed = await err(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1`, [GOLD])
ok('a package with saved partners cannot be deleted', refused(delUsed, /Archive it instead/), delUsed)
await as(U.owner, `UPDATE event_partnership_packages SET archived_at = NULL WHERE id = $1`, [GOLD])

// ---- 4. another event's or organization's package -------------------------
const cross = await err(U.owner, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Cross', $2)`, [EV_A, GOLD_B])
ok('another event\'s package cannot be linked (composite key)', refused(cross, /event_partnerships_package_fk/), cross)
const foreign = await err(U.owner, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Foreign', $2)`, [EV_A, OTHER_PKG])
ok('...nor another organization\'s', refused(foreign, /event_partnerships_package_fk/), foreign)
ok('...and neither left a row behind', await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name IN ('Cross', 'Foreign')`) === 0)

// ---- 5. deleted between choosing and saving -------------------------------
const TEMP = await mkPackage(EV_A, 'Short-lived', 100, 'GHS')
await as(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1`, [TEMP])
const gone = await err(U.manager, `INSERT INTO event_partnerships (event_id, company_name, tier_label, package_id) VALUES ($1, 'Late Co', 'Short-lived', $2) RETURNING id`, [EV_A, TEMP])
ok('a package deleted after it was chosen fails the insert', refused(gone, /foreign key/), gone)
ok('...naming the package constraint, which the wizard maps to its own message', refused(gone, /package/), gone)
ok('...and nothing was written', await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Late Co'`) === 0)

// ---- 6. who may save ------------------------------------------------------
const insertAs = (uid) => err(uid, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Who', $2)`, [EV_A, GOLD])
ok('an unassigned manager cannot save a partner for this event', refused(await insertAs(U.otherManager), /row-level security/))
ok('another organization\'s owner cannot', refused(await insertAs(U.owner2), /row-level security/))
ok('an attendee cannot', refused(await insertAs(U.attendee), /row-level security/))
ok('anon cannot', refused(await err(null, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Who', $2)`, [EV_A, GOLD], 'anon')))
await setAccount(U.manager, 'attendee', 'suspended')
ok('a suspended manager cannot', refused(await insertAs(U.manager)))
await setAccount(U.manager, 'attendee', 'active')
ok('none of them wrote a row', await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Who'`) === 0)
ok('the unassigned manager cannot even read the package to prefill from it',
  (await as(U.otherManager, `SELECT id FROM event_partnership_packages WHERE id = $1 AND event_id = $2`, [GOLD, EV_A])).rows.length === 0)

// ---- 7. rollback of a linked draft ----------------------------------------
const DRAFT = (await as(U.owner, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Rollback Co', $2) RETURNING id`, [EV_A, GOLD])).rows[0].id
const usedBefore = Number((await as(U.owner, `SELECT partnership_count FROM get_event_partnership_packages($1) WHERE id = $2`, [EV_A, GOLD])).rows[0].partnership_count)
await as(U.owner, `DELETE FROM event_partnerships WHERE id = $1`, [DRAFT])
ok('the wizard\'s rollback deletes a linked draft', await n(`SELECT count(*) AS n FROM event_partnerships WHERE id = $1`, [DRAFT]) === 0)
ok('...and the package usage count goes back down',
  Number((await as(U.owner, `SELECT partnership_count FROM get_event_partnership_packages($1) WHERE id = $2`, [EV_A, GOLD])).rows[0].partnership_count) === usedBefore - 1)

// ---- 8. Edit Partner never sends package_id; the archived-package gap ------
await as(U.owner, `UPDATE event_partnerships SET tier_label = 'Gold (renewed)', value_amount = 43000 WHERE id = $1`, [ACME])
ok('an Edit Partner style update keeps the package link', (await agreement(ACME)).package_id === GOLD)
const OLD = await mkPackage(EV_A, 'Retired', null, null)
await as(U.owner, `UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [OLD])
const archivedLink = await err(U.owner, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Archived link', $2)`, [EV_A, OLD])
ok('Spec A: the database refuses a direct link to an archived package (it was the known gap here)',
  refused(archivedLink, /archived/), archivedLink)
ok('...with the signal the wizard maps to "no longer available": a foreign-key error naming the package',
  refused(archivedLink, /package/) && await n(`SELECT count(*) AS n FROM event_partnerships WHERE company_name = 'Archived link'`) === 0, archivedLink)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
