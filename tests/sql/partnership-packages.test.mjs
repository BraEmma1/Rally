// Event partnership packages (migration 20261007000000, phase 5A) -- the backend
// guarantees the package management screens rely on. No migration accompanies this
// file: it pins down EXISTING behaviour so the frontend can depend on it.
//
//   1. several packages per event, and the read contract (order, counts)
//   2. isolation between events and organizations (RLS, composite keys, RPC checks)
//   3. who may manage packages: owners, admins, assigned managers -- nobody else, and
//      never a suspended account, an attendee, anon, or a linked sponsor member
//   4. templates, not bindings: editing, archiving or deleting a template never
//      changes a partnership already created from it
//   5. delete vs archive, and the archived-event freeze
//   6. field rules, and the functions' security model
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
const mkEvent = async (name, org, by, archived = false) => {
  await sup(`SET session_replication_role = replica`)
  try {
    return (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date, archived_at)
                       VALUES ($1, 'upcoming', 'published', $2, $3, '2030-01-01', '2030-01-02', ${archived ? 'now()' : 'NULL'}) RETURNING id`, [name, org, by])).id
  } finally { await sup(`SET session_replication_role = origin`) }
}

// ---- fixtures -------------------------------------------------------------
const U = {}
for (const k of ['owner', 'admin', 'manager', 'otherManager', 'owner2', 'attendee', 'sponsorAdmin'])
  U[k] = await user(`${k.toLowerCase()}@t.test`)
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
const EV_ARCH = await mkEvent('Archived event', ORG, U.owner, true)
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV_A, U.manager, U.owner])

const mkPackage = async (caller, ev, name, extra = {}) =>
  (await as(caller, `INSERT INTO event_partnership_packages (event_id, name, description, value_amount, value_currency, display_order)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [ev, name, extra.description ?? null, extra.value ?? null, extra.currency ?? null, extra.order ?? 0])).rows[0].id
