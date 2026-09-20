import { supabase } from '@/lib/supabase'
import type {
  IncomingInvitation,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationMembership,
  OrgRole,
} from '@/lib/supabase'

// Every membership write goes through a SECURITY DEFINER function, because
// organization_members has no INSERT/UPDATE/DELETE policy at all. The database
// rejects anything these helpers would let through, so the UI never has to be
// the last line of defence — it only has to not offer buttons that will fail.
//
// Those functions raise with messages written for a person to read, so they are
// passed through unchanged. Anything else gets a neutral fallback rather than a
// Postgres internal.
function readableError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message?.trim()
  if (!message) return fallback
  if (/^(permission denied|new row violates|duplicate key|null value|invalid input)/i.test(message)) {
    return fallback
  }
  return message
}

export async function listMyOrganizations(): Promise<{
  data: OrganizationMembership[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('role, organizations(*)')
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: readableError(error, 'Could not load your organizations.') }

  const memberships = (data ?? [])
    .map((row) => {
      // PostgREST types an embedded to-one relation as a possible array.
      const embedded = (row as { organizations: Organization | Organization[] | null }).organizations
      const organization = Array.isArray(embedded) ? embedded[0] : embedded
      return organization ? { role: (row as { role: OrgRole }).role, organization } : null
    })
    .filter((m): m is OrganizationMembership => m !== null)

  return { data: memberships, error: null }
}

export async function createOrganization(input: {
  name: string
  description?: string
  website?: string
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_organizer_organization', {
    org_name: input.name,
    org_description: input.description ?? '',
    org_website: input.website ?? '',
  })
  if (error) return { id: null, error: readableError(error, 'Could not create the organization.') }
  return { id: data as string, error: null }
}

export async function updateOrganization(
  id: string,
  patch: { name?: string; description?: string; website?: string; logo_url?: string }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('organizations').update(patch).eq('id', id)
  if (error) return { error: readableError(error, 'Could not save those changes.') }
  return { error: null }
}

export async function setOrganizationArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_organization_archived', {
    org_id: id,
    archived,
  })
  if (error) return { error: readableError(error, 'Could not update the organization.') }
  return { error: null }
}

export async function listMembers(
  orgId: string
): Promise<{ data: OrganizationMember[]; error: string | null }> {
  const { data, error } = await supabase.rpc('organization_member_directory', { org_id: orgId })
  if (error) return { data: [], error: readableError(error, 'Could not load the team.') }
  return { data: (data ?? []) as OrganizationMember[], error: null }
}

export async function listInvitations(
  orgId: string
): Promise<{ data: OrganizationInvitation[]; error: string | null }> {
  const { data, error } = await supabase.rpc('organization_invitation_list', { org_id: orgId })
  if (error) return { data: [], error: readableError(error, 'Could not load invitations.') }
  return { data: (data ?? []) as OrganizationInvitation[], error: null }
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: OrgRole
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('invite_organization_member', {
    org_id: orgId,
    invitee_email: email,
    invitee_role: role,
  })
  if (error) return { error: readableError(error, 'Could not send that invitation.') }
  return { error: null }
}

export async function revokeInvitation(invitationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('revoke_organization_invitation', {
    invitation_id: invitationId,
  })
  if (error) return { error: readableError(error, 'Could not withdraw that invitation.') }
  return { error: null }
}

export async function setMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_organization_member_role', {
    org_id: orgId,
    target_user_id: userId,
    new_role: role,
  })
  if (error) return { error: readableError(error, 'Could not change that role.') }
  return { error: null }
}

export async function removeMember(
  orgId: string,
  userId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('remove_organization_member', {
    org_id: orgId,
    target_user_id: userId,
  })
  if (error) return { error: readableError(error, 'Could not remove that person.') }
  return { error: null }
}

export async function listMyPendingInvitations(): Promise<{
  data: IncomingInvitation[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('my_pending_organization_invitations')
  if (error) return { data: [], error: readableError(error, 'Could not load your invitations.') }
  return { data: (data ?? []) as IncomingInvitation[], error: null }
}

export async function acceptInvitation(invitationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('accept_organization_invitation', {
    invitation_id: invitationId,
  })
  if (error) return { error: readableError(error, 'Could not accept that invitation.') }
  return { error: null }
}

export async function declineInvitation(invitationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('decline_organization_invitation', {
    invitation_id: invitationId,
  })
  if (error) return { error: readableError(error, 'Could not decline that invitation.') }
  return { error: null }
}

// ---------------------------------------------------------------------------
// What the UI is allowed to offer.
//
// These mirror the rules the RPCs enforce. They exist to keep the screen honest
// — hiding a button the server would reject — and never as the enforcement
// itself. Every rule here is checked again in the database.
// ---------------------------------------------------------------------------
export function canManageTeam(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

export function canEditOrganization(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

export function canArchiveOrganization(role: OrgRole | null): boolean {
  return role === 'owner'
}

// Only an owner may create, promote to, demote or remove an owner.
export function assignableRoles(callerRole: OrgRole | null): OrgRole[] {
  if (callerRole === 'owner') return ['owner', 'admin', 'manager']
  if (callerRole === 'admin') return ['admin', 'manager']
  return []
}

export function canActOnMember(callerRole: OrgRole | null, member: OrganizationMember): boolean {
  if (member.is_self) return false
  if (callerRole === 'owner') return true
  if (callerRole === 'admin') return member.role !== 'owner'
  return false
}
