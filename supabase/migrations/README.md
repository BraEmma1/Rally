# Migration history — repository vs Supabase

The version numbers in this directory **do not match** the versions recorded in
the Supabase project. The schemas agree; the numbering does not. This file is
the mapping, and it exists so that nobody tries to "fix" the difference with a
command that would re-run 50 migrations against production.

Verified 2026-10-15 by comparing every repository file against the `statements`
column of `supabase_migrations.schema_migrations`, normalised identically on
both sides (unescape `\r`/`\n`, strip block and line comments, drop semicolons,
collapse whitespace). "Identical" below means the normalised SQL hashes match.

## Rules

1. **Never run `supabase db push` against production.** The CLI applies local
   versions the remote has not recorded. 51 of the files here carry a version
   production has never seen, so a push would attempt to re-run them all.
2. **Never run `db reset` or `migration repair` against production.**
3. New migrations are forward-only. Do not edit a file that has already been
   applied anywhere — add a new one.
4. A migration provisions schema and controlled data. It never creates a
   reusable login, never writes an account past its approval state, and never
   disables a trigger.

## Why the numbering diverged

The early history was renumbered in the repository into a tidy ladder
(`20260919120000`, `20260919130000`, …) while the database kept its original
wall-clock versions. The re-sequencing is **order-preserving**: sort both sides
and the pairs line up one-to-one in the same relative order, so a fresh
environment applies the same changes in the same sequence.

The partnership phases diverge for a different reason. Phases 3B, 5A, 5B and 6A
were developed on stacked branches that never reached `development`, and their
files are dated *after* phase 1 and 3A **as this repository numbers them**
(`20261004000000` / `20261005000000`). Production numbers phase 1 and 3A
earlier (`20261002124140` / `20261002131727`), so the production versions of
3B–6A sort *before* their own prerequisites here. **They therefore keep their
forward-dated repository versions** — renaming them to the production versions
would break a fresh deployment.

## Mapping

| Repository version | Supabase version | Migration | Content |
| --- | --- | --- | --- |
| `20260919120000` | `20260919100638` | add_profile_access_functions | consolidated |
| `20260919120100` | `20260919100704` | add_notification_functions | consolidated |
| `20260919120200` | `20260919100724` | add_event_id_foreign_keys | identical |
| `20260919120300` | `20260919100738` | add_event_registration_functions | consolidated |
| `20260919130000` | `20260919103223` | revoke_public_profile_read | identical |
| `20260919130100` | `20260919103229` | remove_permissive_notification_insert | identical |
| `20260919130200` | `20260919103237` | remove_auto_confirm_email | consolidated |
| `20260919130300` | `20260919103244` | enforce_safe_urls | identical |
| `20260919130400` | `20260919103252` | restrict_avatar_uploads | identical |
| `20260919130500` | `20260919103300` | restrict_event_registration_visibility | identical |
| `20260919140000` | `20260919185126` | org_core_tables | identical |
| `20260919140100` | `20260919185238` | event_organization_fields | identical |
| `20260919140200` | `20260919185304` | org_authorization_helpers | identical |
| `20260919140300` | `20260919185337` | org_rls_foundations | identical |
| `20260919150000` | `20260919194744` | account_type_foundation | identical |
| `20260919150100` | `20260919194807` | account_type_administration | identical |
| `20260919150200` | `20260919194841` | organization_access_rules | identical |
| `20260919150300` | `20260919194906` | authorization_hardening | identical |
| `20260919150400` | `20260919195006` | lock_contact_consent_columns | identical |
| `20260920000000` | `20260920002025` | organizer_phase_b_organization_rules | identical |
| `20260920000100` | `20260920002148` | organizer_phase_b_team_rpcs | identical |
| `20260921000000` | `20260920183623` | organizer_event_security | identical |
| `20260921000100` | `20260920183726` | organizer_event_rpcs | identical |
| `20260921000200` | `20260920183805` | organization_people | identical |
| `20260922000000` | `20260920200423` | event_check_in | identical |
| `20260922000100` | `20260920200442` | event_activity_counts | identical |
| `20260922000200` | `20260920200510` | event_networking_context | identical |
| `20260922000300` | `20260920202239` | undo_event_check_in | identical |
| `20260923000000` | `20260920213544` | event_manager_assignment | consolidated |
| `20260923000100` | `20260920213639` | email_organization_invitations | identical |
| `20260924000000` | `20260920215841` | attendees_may_join_organization_teams | identical |
| `20260925000000` | `20260920230758` | invitation_email_delivery | identical |
| `20260926000000` | `20260920234217` | event_networking_analytics | consolidated |
| `20260927000000` | `20260923142830` | messaging_foundation | consolidated |
| `20260928000000` | `20260923150301` | my_organization_access | consolidated |
| `20260929000000` | `20260923190355` | event_sessions | identical |
| `20260929000100` | `20260923215214` | revoke_truncate_and_grant_agenda_read | identical |
| `20260930000000` | `20260923221317` | event_session_bookmarks | identical |
| `20261001120000` | `20261001020524` | mark_conversation_read_only_when_new | identical |
| `20261001140000` | `20261001025508` | event_session_author_is_the_caller | identical |
| `20261002000000` | `20261001080031` | event_speakers | consolidated |
| `20261003000000` | `20261001104514` | event_exhibitors | consolidated |
| `20261004000000` | `20261002124140` | event_partnerships_phase_1 | consolidated |
| `20261005000000` | `20261002131727` | partnership_invitations_phase_3a | consolidated |
| `20261005000100` | `20261002131805` | partnership_invitation_email_payload_view | identical |
| `20261005000200` | `20261002133909` | partnership_invitation_payload_expose_queue_status | identical |
| `20261006000000` | `20261003003255` | partnership_invitation_review_phase_3b | identical |
| `20261007000000` | `20261003004933` | event_partnership_packages_phase_5a | identical |
| `20261008000000` | `20261003012225` | event_partnership_documents_phase_5b | identical |
| `20261009000000` | `20261003091251` | sponsor_partnership_workspace_phase_6a | identical |
| `20261009000100` | `20261003091919` | sponsor_membership_requires_active_account_phase_6a | identical |

