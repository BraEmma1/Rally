import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ChevronRight,
  Mail,
  Search,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog, SheetDialog } from '@/components/organizer/SheetDialog'
import { listOrganizationEvents } from '@/lib/events'
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
import { cn } from '@/lib/utils'

// Roles are only ever owner | admin | manager (ORG_ROLE_LABELS calls "manager"
// Event manager). Everything on this page — badges, cards, filter options,
// permission cards — is derived from that enum, never invented.
const ROLE_BADGE_VARIANT: Record<OrgRole, 'primary' | 'default' | 'success'> = {
  owner: 'primary',
  admin: 'default',
  manager: 'success',
}

const ROLE_FILTER_OPTIONS: { key: OrgRole | 'all'; label: string }[] = [
  { key: 'all', label: 'All roles' },
  { key: 'owner', label: ORG_ROLE_LABELS.owner },
  { key: 'admin', label: ORG_ROLE_LABELS.admin },
  { key: 'manager', label: ORG_ROLE_LABELS.manager },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
  iconClassName,
  loading,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  iconClassName: string
  loading: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
            iconClassName
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-10 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="text-xl font-bold leading-6 tabular-nums text-gray-900">{value}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>
        </div>
      </div>
    </div>
  )
}

function MemberInitials({ member }: { member: { full_name: string; photo_url: string } }) {
  return <Avatar name={member.full_name || 'Member'} src={member.photo_url || null} size="md" />
}

// Event access comes straight from event_team, the same table can_manage_event
// reads. Owner and admin hold organization-wide authority; a manager's reach is
// exactly their assignments, and "no assignments" must read as no access.
function accessSummary(role: OrgRole, assignments: number | null): { primary: string; hint: string } {
  if (role === 'owner' || role === 'admin') {
    return { primary: 'All events', hint: 'Full organization access' }
  }
  if (assignments === null) {
    return { primary: 'Selected events', hint: 'Access details unavailable' }
  }
  if (assignments === 0) {
    return { primary: 'No events', hint: 'Not assigned to any event yet' }
  }
  return { primary: 'Selected events', hint: `${assignments} event${assignments === 1 ? '' : 's'}` }
}

