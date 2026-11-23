import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Button } from '@/components/ui/Button'
import { BannerUpload } from '@/components/ui/BannerUpload'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { EventAccessNotice } from '@/components/organizer/EventAccessNotice'
import { canCreateEvents } from '@/lib/eventAccess'
import { useEventAccess } from '@/lib/useEventAccess'
import {
  EVENT_TIMEZONES,
  VISIBILITY_LABELS,
  createEvent,
  getEvent,
  getEventSeatCounts,
  updateEvent,
  type EventInput,
  type EventSeatCounts,
} from '@/lib/events'
import {
  TIMEZONE_FALLBACK_WARNING,
  deadlineFromInputs,
  deadlineInputs,
  eventEndsAt,
  formatInstant,
  usableTimeZone,
} from '@/lib/registrationWindow'
import type { EventVisibility } from '@/lib/supabase'

// The deadline inputs follow the saved deadline (shown in the event's current
// timezone) until the organizer edits them; only then is a deadline sent.
type DeadlineDraft = { touched: false } | { touched: true; date: string; time: string }

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
  timezone: null,
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
  const [loadFailed, setLoadFailed] = useState(false)
  // Edit only: who already holds a seat and who is waiting. Null while loading
  // or if it could not be read; the form still works without it.
  const [seats, setSeats] = useState<EventSeatCounts | null>(null)
  const [seatsFailed, setSeatsFailed] = useState(false)
  // Edit only: what was stored when the form opened. The timezone rules depend
  // on it (a published event must keep a timezone; a legacy published event
  // without one may still save other changes), and so does the deadline.
  const [stored, setStored] = useState<{
    timezone: string | null
    visibility: EventVisibility
    deadline: string | null
  } | null>(null)
  const [deadline, setDeadline] = useState<DeadlineDraft>({ touched: false })

  // Editing is an event-scoped right (can_manage_event): an owner or admin may
  // edit any event, a manager only those assigned to them. Creating is checked
  // separately below. The check is skipped on the create form.
  const access = useEventAccess(isEdit ? id : null)
  const allowed = access.state === 'manage'

  useEffect(() => {
    if (!id || !allowed) return
    void (async () => {
      const { data, error: loadError } = await getEvent(id)
      if (loadError || !data) {
        setError(loadError ?? 'That event could not be found.')
        setLoadFailed(true)
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
        timezone: data.timezone,
        visibility: data.visibility,
      })
      setStored({
        timezone: data.timezone,
        visibility: data.visibility,
        deadline: data.registration_deadline ?? null,
      })
      setLoading(false)
    })()
  }, [id, allowed])

  useEffect(() => {
    if (!id || !allowed) return
    void (async () => {
      const { data, error: countError } = await getEventSeatCounts(id)
      setSeats(data)
      setSeatsFailed(Boolean(countError))
    })()
  }, [id, allowed])

  if (orgLoading) return <LoadingState message="Loading…" />
  // The edit URL answers a direct link exactly as it answers the Edit button.
  if (isEdit && access.state !== 'manage') {
    return <EventAccessNotice access={access} onRetry={access.retry} />
  }
  if (loading) return <LoadingState message="Loading…" />
  if (!organization || !user) return null
  // Never offer an empty edit form for an event that did not load: saving it
  // would try to blank the real one.
  if (isEdit && loadFailed) {
    return <ErrorState message={error ?? 'That event could not be found.'} />
  }

  // Creating is an owner/admin act (the INSERT policy requires is_org_admin);
  // a manager edits the events assigned to them but cannot create new ones.
  // The database enforces both — this only avoids offering a doomed form.
  if (!isEdit && !canCreateEvents(role)) {
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

  // ---- Timezone rules (enforce_event_write_rules, migration 20261104000000) --
  // The event's end, and so the close of registration, is read in this zone.
  const tz = form.timezone?.trim() || null
  const tzUsable = usableTimeZone(tz)
  const storedTz = stored?.timezone ?? null
  // The browser's list is the suggestion list; the database decides. A typed
  // name outside it is flagged, and the database's refusal is shown if it
  // refuses. A stored value is never flagged just for being there.
  const tzUnlisted = tz !== null && tz !== storedTz && !EVENT_TIMEZONES.includes(tz)
  // Publishing needs a timezone, and a published event that has one keeps it.
  const publishing = form.visibility !== 'draft' && (!isEdit || stored?.visibility === 'draft')
  const tzRequired = form.visibility !== 'draft' && (publishing || storedTz !== null)
  // A published event saved before timezones were required may still save
  // other changes; it is told what having no timezone costs.
  const legacyWithoutTz = isEdit && !tz && form.visibility !== 'draft' && !tzRequired

  // ---- Registration deadline ------------------------------------------------
  const storedDeadline = stored?.deadline ?? null
  const deadlineShown = deadline.touched ? deadline : deadlineInputs(storedDeadline, tzUsable)
  // The deadline the form would save: the stored one until edited; nothing
  // while the edit is incomplete (a date without a time), which submit refuses.
  const deadlineValue: string | null = !deadline.touched
    ? storedDeadline
    : deadline.date === '' || !deadline.time || !tzUsable
      ? null
      : deadlineFromInputs(deadline.date, deadline.time, tzUsable)
  const hasDeadline = deadline.touched ? deadline.date !== '' || deadline.time !== '' : storedDeadline !== null
  const endsAt = eventEndsAt({ ...form, timezone: tz })
  const deadlinePassed = deadline.touched && deadlineValue !== null && Date.parse(deadlineValue) <= Date.now()
  const deadlineAfterEnd = deadlineValue !== null && endsAt !== null && Date.parse(deadlineValue) > endsAt.getTime()

  function editDeadline(part: 'date' | 'time', value: string) {
    setDeadline((d) => {
      const base = d.touched ? d : { touched: true as const, ...deadlineInputs(storedDeadline, tzUsable) }
      return { ...base, touched: true, [part]: value }
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!organization || !user) return
    setError(null)
    if (tzRequired && !tz) {
      setError('Choose an event timezone. A published event needs one so registration closes on time.')
      return
    }
    if (deadline.touched && deadline.date && !tzUsable) {
      setError('Set the event timezone before adding a registration deadline.')
      return
    }
    if (deadline.touched && deadline.date && !deadline.time) {
      setError('Add a time for the registration deadline.')
      return
    }
    setSaving(true)

    const payload: EventInput = {
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      // Empty date/time inputs come back as '' which Postgres rejects for a
      // date column; null is the honest representation of "not set yet".
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      timezone: form.timezone || null,
      // Only an edited deadline is sent, so saving other changes never
      // rewrites it (and the form keeps working against a database that does
      // not have the column yet).
      ...(deadline.touched ? { registration_deadline: deadlineValue } : {}),
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
              <Label htmlFor="image_url">Banner image</Label>
              <BannerUpload
                userId={user.id}
                currentUrl={form.image_url}
                onUploaded={(url) => set('image_url', url)}
                onClear={() => set('image_url', '')}
                disabled={archived}
              />
              <p className="mt-1 text-xs text-gray-500">
                Pick an image from your device — it becomes the event banner shown to attendees.
              </p>
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

            <div>
              <Label htmlFor="timezone">Event timezone{tzRequired ? ' *' : ''}</Label>
              <Input
                id="timezone"
                list="event-timezones"
                value={form.timezone ?? ''}
                onChange={(e) => set('timezone', e.target.value || null)}
                placeholder="Choose a timezone, e.g. Africa/Accra"
                disabled={archived}
                aria-required={tzRequired || undefined}
                aria-invalid={tzUnlisted || undefined}
                aria-describedby="timezone-help"
              />
              <datalist id="event-timezones">
                {EVENT_TIMEZONES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div id="timezone-help" className="mt-1 space-y-1">
                {tzUnlisted && (
                  <p className="text-xs text-error-700">
                    “{tz}” is not in the timezone list. Choose one of the suggestions, such as Africa/Accra.
                  </p>
                )}
                {legacyWithoutTz && <p className="text-xs text-warning-700">{TIMEZONE_FALLBACK_WARNING}</p>}
                <p className="text-xs text-gray-500">
                  {tz
                    ? `Session times, the registration deadline and the event's end are read in ${tz}.`
                    : form.visibility === 'draft'
                      ? 'Start typing to choose — suggestions appear as you type. Needed before you publish, and before agenda times or a registration deadline can be set.'
                      : 'Start typing to choose — suggestions appear as you type. Registration closes when the event ends in this timezone.'}
                </p>
              </div>
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
              {isEdit && seats && (
                <p className="mt-1 text-sm text-gray-700" aria-live="polite">
                  <span className="font-medium tabular-nums">{seats.confirmed.toLocaleString()}</span>{' '}
                  confirmed ·{' '}
                  <span className="font-medium tabular-nums">{seats.waitlisted.toLocaleString()}</span>{' '}
                  waitlisted
                </p>
              )}
              {isEdit && seatsFailed && (
                <p className="mt-1 text-xs text-gray-500">Current registration counts could not be loaded.</p>
              )}
              {isEdit && seats && form.capacity !== null && form.capacity < seats.confirmed && (
                <p className="mt-1 text-xs text-error-700">
                  {seats.confirmed.toLocaleString()} people are already confirmed, so capacity cannot be
                  lower than that.
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Once the event is full, new registrations join the waitlist. Confirmed registrations
                (registered or checked in) set the minimum capacity; waitlisted people do not count,
                and raising the capacity moves them in, longest-waiting first.
              </p>
            </div>

            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-gray-700">Registration deadline</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="registration_deadline_date" className="sr-only">
                    Deadline date
                  </Label>
                  <Input
                    id="registration_deadline_date"
                    type="date"
                    value={deadlineShown.date}
                    onChange={(e) => editDeadline('date', e.target.value)}
                    disabled={archived || !tzUsable}
                    aria-describedby="deadline-help"
                  />
                </div>
                <div>
                  <Label htmlFor="registration_deadline_time" className="sr-only">
                    Deadline time
                  </Label>
                  <Input
                    id="registration_deadline_time"
                    type="time"
                    value={deadlineShown.time}
                    onChange={(e) => editDeadline('time', e.target.value)}
                    disabled={archived || !tzUsable}
                    aria-describedby="deadline-help"
                  />
                </div>
              </div>
              <div id="deadline-help" className="mt-1 space-y-1" aria-live="polite">
                {hasDeadline && (
                  <button
                    type="button"
                    onClick={() => setDeadline({ touched: true, date: '', time: '' })}
                    disabled={archived}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700 disabled:text-gray-400"
                  >
                    Remove deadline
                  </button>
                )}
                {!tzUsable && storedDeadline && !deadline.touched && (
                  <p className="text-xs text-gray-700">Current deadline: {formatInstant(storedDeadline, null)}.</p>
                )}
                {deadlinePassed && (
                  <p className="text-xs text-warning-700">This deadline has already passed. Saving it closes registration.</p>
                )}
                {deadlineAfterEnd && endsAt && (
                  <p className="text-xs text-warning-700">
                    This is after the event ends ({formatInstant(endsAt.toISOString(), tzUsable)}), so registration will
                    close when the event ends instead.
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  {tzUsable
                    ? `Optional. Registration closes at this date and time in ${tzUsable}, or when the event ends if that comes first. Leave it empty to keep registration open until the event ends.`
                    : 'Set the event timezone above to add a deadline. Until then, registration stays open until the event ends.'}
                </p>
              </div>
            </fieldset>

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
