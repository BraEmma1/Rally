import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { PhotoUpload } from '@/components/ui/PhotoUpload'
import { useAuth } from '@/context/AuthContext'
import {
  SPEAKER_ROLES,
  SPEAKER_ROLE_LABELS,
  assignSpeakerToSession,
  unassignSpeakerFromSession,
  updateSpeaker,
  listSessionSpeakers,
  type SpeakerRole,
} from '@/lib/speakers'
import { getEventAgenda } from '@/lib/events'
import { formatDayHeading, formatRange } from '@/lib/sessionTime'
import { SheetDialog } from './SheetDialog'
import type { SpeakerFormValues } from './AddSpeakerDialog'
import { EMPTY_SPEAKER_VALUES } from './AddSpeakerDialog'

type EventLike = {
  id: string
  name: string
  timezone: string | null
}

type Assignment = {
  session_id: string
  speaker_role: string
}

export function EditSpeakerDialog({
  event,
  speaker,
  onClose,
  onSaved,
}: {
  event: EventLike
  speaker: {
    id: string
    user_id: string | null
    full_name: string
    job_title: string
    company: string
    bio: string
    photo_url: string
    linkedin: string
    website: string
    industry: string
  }
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'details' | 'sessions'>('details')
  const [values, setValues] = useState<SpeakerFormValues>({
    ...EMPTY_SPEAKER_VALUES,
    full_name: speaker.full_name,
    job_title: speaker.job_title,
    company: speaker.company,
    bio: speaker.bio,
    photo_url: speaker.photo_url,
    linkedin: speaker.linkedin,
    website: speaker.website,
    industry: speaker.industry,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<
    (Assignment & { title: string; start_at: string; location: string })[] | null
  >(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [busyAssignment, setBusyAssignment] = useState<string | null>(null)

  async function refreshAssignments() {
    const [{ data: pairs }, { data: agenda }] = await Promise.all([
      listSessionSpeakers(event.id),
      getEventAgenda(event.id),
    ])
    const titles = new Map((agenda ?? []).map((s) => [s.id, s]))
    setAssignments(
      (pairs ?? [])
        .filter((a) => a.speaker_id === speaker.id)
        .map((a) => ({
          session_id: a.session_id,
          speaker_role: a.speaker_role,
          title: titles.get(a.session_id)?.title ?? 'Session',
          start_at: titles.get(a.session_id)?.start_at ?? '',
          location: titles.get(a.session_id)?.location ?? '',
        }))
    )
  }

  useEffect(() => {
    void refreshAssignments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, speaker.id])

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
    const { error: err } = await updateSpeaker(speaker.id, {
      full_name: values.full_name.trim(),
      job_title: values.job_title.trim(),
      company: values.company.trim(),
      bio: values.bio.trim(),
      photo_url: values.photo_url.trim(),
      linkedin: values.linkedin.trim(),
      website: values.website.trim(),
      industry: values.industry.trim(),
    })
    if (err) {
      setError(err)
      setSaving(false)
      return
    }
    onSaved()
  }

  async function removeAssignment(sessionId: string) {
    setBusyAssignment(sessionId)
    setError(null)
    const { error: err } = await unassignSpeakerFromSession(sessionId, speaker.id)
    setBusyAssignment(null)
    if (err) {
      setError(err)
      return
    }
    await refreshAssignments()
  }

  return (
    <SheetDialog title="Edit speaker" subtitle={event.name} onClose={onClose}>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(['details', 'sessions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ' +
              (tab === t
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700')
            }
          >
            {t === 'details' ? 'Details' : 'Sessions'}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <PhotoUpload
            userId={user?.id ?? 'anonymous'}
            fullName={values.full_name || speaker.full_name}
            currentPhotoUrl={values.photo_url || null}
            onUploaded={(url) => set('photo_url', url)}
          />
          {speaker.user_id && (
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Linked to a Rally account. Editing here changes only this event's speaker record —
              the person's own Rally profile stays untouched.
            </p>
          )}
          <div>
            <Label htmlFor="esp-name">Full name *</Label>
            <Input
              id="esp-name"
              value={values.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="esp-title">Job title</Label>
              <Input id="esp-title" value={values.job_title} onChange={(e) => set('job_title', e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="esp-company">Company / Organization</Label>
              <Input id="esp-company" value={values.company} onChange={(e) => set('company', e.target.value)} maxLength={200} />
            </div>
          </div>
          <div>
            <Label htmlFor="esp-industry">Industry</Label>
            <Input id="esp-industry" value={values.industry} onChange={(e) => set('industry', e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label htmlFor="esp-bio">Bio</Label>
            <Textarea id="esp-bio" value={values.bio} onChange={(e) => set('bio', e.target.value)} rows={4} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="esp-linkedin">LinkedIn</Label>
              <Input id="esp-linkedin" type="url" value={values.linkedin} onChange={(e) => set('linkedin', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="esp-website">Website</Label>
              <Input id="esp-website" type="url" value={values.website} onChange={(e) => set('website', e.target.value)} />
            </div>
          </div>
          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {error}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !values.full_name.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      )}

      {tab === 'sessions' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Assigned sessions</h3>
            <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)}>
              + Assign Session
            </Button>
          </div>
          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {error}
            </div>
          )}
          {assignments === null && <p className="text-sm text-gray-500">Loading…</p>}
          {assignments !== null && assignments.length === 0 && (
            <p className="text-sm text-gray-500">Not assigned to any session yet.</p>
          )}
          {assignments !== null && assignments.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {assignments.map((a) => (
                <li key={a.session_id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-500">
                      {SPEAKER_ROLE_LABELS[a.speaker_role as SpeakerRole] ?? a.speaker_role}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyAssignment === a.session_id}
                    onClick={() => void removeAssignment(a.session_id)}
                    aria-label={`Remove assignment: ${a.title}`}
                  >
                    {busyAssignment === a.session_id ? 'Removing…' : 'Remove'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {assignOpen && (
        <AssignSessionDialog
          event={event}
          speakerId={speaker.id}
          onClose={() => setAssignOpen(false)}
          onSaved={async () => {
            setAssignOpen(false)
            await refreshAssignments()
          }}
        />
      )}
    </SheetDialog>
  )
}

// Choose a session (from this event's agenda only) and a role label. Duplicate
// assignment of the same speaker to the same session is impossible — the table
// keys on (session_id, speaker_id) — and the backend maps any error cleanly.
function AssignSessionDialog({
  event,
  speakerId,
  onSaved,
  onClose,
}: {
  event: EventLike
  speakerId: string
  onSaved: () => void
  onClose: () => void
}) {
  const [role, setRole] = useState<SpeakerRole>('speaker')
  const [sessions, setSessions] = useState<
    { id: string; title: string; start_at: string; end_at: string | null; location: string }[] | null
  >(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: err } = await getEventAgenda(event.id)
      if (cancelled) return
      if (err) {
        setError(err)
        setSessions(null)
      } else {
        setSessions(
          (data ?? []).map((s) => ({
            id: s.id,
            title: s.title,
            start_at: s.start_at,
            end_at: s.end_at,
            location: s.location,
          }))
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [event.id])

  async function assign(sessionId: string) {
    setSavingId(sessionId)
    setError(null)
    const { error: err } = await assignSpeakerToSession(sessionId, speakerId, event.id, role)
    setSavingId(null)
    if (err) {
      setError(err)
      return
    }
    onSaved()
  }

  const timeZone = event.timezone || undefined

  return (
    <SheetDialog
      title="Assign to a session"
      subtitle="Choose the session and the role"
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="assign-role">Role</Label>
          <Select id="assign-role" value={role} onChange={(e) => setRole(e.target.value as SpeakerRole)}>
            {SPEAKER_ROLES.map((r) => (
              <option key={r} value={r}>
                {SPEAKER_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-gray-500">
            A label on the programme — it grants no permissions.
          </p>
        </div>
        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}
        {sessions === null && <p className="text-sm text-gray-500">Loading sessions…</p>}
        {sessions !== null && sessions.length === 0 && (
          <p className="text-sm text-gray-500">No sessions yet — add sessions in the Agenda tab first.</p>
        )}
        {sessions !== null && sessions.length > 0 && (
          <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={savingId === s.id}
                  onClick={() => void assign(s.id)}
                  className="flex w-full flex-col items-start gap-0.5 p-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600 disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {savingId === s.id ? 'Assigning…' : s.title}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDayHeading(new Date(s.start_at), timeZone)} ·{' '}
                    {formatRange(new Date(s.start_at), s.end_at ? new Date(s.end_at) : null, timeZone)}
                    {s.location ? ` · ${s.location}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SheetDialog>
  )
}
