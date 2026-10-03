import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// ---------------------------------------------------------------------------
// The INVITEE's side of a partnership invitation.
//
// Separate from partnerships.ts on purpose: that file is the organizer's
// private workspace, and nothing an invitee's screen imports should reach into
// it. Everything here goes through the four phase 3A functions written for a
// recipient, each of which authorizes on the caller's CONFIRMED email rather
// than on the invitation id:
//
//   my_pending_partnership_invitations()                  what I have been offered
//   my_eligible_sponsor_organizations(invitation)         which organizations I may use
//   accept_partnership_invitation_with_organization(..)   accept with an existing one
//   create_sponsor_organization_for_partnership_invitation(..)  create one and accept
//   decline_partnership_invitation(invitation)            decline
//
// Knowing an invitation's uuid therefore grants nothing: the list function
// filters on `invited_email = current_user_confirmed_email()`, and the write
// functions re-check it and lock the row. This file never queries
// event_partnerships, event_partnership_obligations or
// event_partnership_invitations directly, because an invitee has no read
// access to any of them before acceptance -- by design, not by omission.
// ---------------------------------------------------------------------------

/**
 * One row of my_pending_partnership_invitations.
 *
 * Note what is NOT here: no commercial value, no deliverables, no
 * requirements, no internal notes, no event location. Phase 3A withholds them
 * until acceptance on the grounds that "before acceptance this is an approach,
 * not an agreement". The UI shows what it is given and says so plainly.
 */
export type PendingPartnershipInvitation = {
  invitation_id: string
  partnership_id: string
  event_id: string
  event_name: string
  event_start_date: string | null
  organizer_organization_name: string
  company_name: string
  tier_label: string | null
  roles: string[]
  invited_by_name: string
  created_at: string
  expires_at: string
}

export type EligibleSponsorOrganization = {
  organization_id: string
  name: string
  logo_url: string | null
  website: string | null
  my_role: string
}

const PARTNERSHIP_ROLE_LABELS: Record<string, string> = {
  sponsor: 'Sponsor',
  exhibitor: 'Exhibitor',
  media_partner: 'Media Partner',
  supporting_partner: 'Supporting Partner',
  other: 'Other',
}

export function partnershipRolesLabel(roles: string[]): string {
  return roles.map((role) => PARTNERSHIP_ROLE_LABELS[role] ?? role).join(' · ')
}

/**
 * Errors here are read by someone who may never have used Rally before, so the
 * mapping is more protective than the organizer's. The database's own messages
 * are written for a person and pass through; anything that smells of a policy,
 * a constraint or a SQLSTATE becomes a neutral sentence.
 */
function mapInviteeError(
  error: { message?: string; code?: string; details?: string } | null,
  fallback: string
): string {
  const message = error?.message?.trim() ?? ''
  const code = error?.code ?? ''

  if (/Confirm your email address/i.test(message)) {
    return 'Confirm your email address before responding to this invitation.'
  }
  if (/No pending invitation for this account/i.test(message)) {
    return 'This invitation is not available to the account you are signed in to.'
  }
  if (/has already been accepted/i.test(message)) {
    return 'This invitation has already been accepted.'
  }
  if (/has already been declined/i.test(message)) {
    return 'This invitation has already been declined.'
  }
  if (/has already been revoked/i.test(message)) {
    return 'This invitation was withdrawn by the event organizer.'
  }
  if (/expired/i.test(message)) {
    return 'This invitation expired before it was accepted.'
  }
  if (/no longer open for a response/i.test(message)) {
    return 'This partnership is no longer open for a response.'
  }
  if (/archived/i.test(message)) {
    return 'This event has been archived, so the invitation can no longer be accepted.'
  }
  if (/do not administer that organization|cannot be a sponsor/i.test(message)) {
    return 'You cannot use that organization for this partnership.'
  }
  if (/organization name is too long/i.test(message)) {
    return 'That organization name is too long.'
  }
  if (/Enter your organization name/i.test(message)) {
    return 'Enter your organization name.'
  }
  if (/account is not active|account is not set up|cannot join a sponsor organization/i.test(message)) {
    return 'Your Rally account cannot accept this invitation. Contact support if that seems wrong.'
  }
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return fallback
  }
  return readableError(error, fallback)
}

/**
 * Every pending invitation this account has. The page picks the one named in
 * the URL; asking for the list rather than for an id is what the backend
 * offers, and it is also what keeps a uuid from being a lookup key.
 */
export async function listMyPendingPartnershipInvitations(): Promise<{
  data: PendingPartnershipInvitation[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('my_pending_partnership_invitations')
  if (error) {
    return { data: [], error: mapInviteeError(error, 'Unable to load this invitation.') }
  }
  const rows = (data ?? []) as PendingPartnershipInvitation[]
  return { data: rows.map((row) => ({ ...row, roles: row.roles ?? [] })), error: null }
}

/**
 * Sponsor organizations this caller already owns or administers.
 *
 * There is deliberately no search, no lookup by name and no lookup by domain:
 * the candidate list can only contain organizations the caller already has
 * authority over, so the UI has nothing to offer that the backend would refuse.
 */
export async function listEligibleSponsorOrganizations(
  invitationId: string
): Promise<{ data: EligibleSponsorOrganization[]; error: string | null }> {
  const { data, error } = await supabase.rpc('my_eligible_sponsor_organizations', {
    invitation_id: invitationId,
  })
  if (error) {
    return { data: [], error: mapInviteeError(error, 'Unable to load your organizations.') }
  }
  return { data: (data ?? []) as EligibleSponsorOrganization[], error: null }
}

/** Accept using an organization the caller already administers. */
export async function acceptWithExistingOrganization(
  invitationId: string,
  organizationId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('accept_partnership_invitation_with_organization', {
    invitation_id: invitationId,
    sponsor_organization_id: organizationId,
  })
  if (error) return { error: mapInviteeError(error, 'Unable to accept this partnership.') }
  return { error: null }
}

/**
 * Create the sponsor organization and accept, in one transaction.
 *
 * Not two calls. The organization is created by a definer function authorized
 * entirely by this invitation -- `organizations` INSERT is still
 * organizer-only -- and the same transaction links the partnership, accepts
 * the invitation, activates it and stamps acknowledged_at. Creating the
 * organization separately and linking it afterwards is not possible from a
 * client, which is the point.
 */
export async function acceptWithNewOrganization(input: {
  invitationId: string
  name: string
  website?: string | null
  description?: string | null
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc(
    'create_sponsor_organization_for_partnership_invitation',
    {
      invitation_id: input.invitationId,
      organization_name: input.name,
      organization_website: input.website ?? null,
      organization_description: input.description ?? null,
    }
  )
  if (error) return { error: mapInviteeError(error, 'Unable to set up your organization.') }
  return { error: null }
}

export async function declinePartnershipInvitation(
  invitationId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('decline_partnership_invitation', {
    invitation_id: invitationId,
  })
  if (error) return { error: mapInviteeError(error, 'Unable to decline this invitation.') }
  return { error: null }
}
