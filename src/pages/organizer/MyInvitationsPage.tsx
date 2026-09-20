import { useCallback, useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { acceptInvitation, declineInvitation, listMyPendingInvitations } from '@/lib/organizer'
import { ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS, type IncomingInvitation } from '@/lib/supabase'

// Invitations addressed to the signed-in organizer, as opposed to the ones
// their own organization has sent out — that list lives on the team screen.
export default function MyInvitationsPage() {
  const { refresh, selectOrganization } = useOrganizer()
  const [invitations, setInvitations] = useState<IncomingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await listMyPendingInvitations()
    setInvitations(data)
    setError(loadError)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function respond(invitation: IncomingInvitation, accept: boolean) {
    setBusy(invitation.id)
    setError(null)
    const { error: respondError } = accept
      ? await acceptInvitation(invitation.id)
      : await declineInvitation(invitation.id)

    if (respondError) {
      setError(respondError)
      setBusy(null)
      return
    }

    if (accept) {
      selectOrganization(invitation.organization_id)
      await refresh()
    }
    await load()
    setBusy(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My invitations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Organizations that have invited you to join their team.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Pending</CardTitle>
          <Mail className="h-4 w-4 text-gray-400" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState message="Loading invitations…" />
          ) : invitations.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-8 w-8" />}
              title="Nothing waiting for you"
              description="When another organization invites you to their team, it will show up here."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">
                      {invitation.organization_name}
                    </p>
                    <Badge variant="warning">{ORG_ROLE_LABELS[invitation.role]}</Badge>
                  </div>
                  <p className="text-xs text-gray-500">
                    {ORG_ROLE_DESCRIPTIONS[invitation.role]}
                    {invitation.invited_by_name && ` Invited by ${invitation.invited_by_name}.`}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy === invitation.id}
                      onClick={() => void respond(invitation, true)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === invitation.id}
                      onClick={() => void respond(invitation, false)}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