const mkDeliverable = async (caller, pkg, ev, title, order = 0, extra = {}) =>
  (await as(caller, `INSERT INTO event_partnership_package_deliverables (package_id, event_id, title, category, quantity, due_date, display_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [pkg, ev, title, extra.category ?? null, extra.quantity ?? null, extra.due ?? null, order])).rows[0].id
const listAs = async (caller, ev) => (await as(caller, `SELECT * FROM get_event_partnership_packages($1)`, [ev])).rows
const partnership = async (caller, ev, name) =>
  (await as(caller, `INSERT INTO event_partnerships (event_id, company_name) VALUES ($1, $2) RETURNING id`, [ev, name])).rows[0].id
const applyPkg = (caller, p, pkg) => as(caller, `SELECT apply_partnership_package($1, $2) AS copied`, [p, pkg])
// Everything a partnership owes, in order, as one comparable string.
const agreement = async (p) => (await one(
  `SELECT p.tier_label, p.value_amount::text, p.value_currency, p.package_id,
          (SELECT string_agg(concat_ws('|', ob.direction, ob.title, ob.description, ob.category, ob.quantity, ob.due_date, ob.display_order), ' ; '
                             ORDER BY ob.direction, ob.display_order, ob.created_at)
             FROM event_partnership_obligations ob WHERE ob.partnership_id = p.id) AS obligations
     FROM event_partnerships p WHERE p.id = $1`, [p]))

// ---- 1. several packages per event, and the read contract -----------------
const GOLD = await mkPackage(U.owner, EV_A, '  Gold  ', { value: 50000, currency: 'ghs ', order: 0, description: 'Top tier' })
const SILVER = await mkPackage(U.owner, EV_A, 'Silver', { value: 25000, currency: 'GHS', order: 1 })
const BRONZE = await mkPackage(U.owner, EV_A, 'Bronze', { order: 2 })
const GOLD_B = await mkPackage(U.owner, EV_B, 'Gold', { value: 9000, currency: 'USD' })
const g1 = await mkDeliverable(U.owner, GOLD, EV_A, 'Logo on backdrop', 0, { category: 'Branding' })
const g2 = await mkDeliverable(U.owner, GOLD, EV_A, 'VIP passes', 1, { quantity: 4 })
const g3 = await mkDeliverable(U.owner, GOLD, EV_A, 'Booth artwork deadline', 2, { due: '2029-12-01' })
await mkDeliverable(U.owner, SILVER, EV_A, 'Logo in programme', 0)
await mkDeliverable(U.owner, BRONZE, EV_A, 'Social mention', 0)
await mkDeliverable(U.owner, BRONZE, EV_A, 'Website listing', 1)

const listA = await listAs(U.owner, EV_A)
ok('an event holds several packages, listed in display order', JSON.stringify(listA.map((r) => r.name)) === JSON.stringify(['Gold', 'Silver', 'Bronze']), JSON.stringify(listA.map((r) => r.name)))
ok('...with the template count per package', JSON.stringify(listA.map((r) => Number(r.deliverable_count))) === JSON.stringify([3, 1, 2]))
ok('...and a usage count of zero before any partner uses them', listA.every((r) => Number(r.partnership_count) === 0))
ok('the same package name can exist in another event of the organization', (await listAs(U.owner, EV_B)).length === 1)
const goldRow = await one(`SELECT name, value_currency, created_by FROM event_partnership_packages WHERE id = $1`, [GOLD])
ok('the name is trimmed and the currency upper-cased by the trigger', goldRow.name === 'Gold' && goldRow.value_currency === 'GHS', JSON.stringify(goldRow))
const forged = (await as(U.admin, `INSERT INTO event_partnership_packages (event_id, name, created_by) VALUES ($1, 'Forged', $2) RETURNING created_by`, [EV_A, U.owner2])).rows[0]
ok('created_by is the caller, whatever the client sends', forged.created_by === U.admin)
await sup(`DELETE FROM event_partnership_packages WHERE name = 'Forged'`)

// ---- 2. isolation between events and organizations ------------------------
ok('another organization\'s owner reads none of this event\'s packages', (await as(U.owner2, `SELECT id FROM event_partnership_packages WHERE event_id = $1`, [EV_A])).rows.length === 0)
ok('...nor its template deliverables', (await as(U.owner2, `SELECT id FROM event_partnership_package_deliverables WHERE event_id = $1`, [EV_A])).rows.length === 0)
ok('...and the list RPC returns nothing for them', (await listAs(U.owner2, EV_A)).length === 0)
ok('...they cannot add a package to this event', refused(await err(U.owner2, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Intruder')`, [EV_A]), /row-level security/))
ok('...or add a deliverable to one of its packages', refused(await err(U.owner2, `INSERT INTO event_partnership_package_deliverables (package_id, event_id, title) VALUES ($1, $2, 'x')`, [GOLD, EV_A]), /row-level security/))
ok('...an UPDATE of its package touches no row', (await as(U.owner2, `UPDATE event_partnership_packages SET name = 'Hijacked' WHERE id = $1 RETURNING id`, [GOLD])).rows.length === 0 && (await one(`SELECT name FROM event_partnership_packages WHERE id = $1`, [GOLD])).name === 'Gold')
ok('...a DELETE touches no row', (await as(U.owner2, `DELETE FROM event_partnership_package_deliverables WHERE id = $1 RETURNING id`, [g1])).rows.length === 0 && (await n(`SELECT count(*) n FROM event_partnership_package_deliverables WHERE id = $1`, [g1])) === 1)
ok('...they cannot reorder this event\'s packages', refused(await err(U.owner2, `SELECT reorder_event_partnership_packages($1, $2)`, [EV_A, [SILVER, GOLD]]), /do not manage/))
ok('...or a package\'s deliverables', refused(await err(U.owner2, `SELECT reorder_package_deliverables($1, $2)`, [GOLD, [g2, g1]]), /not available/))
ok('a deliverable cannot claim one event while its package belongs to another (composite key)',
  refused(await err(U.owner, `INSERT INTO event_partnership_package_deliverables (package_id, event_id, title) VALUES ($1, $2, 'Cross')`, [GOLD, EV_B]), /foreign key/))