Sixteen further migrations carry the **same version on both sides**: the
thirteen `20260918…`–`20260919015236` files that opened the project, plus
`20260920225452` (event banner bucket), `20261001012432` (broadcast read
receipts) and `20261003115854` (see below). All sixteen are content-identical
except the tombstone.

## "Consolidated" files

Twelve repository files hold the **final** state of a migration that production
reached in two or more steps. The end state is the same; the repository gets
there in one statement set. These production versions therefore have no file of
their own, by design:

| Production version | Migration | Folded into |
| --- | --- | --- |
| `20260919101045` | revoke_anon_execute_on_scoped_functions | `20260919120000`, `20260919120100`, `20260919120300` |
| `20260923150423` | my_organization_access_full_row | `20260928000000_my_organization_access.sql` |
| `20261002132125` | partnership_representative_guard_precision | `20261005000000_partnership_invitations_phase_3a.sql` |
| `20261002132350` | partnership_link_guard_null_logic_fix | `20261005000000_partnership_invitations_phase_3a.sql` |

One production version is **superseded** rather than folded in:

| Production version | Migration | Superseded by |
| --- | --- | --- |
| `20260920213835` | event_read_policy_insert_returning_fix | `20261010000000_restore_event_read_policy_to_production_form.sql` |

`20260921000000_organizer_event_security.sql` still creates
`read_own_organization_events` in its original, looser form. Rather than edit a
migration that has already run, `20261010000000` recreates the policy in the
form production actually enforces. Against production it is a no-op.

## `20261003115854_create_test_sponsor_account.sql.sql`

A **deliberate tombstone**. It once provisioned two reusable identities with
hardcoded passwords and ran against production (audit finding R-03). The file is
emptied rather than deleted so that the version stays present on both sides;
emptying it also removed a fresh-environment failure, because the original
inserted into `event_partnerships` at a point in this repository's ordering
where that table does not yet exist. It is the one aligned version whose content
intentionally differs from production. Do not restore it.