function RolePermissions() {
  const cards: {
    role: OrgRole
    icon: React.ReactNode
    iconClassName: string
    description: string
    permissions: string[]
  }[] = [
    {
      role: 'owner',
      icon: <ShieldCheck className="h-5 w-5" />,
      iconClassName: 'bg-primary-50 text-primary-600',
      description: 'Full organization authority.',
      permissions: [
        'Manage organization settings',
        'Create and manage events',
        'Manage team members and roles',
        'Full event and attendee access',
      ],
    },
    {
      role: 'admin',
      icon: <Users className="h-5 w-5" />,
      iconClassName: 'bg-accent-50 text-accent-600',
      description: 'Manages the organization and its team.',
      permissions: [
        'Manage organization settings',
        'Create and manage events',
        'Manage team members',
        'Full event and attendee access',
      ],
    },
    {
      role: 'manager',
      icon: <UserCog className="h-5 w-5" />,
      iconClassName: 'bg-gray-100 text-gray-600',
      description: 'Can manage the events they are assigned to.',
      permissions: [
        'Manage assigned events',
        'Manage attendees and check-in',
        'Manage event content',
        'No organization settings access',
      ],
    },
  ]

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-gray-900">Role permissions</h2>
        <p className="hidden text-xs text-gray-500 sm:block">
          A quick overview of what each role can do.
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.role} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  card.iconClassName
                )}
              >
                {card.icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{ORG_ROLE_LABELS[card.role]}</p>
                <p className="truncate text-xs text-gray-500">{card.description}</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5">
              {card.permissions.map((permission) => (
                <li key={permission} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
                  {permission}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function TeamPage() {
  const { organization, role, loading: orgLoading } = useOrganizer()
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // user_id -> number of assigned events; null means the lookup itself failed
  // and access lines should degrade instead of claiming zero.
  const [assignments, setAssignments] = useState<Record<string, number> | null>(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<OrgRole | 'all'>('all')

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('manager')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [managing, setManaging] = useState<OrganizationMember | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<OrganizationMember | null>(null)

  const orgId = organization?.id ?? null
  const manages = canManageTeam(role)
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

    // Event assignments are a separate, failure-tolerant layer: the team list
    // stays usable even if the assignment counts cannot be loaded.
    const eventsResult = await listOrganizationEvents(orgId)
    const eventIds = eventsResult.data.map((event) => event.id)
    if (eventIds.length > 0) {
      const { data, error: teamError } = await supabase
        .from('event_team')
        .select('user_id, event_id')
        .in('event_id', eventIds)
      if (teamError) {
        setAssignments(null)
      } else {
        const counts: Record<string, number> = {}
        for (const row of (data ?? []) as { user_id: string; event_id: string }[]) {
          counts[row.user_id] = (counts[row.user_id] ?? 0) + 1
        }
        setAssignments(counts)
      }
    } else {
      setAssignments({})
    }

    if (manages) {
      const invitationsResult = await listInvitations(orgId)
      if (invitationsResult.error) {
        // A failed invitation load must not take the member list down with it.
        setError(invitationsResult.error)
      } else {
        setInvitations(invitationsResult.data)
      }
    }

    setLoading(false)
  }, [orgId, manages])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return members.filter((member) => {
      if (roleFilter !== 'all' && member.role !== roleFilter) return false
      if (!query) return true
      return (
        member.full_name.toLowerCase().includes(query) ||
        member.job_title.toLowerCase().includes(query) ||
        member.company.toLowerCase().includes(query)
      )
    })
  }, [members, search, roleFilter])

  const pending = invitations.filter((i) => i.status === 'pending')

  const totals = useMemo(() => {
    const admins = members.filter((m) => m.role === 'owner' || m.role === 'admin').length
    const managers = members.filter((m) => m.role === 'manager').length
    return { total: members.length, admins, managers }
  }, [members])

  if (orgLoading) return <LoadingState message="Loading team…" />
  if (!organization) return null

  async function handleInvite(event: FormEvent) {
    event.preventDefault()
    if (!orgId) return
    setInviting(true)
    setInviteError(null)

    const { error: sendError } = await inviteMember(orgId, inviteEmail.trim(), inviteRole)
    if (sendError) {
      setInviteError(sendError)
      setInviting(false)
      return
    }

    setInviteOpen(false)
    setInviteEmail('')
    setInviteRole('manager')
    setInviting(false)
    await load()
  }

  async function handleRoleChange(member: OrganizationMember, next: OrgRole) {
    if (!orgId || next === member.role) return
    setBusy(member.user_id)
    const { error: roleError } = await setMemberRole(orgId, member.user_id, next)
    if (roleError) setError(roleError)
    await load()
    setBusy(null)
  }

  async function handleRemove(member: OrganizationMember) {
    if (!orgId) return
    setBusy(member.user_id)
    const { error: removeError } = await removeMember(orgId, member.user_id)
    if (removeError) setError(removeError)
    setConfirmingRemove(null)
    setManaging(null)
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

  function openManage(member: OrganizationMember) {
    if (manages && canActOnMember(role, member)) setManaging(member)
  }

  const showTeamEmptyState = !loading && members.length <= 1 && members[0]?.is_self

  const inviteButton = manages ? (
    <Button size="md" onClick={() => setInviteOpen(true)}>
      <UserPlus className="h-4 w-4" />
      Invite someone
    </Button>
  ) : null

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Team</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage your team and control who can work on your events.
          </p>
        </div>
        {inviteButton}
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {/* Summary cards — counts come from the loaded member list, never invented. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Team members"
          value={String(totals.total)}
          hint="Can work on your events"
          icon={<Users className="h-5 w-5" />}
          iconClassName="bg-primary-50 text-primary-600"
          loading={loading}
        />
        <SummaryCard
          label="Owners & admins"
          value={String(totals.admins)}
          hint="Full organization access"
          icon={<ShieldCheck className="h-5 w-5" />}
          iconClassName="bg-accent-50 text-accent-600"
          loading={loading}
        />
        <SummaryCard
          label="Event managers"
          value={String(totals.managers)}
          hint="Manage assigned events"
          icon={<UserCog className="h-5 w-5" />}
          iconClassName="bg-gray-100 text-gray-600"
          loading={loading}
        />
        <SummaryCard
          label="Pending invites"
          value={manages ? String(pending.length) : '—'}
          hint="Waiting for a response"
          icon={<Mail className="h-5 w-5" />}
          iconClassName="bg-warning-50 text-warning-600"
          loading={loading}
        />
      </div>

      {showTeamEmptyState && manages && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Build your team</p>
            <p className="text-xs text-gray-500">Invite people to help manage your events.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Invite someone
          </Button>
        </div>
      )}

      {/* Search + role filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team members..."
            aria-label="Search team members"
            className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
        </div>
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as OrgRole | 'all')}
          className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600"
        >
          {ROLE_FILTER_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Team members */}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-bold text-gray-900">Team members</h2>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-full bg-gray-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-40 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-56 animate-pulse rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={members.length === 0 ? 'No members yet' : 'No matches'}
              description={
                members.length === 0
                  ? undefined
                  : 'Try a different name or clear the role filter.'
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5 font-medium">Member</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Event access</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((member) => {
                    const actionable = manages && canActOnMember(role, member)
                    const access = accessSummary(member.role, assignments?.[member.user_id] ?? (assignments ? 0 : null))
                    return (
                      <tr key={member.user_id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <MemberInitials member={member} />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">
                                {member.full_name || 'Unnamed member'}
                                {member.is_self && <span className="text-gray-400"> (you)</span>}
                              </p>
                              <p className="truncate text-xs text-gray-500">
                                {[member.job_title, member.company].filter(Boolean).join(' · ') ||
                                  'No title set'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={ROLE_BADGE_VARIANT[member.role]}>
                            {ORG_ROLE_LABELS[member.role]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{access.primary}</p>
                          <p className="text-xs text-gray-500">{access.hint}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(member.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          {actionable ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy === member.user_id}
                              onClick={() => setManaging(member)}
                            >
                              Manage
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-gray-100 md:hidden">
              {filtered.map((member) => {
                const actionable = manages && canActOnMember(role, member)
                const access = accessSummary(member.role, assignments?.[member.user_id] ?? (assignments ? 0 : null))
                return (
                  <li key={member.user_id}>
                    <button
                      type="button"
                      disabled={!actionable}
                      onClick={() => openManage(member)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left',
                        actionable && 'active:bg-gray-50'
                      )}
                    >
                      <MemberInitials member={member} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {member.full_name || 'Unnamed member'}
                            {member.is_self && <span className="text-gray-400"> (you)</span>}
                          </p>
                          <Badge variant={ROLE_BADGE_VARIANT[member.role]}>
                            {ORG_ROLE_LABELS[member.role]}
                          </Badge>
                        </div>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
                          <Users className="h-3 w-3 shrink-0 text-gray-400" />
                          {access.primary} · {access.hint}
                        </p>
                      </div>
                      {actionable ? (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {/* Pending invitations — organization team invitations only */}
      {manages && (
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">Pending invitations</h2>
              <p className="text-xs text-gray-500">
                {loading ? 'Loading…' : `${pending.length} invitation${pending.length === 1 ? '' : 's'} waiting for a response.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              Invite someone
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3 p-4">
              <div className="h-3.5 w-64 animate-pulse rounded bg-gray-100" />
              <div className="h-3.5 w-48 animate-pulse rounded bg-gray-100" />
            </div>
          ) : pending.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No pending invitations"
                description="Invitations you send appear here until they are accepted or declined."
              />
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-4 py-2.5 font-medium">Invitee</th>
                      <th className="px-4 py-2.5 font-medium">Role</th>
                      <th className="px-4 py-2.5 font-medium">Invited</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pending.map((invitation) => (
                      <tr key={invitation.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar
                              name={invitation.full_name || invitation.invited_email || 'Invited'}
                              size="md"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">
                                {invitation.full_name || invitation.invited_email || 'Invited user'}
                              </p>
                              {invitation.full_name && invitation.invited_email && (
                                <p className="truncate text-xs text-gray-500">
                                  {invitation.invited_email}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={ROLE_BADGE_VARIANT[invitation.role]}>
                            {ORG_ROLE_LABELS[invitation.role]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(invitation.created_at)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="warning">Pending</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === invitation.id}
                            onClick={() => void handleRevoke(invitation)}
                          >
                            Withdraw
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <ul className="divide-y divide-gray-100 md:hidden">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar
                      name={invitation.full_name || invitation.invited_email || 'Invited'}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {invitation.full_name || invitation.invited_email || 'Invited user'}
                        </p>
                        <Badge variant={ROLE_BADGE_VARIANT[invitation.role]}>
                          {ORG_ROLE_LABELS[invitation.role]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        Invited {formatDate(invitation.created_at)} · Pending
                      </p>
                    </div>
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
            </>
          )}
        </section>
      )}

      <RolePermissions />

      {/* Invite dialog — the existing organization invitation flow */}
      {inviteOpen && (
        <SheetDialog
          title="Invite someone"
          subtitle={organization.name}
          onClose={() => setInviteOpen(false)}
        >
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                required
                autoFocus
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

            <p className="text-xs text-gray-500">{ORG_ROLE_DESCRIPTIONS[inviteRole]}</p>

            {inviteError && (
              <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
                {inviteError}
              </div>
            )}

            <Button type="submit" disabled={inviting || !inviteEmail.trim()} className="w-full">
              <UserPlus className="h-4 w-4" />
              {inviting ? 'Sending…' : 'Send invitation'}
            </Button>

            <p className="text-xs text-gray-500">
              Rally emails an invitation to this address. The recipient can sign in — or create a
              Rally account with this email — to accept it.
            </p>
          </form>
        </SheetDialog>
      )}

      {/* Manage member dialog */}
      {managing && (
        <SheetDialog
          title={managing.full_name || 'Team member'}
          subtitle={[managing.job_title, managing.company].filter(Boolean).join(' · ') || undefined}
          onClose={() => setManaging(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <MemberInitials member={managing} />
              <div className="min-w-0">
                <Badge variant={ROLE_BADGE_VARIANT[managing.role]}>
                  {ORG_ROLE_LABELS[managing.role]}
                </Badge>
                <p className="mt-1 text-xs text-gray-500">
                  {accessSummary(
                    managing.role,
                    assignments?.[managing.user_id] ?? (assignments ? 0 : null)
                  ).primary}
                  {' · '}
                  Joined {formatDate(managing.created_at)}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="manage-role">Role</Label>
              <Select
                id="manage-role"
                value={managing.role}
                disabled={busy === managing.user_id}
                onChange={(e) => void handleRoleChange(managing, e.target.value as OrgRole)}
              >
                {/* The member's current role stays listed even when this caller
                    could not assign it, so the select shows the truth. */}
                {Array.from(new Set([managing.role, ...roleOptions])).map((option) => (
                  <option
                    key={option}
                    value={option}
                    disabled={!roleOptions.includes(option)}
                  >
                    {ORG_ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-500">{ORG_ROLE_DESCRIPTIONS[managing.role]}</p>
            </div>

            <div className="border-t border-gray-200 pt-4">
              <Button
                variant="danger"
                disabled={busy === managing.user_id}
                onClick={() => setConfirmingRemove(managing)}
                className="w-full"
              >
                Remove from organization
              </Button>
            </div>
          </div>
        </SheetDialog>
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title="Remove this member?"
          body={`${confirmingRemove.full_name || 'This member'} will lose access to ${organization.name} and its events. This cannot be undone from this page.`}
          action="Remove member"
          busy={busy === confirmingRemove.user_id}
          onConfirm={() => void handleRemove(confirmingRemove)}
          onClose={() => setConfirmingRemove(null)}
        />
      )}
    </div>
  )
}