ok('a package cannot be moved to another event', refused(await err(U.owner, `UPDATE event_partnership_packages SET event_id = $2 WHERE id = $1`, [GOLD, EV_B]), /cannot be moved/))
ok('a deliverable cannot be moved to another package', refused(await err(U.owner, `UPDATE event_partnership_package_deliverables SET package_id = $2 WHERE id = $1`, [g1, SILVER]), /cannot be moved/))
ok('reordering refuses a package from another event', refused(await err(U.owner, `SELECT reorder_event_partnership_packages($1, $2)`, [EV_B, [GOLD_B, GOLD]]), /do not all belong/))
ok('reordering refuses a deliverable from another package', refused(await err(U.owner, `SELECT reorder_package_deliverables($1, $2)`, [SILVER, [g1]]), /do not all belong/))
const P_B = await partnership(U.owner, EV_B, 'Beta Bank')
ok('a partnership cannot be created from another event\'s package (composite key)',
  refused(await err(U.owner, `INSERT INTO event_partnerships (event_id, company_name, package_id) VALUES ($1, 'Cross Co', $2)`, [EV_B, GOLD]), /foreign key/))
ok('...nor have one applied', refused(await err(U.owner, `SELECT apply_partnership_package($1, $2)`, [P_B, GOLD]), /does not belong to this event/))

// Reordering works for the event's own packages.
await as(U.owner, `SELECT reorder_event_partnership_packages($1, $2)`, [EV_A, [SILVER, GOLD, BRONZE]])
ok('reordering the event\'s own packages changes the list order', JSON.stringify((await listAs(U.owner, EV_A)).map((r) => r.name)) === JSON.stringify(['Silver', 'Gold', 'Bronze']))
await as(U.owner, `SELECT reorder_event_partnership_packages($1, $2)`, [EV_A, [GOLD, SILVER, BRONZE]])

