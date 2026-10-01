import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  SESSION_STATUS_BADGE,
  SESSION_STATUS_LABELS,
  SESSION_TYPE_LABELS,
  deleteSession,
  getEventAgenda,
  reorderSessions,
  updateSession,
  type OrganizerSession,
} from '@/lib/events'
import { dayKey, formatDayHeading, formatRange, utcToZonedTime } from '@/lib/sessionTime'
import { SessionFormDialog } from './SessionFormDialog'
import { cn } from '@/lib/utils'

type EventLike = {
  id: string
  name: string
  timezone: string | null
  start_date: string | null
  end_date: string | null
  visibility: string
  archived_at: string | null
}

type ConfirmState = {
  kind: 'cancel' | 'restore' | 'delete'
  session: OrganizerSession
} | null

const CONFIRM_TEXT: Record<
  'cancel' | 'restore' | 'delete',
  { title: string; body: string; action: string; variant: 'secondary' | 'danger' }
> = {
  cancel: {
    title: 'Cancel this session?',
    body: 'Attendees will continue to see this session marked as cancelled. Anyone who saved it keeps it in their schedule until they remove it.',
    action: 'Cancel Session',
    variant: 'danger',
  },
  restore: {
    title: 'Restore this session?',
    body: 'The session returns to the agenda as scheduled.',
    action: 'Restore Session',
    variant: 'secondary',
  },
  delete: {
    title: 'Delete this session permanently?',
    body: 'This cannot be undone. The session is removed everywhere, including from the My Schedule of anyone who saved it.',
    action: 'Delete permanently',
    variant: 'danger',
  },
}

