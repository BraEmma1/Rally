// SECURITY DEFINER inventory (backlog B-04, minimum security foundation PR-2).
//
// Every public function in Rally is an API endpoint: PostgREST exposes anything a role
// may EXECUTE. SECURITY DEFINER functions run with their owner's rights, so each one
// must (a) pin its search_path, (b) be executable only by the roles meant to call it,
// and (c) check authorization in its body. This suite enforces (a) and (b) for every
// function, and turns (b) into a reviewed inventory: adding, removing or re-granting
// a client-callable SECURITY DEFINER function fails here until the lists below are
// updated in the same pull request, so every change to the API surface is visible in
// review. It does NOT prove (c): the authorization *behaviour* of the high-risk
// functions is tested in the behaviour suites.
//
// Runs on PGlite; see boot.mjs for what that does and does not prove.
import fs from 'node:fs'
import path from 'node:path'
import { boot, MIGRATIONS } from './boot.mjs'

const MIG = process.argv[2] || MIGRATIONS
const { db, failures } = await boot(MIG)
if (failures.length) { console.log('MIGRATION FAILURES', failures); process.exit(1) }

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail) }
}
const sup = async (sql, params = []) => (await db.query(sql, params)).rows
const diff = (actual, expected) => {
  const a = new Set(actual), e = new Set(expected)
  const added = [...a].filter((x) => !e.has(x)), removed = [...e].filter((x) => !a.has(x))
  return { same: added.length === 0 && removed.length === 0, detail: JSON.stringify({ added, removed }) }
}

// ---- the reviewed inventory ------------------------------------------------
// SECURITY DEFINER functions that signed-in users may EXECUTE. Each must check
// authorization in its body (account_is_active(), membership helpers, ownership...).
// To change this list: add or remove the signature here in the same PR as the
// migration, and say in the PR why the function needs client access.
const AUTHENTICATED_DEFINER = [
  'accept_organization_invitation(uuid)',
  'accept_partnership_invitation_with_organization(uuid,uuid)',
  'account_is_active()',
  'admin_activity_series(text,text,date,date)',
  'admin_get_event(uuid)',
  'admin_get_organization(uuid)',
  'admin_list_events(text,text,text,uuid,date,date,boolean,text,integer,integer)',
  'admin_list_organizations(text,org_type,org_approval_status,boolean,text,integer,integer)',
  'admin_list_users(text,account_type,account_status,text,integer,integer)',
  'admin_platform_overview()',
  'assign_event_manager(uuid,uuid)',
  'can_manage_event(uuid)',
  'can_read_partnership(uuid)',
  'can_read_partnership_document_object(text)',
  'can_write_partnership_document_object(text)',
  'cancel_connection_request(uuid)',
  'cancel_event_registration(uuid)',
  'check_in_event_attendee(uuid,uuid)',
  'connect_with_event_attendee(uuid,uuid,text)',
  'create_direct_conversation(uuid,uuid)',
  'create_organizer_organization(text,text,text)',
  'create_sponsor_organization_for_partnership_invitation(uuid,text,text,text,text)',
  'current_account_type()',
  'decline_organization_invitation(uuid)',
  'decline_partnership_invitation(uuid)',
  'event_activity_counts(uuid)',
  'event_attendee_directory(uuid)',
  'event_attendee_export(uuid,text,text,integer,integer)',
  'event_attendee_list(uuid)',
  'event_attendee_page(uuid,text,text,integer,integer)',
  'event_industry_activity(uuid)',
  'event_industry_connections(uuid)',
  'event_invitation_list(uuid)',
  'event_networking_overview(uuid)',
  'event_networking_timeline(uuid)',
  'event_opportunity_breakdown(uuid)',
  'event_org_id(uuid)',
  'event_registration_detail(uuid,uuid)',
  'event_team_list(uuid)',
  'find_event_attendees(uuid,text)',
  'get_connect_profile(uuid)',
  'get_conversation_messages(uuid,timestamp with time zone,integer)',
  'get_event_host(uuid)',
  'get_event_registration_answers(uuid,integer,integer)',
  'get_event_registration_counts(uuid[])',
  // Registration open/close migration: scoped event status metadata for signed-in users.
  'get_event_registration_states(uuid[])',
  'get_event_registration_form(uuid)',
  'get_my_conversations()',
  'get_my_organization_access()',
  'get_partnership_documents(uuid)',
  'get_public_profile(uuid)',
  'get_public_profiles(uuid[])',
  'invitation_delivery_status(uuid)',
  'invite_event_attendee(uuid,text)',
  'invite_organization_member(uuid,text,org_role)',
  'invite_partnership_representative(uuid,text)',
  'is_conversation_member(uuid)',
  'is_invited_to_event(uuid)',
  'is_org_admin(uuid)',
  // Organization partners migration (20261129000000): read/create access to the
  // organization's partner list for event managers of the organization.
  'is_org_event_manager(uuid)',
  'is_org_member(uuid)',
  'is_org_owner(uuid)',
  'is_partnership_sponsor_member(uuid)',
  'is_platform_admin()',
  'is_registered_for_event(uuid)',
  'is_waitlisted_for_event(uuid)',
  'list_partnership_invitations(uuid)',
  'mark_conversation_read(uuid)',
  'my_connection_requests()',
  'my_eligible_sponsor_organizations(uuid)',
  'my_event_marketing_consent(uuid)',
  'my_event_registration(uuid)',
  'my_partnership_invitation(uuid)',
  'my_partnership_invitation_obligations(uuid)',
  'my_pending_organization_invitations()',
  'my_pending_partnership_invitations()',
  'my_sponsor_partnership_ids()',
  'my_sponsor_partnership_obligations(uuid)',
  'my_sponsor_partnerships()',
  'notify_invitation_response(uuid)',
  'notify_new_connection(uuid)',
  'org_role_for(uuid)',
  'organization_event_counts(uuid)',
  'organization_invitation_list(uuid)',
  'organization_member_directory(uuid)',
  'organization_people(uuid)',
  'organizer_cancel_event_registration(uuid,uuid)',
  'organizer_promote_waitlisted_registration(uuid,uuid)',
  'register_for_event(uuid,jsonb)',
  'remove_organization_member(uuid,uuid)',
  'reorder_event_exhibitors(uuid,uuid[])',
  'reorder_event_sessions(uuid,uuid[])',
  'reorder_event_speakers(uuid,uuid[])',
  'resend_organization_invitation(uuid)',
  'resend_partnership_invitation(uuid)',
  'respond_to_connection_request(uuid,boolean)',
  'revoke_organization_invitation(uuid)',
  'revoke_partnership_invitation(uuid)',
  'send_connection_request(uuid,uuid)',
  'send_message(uuid,text)',
  'set_account_status(uuid,account_status,text)',
  'set_account_type(uuid,account_type,text)',
  'set_event_marketing_consent(uuid,boolean)',
  'set_event_registration_questions(uuid,jsonb)',
  'set_organization_archived(uuid,boolean)',
  'set_organization_member_role(uuid,uuid,org_role)',
  'unassign_event_manager(uuid,uuid)',
  'undo_event_check_in(uuid,uuid)',
]

