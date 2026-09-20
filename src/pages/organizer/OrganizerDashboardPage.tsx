import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CalendarRange, Globe, Mail, UserPlus, Users } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { canManageTeam, listInvitations, listMembers } from '@/lib/organizer'
import { ORG_ROLE_LABELS, type OrganizationInvitation, type OrganizationMember } from '@/lib/supabase'

function ApprovalBadge({ status }: { status: string }) {
  if (status === 'approved') return <Badge variant="success">Approved</Badge>
  if (status === 'rejected') return <Badge variant="error">Rejected</Badge>
  if (status === 'suspended') return <Badge variant="error">Suspended</Badge>
  return <Badge variant="warning">Pending review</Badge>
}

export default function OrganizerDashboardPage() {
  const { organization, role, loading: orgLoading, error: orgError, refresh } = useOrganizer()
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orgId = organization?.id ?? null
  const manages = canManageTeam(role)

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

    // Only owners and admins may list invitations, so a manager simply sees
    // none rather than an error they can do nothing about.
    if (manages) {
      const invitationsResult = await listInvitations(orgId)
      if (invitationsResult.error) {
        setError(invitationsResult.error)
        setLoading(false)
        return
      }
      setInvitations(invitationsResult.data)
    } else {
      setInvitations([])
    }

    setLoading(false)
  }, [orgId, manages])

  useEffect(() => {
    void load()
  }, [load])

  if (orgLoading) return <LoadingState message="Loading your organization…" />
  if (orgError) return <ErrorState message={orgError} onRetry={() => void refresh()} />
  if (!organization) return null // the route guard sends this case to setup

  const pending = invitations.filter((i) => i.status === 'pending')

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-gray-900">{organization.name}</h1>
              <ApprovalBadge status={organization.approval_status} />
              {organization.archived_at && <Badge variant="gray">Archived</Badge>}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {role ? `You are ${role === 'admin' ? 'an admin' : role === 'owner' ? 'the owner' : 'an event manager'}` : ''}
            </p>
            {organization.description && (
              <p className="mt-2 max-w-2xl text-sm text-gray-600">{organization.description}</p>
            )}
            {organization.website && (
              <a
                href={organization.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                <Globe className="h-4 w-4" />
                {organization.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>
        <Link to="/organizer/settings" className="shrink-0">
          <Button variant="secondary">Organization settings</Button>
        </Link>
      </div>

      {organization.approval_status !== 'approved' && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent>
            <p className="text-sm text-warning-700">
              This organization has not been reviewed yet. You can set it up and build your team now;
              review affects publishing events, which arrives in the next phase.
            </p>
          </CardContent>
        </Card>
      )}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading ? (
        <LoadingState message="Loading organization details…" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Event management is deliberately not built yet — this states that
              plainly rather than showing numbers that would all be zero. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Events</CardTitle>
              <CalendarRange className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              <EmptyState
                title="Event management is not available yet"
                description="Creating and running events under this organization is the next phase of Rally's organizer tools."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Team</CardTitle>
              <Users className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-2xl font-bold text-gray-900">
                {members.length}
                <span className="ml-1.5 text-sm font-normal text-gray-500">
                  {members.length === 1 ? 'member' : 'members'}
                </span>
              </p>
              <ul className="space-y-1.5">
                {members.slice(0, 4).map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-gray-700">
                      {m.full_name || 'Unnamed member'}
                      {m.is_self && <span className="text-gray-400"> (you)</span>}
                    </span>
                    <Badge variant={m.role === 'owner' ? 'primary' : 'default'}>
                      {ORG_ROLE_LABELS[m.role]}
                    </Badge>
                  </li>
                ))}
              </ul>
              {members.length > 4 && (
                <p className="text-xs text-gray-500">and {members.length - 4} more</p>
              )}
              <Link to="/organizer/team">
                <Button variant="secondary" size="sm" className="w-full">
                  {manages ? 'Manage team' : 'View team'}
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="sm:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Pending invitations</CardTitle>
              <Mail className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              {!manages ? (
                <EmptyState
                  title="Invitations are managed by owners and admins"
                  description="Ask an organization admin if you need someone added to the team."
                />
              ) : pending.length === 0 ? (
                <EmptyState
                  icon={<UserPlus className="h-8 w-8" />}
                  title="No invitations waiting"
                  description="Invite a teammate by email from the team screen. They need a Rally organizer account first."
                  action={
                    <Link to="/organizer/team">
                      <Button size="sm">Invite someone</Button>
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {pending.map((invitation) => (
                    <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {invitation.full_name || invitation.invited_email || 'Invited user'}
                        </p>
                        {invitation.invited_email && invitation.full_name && (
                          <p className="truncate text-xs text-gray-500">{invitation.invited_email}</p>
                        )}
                      </div>
                      <Badge variant="warning">Invited as {ORG_ROLE_LABELS[invitation.role]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
