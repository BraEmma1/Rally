import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Coffee,
  Filter,
  Link2,
  MapPin,
  Mic,
  MoreHorizontal,
  Pencil,
  Presentation,
  RotateCcw,
  Search,
  Trash2,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  SESSION_TYPE_LABELS,
  deleteSession,
  getEventAgenda,
  reorderSessions,
  updateSession,
  type OrganizerSession,
} from '@/lib/events'
import { listSessionSpeakers, type SessionSpeaker } from '@/lib/speakers'
import { dayKey, formatDayChip, formatTime, utcToZonedTime } from '@/lib/sessionTime'
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

// ---------------------------------------------------------------------------
// Session-type visual language. Every Rally session type keeps a badge label
// (never color alone); unknown types fall back to the neutral slate treatment.
// ---------------------------------------------------------------------------
const TYPE_STYLES: Record<string, { badge: string; dot: string; icon: ReactNode }> = {
  session: {
    badge: 'bg-violet-50 text-violet-700',
    dot: 'bg-violet-500',
    icon: <Presentation className="h-3.5 w-3.5" />,
  },
  keynote: {
    badge: 'bg-purple-50 text-purple-700',
    dot: 'bg-purple-500',
    icon: <Mic className="h-3.5 w-3.5" />,
  },
  panel: {
    badge: 'bg-accent-50 text-accent-700',
    dot: 'bg-accent-500',
    icon: <Users className="h-3.5 w-3.5" />,
  },
  workshop: {
    badge: 'bg-orange-50 text-orange-700',
    dot: 'bg-orange-500',
    icon: <Wrench className="h-3.5 w-3.5" />,
  },
  break: {
    badge: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-400',
    icon: <Coffee className="h-3.5 w-3.5" />,
  },
  networking: {
    badge: 'bg-primary-50 text-primary-700',
    dot: 'bg-primary-500',
    icon: <Link2 className="h-3.5 w-3.5" />,
  },
}

const FALLBACK_STYLE = {
  badge: 'bg-gray-100 text-gray-600',
  dot: 'bg-gray-400',
  icon: <Presentation className="h-3.5 w-3.5" />,
}

function typeStyle(sessionType: string) {
  return TYPE_STYLES[sessionType] ?? FALLBACK_STYLE
}

function typeBadgeClass(sessionType: string): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold',
    typeStyle(sessionType).badge
  )
}