function ConfirmDialog({
  state,
  busy,
  onConfirm,
  onClose,
}: {
  state: NonNullable<ConfirmState>
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const text = CONFIRM_TEXT[state.kind]
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={text.title}>
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={onClose} />
      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl md:left-1/2 md:right-auto md:w-96 md:-translate-x-1/2">
        <h3 className="text-base font-bold text-gray-900">{text.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{text.body}</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep session
          </Button>
          <Button variant={text.variant} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : text.action}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function EventAgendaPanel({
  event,
  manages,
}: {
  event: EventLike
  manages: boolean
}) {
  const [sessions, setSessions] = useState<OrganizerSession[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrganizerSession | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const timeZone = event.timezone || undefined
  const archived = event.archived_at !== null
  const editable = manages && !archived
  const isDraft = event.visibility === 'draft'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await getEventAgenda(event.id)
    if (err) {
      setError(err)
      setSessions(null)
    } else {
      setSessions(data)
    }
    setLoading(false)
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => {
    if (!sessions) return []
    const unique = new Map<string, Date>()
    for (const s of sessions) {
      const key = dayKey(new Date(s.start_at), timeZone)
      if (!unique.has(key)) unique.set(key, new Date(s.start_at))
    }
    return Array.from(unique.entries(), ([key, date]) => ({ key, date })).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    )
  }, [sessions, timeZone])

  const byDay = useMemo(() => {
    const map = new Map<string, OrganizerSession[]>()
    for (const s of sessions ?? []) {
      const key = dayKey(new Date(s.start_at), timeZone)
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    return map
  }, [sessions, timeZone])

  function openAdd() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(session: OrganizerSession) {
    setEditing(session)
    setFormOpen(true)
  }

  function applyUpdated(updated: OrganizerSession) {
    setSessions((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev))
  }

  async function handleFormSaved() {
    setFormOpen(false)
    setEditing(null)
    await load()
  }

  async function handleConfirm() {
    if (!confirm) return
    const { kind, session } = confirm
    setBusyId(session.id)
    setActionError(null)
    if (kind === 'delete') {
      const { error: err } = await deleteSession(session.id)
      setBusyId(null)
      setConfirm(null)
      if (err) {
        setActionError(err)
        return
      }
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== session.id) : prev))
      return
    }
    const status = kind === 'cancel' ? 'cancelled' : 'scheduled'
    const { error: err } = await updateSession(session.id, { status })
    setBusyId(null)
    setConfirm(null)
    if (err) {
      setActionError(err)
      return
    }
    applyUpdated({ ...session, status })
  }

  // display_order is a tie-breaker for sessions sharing a start time — the
  // attendee agenda sorts chronologically first. Reordering therefore only
  // exists within a same-start-time group, and it never touches start times.
  function sameTimeGroups(dayList: OrganizerSession[]): OrganizerSession[][] {
    const groups: OrganizerSession[][] = []
    let current: OrganizerSession[] = []
    let currentKey = ''
    for (const s of dayList) {
      const key = utcToZonedTime(s.start_at, timeZone as string)
      if (key !== currentKey) {
        if (current.length > 0) groups.push(current)
        current = [s]
        currentKey = key
      } else {
        current.push(s)
      }
    }
    if (current.length > 0) groups.push(current)
    return groups
  }

  async function persistOrder(group: OrganizerSession[]) {
    if (!sessions) return
    const groupIds = new Set(group.map((s) => s.id))
    const before = sessions.filter((s) => !groupIds.has(s.id))
    const firstIdx = sessions.findIndex((s) => groupIds.has(s.id))
    const fullOrder = [...before.slice(0, Math.max(firstIdx, 0)).map((s) => s.id), ...group.map((s) => s.id), ...before.slice(Math.max(firstIdx, 0)).map((s) => s.id)]
    const { error: err } = await reorderSessions(event.id, fullOrder)
    if (err) {
      setActionError(err)
      void load()
      return
    }
    const order = new Map(fullOrder.map((id, i) => [id, i]))
    setSessions((prev) =>
      prev ? prev.map((s) => ({ ...s, display_order: order.get(s.id) ?? s.display_order })) : prev
    )
  }

  function reorderGroup(group: OrganizerSession[], fromId: string, toIndex: number) {
    if (!editable) return
    const from = group.findIndex((s) => s.id === fromId)
    if (from < 0 || toIndex < 0 || toIndex >= group.length || from === toIndex) return
    const next = [...group]
    const [moved] = next.splice(from, 1)
    next.splice(toIndex, 0, moved)
    setSessions((prev) => {
      if (!prev) return prev
      const order = new Map(next.map((s, i) => [s.id, i]))
      return prev.map((s) => (order.has(s.id) ? { ...s, display_order: order.get(s.id) ?? s.display_order } : s))
    })
    void persistOrder(next)
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-10 w-24 shrink-0 animate-pulse rounded bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
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
          <h2 className="text-lg font-bold text-gray-900">Agenda</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Build and manage the schedule attendees will see in Event Mode.
          </p>
        </div>
        {editable && event.timezone && (
          <Button onClick={openAdd} className="shrink-0">
            <CalendarPlus className="h-4 w-4" />
            Add Session
          </Button>
        )}
      </div>

      {manages && !event.timezone && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-warning-700">
              Set the event timezone before adding sessions. Attendees see session times in this
              timezone.
            </p>
            <a
              href={`/organizer/events/${event.id}/edit`}
              className="shrink-0 text-sm font-medium text-warning-700 underline hover:no-underline"
            >
              Set the event timezone
            </a>
          </CardContent>
        </Card>
      )}

      {archived && manages && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent>
            <p className="text-sm text-warning-700">
              This event is archived. Restore it before changing its agenda.
            </p>
          </CardContent>
        </Card>
      )}

      {actionError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </div>
      )}

      {sessions && sessions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CalendarPlus className="h-10 w-10" />}
              title="No sessions have been added yet."
              description="Build the event schedule attendees will see in Event Mode."
              action={
                editable && event.timezone ? (
                  <Button onClick={openAdd}>+ Add First Session</Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        days.map(({ key, date }) => {
          const dayList = (byDay.get(key) ?? []).slice().sort((a, b) => {
            const byStart = new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
            if (byStart !== 0) return byStart
            return a.display_order - b.display_order
          })
          const groups = sameTimeGroups(dayList)
          let groupCounter = -1
          return (
            <section key={key} className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">
                {formatDayHeading(date, timeZone)}
              </h3>
              <ol className="space-y-2">
                {dayList.map((session) => {
                  const groupIdx = groups.findIndex((g) => g.some((s) => s.id === session.id))
                  if (groupIdx !== groupCounter) groupCounter = groupIdx
                  const group = groups[groupIdx]
                  const posInGroup = group.findIndex((s) => s.id === session.id)
                  const reorderable = editable && group.length > 1 && session.status !== 'cancelled'
                  const cancelled = session.status === 'cancelled'
                  return (
                    <li
                      key={session.id}
                      className={cn(
                        'rounded-lg border p-4',
                        cancelled ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900">
                              <Clock className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                              {formatRange(
                                new Date(session.start_at),
                                session.end_at ? new Date(session.end_at) : null,
                                timeZone
                              )}
                            </span>
                            <Badge variant={SESSION_STATUS_BADGE[session.status] ?? 'default'}>
                              {SESSION_STATUS_LABELS[session.status] ?? session.status}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {SESSION_TYPE_LABELS[session.session_type] ?? 'Session'}
                            </span>
                          </div>
                          <h4
                            className={cn(
                              'mt-1 text-sm font-semibold text-gray-900',
                              cancelled && 'text-gray-400 line-through'
                            )}
                          >
                            {session.title}
                          </h4>
                          {session.location && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{session.location}</span>
                            </p>
                          )}
                          {session.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-gray-500">{session.description}</p>
                          )}
                        </div>

                        {editable && (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(session)}
                              aria-label={`Edit "${session.title}"`}
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="hidden md:inline">Edit</span>
                            </Button>
                            {!cancelled ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId === session.id}
                                onClick={() => setConfirm({ kind: 'cancel', session })}
                                aria-label={`Cancel "${session.title}"`}
                              >
                                <X className="h-4 w-4" />
                                <span className="hidden md:inline">Cancel</span>
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId === session.id}
                                onClick={() => setConfirm({ kind: 'restore', session })}
                                aria-label={`Restore "${session.title}"`}
                              >
                                <RotateCcw className="h-4 w-4" />
                                <span className="hidden md:inline">Restore</span>
                              </Button>
                            )}
                            {isDraft && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId === session.id}
                                onClick={() => setConfirm({ kind: 'delete', session })}
                                aria-label={`Delete "${session.title}"`}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="hidden md:inline">Delete</span>
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {reorderable && (
                        <div className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-2">
                          <button
                            type="button"
                            disabled={posInGroup === 0}
                            onClick={() => reorderGroup(group, session.id, posInGroup - 1)}
                            className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                            aria-label={`Move "${session.title}" earlier among same-time sessions`}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={posInGroup === group.length - 1}
                            onClick={() => reorderGroup(group, session.id, posInGroup + 1)}
                            className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                            aria-label={`Move "${session.title}" later among same-time sessions`}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <span className="ml-1 text-xs text-gray-400">
                            Ordering for these same-time sessions
                          </span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })
      )}

      {formOpen && (
        <SessionFormDialog
          event={event}
          session={editing}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSaved={handleFormSaved}
        />
      )}

      {confirm && (
        <ConfirmDialog
          state={confirm}
          busy={busyId === confirm.session.id}
          onConfirm={() => void handleConfirm()}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
