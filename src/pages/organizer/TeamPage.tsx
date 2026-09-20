import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Mail, UserPlus, Users, X } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import {
  assignableRoles,
  canActOnMember,
  canManageTeam,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  setMemberRole,
} from '@/lib/organizer'
import {
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrgRole,
} from '@/lib/supabase'

export default function TeamPage() {
  const { organization, role, loading: orgLoading } = useOrganizer()
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('manager')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const orgId = organization?.id ?? null
  const manages = canManageTeam(role)
  // The role options offered here are the ones the RPC will accept from this
  // caller. An admin never sees "owner", because the database would refuse it.
  const roleOptions = assignableRoles(role)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)

    const membersResult = await listMembers(orgId)
    if (membersResult.error) {
      setError(membersResult.error)
      setLoading(false)
      return
    }
    setMembers(membersResult.data)

    if (manages) {
      const invitationsResult = await listInvitations(orgId)
      if (invitationsResult.error) {
        setError(invitationsResult.error)
        setLoading(false)
        return
      }
      setInvitations(invitationsResult.data)
    }

    setLoading(false)
  }, [orgId, manages])

  useEffect(() => {
    void load()
  }, [load])

  if (orgLoading) return <LoadingState message="Loading team…" />
  if (!organization) return null

  async function handleInvite(event: FormEvent) {
    event.preventDefault()
    if (!orgId) return
    setInviting(true)
    setInviteError(null)
    setInviteSuccess(null)

    const { error: sendError } = await inviteMember(orgId, inviteEmail.trim(), inviteRole)
    if (sendError) {
      setInviteError(sendError)
      setInviting(false)
      return
    }

    setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}.`)
    setInviteEmail('')
    setInviteRole('manager')
    setInviting(false)
    await load()
  }

  async function handleRoleChange(member: OrganizationMember, next: OrgRole) {
    if (!orgId || next === member.role) return
    setBusy(member.user_id)
    setError(null)
    const { error: roleError } = await setMemberRole(orgId, member.user_id, next)
    if (roleError) setError(roleError)
    await load()
    setBusy(null)
  }

  async function handleRemove(member: OrganizationMember) {
    if (!orgId) return
    setBusy(member.user_id)
    setError(null)
    const { error: removeError } = await removeMember(orgId, member.user_id)
    if (removeError) setError(removeError)
    await load()
    setBusy(null)
  }

  async function handleRevoke(invitation: OrganizationInvitation) {
    setBusy(invitation.id)
    setError(null)
    const { error: revokeError } = await revokeInvitation(invitation.id)
    if (revokeError) setError(revokeError)
    await load()
    setBusy(null)
  }

  const pending = invitations.filter((i) => i.status === 'pending')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Team</h1>
        <p className="mt-1 text-sm text-gray-500">
          Who can act on behalf of {organization.name}.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {manages && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <Label htmlFor="invite-email">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  >
                    {roleOptions.map((option) => (
                      <option key={option} value={option}>
                        {ORG_ROLE_LABELS[option]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <p className="text-xs text-gray-500">{ORG_ROLE_DESCRIPTIONS[inviteRole]}</p>

              {inviteError && (
                <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
                  {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700">
                  {inviteSuccess}
                </div>
              )}

              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                <UserPlus className="h-4 w-4" />
                {inviting ? 'Sending…' : 'Send invitation'}
              </Button>

              <p className="text-xs text-gray-500">
                They need a Rally organizer account already. Rally does not email people who have not
                signed up.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Members</CardTitle>
          <Users className="h-4 w-4 text-gray-400" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState message="Loading members…" />
          ) : members.length === 0 ? (
            <EmptyState title="No members yet" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((member) => {
                const actionable = manages && canActOnMember(role, member)
                return (
                  <li key={member.user_id} className="flex flex-wrap items-center gap-3 py-3">
                    <Avatar name={member.full_name || 'Member'} src={member.photo_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {member.full_name || 'Unnamed member'}
                        {member.is_self && <span className="text-gray-400"> (you)</span>}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {[member.job_title, member.company].filter(Boolean).join(' · ') ||
                          'No title set'}
                      </p>
                    </div>

                    {actionable ? (
                      <div className="flex items-center gap-2">
                        <Select
                          aria-label={`Role for ${member.full_name || 'member'}`}
                          value={member.role}
                          disabled={busy === member.user_id}
                          onChange={(e) =>
                            void handleRoleChange(member, e.target.value as OrgRole)
                          }
                          className="h-8 w-40 py-0 text-xs"
                        >
                          {/* The member's current role stays listed even when this
                              caller could not assign it, so the select shows the
                              truth rather than silently mislabelling them. */}
                          {Array.from(new Set([member.role, ...roleOptions])).map((option) => (
                            <option
                              key={option}
                              value={option}
                              disabled={!roleOptions.includes(option)}
                            >
                              {ORG_ROLE_LABELS[option]}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === member.user_id}
                          onClick={() => void handleRemove(member)}
                          aria-label={`Remove ${member.full_name || 'member'}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Badge variant={member.role === 'owner' ? 'primary' : 'default'}>
                        {ORG_ROLE_LABELS[member.role]}
                      </Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {manages && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Invitations</CardTitle>
            <Mail className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState message="Loading invitations…" />
            ) : pending.length === 0 ? (
              <EmptyState
                title="No pending invitations"
                description="Invitations you send appear here until they are accepted or declined."
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {invitation.full_name || invitation.invited_email || 'Invited user'}
                      </p>
                      {invitation.invited_email && (
                        <p className="truncate text-xs text-gray-500">{invitation.invited_email}</p>
                      )}
                    </div>
                    <Badge variant="warning">{ORG_ROLE_LABELS[invitation.role]}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === invitation.id}
                      onClick={() => void handleRevoke(invitation)}
                    >
                      Withdraw
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
