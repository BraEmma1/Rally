import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { EventPhotoUpload } from '@/components/ui/EventPhotoUpload'
import {
  createSpeaker,
  getPublicProfileForPrefill,
  type SpeakerInput,
} from '@/lib/speakers'
import { searchCheckInRows } from '@/lib/checkin'
import { SheetDialog } from './SheetDialog'

type EventLike = {
  id: string
  name: string
  timezone: string | null
}

export type SpeakerFormValues = {
  full_name: string
  job_title: string
  company: string
  bio: string
  photo_url: string
  linkedin: string
  website: string
  industry: string
}

export const EMPTY_SPEAKER_VALUES: SpeakerFormValues = {
  full_name: '',
  job_title: '',
  company: '',
  bio: '',
  photo_url: '',
  linkedin: '',
  website: '',
  industry: '',
}

// Add-speaker flow: choose external or linked attendee, then the shared form.
// The linked path prefills the snapshot from the attendee's public Rally
// profile; everything stays editable because the snapshot, not the live
// profile, is what attendees will see.
export function AddSpeakerDialog({
  event,
  onClose,
  onSaved,
}: {
  event: EventLike
  onClose: () => void
  onSaved: () => void
}) {
  const [mode, setMode] = useState<'choose' | 'external' | 'attendee'>('choose')
  const [prefillUserId, setPrefillUserId] = useState<string | null>(null)
  const [initial, setInitial] = useState<SpeakerFormValues | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <SheetDialog title="Add Speaker" subtitle={event.name} onClose={onClose}>
      {mode === 'choose' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">How would you like to add this speaker?</p>
          <button
            type="button"
            onClick={() => setMode('external')}
            className="w-full rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <p className="text-sm font-semibold text-gray-900">Add External Speaker</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Someone without a Rally account — type their details yourself.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('attendee')}
            className="w-full rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <p className="text-sm font-semibold text-gray-900">Add Event Attendee as Speaker</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Pick someone registered for this event and prefill from their Rally profile.
            </p>
          </button>
        </div>
      )}

      {mode === 'external' && (
        <SpeakerFields
          eventId={event.id}
          userId={null}
          initial={EMPTY_SPEAKER_VALUES}
          onCancel={() => setMode('choose')}
          onSaved={onSaved}
        />
      )}

      {mode === 'attendee' && !initial && (
        <AttendeePicker
          eventId={event.id}
          onPick={async (userId) => {
            const { data, error: err } = await getPublicProfileForPrefill(userId)
            if (err || !data) {
              setError(err ?? 'Could not load that profile.')
              return
            }
            setError(null)
            setPrefillUserId(userId)
            setInitial(data)
          }}
          onBack={() => setMode('choose')}
        />
      )}
      {mode === 'attendee' && initial && (
        <SpeakerFields
          eventId={event.id}
          userId={prefillUserId}
          initial={initial}
          onCancel={() => {
            setInitial(null)
            setPrefillUserId(null)
          }}
          onSaved={onSaved}
        />
      )}

      {error && (
        <div className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {error}
        </div>
      )}
    </SheetDialog>
  )
}

// Only people already registered for this event can be linked —
// find_event_attendees is scoped to one event and returns the public card,
// never contact details.
function AttendeePicker({
  eventId,
  onPick,
  onBack,
}: {
  eventId: string
  onPick: (userId: string) => void
  onBack: () => void
}) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<
    { user_id: string; full_name: string; job_title: string; company: string; photo_url: string }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(async () => {
      const { data, error: err } = await searchCheckInRows(eventId, search.trim())
      if (cancelled) return
      if (err) {
        setError(err)
        setRows([])
      } else {
        setError(null)
        setRows(data)
      }
      setLoading(false)
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [eventId, search])

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      >
        Back to options
      </button>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search attendees by name or company…"
          className="pl-9"
          autoFocus
        />
      </div>
      {loading && <p className="text-sm text-gray-500">Searching…</p>}
      {error && (
        <p className="text-sm text-error-600" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-gray-500">
          No matching attendees. Only people registered for this event can be linked as speakers.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
          {rows.map((r) => (
            <li key={r.user_id}>
              <button
                type="button"
                onClick={() => onPick(r.user_id)}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
              >
                <Avatar name={r.full_name || 'Attendee'} src={r.photo_url || null} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {r.full_name || 'Rally member'}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {[r.job_title, r.company].filter(Boolean).join(' · ') || 'No title set'}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-500">
        Only the public card is shown — never email or phone. Everything can still be edited after
        picking.
      </p>
    </div>
  )
}

export function SpeakerFields({
  eventId,
  userId,
  initial,
  onCancel,
  onSaved,
}: {
  eventId: string
  userId: string | null
  initial: SpeakerFormValues
  onCancel: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<SpeakerFormValues>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof SpeakerFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!values.full_name.trim()) {
      setError('Give the speaker a name.')
      return
    }
    setSaving(true)
    const payload: SpeakerInput = {
      full_name: values.full_name.trim(),
      job_title: values.job_title.trim(),
      company: values.company.trim(),
      bio: values.bio.trim(),
      photo_url: values.photo_url.trim(),
      linkedin: values.linkedin.trim(),
      website: values.website.trim(),
      industry: values.industry.trim(),
    }
    const { error: err } = await createSpeaker(eventId, payload, userId)
    if (err) {
      setError(err)
      setSaving(false)
      return
    }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {userId && (
        <p className="rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-700">
          Prefilled from this person's Rally profile. Edit freely — attendees will see this event's
          own speaker record, which does not follow their profile changes.
        </p>
      )}
      {/* Event content, not the organizer's avatar: this writes a fresh
          object under the uploader's own folder in event-assets. */}
      <EventPhotoUpload
        folder="speakers"
        fullName={values.full_name || 'Speaker'}
        currentPhotoUrl={values.photo_url || null}
        onUploaded={(url) => set('photo_url', url)}
      />
      <div>
        <Label htmlFor="sp-name">Full name *</Label>
        <Input
          id="sp-name"
          value={values.full_name}
          onChange={(e) => set('full_name', e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="sp-title">Job title</Label>
          <Input id="sp-title" value={values.job_title} onChange={(e) => set('job_title', e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label htmlFor="sp-company">Company / Organization</Label>
          <Input id="sp-company" value={values.company} onChange={(e) => set('company', e.target.value)} maxLength={200} />
        </div>
      </div>
      <div>
        <Label htmlFor="sp-industry">Industry</Label>
        <Input id="sp-industry" value={values.industry} onChange={(e) => set('industry', e.target.value)} maxLength={120} />
      </div>
      <div>
        <Label htmlFor="sp-bio">Bio</Label>
        <Textarea id="sp-bio" value={values.bio} onChange={(e) => set('bio', e.target.value)} rows={4} maxLength={4000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="sp-linkedin">LinkedIn</Label>
          <Input
            id="sp-linkedin"
            type="url"
            value={values.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
            placeholder="https://linkedin.com/in/…"
          />
        </div>
        <div>
          <Label htmlFor="sp-website">Website</Label>
          <Input
            id="sp-website"
            type="url"
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://…"
          />
        </div>
      </div>
      {error && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {error}
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Back
        </Button>
        <Button type="submit" disabled={saving || !values.full_name.trim()}>
          {saving ? 'Saving…' : 'Save speaker'}
        </Button>
      </div>
    </form>
  )
}