// Duration derived from start/end on the fly — no stored field.
function formatDuration(startAt: string, endAt: string | null): string | null {
  if (!endAt) return null
  const mins = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)
  if (mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`
  return `${h} hr ${m} min`
}

// Compact split of "9:30 AM" into line-friendly pieces.
function splitTime(iso: string, timeZone: string | undefined): { time: string; meridiem: string } {
  const [time, meridiem = ''] = formatTime(new Date(iso), timeZone).split(' ')
  return { time, meridiem }
}

function SpeakerBits({
  speakers,
  className,
}: {
  speakers: SessionSpeaker[]
  className?: string
}) {
  if (speakers.length === 0) return null
  if (speakers.length === 1) {
    const s = speakers[0]
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
        <Avatar name={s.full_name || 'Speaker'} src={s.photo_url || null} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-gray-900">
            {s.full_name || 'Speaker'}
          </span>
          {(s.job_title || s.company) && (
            <span className="block truncate text-[11px] text-gray-500">
              {[s.job_title, s.company].filter(Boolean).join(', ')}
            </span>
          )}
        </span>
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="flex -space-x-2">
        {speakers.slice(0, 4).map((s) => (
          <span key={`${s.speaker_id}`} className="rounded-full ring-2 ring-white">
            <Avatar name={s.full_name || 'Speaker'} src={s.photo_url || null} size="xs" />
          </span>
        ))}
      </span>
      <span className="text-xs font-medium text-gray-600">
        {speakers.length} speaker{speakers.length === 1 ? '' : 's'}
      </span>
    </span>
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
  const [speakerMap, setSpeakerMap] = useState<Map<string, SessionSpeaker[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrganizerSession | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [menuSession, setMenuSession] = useState<OrganizerSession | null>(null)
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
      setLoading(false)
      return
    }
    setSessions(data)
    // Speakers are an enhancement layer: a failed load must not take the
    // agenda down, it just renders without speaker lines.
    const speakersResult = await listSessionSpeakers(event.id)
    if (!speakersResult.error) {
      const map = new Map<string, SessionSpeaker[]>()
      for (const row of speakersResult.data) {
        const list = map.get(row.session_id) ?? []
        list.push(row)
        map.set(row.session_id, list)
      }
      for (const list of map.values()) {
        list.sort((a, b) => a.display_order - b.display_order)
      }
      setSpeakerMap(map)
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

  // Keep a valid day selected as days load or change.
  useEffect(() => {
    if (days.length === 0) return
    if (selectedDay && days.some((d) => d.key === selectedDay)) return
    setSelectedDay(days[0].key)
  }, [days, selectedDay])

  const dayTypes = useMemo(() => {
    if (!sessions) return []
    const present = new Set(sessions.map((s) => s.session_type))
    return Object.entries(SESSION_TYPE_LABELS)
      .filter(([key]) => present.has(key))
      .map(([key, label]) => ({ key, label }))
  }, [sessions])

  const activeDay = days.find((d) => d.key === selectedDay) ?? null

  const daySessions = useMemo(() => {
    if (!activeDay) return []
    const query = search.trim().toLowerCase()
    return (byDay.get(activeDay.key) ?? [])
      .filter((s) => {
        if (typeFilter !== 'all' && s.session_type !== typeFilter) return false
        if (!query) return true
        const label = SESSION_TYPE_LABELS[s.session_type] ?? ''
        const speakers = speakerMap.get(s.id) ?? []
        return (
          s.title.toLowerCase().includes(query) ||
          s.location.toLowerCase().includes(query) ||
          (s.description ?? '').toLowerCase().includes(query) ||
          label.toLowerCase().includes(query) ||
          speakers.some((sp) => sp.full_name.toLowerCase().includes(query))
        )
      })
      .sort((a, b) => {
        const byStart = new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        if (byStart !== 0) return byStart
        return a.display_order - b.display_order
      })
  }, [activeDay, byDay, search, typeFilter, speakerMap])

  // Overlapping sessions share one time position: one label, one dot, stacked
  // cards, so the timeline never implies a sequence that does not exist.
  const timeGroups = useMemo(() => {
    const groups: OrganizerSession[][] = []
    let current: OrganizerSession[] = []
    let currentKey = ''
    for (const s of daySessions) {
      const key = utcToZonedTime(s.start_at, (timeZone as string) ?? '')
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
  }, [daySessions, timeZone])

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
  async function persistOrder(group: OrganizerSession[]) {
    if (!sessions) return
    const groupIds = new Set(group.map((s) => s.id))
    const before = sessions.filter((s) => !groupIds.has(s.id))
    const firstIdx = sessions.findIndex((s) => groupIds.has(s.id))
    const fullOrder = [
      ...before.slice(0, Math.max(firstIdx, 0)).map((s) => s.id),
      ...group.map((s) => s.id),
      ...before.slice(Math.max(firstIdx, 0)).map((s) => s.id),
    ]
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

  function sessionActions(session: OrganizerSession): ReactNode {
    const cancelled = session.status === 'cancelled'
    if (!cancelled) {
      return (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-error-700 hover:bg-error-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          onClick={() => {
            setMenuSession(null)
            setConfirm({ kind: 'cancel', session })
          }}
        >
          <X className="h-4 w-4" />
          Cancel session
        </button>
      )
    }
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        onClick={() => {
          setMenuSession(null)
          setConfirm({ kind: 'restore', session })
        }}
      >
        <RotateCcw className="h-4 w-4" />
        Restore session
      </button>
    )
  }

  function renderSessionCard(session: OrganizerSession, group: OrganizerSession[], posInGroup: number) {
    const cancelled = session.status === 'cancelled'
    const speakers = speakerMap.get(session.id) ?? []
    const duration = formatDuration(session.start_at, session.end_at)
    const reorderable = editable && group.length > 1 && !cancelled

    return (
      <div
        className={cn(
          'relative rounded-lg border bg-white p-4 shadow-sm',
          cancelled ? 'border-gray-200 bg-gray-50' : 'border-gray-200'
        )}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={typeBadgeClass(session.session_type)}>
                {typeStyle(session.session_type).icon}
                {SESSION_TYPE_LABELS[session.session_type] ?? 'Session'}
              </span>
              {cancelled && <Badge variant="error">Cancelled</Badge>}
              {session.status === 'live' && <Badge variant="success">Live</Badge>}
            </div>
            <h4
              className={cn(
                'mt-1.5 text-sm font-semibold leading-snug text-gray-900 md:text-[15px]',
                cancelled && 'text-gray-400 line-through'
              )}
            >
              {session.title}
            </h4>
            <p className="mt-0.5 text-xs text-gray-500 md:hidden">
              {formatTime(new Date(session.start_at), timeZone)}
              {session.end_at ? ` – ${formatTime(new Date(session.end_at), timeZone)}` : ''}
            </p>
            {session.description && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                {session.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {session.location && (
                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-gray-600">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                  <span className="truncate">{session.location}</span>
                </span>
              )}
              {duration && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                  {duration}
                </span>
              )}
              <SpeakerBits speakers={speakers} className="min-w-0 sm:ml-auto" />
            </div>
          </div>

          {editable && (
            <div className="flex shrink-0 items-center gap-1 self-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId === session.id}
                onClick={() => openEdit(session)}
                aria-label={`Edit "${session.title}"`}
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden md:inline">Edit</span>
              </Button>
              <div className="relative">
                <button
                  type="button"
                  className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  aria-label={`More actions for "${session.title}"`}
                  aria-expanded={menuSession?.id === session.id}
                  onClick={() => setMenuSession(menuSession?.id === session.id ? null : session)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuSession?.id === session.id && (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 cursor-default"
                      aria-hidden="true"
                      onClick={() => setMenuSession(null)}
                    />
                    <div className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {sessionActions(session)}
                      {isDraft && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-error-700 hover:bg-error-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          onClick={() => {
                            setMenuSession(null)
                            setConfirm({ kind: 'delete', session })
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete permanently
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              <ChevronRight
                className="hidden h-4 w-4 text-gray-300"
                aria-hidden="true"
              />
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
            <span className="ml-1 text-xs text-gray-400">Order for these same-time sessions</span>
          </div>
        )}
      </div>
    )
  }

  function renderTimelineRow(group: OrganizerSession[], isLast: boolean) {
    const first = group[0]
    const start = splitTime(first.start_at, timeZone)
    const end = first.end_at ? splitTime(first.end_at, timeZone) : null
    const dotClass = typeStyle(first.session_type).dot

    return (
      <li key={first.id} className="flex gap-3 md:gap-5">
        {/* Time column */}
        <div className="w-12 shrink-0 pt-4 md:w-20">
          <p className="text-xs font-bold leading-tight text-gray-900 md:text-sm">
            {start.time}
            {start.meridiem && (
              <span className="md:hidden">
                <br />
                {start.meridiem}
              </span>
            )}
          </p>
          {end && (
            <p className="mt-0.5 text-[11px] leading-tight text-gray-400 md:text-xs">
              {end.time}
              {end.meridiem && (
                <span className="md:hidden">
                  <br />
                  {end.meridiem}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Timeline rail + cards */}
        <div className="relative min-w-0 flex-1 pb-5">
          {!isLast && (
            <span
              className="absolute bottom-0 left-[6px] top-6 w-px bg-gray-200"
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              'absolute left-0 top-[17px] h-3 w-3 rounded-full ring-4 ring-white md:h-3.5 md:w-3.5',
              dotClass
            )}
            aria-hidden="true"
          />
          <div className="ml-6 space-y-2 md:ml-7">
            {group.map((session, i) => (
              <div key={session.id}>{renderSessionCard(session, group, i)}</div>
            ))}
          </div>
        </div>
      </li>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-hidden="true">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 w-24 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-10 w-14 shrink-0 animate-pulse rounded bg-gray-100" />
              <div className="h-28 flex-1 animate-pulse rounded-lg bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  const hasSessions = (sessions?.length ?? 0) > 0
  const filtersActive = search.trim() !== '' || typeFilter !== 'all'

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Agenda</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Build and manage the event schedule. Attendees will see this in Event Mode.
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

      {!hasSessions ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CalendarPlus className="h-10 w-10" />}
              title="No sessions have been added yet."
              description="Build the event schedule attendees will see in Event Mode."
              action={
                editable && event.timezone ? (
                  <Button onClick={openAdd}>+ Add Session</Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Date selector — one compact card per real agenda day */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
            {days.map(({ key, date }) => {
              const count = (byDay.get(key) ?? []).length
              const chip = formatDayChip(date, timeZone)
              const active = key === selectedDay
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  aria-pressed={active}
                  className={cn(
                    'flex w-24 shrink-0 flex-col items-center rounded-lg border px-3 py-2.5 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                    active
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300'
                  )}
                >
                  <span className={cn('text-xs font-semibold', active ? 'text-white' : 'text-gray-500')}>
                    {chip.weekday}
                  </span>
                  <span className="text-sm font-bold leading-tight">
                    {chip.day}{' '}
                    <span className={cn('text-xs font-medium', active ? 'text-primary-100' : 'text-gray-500')}>
                      {date.toLocaleDateString('en-US', { month: 'short', timeZone })}
                    </span>
                  </span>
                  <span className={cn('mt-0.5 text-[11px]', active ? 'text-primary-100' : 'text-gray-500')}>
                    {count} session{count === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Search + session-type filter */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sessions..."
                aria-label="Search sessions"
                className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-600"
              />
            </div>
            <div className="relative shrink-0">
              <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select
                aria-label="Filter by session type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white pl-8 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600"
              >
                <option value="all">All session types</option>
                {dayTypes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Timeline for the selected day */}
          {timeGroups.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  title={filtersActive ? 'No sessions match your filters.' : 'No sessions scheduled for this day.'}
                  description={
                    filtersActive
                      ? undefined
                      : 'Add a session to start building this day.'
                  }
                  action={
                    filtersActive ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearch('')
                          setTypeFilter('all')
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : editable && event.timezone ? (
                      <Button onClick={openAdd}>+ Add Session</Button>
                    ) : undefined
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <ol className="space-y-0">
              {timeGroups.map((group, i) => renderTimelineRow(group, i === timeGroups.length - 1))}
            </ol>
          )}
        </>
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
