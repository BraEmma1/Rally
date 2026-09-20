import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { LoadingState } from '@/components/ui/States'
import { canManageTeam } from '@/lib/organizer'
import { VISIBILITY_LABELS, createEvent, getEvent, updateEvent, type EventInput } from '@/lib/events'
import type { EventVisibility } from '@/lib/supabase'

const EMPTY: EventInput = {
  name: '',
  description: '',
  location: '',
  start_date: null,
  end_date: null,
  start_time: null,
  end_time: null,
  capacity: null,
  image_url: '',
  visibility: 'draft',
}

// One form for both creating and editing. The fields are exactly the ones the
// events table already has — nothing invented, nothing collected that has
// nowhere to go.
export default function EventFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { organization, role, loading: orgLoading } = useOrganizer()

  const [form, setForm] = useState<EventInput>(EMPTY)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)

  useEffect(() => {
    if (!id) return
    void (async () => {
      const { data, error: loadError } = await getEvent(id)
      if (loadError || !data) {
        setError(loadError ?? 'That event could not be found.')
        setLoading(false)
        return
      }
      setArchived(data.archived_at !== null)
      setForm({
        name: data.name,
        description: data.description ?? '',
        location: data.location ?? '',
        start_date: data.start_date,
        end_date: data.end_date,
        start_time: data.start_time,
        end_time: data.end_time,
        capacity: data.capacity,
        image_url: data.image_url ?? '',
        visibility: data.visibility,
      })
      setLoading(false)
    })()
  }, [id])

  if (orgLoading || loading) return <LoadingState message="Loading…" />
  if (!organization) return null

  // Creating is an owner/admin act; a manager edits events assigned to them.
  // The database enforces both — this only avoids offering a doomed form.
  if (!isEdit && !canManageTeam(role)) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-gray-600">
            Only owners and admins can create events for this organization.
          </p>
        </CardContent>
      </Card>
    )
  }

  function set<K extends keyof EventInput>(key: K, value: EventInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!organization || !user) return
    setSaving(true)
    setError(null)

    const payload: EventInput = {
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      image_url: form.image_url.trim(),
      // Empty date/time inputs come back as '' which Postgres rejects for a
      // date column; null is the honest representation of "not set yet".
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
    }

    if (isEdit && id) {
      const { error: saveError } = await updateEvent(id, payload)
      if (saveError) {
        setError(saveError)
        setSaving(false)
        return
      }
      navigate(`/organizer/events/${id}`)
      return
    }

    const { id: newId, error: createError } = await createEvent(organization.id, user.id, payload)
    if (createError || !newId) {
      setError(createError ?? 'Could not create that event.')
      setSaving(false)
      return
    }
    navigate(`/organizer/events/${newId}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={isEdit && id ? `/organizer/events/${id}` : '/organizer/events'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="mt-2 text-xl font-bold text-gray-900">
          {isEdit ? 'Edit event' : 'New event'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {isEdit ? form.name || 'Untitled event' : `A new event for ${organization.name}.`}
        </p>
      </div>

      {archived && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent>
            <p className="text-sm text-warning-700">
              This event is archived and cannot be edited. Restore it from the event page first.
            </p>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Event name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="TechConnect Summit 2026"
                required
                maxLength={150}
                disabled={archived}
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="What is this event, and who is it for?"
                disabled={archived}
              />
            </div>

            <div>
              <Label htmlFor="image_url">Banner image URL</Label>
              <Input
                id="image_url"
                type="url"
                value={form.image_url}
                onChange={(e) => set('image_url', e.target.value)}
                placeholder="https://example.com/banner.jpg"
                disabled={archived}
              />
              {form.image_url && (
                <img
                  src={form.image_url}
                  alt=""
                  className="mt-2 h-32 w-full rounded-md object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>When and where</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="start_date">Start date</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={form.start_date ?? ''}
                  onChange={(e) => set('start_date', e.target.value || null)}
                  disabled={archived}
                />
              </div>
              <div>
                <Label htmlFor="end_date">End date</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={form.end_date ?? ''}
                  min={form.start_date ?? undefined}
                  onChange={(e) => set('end_date', e.target.value || null)}
                  disabled={archived}
                />
              </div>
              <div>
                <Label htmlFor="start_time">Start time</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={form.start_time ?? ''}
                  onChange={(e) => set('start_time', e.target.value || null)}
                  disabled={archived}
                />
              </div>
              <div>
                <Label htmlFor="end_time">End time</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={form.end_time ?? ''}
                  onChange={(e) => set('end_time', e.target.value || null)}
                  disabled={archived}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="Accra International Conference Centre"
                maxLength={200}
                disabled={archived}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                value={form.capacity ?? ''}
                onChange={(e) => set('capacity', e.target.value ? Number(e.target.value) : null)}
                placeholder="Leave empty for unlimited"
                disabled={archived}
              />
              <p className="mt-1 text-xs text-gray-500">
                Registration closes automatically once capacity is reached. It cannot be set below
                the number of people already registered.
              </p>
            </div>

            <div>
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                id="visibility"
                value={form.visibility}
                onChange={(e) => set('visibility', e.target.value as EventVisibility)}
                disabled={archived}
              >
                <option value="draft">Draft</option>
                <option value="published">Public</option>
                <option value="unlisted">Unlisted</option>
              </Select>
              <p className="mt-1 text-xs text-gray-500">{VISIBILITY_LABELS[form.visibility]}</p>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={saving || archived || !form.name.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}
          </Button>
          <Link to={isEdit && id ? `/organizer/events/${id}` : '/organizer/events'}>
            <Button type="button" variant="secondary" className="w-full sm:w-auto">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
