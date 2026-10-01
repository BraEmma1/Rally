import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { createSession, updateSession, type OrganizerSession, type SessionInput } from '@/lib/events'
import { utcToZonedDate, utcToZonedTime, zonedToUtc } from '@/lib/sessionTime'

// Add/edit form for organizer sessions. Dates and times are entered as
// wall-clock values in the event's timezone and converted to absolute instants
// before storing — the organizer's device timezone is never involved.

type EventLike = {
  id: string
  name: string
  timezone: string | null
  start_date: string | null
  end_date: string | null
}

const SESSION_TYPES = [
  { value: 'session', label: 'Session' },
  { value: 'keynote', label: 'Keynote' },
  { value: 'panel', label: 'Panel' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'break', label: 'Break' },
  { value: 'networking', label: 'Networking' },
]

export function SessionFormDialog({
  event,
  session,
  onClose,
  onSaved,
}: {
  event: EventLike
  session: OrganizerSession | null
  onClose: () => void
  onSaved: () => void
}) {
  const timeZone = event.timezone

  const [title, setTitle] = useState(session?.title ?? '')
  const [description, setDescription] = useState(session?.description ?? '')
  const [date, setDate] = useState(
    session ? utcToZonedDate(session.start_at, timeZone as string) : event.start_date ?? ''
  )
  const [startTime, setStartTime] = useState(
    session ? utcToZonedTime(session.start_at, timeZone as string) : ''
  )
  const [endTime, setEndTime] = useState(
    session?.end_at ? utcToZonedTime(session.end_at, timeZone as string) : ''
  )
  const [location, setLocation] = useState(session?.location ?? '')
  const [sessionType, setSessionType] = useState(session?.session_type ?? 'session')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, saving])

  const outsideDates = useMemo(() => {
    if (!event.start_date && !event.end_date) return false
    if (!date) return false
    if (event.start_date && date < event.start_date) return true
    if (event.end_date && date > event.end_date) return true
    return false
  }, [date, event.start_date, event.end_date])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!timeZone) return
    if (saving) return

    setError(null)
    if (!title.trim()) {
      setError('Give the session a title.')
      return
    }
    if (!date || !startTime) {
      setError('Choose a date and a start time.')
      return
    }
    if (endTime && endTime <= startTime) {
      setError('End time must be after start time.')
      return
    }

    const input: SessionInput = {
      title: title.trim(),
      description: description.trim() || null,
      start_at: zonedToUtc(date, startTime, timeZone),
      end_at: endTime ? zonedToUtc(date, endTime, timeZone) : null,
      location: location.trim() || null,
      session_type: sessionType,
    }

    setSaving(true)
    const { error: err } = session
      ? await updateSession(session.id, input)
      : await createSession(event.id, input)
    if (err) {
      setError(err)
      setSaving(false)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={session ? 'Edit session' : 'Add session'}>
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={saving ? undefined : onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-[36rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 md:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-snug text-gray-900">
              {session ? 'Edit session' : 'Add session'}
            </h2>
            <p className="mt-0.5 truncate text-xs text-gray-500">{event.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close session form"
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 border-t border-gray-200 pt-4">
          <div>
            <Label htmlFor="session-title">Session title *</Label>
            <Input
              id="session-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Opening Keynote"
              required
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="session-description">Description</Label>
            <Textarea
              id="session-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What happens in this session?"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="session-date">Date *</Label>
              <Input
                id="session-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="session-start">Start time *</Label>
              <Input
                id="session-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="session-end">End time</Label>
              <Input
                id="session-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Times are in the event's timezone: {timeZone}.
          </p>

          {outsideDates && (
            <p className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700" role="alert">
              This session falls outside the event's scheduled dates. You can still save it.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="session-location">Location</Label>
              <Input
                id="session-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={200}
                placeholder="Main Hall"
              />
            </div>
            <div>
              <Label htmlFor="session-type">Session type</Label>
              <Select
                id="session-type"
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value)}
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Discard
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : session ? 'Save changes' : 'Create session'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
