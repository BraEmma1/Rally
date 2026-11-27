// The organization partner screens -- the backend behaviour their statements rely
// on. No migration accompanies this file: it pins down what migration
// 20261129000000_organization_partners already does, replaying the SQL
// equivalent of each request src/lib/partners.ts and the partner dialogs send.
//
//   1. a manager creates a partner from Add Partner or the Partners page; the
//      database stamps who created it
//   2. a second partner whose name differs only by case or spacing is refused,
//      naming the unique index the screens map to "already one of your partners"
//   3. Add Partner's insert with partner_id stores the partner's CURRENT details,
//      even when the screen sent details read before the partner was renamed
//   4. Edit Partner on a linked partnership: the event's own fields save; the
//      same save carrying the form's normalized company fields is refused --
//      which is why the screen leaves them out
//   5. the event tags query returns only events the caller manages
//   6. the history query's deliverable counts
//   7. archive and restore: owners and admins only; a restore whose name is now
//      taken is refused with the database's own message
//   8. nobody outside the organization reads its partners
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
const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await sup(sql, params))[0]
const user = async (email) => (await one(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id`, [email])).id
const setAccount = (uid, type, status = 'active') => sup(`UPDATE user_accounts SET account_type = $2, status = $3 WHERE user_id = $1`, [uid, type, status])
const mkOrg = async (name, creator, type = 'organizer') =>
  (await one(`INSERT INTO organizations (name, org_type, approval_status, created_by) VALUES ($1, $2, 'approved', $3) RETURNING id`, [name, type, creator])).id
const addMember = (org, uid, role) => sup(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, uid, role])
const mkEvent = async (name, org, by, start) => {
  await sup(`SET session_replication_role = replica`)
  try {
    return (await one(`INSERT INTO events (name, status, visibility, organization_id, created_by, start_date, end_date)
                       VALUES ($1, 'upcoming', 'published', $2, $3, $4, $4) RETURNING id`, [name, org, by, start])).id
  } finally { await sup(`SET session_replication_role = origin`) }
}

// ---- fixtures -------------------------------------------------------------
const U = {}
for (const k of ['owner', 'admin', 'manager', 'attendee', 'owner2'])
  U[k] = await user(`${k.toLowerCase()}@screens.test`)
await setAccount(U.owner, 'organizer')
await setAccount(U.owner2, 'organizer')
const ORG = await mkOrg('Org', U.owner)
const ORG2 = await mkOrg('Other Org', U.owner2)
await addMember(ORG, U.admin, 'admin')
await addMember(ORG, U.manager, 'manager')
const EV_A = await mkEvent('Summit A', ORG, U.owner, '2030-03-01')
const EV_B = await mkEvent('Summit B', ORG, U.owner, '2030-06-01')
await sup(`INSERT INTO event_team (event_id, user_id, assigned_by) VALUES ($1, $2, $3)`, [EV_A, U.manager, U.owner])

// createOrganizationPartner: exactly these eight columns.
const createPartner = (caller, org, d) => as(caller,
  `INSERT INTO organization_partners (organization_id, company_name, description, logo_url, industry, website, linkedin, contact_email)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
  [org, d.company_name, d.description ?? null, d.logo_url ?? null, d.industry ?? null, d.website ?? null, d.linkedin ?? null, d.contact_email ?? null])

// listPartnerEventLinks: event_partnerships with partner_id, inner-joined to the
// organization's events, with each partnership's obligations.
const eventLinks = (caller, org, partnerId = null) => as(caller,
  `SELECT ep.id, ep.partner_id, ep.event_id, ep.tier_label, ep.status, e.name AS event_name,
          (SELECT count(*) FROM event_partnership_obligations o WHERE o.partnership_id = ep.id AND o.direction = 'organizer_to_partner')::int AS owed_total,
          (SELECT count(*) FROM event_partnership_obligations o WHERE o.partnership_id = ep.id AND o.direction = 'organizer_to_partner' AND o.status = 'completed')::int AS owed_completed
     FROM event_partnerships ep JOIN events e ON e.id = ep.event_id
    WHERE ep.partner_id IS NOT NULL AND e.organization_id = $1 AND ($2::uuid IS NULL OR ep.partner_id = $2)
    ORDER BY e.start_date`, [org, partnerId])

// ---- 1. a manager creates a partner ----------------------------------------
const zuri = (await createPartner(U.manager, ORG, {
  company_name: 'Zuri Logistics', industry: 'Logistics', website: 'https://zuri.example', contact_email: 'hello@zuri.example',
})).rows[0]
ok('1. an assigned manager creates a partner', Boolean(zuri?.id))
ok('1. ...the database records the manager as its creator', zuri?.created_by === U.manager, zuri?.created_by)
ok('1. ...and it is active', zuri?.archived_at === null)

// ---- 2. a duplicate name ---------------------------------------------------
const dup = await err(U.admin, `INSERT INTO organization_partners (organization_id, company_name) VALUES ($1, $2)`, [ORG, '  zuri   LOGISTICS '])
ok('2. a name differing only by case and spacing is refused', dup !== null)
ok('2. ...naming the unique index the screens recognise', /organization_partners_active_name_unique/.test(dup ?? ''), dup)

// ---- 3. Add Partner with a chosen partner ------------------------------------
// The picker read "Zuri Logistics"; before Save, an admin renamed the partner.
await as(U.admin, `UPDATE organization_partners SET company_name = 'Zuri Logistics Group', website = 'https://zurigroup.example' WHERE id = $1`, [zuri.id])
const P_A = (await as(U.manager,
  `INSERT INTO event_partnerships (event_id, company_name, industry, website, representative_email, tier_label, partner_id)
   VALUES ($1, 'Zuri Logistics', 'Logistics', 'https://zuri.example', 'rep@zuri.example', 'Gold', $2) RETURNING *`, [EV_A, zuri.id])).rows[0]
ok('3. the partnership stores the partner\'s current name, not the stale one sent',
  P_A.company_name === 'Zuri Logistics Group', P_A.company_name)
ok('3. ...and its current website', P_A.website === 'https://zurigroup.example', P_A.website)
ok('3. ...while the event\'s own fields are as sent', P_A.representative_email === 'rep@zuri.example' && P_A.tier_label === 'Gold')

// ---- 4. Edit Partner on a linked partnership ---------------------------------
const linkedSave = await err(U.manager,
  `UPDATE event_partnerships SET tier_label = 'Platinum', value_amount = 20000, value_currency = 'GHS',
          internal_notes = 'Renewing', representative_email = 'ops@zuri.example' WHERE id = $1`, [P_A.id])
ok('4. a linked save of only the event\'s own fields succeeds', linkedSave === null, linkedSave)
const after4 = await one(`SELECT tier_label, internal_notes, company_name FROM event_partnerships WHERE id = $1`, [P_A.id])
ok('4. ...and is stored', after4.tier_label === 'Platinum' && after4.internal_notes === 'Renewing')
// Today's form sends all six back, normalized: a trailing slash on the website,
// blanks as NULL.
const formSave = await err(U.manager,
  `UPDATE event_partnerships SET company_name = 'Zuri Logistics Group', description = NULL, logo_url = NULL, industry = 'Logistics',
          website = 'https://zurigroup.example/', linkedin = NULL, tier_label = 'Platinum' WHERE id = $1`, [P_A.id])
ok('4. the same save with the form\'s normalized company fields is refused', /These details belong to the partner/.test(formSave ?? ''), formSave)

// ---- 5. event tags: only events the caller manages --------------------------
const P_B = (await as(U.owner, `INSERT INTO event_partnerships (event_id, company_name, partner_id) VALUES ($1, 'x', $2) RETURNING id`, [EV_B, zuri.id])).rows[0].id
const mgrLinks = (await eventLinks(U.manager, ORG)).rows
ok('5. the manager sees the link on the event they manage only', mgrLinks.length === 1 && mgrLinks[0].event_id === EV_A, JSON.stringify(mgrLinks))
const ownerLinks = (await eventLinks(U.owner, ORG)).rows
ok('5. the owner sees both events', ownerLinks.length === 2 && ownerLinks.map((r) => r.event_id).join() === [EV_A, EV_B].join())
ok('5. ...each with the event name', ownerLinks[1].event_name === 'Summit B')

// ---- 6. the history query's deliverable counts ------------------------------
const ob = async (dir, title, order) => (await as(U.owner,
  `INSERT INTO event_partnership_obligations (partnership_id, event_id, direction, title, display_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
  [P_B, EV_B, dir, title, order])).rows[0].id
const owed = []
for (let i = 0; i < 5; i++) owed.push(await ob('organizer_to_partner', 'Deliverable ' + i, i))
await ob('partner_to_organizer', 'Logo file', 0)
for (const id of owed.slice(0, 3)) {
  const e = await err(U.owner, `SELECT set_partnership_obligation_status($1, 'completed')`, [id])
  if (e) console.log('note: completing an obligation:', e)
}
const hist = (await eventLinks(U.owner, ORG, zuri.id)).rows.find((r) => r.id === P_B)
ok('6. the history counts deliverables owed to the partner only', hist?.owed_total === 5, JSON.stringify(hist))
ok('6. ...and the completed ones', hist?.owed_completed === 3, JSON.stringify(hist))
ok('6. the partner filter returns only that partner\'s links',
  (await eventLinks(U.owner, ORG, zuri.id)).rows.every((r) => r.partner_id === zuri.id))

// ---- 7. archive and restore --------------------------------------------------
const mgrArchive = (await as(U.manager, `UPDATE organization_partners SET archived_at = now() WHERE id = $1 RETURNING id`, [zuri.id])).rows.length
ok('7. a manager cannot archive a partner (nothing changes)', mgrArchive === 0)
const adminArchive = (await as(U.admin, `UPDATE organization_partners SET archived_at = $2 WHERE id = $1 RETURNING id`, [zuri.id, new Date().toISOString()])).rows.length
ok('7. an admin archives it', adminArchive === 1)
const adminRestore = (await as(U.admin, `UPDATE organization_partners SET archived_at = NULL WHERE id = $1 RETURNING id`, [zuri.id])).rows.length
ok('7. ...and restores it', adminRestore === 1)
await as(U.owner, `UPDATE organization_partners SET archived_at = now() WHERE id = $1`, [zuri.id])
await createPartner(U.owner, ORG, { company_name: 'zuri logistics group' })
const conflict = await err(U.owner, `UPDATE organization_partners SET archived_at = NULL WHERE id = $1`, [zuri.id])
ok('7. restoring when the name is taken is refused', conflict !== null)
ok('7. ...with the database\'s own message, which the screen shows as written', /already exists/i.test(conflict ?? ''), conflict)

// ---- 8. outsiders --------------------------------------------------------------
const seen = async (uid) => (await as(uid, `SELECT id FROM organization_partners WHERE organization_id = $1`, [ORG])).rows.length
ok('8. an attendee reads no partners', (await seen(U.attendee)) === 0)
ok('8. another organization\'s owner reads none', (await seen(U.owner2)) === 0)
ok('8. the other organization\'s owner sees no links either', (await eventLinks(U.owner2, ORG)).rows.length === 0)
void ORG2

// ---- 9. the foreign keys src/lib/partners.ts names in its embeds ---------------
// PostgREST needs the hint because other tables also join partnerships and events;
// a renamed constraint would break the Partners page, so its name is pinned here.
for (const [table, name] of [['event_partnerships', 'event_partnerships_event_id_fkey'],
                             ['event_partnership_obligations', 'event_partnership_obligations_partnership_fk']]) {
  const found = await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1 AND conrelid = ('public.' || $2)::regclass AND contype = 'f'`, [name, table])
  ok(`9. foreign key ${name} exists on ${table}`, found.n === 1)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