// Functions anonymous visitors may EXECUTE, and why. Anything else reachable by
// `anon` fails this suite.
const ANON_ALLOWED = {
  // SECURITY DEFINER, deliberately public (migration 20260919120000): the public
  // professional card at /p/:id. Returns no email or phone.
  'get_public_profile(uuid)': 'definer',
  // SECURITY DEFINER, deliberately public (migration 20260919120300): confirmed
  // registration counts for event listings.
  'get_event_registration_counts(uuid[])': 'definer',
  // SECURITY INVOKER: they run with the caller's rights, so RLS decides what anon sees.
  'get_event_agenda(uuid)': 'invoker',
  'get_event_speakers(uuid)': 'invoker',
  'get_event_speaker_sessions(uuid)': 'invoker',
  'get_event_session_speakers(uuid)': 'invoker',
  'get_event_exhibitors(uuid)': 'invoker',
}

// Tables with RLS enabled and deliberately no policies: no client can read or write
// them directly; they are reached only through SECURITY DEFINER functions.
const RLS_NO_POLICY = [
  'event_marketing_consents',
  'event_registration_answers',
  'event_registration_questions',
  // Read-only IANA timezone catalogue, populated by migration-managed functions.
  'iana_time_zones',
  // Identity stage S1 (migration 20261125000000): written only by the sync
  // triggers, read by no client. Stages S2/S3 add read paths with their own tests.
  'organization_capabilities',
  'organization_capability_changes',
  'partnership_invitation_emails',
  'platform_roles',
]

// ---- facts about every function in public ---------------------------------
const fns = await sup(`
  SELECT p.oid::regprocedure::text AS sig, p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner,
         (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS sp,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  ORDER BY 1`)
const definer = fns.filter((f) => f.definer)
console.log(`(info) ${fns.length} functions in public, ${definer.length} SECURITY DEFINER`)
ok('(sanity) the inventory query found the functions', fns.length > 100 && definer.length > 100, `${fns.length}/${definer.length}`)

