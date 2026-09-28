import { useEffect } from 'react'
import { MapPin, X } from 'lucide-react'
import type { EventSession } from '@/lib/supabase'
import { formatRange, formatTime, formatDayHeading, isSessionLive } from '@/lib/sessionTime'
import { cn } from '@/lib/utils'

// Session row + detail dialog shared by Agenda and My Schedule so both pages
// present sessions identically. Cancelled sessions keep their row (My Schedule
// intentionally preserves bookmarks on cancelled sessions) with the same
// struck-through treatment both pages use.

export function SessionRow({
  session,
  timeZone,
  now,
  action,
  onOpen,
}: {
  session: EventSession
  timeZone: string | undefined
  now: number
  action?: React.ReactNode
  onOpen?: () => void
}) {
  const live = isSessionLive(session, now)
  const cancelled = session.status === 'cancelled'
  const start = new Date(session.start_at)
  const end = session.end_at ? new Date(session.end_at) : null

  const body = (
    <>
      <div className="w-24 shrink-0">
        <p className={cn('text-sm font-semibold', live ? 'text-primary-600' : 'text-gray-900')}>
          {formatTime(start, timeZone)}
        </p>
        {end && end.getTime() !== start.getTime() && (
          <p className="text-xs text-gray-400">{formatTime(end, timeZone)}</p>
        )}
      </div>
      <div className="min-w-0 flex-1 border-l border-gray-100 pl-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={cn(
              'text-sm font-semibold leading-snug text-gray-900',
              cancelled && 'text-gray-400 line-through'
            )}
          >
            {session.title}
          </h3>
          {live && (
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
              Now
            </span>
          )}
          {cancelled && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Cancelled
            </span>
          )}
          {!live && !cancelled && session.session_type && session.session_type !== 'session' && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium capitalize text-gray-600">
              {session.session_type}
            </span>
          )}
        </div>
        {session.location && (
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{session.location}</span>
          </p>
        )}
      </div>
    </>
  )

  return (
    <li>
      <div
        className={cn(
          'flex items-stretch gap-4 rounded-lg border bg-white p-4 transition-colors',
          live ? 'border-primary-600' : 'border-gray-200',
          onOpen && 'hover:border-primary-300'
        )}
      >
        {onOpen ? (
          <button
            onClick={onOpen}
            aria-label={`Session details: ${session.title}`}
            className="flex min-w-0 flex-1 items-stretch gap-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-stretch gap-4">{body}</div>
        )}
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </div>
    </li>
  )
}

export function SessionDetailDialog({
  session,
  timeZone,
  eventName,
  footer,
  onClose,
}: {
  session: EventSession
  timeZone: string | undefined
  eventName: string
  footer?: React.ReactNode
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
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={session.title}
    >
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-[32rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 md:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold leading-snug text-gray-900">{session.title}</h2>
          <button
            onClick={onClose}
            aria-label="Close session details"
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-400">{eventName}</p>

        <dl className="mt-4 space-y-2.5 border-t border-gray-200 pt-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-gray-500">Time</dt>
            <dd className="font-medium text-gray-900">{formatRange(start, end, timeZone)}</dd>
          </div>
          {session.location && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-gray-500">Venue</dt>
              <dd className="text-gray-900">{session.location}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-gray-500">Day</dt>
            <dd className="text-gray-900">{formatDayHeading(start, timeZone)}</dd>
          </div>
          {session.session_type && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-gray-500">Type</dt>
              <dd className="capitalize text-gray-900">{session.session_type}</dd>
            </div>
          )}
        </dl>

        {session.description && (
          <p className="mt-4 whitespace-pre-wrap border-t border-gray-200 pt-4 text-sm leading-relaxed text-gray-600">
            {session.description}
          </p>
        )}

        {footer && <div className="mt-5 border-t border-gray-200 pt-4">{footer}</div>}
      </div>
    </div>
  )
}
