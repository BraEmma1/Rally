import { useEffect, type ReactNode } from 'react'
import { CheckCircle2, MapPin, X } from 'lucide-react'
import type { EventSession } from '@/lib/supabase'
import { SESSION_TYPE_LABELS } from '@/lib/events'
import { formatRange, formatDayHeading, isSessionLive } from '@/lib/sessionTime'
import { SessionSpeakersSection } from './SessionSpeakersSection'
import type { SessionSpeaker } from '@/lib/speakers'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

// Session row + detail dialog shared by Agenda and My Schedule so both pages
// present sessions identically. Cancelled sessions keep their row (My Schedule
// intentionally preserves bookmarks on cancelled sessions) with the same
// struck-through treatment both pages use.

// One colour per kind of session, from the Rally Event UI agenda design.
const TYPE_STYLES: Record<string, string> = {
  keynote: 'bg-rally-tint text-primary-700',
  panel: 'bg-indigo-50 text-indigo-700',
  workshop: 'bg-amber-50 text-amber-800',
  networking: 'bg-emerald-50 text-emerald-700',
  break: 'bg-slate-100 text-slate-600',
  session: 'bg-slate-100 text-slate-600',
}

export function SessionTypePill({ type }: { type: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold',
        TYPE_STYLES[type] ?? TYPE_STYLES.session
      )}
    >
      {SESSION_TYPE_LABELS[type] ?? type}
    </span>
  )
}

export function SessionRow({
  session,
  timeZone,
  now,
  action,
  onOpen,
  speakers,
  notice,
}: {
  session: EventSession
  timeZone: string | undefined
  now: number
  action?: ReactNode
  onOpen?: () => void
  // Speakers for this session, shown as small chips under the title.
  speakers?: SessionSpeaker[]
  // Extra status shown beside the time, e.g. a schedule-conflict warning.
  notice?: ReactNode
}) {
  const live = isSessionLive(session, now)
  const cancelled = session.status === 'cancelled'
  const start = new Date(session.start_at)
  const end = session.end_at ? new Date(session.end_at) : null
  const finished = !live && !cancelled && (end ? end.getTime() <= now : start.getTime() < now - 3_600_000)

  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className={cn('text-sm font-semibold tabular-nums', live ? 'text-primary-700' : 'text-slate-700')}>
          {formatRange(start, end, timeZone)}
        </p>
        {session.session_type && <SessionTypePill type={session.session_type} />}
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-error-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-error-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-error-600" aria-hidden="true" /> Live now
          </span>
        )}
        {cancelled && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Cancelled
          </span>
        )}
        {finished && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Completed
          </span>
        )}
        {notice}
      </div>
      <h3
        className={cn(
          'mt-2 font-display text-base font-semibold leading-snug text-rally-navy md:text-lg',
          cancelled && 'text-slate-400 line-through',
          finished && 'text-slate-600'
        )}
      >
        {session.title}
      </h3>
      {session.description && !cancelled && (
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{session.description}</p>
      )}
      {speakers && speakers.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {speakers.slice(0, 3).map((sp) => (
            <li key={sp.speaker_id} className="flex items-center gap-2 rounded-full bg-rally-canvas py-1 pl-1 pr-3 ring-1 ring-rally-line">
              <Avatar name={sp.full_name} src={sp.photo_url || null} size="xs" />
              <span className="text-xs font-semibold text-rally-navy">{sp.full_name}</span>
              {sp.company && <span className="hidden text-xs text-slate-500 sm:inline">{sp.company}</span>}
            </li>
          ))}
          {speakers.length > 3 && <li className="self-center text-xs text-slate-500">+{speakers.length - 3} more</li>}
        </ul>
      )}
      {session.location && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
          <MapPin className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          <span className="min-w-0 truncate">{session.location}</span>
        </p>
      )}
    </div>
  )

  return (
    <li>
      <div
        className={cn(
          'flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-card transition-colors sm:flex-row sm:items-start sm:gap-4 md:p-5',
          live ? 'border-2 border-primary-600' : 'border-rally-line',
          finished && 'bg-slate-50/60',
          onOpen && !live && 'hover:border-primary-300'
        )}
      >
        {onOpen ? (
          <button
            onClick={onOpen}
            aria-label={`Session details: ${session.title}`}
            className="flex min-w-0 flex-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1">{body}</div>
        )}
        {action && <div className="flex shrink-0 items-center sm:pt-1">{action}</div>}
      </div>
    </li>
  )
}

export function SessionDetailDialog({
  session,
  timeZone,
  eventName,
  speakers,
  speakerLink,
  footer,
  onClose,
}: {
  session: EventSession
  timeZone: string | undefined
  eventName: string
  speakers?: SessionSpeaker[]
  speakerLink?: (speakerId: string) => string
  footer?: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const start = new Date(session.start_at)
  const end = session.end_at ? new Date(session.end_at) : null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={session.title}>
      <button className="absolute inset-0 bg-rally-ink/60" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-[34rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:p-6">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 md:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {session.session_type && <SessionTypePill type={session.session_type} />}
            <h2 className="mt-2 font-display text-xl font-bold leading-snug text-rally-navy">{session.title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close session details"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{eventName}</p>

        <dl className="mt-4 space-y-2.5 border-t border-rally-line pt-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-slate-500">Time</dt>
            <dd className="font-medium text-rally-navy">{formatRange(start, end, timeZone)}</dd>
          </div>
          {session.location && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-slate-500">Venue</dt>
              <dd className="text-rally-navy">{session.location}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-slate-500">Day</dt>
            <dd className="text-rally-navy">{formatDayHeading(start, timeZone)}</dd>
          </div>
        </dl>

        {session.description && (
          <p className="mt-4 whitespace-pre-wrap border-t border-rally-line pt-4 text-sm leading-relaxed text-slate-600">
            {session.description}
          </p>
        )}

        {speakers && speakerLink && speakers.length > 0 && (
          <SessionSpeakersSection speakers={speakers} speakerLink={speakerLink} />
        )}

        {footer && <div className="mt-5 border-t border-rally-line pt-4">{footer}</div>}
      </div>
    </div>
  )
}
