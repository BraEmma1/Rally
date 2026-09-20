import { useEffect, useState, type FormEvent } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { LoadingState } from '@/components/ui/States'
import {
  canArchiveOrganization,
  canEditOrganization,
  setOrganizationArchived,
  updateOrganization,
} from '@/lib/organizer'

export default function OrganizationSettingsPage() {
  const { organization, role, loading, refresh } = useOrganizer()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!organization) return
    setName(organization.name)
    setDescription(organization.description ?? '')
    setWebsite(organization.website ?? '')
  }, [organization])

  if (loading) return <LoadingState message="Loading organization…" />
  if (!organization) return null

  const editable = canEditOrganization(role)
  const archivable = canArchiveOrganization(role)
  const archived = organization.archived_at !== null

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    if (!organization) return
    setSaving(true)
    setError(null)
    setSaved(false)

    const { error: saveError } = await updateOrganization(organization.id, {
      name: name.trim(),
      description: description.trim(),
      website: website.trim(),
    })

    if (saveError) {
      setError(saveError)
      setSaving(false)
      return
    }

    await refresh()
    setSaving(false)
    setSaved(true)
  }

  async function handleArchive(next: boolean) {
    if (!organization) return
    setArchiving(true)
    setError(null)
    const { error: archiveError } = await setOrganizationArchived(organization.id, next)
    if (archiveError) setError(archiveError)
    else await refresh()
    setArchiving(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Organization</h1>
        <p className="mt-1 text-sm text-gray-500">
          The profile attendees see, and how this organization is set up.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {!editable && (
            <p className="mb-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
              Only owners and admins can edit the organization profile.
            </p>
          )}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!editable}
                required
                maxLength={120}
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!editable}
                rows={3}
                maxLength={500}
              />
            </div>

            <div>
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={!editable}
                placeholder="https://example.com"
              />
            </div>

            {error && (
              <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
            )}
            {saved && !error && (
              <div className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700">Saved.</div>
            )}

            {editable && (
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span>Review status:</span>
            <Badge variant={organization.approval_status === 'approved' ? 'success' : 'warning'}>
              {organization.approval_status}
            </Badge>
            <span className="text-gray-300">·</span>
            <span>Type:</span>
            <Badge variant="default">{organization.org_type}</Badge>
          </div>
          <p className="text-xs text-gray-500">
            Type and review status are set by Rally and cannot be changed from here.
          </p>
        </CardContent>
      </Card>

      {archivable && (
        <Card>
          <CardHeader>
            <CardTitle>{archived ? 'Restore organization' : 'Archive organization'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">
              {archived
                ? 'This organization is archived. Restoring it makes it active again for everyone on the team.'
                : 'Archiving hides the organization from active use without deleting anything. Rally does not delete organizations, so the team, the history and — once events arrive — the attendee records all stay intact and reversible.'}
            </p>
            <Button
              variant={archived ? 'primary' : 'secondary'}
              disabled={archiving}
              onClick={() => void handleArchive(!archived)}
            >
              {archived ? (
                <>
                  <ArchiveRestore className="h-4 w-4" />
                  Restore organization
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" />
                  Archive organization
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
