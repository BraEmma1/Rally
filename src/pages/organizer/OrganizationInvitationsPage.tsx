import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Check, MailOpen } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { acceptInvitation, declineInvitation, listMyPendingInvitations } from '@/lib/organizer'
import { ORG_ROLE_LABELS, type IncomingInvitation } from '@/lib/supabase'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { formatDate, formatRelativeDate } from '@/lib/utils'

// Review, accept or decline organization invitations. Attendees only —
// accepting adds an organization membership and never touches account_type.
// Every action goes through the existing invitation RPCs; nothing is decided
// or stored locally.
export default function OrganizationInvitationsPage() {
  const navigate = useNavigate()
  const { selectOrganization, refresh: refreshOrganizer } = useOrganizer()
  const [invitations, setInvitations] = useState<IncomingInvitation[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [confirmDeclineId, setConfirmDeclineId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<IncomingInvitation | null>(null)
  const [declined, setDeclined] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await listMyPendingInvitations()
    setInvitations(data)
    setLoadError(error)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A vanished invitation — accepted elsewhere, revoked, expired — should not
  // keep offering dead buttons; drop it and let the message explain why.
  const isGoneError = (message: string) =>
    /no longer|not found|already|revoked|expired|invalid|cancelled/i.test(message)

  async function handleAccept(invitation: IncomingInvitation) {
    setWorkingId(invitation.id)
    setActionError(null)
    const { error } = await acceptInvitation(invitation.id)
    setWorkingId(null)
    if (error) {
      setActionError(error)
      if (isGoneError(error)) {
        setInvitations((prev) => prev?.filter((i) => i.id !== invitation.id) ?? null)
        setConfirmDeclineId(null)
      }
      return
    }
    await refreshOrganizer()
    setInvitations((prev) => prev?.filter((i) => i.id !== invitation.id) ?? null)
    setAccepted(invitation)
  }

  async function handleDecline(invitation: IncomingInvitation) {
    setWorkingId(invitation.id)
    setActionError(null)
    const { error } = await declineInvitation(invitation.id)
    setWorkingId(null)
    if (error) {
      setActionError(error)
      if (isGoneError(error)) {
        setInvitations((prev) => prev?.filter((i) => i.id !== invitation.id) ?? null)
        setConfirmDeclineId(null)
      }
      return
    }
    setInvitations((prev) => prev?.filter((i) => i.id !== invitation.id) ?? null)
    setConfirmDeclineId(null)
    setDeclined(true)
  }

  async function handleManage(invitation: IncomingInvitation) {
    await refreshOrganizer()
    selectOrganization(invitation.organization_id)
    navigate('/organizer')
  }

  const isExpired = (invitation: IncomingInvitation) =>
    invitation.expires_at !== null && new Date(invitation.expires_at) < new Date()

  if (accepted) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <CardContent className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-100">
              <Check className="h-8 w-8 text-success-700" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">
              You're now part of {accepted.organization_name}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Role: <span className="font-semibold text-gray-900">{ORG_ROLE_LABELS[accepted.role]}</span>
            </p>
            <p className="mt-3 text-xs text-gray-500">
              Your Rally attendee account remains unchanged.
            </p>
            <div className="mt-6 grid gap-2">
              <Button onClick={() => void handleManage(accepted)}>Manage Organization</Button>
              <Button variant="secondary" onClick={() => navigate('/dashboard')}>
                Continue to Rally
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold text-gray-900">Organization Invitations</h1>
      <p className="mt-1 text-sm text-gray-500">
        Invitations from organizations that would like you on their team.
      </p>

      {declined && (
        <Card className="mt-4">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-sm font-medium text-gray-900">Invitation declined</p>
            <Button size="sm" variant="secondary" onClick={() => navigate('/dashboard')}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mt-4">
        {invitations === null && !loadError && <LoadingState message="Loading invitations…" />}
        {loadError && <ErrorState message={loadError} onRetry={() => void load()} />}
        {invitations !== null && !loadError && invitations.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState
                icon={<MailOpen className="h-8 w-8" />}
                title={declined ? 'No invitations left' : 'No pending invitations'}
                description="When an organization invites you to join their team, it will appear here and in your notifications."
                action={
                  <Button variant="secondary" onClick={() => navigate('/dashboard')}>
                    Back to Rally
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
        {invitations !== null && !loadError && invitations.length > 0 && (
          <div className="space-y-4">
            {actionError && (
              <Card className="border-warning-200 bg-warning-50">
                <CardContent className="py-3">
                  <p className="text-sm text-warning-700">{actionError}</p>
                </CardContent>
              </Card>
            )}
            {invitations.map((invitation) => {
              const expired = isExpired(invitation)
              return (
                <Card key={invitation.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                        <Building2 className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-lg font-bold text-gray-900">
                          {invitation.organization_name}
                        </h2>
                        <p className="text-sm text-gray-500">
                          You've been invited to join this organization
                        </p>
                      </div>
                      <Badge variant={expired ? 'error' : 'warning'}>
                        {expired ? 'Expired' : 'Pending'}
                      </Badge>
                    </div>

                    <dl className="mt-4 space-y-1.5 rounded-md bg-gray-50 px-3 py-2.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Role</dt>
                        <dd className="font-semibold text-gray-900">{ORG_ROLE_LABELS[invitation.role]}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Invitation status</dt>
                        <dd className="font-medium text-gray-900">{expired ? 'Expired' : 'Pending'}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Invited</dt>
                        <dd className="font-medium text-gray-900">{formatRelativeDate(invitation.created_at)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Expiration</dt>
                        <dd className={`font-medium ${expired ? 'text-error-600' : 'text-gray-900'}`}>
                          {invitation.expires_at ? formatDate(invitation.expires_at) : 'No expiration'}
                        </dd>
                      </div>
                      {invitation.invited_by_name && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-gray-500">Invited by</dt>
                          <dd className="font-medium text-gray-900">{invitation.invited_by_name}</dd>
                        </div>
                      )}
                    </dl>

                    {expired ? (
                      <p className="mt-4 rounded-md border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
                        This invitation has expired. Ask the organization to send a new one.
                      </p>
                    ) : confirmDeclineId === invitation.id ? (
                      <div className="mt-4 rounded-md border border-warning-200 bg-warning-50 px-3 py-3">
                        <p className="text-sm font-medium text-warning-800">
                          Decline this invitation? You would need a new invitation to join this
                          organization later.
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            disabled={workingId === invitation.id}
                            onClick={() => void handleDecline(invitation)}
                          >
                            {workingId === invitation.id ? 'Declining…' : 'Yes, decline'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={workingId === invitation.id}
                            onClick={() => setConfirmDeclineId(null)}
                          >
                            Keep it
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <Button
                          disabled={workingId === invitation.id}
                          onClick={() => void handleAccept(invitation)}
                        >
                          {workingId === invitation.id ? 'Accepting…' : 'Accept Invitation'}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={workingId === invitation.id}
                          onClick={() => {
                            setActionError(null)
                            setConfirmDeclineId(invitation.id)
                          }}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
