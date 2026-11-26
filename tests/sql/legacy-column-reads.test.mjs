// Allow-list of every remaining read of the legacy identity columns user_accounts.account_type
// and organizations.org_type (identity plan RALLY_S2_S4_SCOPE.md, introduced with PR-2).
//
// The identity migration moves authorization from these columns to platform_roles and
// organization_capabilities one PR at a time. This suite names every function and policy
// that still reads them, why, and which PR removes the read, so nothing depends on them
// implicitly:
//   - a function or policy that reads them but is not listed fails (a new dependency);
//   - a listed entry that no longer reads them fails (the list must shrink with the code);
//   - every entry must say why it is there and which PR (or S5) removes it.
//
// "Reads" means: the function body mentions account_type or org_type (columns, enum casts,
// current_account_type()), or its signature uses those enum types; or a policy expression
// mentions them.
//
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node tests/sql/legacy-column-reads.test.mjs [migrations-dir]
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}

// group: what the read is for (RALLY_S2_SCOPE.md section 2 groups, plus the S1 sync).
// removedBy: the PR in RALLY_S2_S4_SCOPE.md that removes the read (S5 = the contract stage).
const FUNCTIONS = {
  accept_organization_invitation: { group: 'membership rule + GAP-3 activation', removedBy: 'PR-3' },
  accept_partnership_invitation_with_organization: { group: 'capability decision (sponsor)', removedBy: 'PR-6' },
  account_type_may_join_org: { group: 'membership rule (signature uses both enums)', removedBy: 'PR-3' },
  admin_activity_series: { group: 'admin display (account counts by type)', removedBy: 'PR-12' },
  admin_get_event: { group: 'admin display (owner organization type)', removedBy: 'PR-10' },
  admin_get_organization: { group: 'admin display (organization type, member account types)', removedBy: 'PR-10, PR-12' },
  admin_list_organizations: { group: 'admin display and filter (organization type)', removedBy: 'PR-10' },
  admin_list_users: { group: 'admin display and filter (account type)', removedBy: 'PR-12' },
  admin_platform_overview: { group: 'admin display (counts by type)', removedBy: 'PR-10, PR-12' },
  capability_for_org_type: { group: 'S1 sync mapping (signature uses org_type)', removedBy: 'PR-4' },
  create_organizer_organization: { group: 'legacy approval gate (organizer account) and writer', removedBy: 'PR-10' },
  create_sponsor_organization_for_partnership_invitation: { group: 'writer of org_type', removedBy: 'PR-6' },
  current_account_type: { group: 'compatibility helper for the old UI and the legacy gate', removedBy: 'S5' },
  enforce_event_owner_org_type: { group: 'capability decision (event ownership)', removedBy: 'PR-4, PR-6' },
  enforce_member_account_type: { group: 'membership rule (trigger)', removedBy: 'PR-3' },
  enforce_organization_partner_rules: { group: 'capability decision (partner list owner)', removedBy: 'PR-4, PR-6' },
  enforce_organization_immutable_fields: { group: 'guard of the legacy columns', removedBy: 'S5' },
  get_my_organization_access: { group: 'display for the current UI (organization type)', removedBy: 'PR-8' },
  handle_new_user: { group: 'signup writer (organizer intent)', removedBy: 'PR-9a' },
  identity_s1_drift: { group: 'S1 consistency check', removedBy: 'PR-4' },
  invite_event_attendee: { group: 'attendee-only invitation', removedBy: 'PR-9a' },
  invite_organization_member: { group: 'membership rule', removedBy: 'PR-3' },
  lock_acceptable_partnership_invitation: { group: 'membership rule (sponsor acceptance)', removedBy: 'PR-3' },
  my_eligible_sponsor_organizations: { group: 'capability decision (sponsor)', removedBy: 'PR-6' },
  my_pending_organization_invitations: { group: 'display (organization type)', removedBy: 'PR-10' },
  set_account_status: { group: 'platform-admin writer (reads account type)', removedBy: 'PR-12' },
  set_account_type: { group: 'platform-admin writer of account_type', removedBy: 'PR-12' },
  sync_organization_capability: { group: 'S1 sync trigger (org_type -> capabilities)', removedBy: 'PR-4' },
  sync_platform_role: { group: 'S1 sync trigger (account_type -> platform_roles)', removedBy: 'PR-12' },
}
const POLICIES = {
  'organizations.insert_organization_as_organizer': { group: 'unreachable since #78 (no client INSERT grant)', removedBy: 'S5' },
}
// Removed so far, and by which PR. A function listed here must not read the columns again.
const REMOVED = { is_platform_admin: 'PR-2' }

const body = (await db.query(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ '(account_type|org_type)'`)).rows.map((r) => r.proname)
const sig = (await db.query(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND (pg_get_function_arguments(p.oid) ~ '(account_type|org_type)' OR pg_get_function_result(p.oid) ~ '(account_type|org_type)')`)).rows.map((r) => r.proname)
const found = [...new Set([...body, ...sig])].sort()
const pols = (await db.query(`SELECT tablename || '.' || policyname AS p FROM pg_policies
  WHERE schemaname IN ('public', 'storage') AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(account_type|org_type)'`)).rows.map((r) => r.p).sort()

const listed = Object.keys(FUNCTIONS).sort()
const unlisted = found.filter((f) => !FUNCTIONS[f])
const stale = listed.filter((f) => !found.includes(f))
ok(`every function that reads account_type or org_type is listed (${found.length} found)`, unlisted.length === 0, 'unlisted: ' + unlisted.join(', '))
ok(`every listed function still reads them (no stale entries; ${listed.length} listed)`, stale.length === 0, 'stale: ' + stale.join(', '))
ok('every function entry says why it is there and which PR removes the read', listed.every((f) => FUNCTIONS[f].group && /^(PR-\d+[ab]?(, PR-\d+[ab]?)*|S5)$/.test(FUNCTIONS[f].removedBy)))

const unlistedP = pols.filter((p) => !POLICIES[p])
const staleP = Object.keys(POLICIES).filter((p) => !pols.includes(p))
ok(`every policy that reads them is listed (${pols.length} found)`, unlistedP.length === 0, 'unlisted: ' + unlistedP.join(', '))
ok('every listed policy still reads them', staleP.length === 0, 'stale: ' + staleP.join(', '))

const back = Object.keys(REMOVED).filter((f) => found.includes(f))
ok(`functions already moved off the legacy columns stay off them (${Object.entries(REMOVED).map(([f, pr]) => `${f} by ${pr}`).join(', ')})`, back.length === 0, 'reads again: ' + back.join(', '))

ok('current size: 29 functions and 1 policy (PR-2 removed is_platform_admin; the organization partner list added enforce_organization_partner_rules)', found.length === 29 && pols.length === 1, `${found.length} functions, ${pols.length} policies`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
