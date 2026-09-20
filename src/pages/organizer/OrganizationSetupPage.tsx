import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, LogOut, Mail } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { LoadingState } from '@/components/ui/States'
import {
  acceptInvitation,
  createOrganization,
  declineInvitation,
  listMyPendingInvitations,
} from '@/lib/organizer'
import { ORG_ROLE_LABELS, type IncomingInvitation } from '@/lib/supabase'

// Where an approved organizer lands before they belong to anything: either
// start an organization, or accept an invitation to someone else's.
export default function OrganizationSetupPage() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { refresh, selectOrganization } = useOrganizer()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [invitations, setInvitations] = useState<IncomingInvitation[]>([])
  const [invitationsLoading, setInvitationsLoading] = useState(true)
  const [responding, setResponding] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await listMyPendingInvitations()
      setInvitations(data)
      setInvitationsLoading(false)
    })()
  }, [])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const { id, error: createError } = await createOrganization({ name, description, website })
    if (createError || !id) {
      setError(createError ?? 'Could not create the organization.')
      setSaving(false)
      return
    }

    selectOrganization(id)
    await refresh()
    navigate('/organizer', { replace: true })
  }

  async function respond(invitation: IncomingInvitation, accept: boolean) {
    setResponding(invitation.id)
    setError(null)
    const { error: respondError } = accept
      ? await acceptInvitation(invitation.id)
      : await declineInvitation(invitation.id)

    if (respondError) {
      setError(respondError)
      setResponding(null)
      return
    }

    if (accept) {
      selectOrganization(invitation.organization_id)
      await refresh()
      navigate('/organizer', { replace: true })
      return
    }

    setInvitations((current) => current.filter((i) => i.id !== invitation.id))
    setResponding(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Set up your organization</h1>
            <p className="mt-1 text-sm text-gray-500">
              Events, team members and attendees all belong to an organization rather than to you
              personally, so ownership can be handed over without anything being lost.
            </p>
          </div>
        </div>

        {invitationsLoading ? (
          <LoadingState message="Checking for invitations…" />
        ) : (
          invitations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>You have been invited</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {invitation.organization_name}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          As {ORG_ROLE_LABELS[invitation.role]}
                          {invitation.invited_by_name && ` · invited by ${invitation.invited_by_name}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={responding === invitation.id}
                        onClick={() => void respond(invitation, true)}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={responding === invitation.id}
                        onClick={() => void respond(invitation, false)}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )
        )}

        <Card>
          <CardHeader>
            <CardTitle>Create an organization</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label htmlFor="org-name">Organization name *</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Events"
                  required
                  maxLength={120}
                />
              </div>

              <div>
                <Label htmlFor="org-description">What does it do?</Label>
                <Textarea
                  id="org-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description attendees will see."
                  rows={3}
                  maxLength={500}
                />
              </div>

              <div>
                <Label htmlFor="org-website">Website</Label>
                <Input
                  id="org-website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>

              {error && (
                <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
              )}

              <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
                {saving ? 'Creating…' : 'Create organization'}
              </Button>

              <p className="text-xs text-gray-500">
                You become its owner. Owners can add teammates and hand ownership on later.
              </p>
            </form>
          </CardContent>
        </Card>

        <button
          onClick={() => void signOut().then(() => navigate('/login'))}
          className="mx-auto flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}