// ---- 3. who may manage packages -------------------------------------------
ok('an organization admin manages the event\'s packages', (await as(U.admin, `UPDATE event_partnership_packages SET description = 'Silver tier' WHERE id = $1 RETURNING id`, [SILVER])).rows.length === 1)
const MGR_PKG = await mkPackage(U.manager, EV_A, 'Manager made')
ok('a manager assigned to the event manages its packages', typeof MGR_PKG === 'string' && (await listAs(U.manager, EV_A)).length === 4)
ok('...but not those of an event they are not assigned to', (await listAs(U.manager, EV_B)).length === 0 &&
  refused(await err(U.manager, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Nope')`, [EV_B]), /row-level security/))
ok('an unassigned manager sees and changes nothing', (await listAs(U.otherManager, EV_A)).length === 0 &&
  refused(await err(U.otherManager, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Nope')`, [EV_A]), /row-level security/))
await sup(`DELETE FROM event_partnership_packages WHERE id = $1`, [MGR_PKG])
await setAccount(U.admin, 'attendee', 'suspended')
ok('a suspended admin reads no packages', (await listAs(U.admin, EV_A)).length === 0)
ok('...and cannot write one', refused(await err(U.admin, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Suspended')`, [EV_A]), /row-level security/))
await setAccount(U.admin, 'attendee', 'active')
ok('an attendee reads no packages and cannot write one', (await listAs(U.attendee, EV_A)).length === 0 &&
  refused(await err(U.attendee, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Attendee')`, [EV_A]), /row-level security/))
ok('anon has no access to the package tables', refused(await err(null, `SELECT id FROM event_partnership_packages`, [], 'anon'), /permission denied/) &&
  refused(await err(null, `SELECT id FROM event_partnership_package_deliverables`, [], 'anon'), /permission denied/))
ok('anon cannot call the package functions', refused(await err(null, `SELECT * FROM get_event_partnership_packages($1)`, [EV_A], 'anon'), /permission denied/))

// A linked sponsor: the partnership was created from Gold, invited and accepted.
const P_S = await partnership(U.owner, EV_A, 'Sponsor Co')
await applyPkg(U.owner, P_S, GOLD)
const inv = (await as(U.owner, `SELECT invite_partnership_representative($1, 'sponsoradmin@t.test') id`, [P_S])).rows[0].id
await as(U.sponsorAdmin, `SELECT accept_partnership_invitation_with_organization($1, $2)`, [inv, SPONSOR_ORG])
const linked = await one(`SELECT status, sponsor_organization_id FROM event_partnerships WHERE id = $1`, [P_S])
ok('(setup) the sponsor accepted and the partnership is linked', linked.status === 'active' && linked.sponsor_organization_id === SPONSOR_ORG, JSON.stringify(linked))
ok('a linked sponsor member sees their partnership in the workspace', (await as(U.sponsorAdmin, `SELECT * FROM my_sponsor_partnerships()`)).rows.length === 1)
ok('...but no package of the event', (await as(U.sponsorAdmin, `SELECT id FROM event_partnership_packages`)).rows.length === 0 && (await listAs(U.sponsorAdmin, EV_A)).length === 0)
ok('...and no template deliverable', (await as(U.sponsorAdmin, `SELECT id FROM event_partnership_package_deliverables`)).rows.length === 0)
ok('...and cannot write one', refused(await err(U.sponsorAdmin, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'Sponsor made')`, [EV_A]), /row-level security/))
const wsCols = (await one(`SELECT pg_get_function_result('public.my_sponsor_partnerships()'::regprocedure) r`)).r
ok('the sponsor workspace contract carries no package column', !/package/i.test(wsCols), wsCols)

// ---- 4. templates, not bindings ------------------------------------------
const P1 = await partnership(U.owner, EV_A, 'Acme Bank')
const copied = Number((await applyPkg(U.owner, P1, GOLD)).rows[0].copied)
const before = await agreement(P1)
ok('applying a package copies its deliverables into the partnership', copied === 3 && (await n(`SELECT count(*) n FROM event_partnership_obligations WHERE partnership_id = $1`, [P1])) === 3)
ok('...and takes its name and value as a starting point', before.tier_label === 'Gold' && before.value_amount === '50000' && before.value_currency === 'GHS' && before.package_id === GOLD, JSON.stringify(before))
ok('...with the template\'s category, quantity and due date', /Branding/.test(before.obligations) && /\|4\|/.test(before.obligations) && /2029-12-01/.test(before.obligations))
ok('the package now reports one more use', Number((await listAs(U.owner, EV_A)).find((r) => r.id === GOLD).partnership_count) === 2)

// Now change everything about the template.
await as(U.owner, `UPDATE event_partnership_packages SET name = 'Gold 2027', value_amount = 75000, value_currency = 'USD', description = 'Changed' WHERE id = $1`, [GOLD])
await as(U.owner, `UPDATE event_partnership_package_deliverables SET title = 'Logo on main stage', quantity = 2 WHERE id = $1`, [g1])
await as(U.owner, `DELETE FROM event_partnership_package_deliverables WHERE id = $1`, [g3])
const g4 = await mkDeliverable(U.owner, GOLD, EV_A, 'Speaking slot', 5)
await as(U.owner, `SELECT reorder_package_deliverables($1, $2)`, [GOLD, [g4, g2, g1]])
ok('renaming, repricing, editing, removing, adding and reordering template deliverables leaves an existing agreement untouched',
  JSON.stringify(await agreement(P1)) === JSON.stringify(before), JSON.stringify(await agreement(P1)))
ok('...including the sponsor\'s accepted agreement', !/Speaking slot/.test((await agreement(P_S)).obligations) && /Logo on backdrop/.test((await agreement(P_S)).obligations))

const P2 = await partnership(U.owner, EV_A, 'Beacon Telecom')
await applyPkg(U.owner, P2, GOLD)
const p2 = await agreement(P2)
ok('a partner added afterwards gets the template as it is NOW', /Speaking slot/.test(p2.obligations) && /Logo on main stage/.test(p2.obligations) && !/Booth artwork/.test(p2.obligations) && p2.tier_label === 'Gold 2027' && p2.value_currency === 'USD', JSON.stringify(p2))
ok('...in the template\'s current order', p2.obligations.indexOf('Speaking slot') < p2.obligations.indexOf('VIP passes') && p2.obligations.indexOf('VIP passes') < p2.obligations.indexOf('Logo on main stage'))

const templateBefore = await one(`SELECT string_agg(title || '|' || coalesce(quantity::text, ''), ';' ORDER BY display_order) t FROM event_partnership_package_deliverables WHERE package_id = $1`, [GOLD])
await as(U.owner, `UPDATE event_partnership_obligations SET title = 'Logo on main stage, left side', quantity = 1 WHERE partnership_id = $1 AND title = 'Logo on main stage'`, [P2])
await as(U.owner, `INSERT INTO event_partnership_obligations (partnership_id, event_id, direction, title) VALUES ($1, $2, 'organizer_to_partner', 'Custom extra')`, [P2, EV_A])
ok('customizing a partner\'s deliverables does not change the template', JSON.stringify(await one(`SELECT string_agg(title || '|' || coalesce(quantity::text, ''), ';' ORDER BY display_order) t FROM event_partnership_package_deliverables WHERE package_id = $1`, [GOLD])) === JSON.stringify(templateBefore))
ok('a package is applied once: a second apply is refused', refused(await err(U.owner, `SELECT apply_partnership_package($1, $2)`, [P1, SILVER]), /already has a package/))

// ---- 5. delete vs archive, and the archived-event freeze ------------------
ok('a package any partnership was created from cannot be deleted', refused(await err(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1`, [GOLD]), /used by 3 partnership\(s\)\. Archive it instead/) &&
  (await n(`SELECT count(*) n FROM event_partnership_packages WHERE id = $1`, [GOLD])) === 1)
await as(U.owner, `UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [GOLD])
ok('it can be archived, and stays listed as archived', (await listAs(U.owner, EV_A)).find((r) => r.id === GOLD).archived_at !== null)
ok('archiving changes no partnership created from it', JSON.stringify(await agreement(P1)) === JSON.stringify(before))
const P3 = await partnership(U.owner, EV_A, 'Cedar Media')
ok('an archived package cannot be applied', refused(await err(U.owner, `SELECT apply_partnership_package($1, $2)`, [P3, GOLD]), /archived\. Restore it/))
await as(U.owner, `UPDATE event_partnership_packages SET archived_at = NULL WHERE id = $1`, [GOLD])
ok('a restored package can be applied again', Number((await applyPkg(U.owner, P3, GOLD)).rows[0].copied) === 3)
ok('an unused package can be deleted, its deliverables with it', (await as(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1 RETURNING id`, [BRONZE])).rows.length === 1 &&
  (await n(`SELECT count(*) n FROM event_partnership_package_deliverables WHERE package_id = $1`, [BRONZE])) === 0)

await sup(`SET session_replication_role = replica`)
const ARCH_PKG = (await one(`INSERT INTO event_partnership_packages (event_id, name, created_by) VALUES ($1, 'Frozen', $2) RETURNING id`, [EV_ARCH, U.owner])).id
const ARCH_DEL = (await one(`INSERT INTO event_partnership_package_deliverables (package_id, event_id, title) VALUES ($1, $2, 'Frozen item') RETURNING id`, [ARCH_PKG, EV_ARCH])).id
await sup(`SET session_replication_role = origin`)
ok('an archived event\'s packages are still readable', (await listAs(U.owner, EV_ARCH)).length === 1)
ok('...but no package can be added to it', refused(await err(U.owner, `INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, 'New')`, [EV_ARCH]), /archived/))
ok('...or edited, archived or deleted', refused(await err(U.owner, `UPDATE event_partnership_packages SET name = 'Renamed' WHERE id = $1`, [ARCH_PKG]), /archived/) &&
  refused(await err(U.owner, `UPDATE event_partnership_packages SET archived_at = now() WHERE id = $1`, [ARCH_PKG]), /archived/) &&
  refused(await err(U.owner, `DELETE FROM event_partnership_packages WHERE id = $1`, [ARCH_PKG]), /archived/))
ok('...and its template deliverables are frozen too', refused(await err(U.owner, `INSERT INTO event_partnership_package_deliverables (package_id, event_id, title) VALUES ($1, $2, 'x')`, [ARCH_PKG, EV_ARCH]), /archived/) &&
  refused(await err(U.owner, `UPDATE event_partnership_package_deliverables SET title = 'y' WHERE id = $1`, [ARCH_DEL]), /archived/) &&
  refused(await err(U.owner, `DELETE FROM event_partnership_package_deliverables WHERE id = $1`, [ARCH_DEL]), /archived/))

// ---- 6. field rules, and the security model --------------------------------
const pkgErr = (sql, params) => err(U.owner, sql, params)
ok('a blank name is refused', refused(await pkgErr(`INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, '   ')`, [EV_A]), /name_not_blank/))
ok('a name over 80 characters is refused', refused(await pkgErr(`INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, $2)`, [EV_A, 'x'.repeat(81)]), /name_length/))
ok('...80 characters is accepted', (await pkgErr(`INSERT INTO event_partnership_packages (event_id, name) VALUES ($1, $2)`, [EV_A, 'y'.repeat(80)])) === null)
ok('a negative value is refused', refused(await pkgErr(`INSERT INTO event_partnership_packages (event_id, name, value_amount, value_currency) VALUES ($1, 'Neg', -1, 'GHS')`, [EV_A]), /value_non_negative/))
ok('a currency that is not three letters is refused', refused(await pkgErr(`INSERT INTO event_partnership_packages (event_id, name, value_amount, value_currency) VALUES ($1, 'Cur', 1, 'GH')`, [EV_A]), /currency_shape/))
ok('a deliverable quantity of zero is refused', refused(await pkgErr(`INSERT INTO event_partnership_package_deliverables (package_id, event_id, title, quantity) VALUES ($1, $2, 'Zero', 0)`, [SILVER, EV_A]), /quantity_positive/))
ok('a blank deliverable title is refused', refused(await pkgErr(`INSERT INTO event_partnership_package_deliverables (package_id, event_id, title) VALUES ($1, $2, ' ')`, [SILVER, EV_A]), /title_not_blank/))

const fns = await sup(`SELECT p.proname, p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
                              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, p.proconfig::text AS cfg
                         FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                        WHERE ns.nspname = 'public' AND p.proname IN ('get_event_partnership_packages', 'reorder_event_partnership_packages', 'reorder_package_deliverables', 'apply_partnership_package')`)
ok('the four package functions exist', fns.length === 4, JSON.stringify(fns))
ok('...run as the caller (SECURITY INVOKER), so RLS decides', fns.every((f) => f.prosecdef === false))
ok('...are executable by signed-in users and not by anon', fns.every((f) => f.auth_exec && !f.anon_exec))
ok('...and pin their search_path', fns.every((f) => /search_path=public, pg_temp/.test(f.cfg ?? '')), JSON.stringify(fns.map((f) => f.cfg)))
const rls = await sup(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('event_partnership_packages', 'event_partnership_package_deliverables')`)
ok('RLS is on for both package tables', rls.length === 2 && rls.every((r) => r.relrowsecurity))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