// ---- (a) search_path --------------------------------------------------------
const badPath = fns.filter((f) => f.sp !== 'search_path=public, pg_temp').map((f) => `${f.sig} -> ${f.sp}`)
ok('every function in public pins search_path = public, pg_temp', badPath.length === 0, JSON.stringify(badPath))
ok('no SECURITY DEFINER function relies on the caller\'s search_path', definer.every((f) => f.sp !== null))

// ---- ownership ----------------------------------------------------------------
const notPostgres = definer.filter((f) => f.owner !== 'postgres').map((f) => `${f.sig} owned by ${f.owner}`)
ok('every SECURITY DEFINER function is owned by postgres (not by a client role)', notPostgres.length === 0, JSON.stringify(notPostgres))

// ---- (b) who may EXECUTE ------------------------------------------------------
const publicExec = definer.filter((f) => f.public_exec).map((f) => f.sig)
ok('no SECURITY DEFINER function is executable by PUBLIC', publicExec.length === 0, JSON.stringify(publicExec))

const anonFns = fns.filter((f) => f.anon)
const anonDiff = diff(anonFns.map((f) => f.sig), Object.keys(ANON_ALLOWED))
ok('anon may execute exactly the allow-listed functions', anonDiff.same, anonDiff.detail)
const wrongKind = anonFns.filter((f) => ANON_ALLOWED[f.sig] && (ANON_ALLOWED[f.sig] === 'definer') !== f.definer).map((f) => f.sig)
ok('each anon function is the kind the allow-list says (definer vs invoker)', wrongKind.length === 0, JSON.stringify(wrongKind))

const authDiff = diff(definer.filter((f) => f.authed).map((f) => f.sig), AUTHENTICATED_DEFINER)
ok(`signed-in users may execute exactly the ${AUTHENTICATED_DEFINER.length} inventoried SECURITY DEFINER functions`, authDiff.same, authDiff.detail)
const anonDefinerNotInventoried = Object.entries(ANON_ALLOWED).filter(([sig, kind]) => kind === 'definer' && !AUTHENTICATED_DEFINER.includes(sig)).map(([sig]) => sig)
ok('every anon SECURITY DEFINER function is also in the signed-in inventory', anonDefinerNotInventoried.length === 0, JSON.stringify(anonDefinerNotInventoried))
console.log(`(info) ${definer.filter((f) => !f.authed && !f.anon).length} SECURITY DEFINER functions are internal (triggers and helpers with no client EXECUTE)`)

// The two functions migration 20261123000000 touched keep their exact grants.
const fn = (sig) => fns.find((f) => f.sig === sig)
const counts = fn('get_event_registration_counts(uuid[])')
ok('get_event_registration_counts keeps anon + authenticated EXECUTE and SECURITY DEFINER',
  counts && counts.anon && counts.authed && counts.definer && !counts.public_exec)
const mayJoin = fn('account_type_may_join_org(account_type,org_type)')
ok('account_type_may_join_org stays internal (no client EXECUTE) and SECURITY INVOKER',
  mayJoin && !mayJoin.anon && !mayJoin.authed && !mayJoin.public_exec && !mayJoin.definer)
ok('account_type_may_join_org still answers the same rules',
  (await sup(`SELECT account_type_may_join_org('attendee','sponsor') a, account_type_may_join_org('platform_admin','organizer') b,
                     account_type_may_join_org('sponsor','sponsor') c, account_type_may_join_org('vendor','organizer') d`))
    .every((r) => r.a === true && r.b === false && r.c === true && r.d === false))

// ---- tables -------------------------------------------------------------------
const noRls = (await sup(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`)).map((r) => r.relname)
ok('RLS is enabled on every table in public', noRls.length === 0, JSON.stringify(noRls))
const noPolicy = (await sup(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
  ORDER BY 1`)).map((r) => r.relname)
const npDiff = diff(noPolicy, RLS_NO_POLICY)
ok(`only the ${RLS_NO_POLICY.length} listed function-only tables have RLS with no policies`, npDiff.same, npDiff.detail)

// ---- the migration is safe to re-run ------------------------------------------
const migFile = path.join(MIG, '20261123000000_pin_function_search_paths.sql')
if (fs.existsSync(migFile)) {
  let rerun = null
  try { await db.exec(fs.readFileSync(migFile, 'utf8')) } catch (e) { rerun = String(e.message) }
  ok('migration 20261123000000 can be re-run', rerun === null, rerun ?? '')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
