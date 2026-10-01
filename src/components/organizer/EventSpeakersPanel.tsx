import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Mic, Pencil, Search, Trash2, UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  deleteSpeaker,
  listEventSpeakers,
  reorderEventSpeakers,
  type EventSpeaker,
} from '@/lib/speakers'
import { AddSpeakerDialog } from './AddSpeakerDialog'
import { EditSpeakerDialog } from './EditSpeakerDialog'
import { ConfirmDialog } from './SheetDialog'

type EventLike = {
  id: string
  name: string
  timezone: string | null
  archived_at: string | null
}

export function EventSpeakersPanel({ event, manages }: { event: EventLike; manages: boolean }) {
  const [speakers, setSpeakers] = useState<EventSpeaker[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<EventSpeaker | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<EventSpeaker | null>(null)
  const [removing, setRemoving] = useState(false)
  const [busyMove, setBusyMove] = useState(false)

  const [search, setSearch] = useState('')

  const archived = event.archived_at !== null
  const editable = manages && !archived

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await listEventSpeakers(event.id)
    if (err) {
      setError(err)
      setSpeakers(null)
    } else {
      setSpeakers(data)
    }
    setLoading(false)
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  const needle = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!speakers) return []
    if (!needle) return speakers
    return speakers.filter(
      (s) =>
        s.full_name.toLowerCase().includes(needle) ||
        s.job_title.toLowerCase().includes(needle) ||
        s.company.toLowerCase().includes(needle) ||
        s.industry.toLowerCase().includes(needle)
    )
  }, [speakers, needle])

  async function moveSpeaker(speaker: EventSpeaker, direction: -1 | 1) {
    if (!speakers || !editable || busyMove) return
    const idx = speakers.findIndex((s) => s.id === speaker.id)
    const swap = idx + direction
    if (idx < 0 || swap < 0 || swap >= speakers.length) return
    const next = [...speakers]
    const [moved] = next.splice(idx, 1)
    next.splice(swap, 0, moved)
    setSpeakers(next)
    setBusyMove(true)
    setActionError(null)
    const { error: err } = await reorderEventSpeakers(
      event.id,
      next.map((s) => s.id)
    )
    setBusyMove(false)
    if (err) {
      setActionError(err)
      void load()
    }
  }

  async function handleRemove() {
    if (!confirmRemove) return
    setRemoving(true)
    setActionError(null)
    const { error: err } = await deleteSpeaker(confirmRemove.id)
    setRemoving(false)
    if (err) {
      setActionError(err)
      setConfirmRemove(null)
      return
    }
    const removed = confirmRemove
    setConfirmRemove(null)
    setSpeakers((prev) => (prev ? prev.filter((s) => s.id !== removed.id) : prev))
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Speakers</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage the people appearing in this event's programme.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0">
            <UserPlus className="h-4 w-4" />
            Add Speaker
          </Button>
        )}
      </div>

      {archived && manages && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent>
            <p className="text-sm text-warning-700">
              This event is archived. Restore it before changing its speakers.
            </p>
          </CardContent>
        </Card>
      )}

      {actionError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </div>
      )}

      {speakers !== null && speakers.length > 4 && editable && (
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search speakers…"
            className="pl-9"
          />
        </div>
      )}

      {speakers && speakers.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Mic className="h-10 w-10" />}
              title="No speakers have been added yet."
              description="Add the people appearing in this event's programme."
              action={
                editable ? <Button onClick={() => setAddOpen(true)}>+ Add First Speaker</Button> : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((speaker, idx) => (
            <li
              key={speaker.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4"
            >
              <Avatar name={speaker.full_name} src={speaker.photo_url || null} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-gray-900">{speaker.full_name}</h3>
                  {speaker.user_id && <Badge variant="gray">On Rally</Badge>}
                </div>
                <p className="truncate text-xs text-gray-500">
                  {[speaker.job_title, speaker.company].filter(Boolean).join(' · ') || 'No title set'}
                </p>
                {speaker.industry && <p className="truncate text-xs text-gray-400">{speaker.industry}</p>}
                <p className="mt-1 text-xs text-gray-500">
                  {speaker.session_count} {speaker.session_count === 1 ? 'session' : 'sessions'}
                </p>
              </div>
              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  {speakers !== null && speakers.length > 1 && (
                    <div className="mr-1 hidden flex-col sm:flex">
                      <button
                        type="button"
                        disabled={idx === 0 || busyMove}
                        onClick={() => void moveSpeaker(speaker, -1)}
                        className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        aria-label={`Move ${speaker.full_name} up in the speaker order`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === speakers.length - 1 || busyMove}
                        onClick={() => void moveSpeaker(speaker, 1)}
                        className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        aria-label={`Move ${speaker.full_name} down in the speaker order`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(speaker)}
                    aria-label={`Edit ${speaker.full_name}`}
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="hidden md:inline">Edit</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removing}
                    onClick={() => setConfirmRemove(speaker)}
                    aria-label={`Remove ${speaker.full_name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden md:inline">Remove</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {addOpen && (
        <AddSpeakerDialog
          event={event}
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false)
            await load()
          }}
        />
      )}

      {editing && (
        <EditSpeakerDialog
          event={event}
          speaker={{
            id: editing.id,
            user_id: editing.user_id,
            full_name: editing.full_name,
            job_title: editing.job_title,
            company: editing.company,
            bio: editing.bio,
            photo_url: editing.photo_url,
            linkedin: editing.linkedin,
            website: editing.website,
            industry: editing.industry,
          }}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          busy={removing}
          title="Remove this speaker from the event?"
          body="The speaker will also be removed from their assigned sessions. Their Rally account, if linked, will not be deleted."
          action="Remove Speaker"
          onConfirm={() => void handleRemove()}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}
