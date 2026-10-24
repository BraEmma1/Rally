import { Link } from 'react-router-dom'
import { ArrowRight, Calendar, CheckCircle2, Clock, MapPin, Users } from 'lucide-react'
import type { EventRow } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { formatClock, formatDateRange } from '@/lib/utils'

interface EventCardProps {
  event: EventRow
  registered: boolean
  // On the waitlist: no seat yet.
  waitlisted?: boolean
  // At capacity: registering joins the waitlist.
  full?: boolean
  registeredCount: number
  // Past events cannot be registered for or left.
  past: boolean
  busy: boolean
  // "list" puts the image beside the text from the sm breakpoint up; on
  // phones both layouts stack.
  layout?: 'grid' | 'list'
  onRegister: () => void
  onUnregister: () => void
}

function EventImage({ event, className }: { event: EventRow; className: string }) {
  if (event.image_url) {
    return <img src={event.image_url} alt="" className={`${className} object-cover`} loading="lazy" />
  }
  // No image uploaded: a plain brand tile, not a stock photo.
  return (
    <div
      className={`${className} flex items-center justify-center bg-gradient-to-br from-primary-700 to-rally-ink text-white/70`}
      aria-hidden="true"
    >
      <Calendar className="h-10 w-10" />
    </div>
  )
}

export function EventMeta({ event }: { event: EventRow }) {
  const time = event.start_time
    ? `${formatClock(event.start_time)}${event.end_time ? ` – ${formatClock(event.end_time)}` : ''}`
    : ''
  return (
    <div className="space-y-1 text-sm text-rally-muted">
      {event.location && (
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          <span className="min-w-0">{event.location}</span>
        </p>
      )}
      {time && (
        <p className="flex items-center gap-1.5">
          <Clock className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          {time}
        </p>
      )}
    </div>
  )
}

export function RegisteredCount({ count, capacity }: { count: number; capacity: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-rally-muted">
      <Users className="h-4 w-4" aria-hidden="true" />
      {count}
      {capacity ? ` / ${capacity}` : ''} registered
    </span>
  )
}

export function WaitlistPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
      On the waitlist
    </span>
  )
}

export function RegisteredPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      Registered
    </span>
  )
}

// One event in the discovery grid. The title and image link to the event
// page; Register / Unregister keep the page's existing behaviour.
export function EventCard({
  event,
  registered,
  waitlisted = false,
  full = false,
  registeredCount,
  past,
  busy,
  layout = 'grid',
  onRegister,
  onUnregister,
}: EventCardProps) {
  const list = layout === 'list'
  return (
    <article
      className={`flex overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card transition-shadow hover:shadow-float ${
        list ? 'flex-col sm:flex-row' : 'flex-col'
      }`}
    >
      <Link
        to={`/events/${event.id}`}
        className={`relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600 ${
          list ? 'sm:w-64 sm:shrink-0 lg:w-72' : ''
        }`}
        aria-label={`View ${event.name}`}
      >
        <EventImage event={event} className={list ? 'aspect-[16/9] w-full sm:aspect-auto sm:h-full sm:min-h-[11rem]' : 'aspect-[16/9] w-full'} />
        <span className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-2.5 py-1 text-xs font-semibold text-rally-navy shadow-card">
          {formatDateRange(event.start_date, event.end_date)}
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4 md:p-5">
        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-rally-navy">
          <Link to={`/events/${event.id}`} className="-my-1.5 inline-block py-1.5 hover:text-primary-700 focus:outline-none focus-visible:underline">
            {event.name}
          </Link>
        </h3>
        <EventMeta event={event} />
        {event.description && <p className="line-clamp-2 text-sm text-slate-600">{event.description}</p>}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2">
          <div className="flex flex-col items-start gap-1.5">
            <RegisteredCount count={registeredCount} capacity={event.capacity} />
            {registered && <RegisteredPill />}
            {waitlisted && <WaitlistPill />}
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/events/${event.id}`}>
              <Button size="lg" variant={registered || past ? 'secondary' : 'outline'} className="rounded-xl">
                Details <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
            {!past &&
              (registered || waitlisted ? (
                <Button size="lg" variant="ghost" className="rounded-xl" onClick={onUnregister} disabled={busy}>
                  {waitlisted ? 'Leave waitlist' : 'Unregister'}
                </Button>
              ) : (
                <Button size="lg" className="rounded-xl" onClick={onRegister} disabled={busy}>
                  {full ? 'Join waitlist' : 'Register'}
                </Button>
              ))}
          </div>
        </div>
      </div>
    </article>
  )
}

// "Your next event": a wide card for the earliest upcoming event the person
// is registered for. Only shown when that is true; it is not a promotion.
export function NextEventCard({ event, registeredCount }: { event: EventRow; registeredCount: number }) {
  return (
    <article className="grid overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card md:grid-cols-2">
      <Link
        to={`/events/${event.id}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
        aria-label={`View ${event.name}`}
      >
        <EventImage event={event} className="aspect-[16/9] h-full w-full md:aspect-auto md:min-h-[18rem]" />
      </Link>
      <div className="flex flex-col gap-4 p-5 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-rally-tint px-2.5 py-1 text-xs font-semibold text-primary-700">Your next event</span>
          <RegisteredPill />
          <RegisteredCount count={registeredCount} capacity={event.capacity} />
        </div>
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-rally-navy md:text-3xl">
          {event.name}
        </h2>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-primary-700">
          <Calendar className="h-4 w-4" aria-hidden="true" />
          {formatDateRange(event.start_date, event.end_date)}
        </p>
        <EventMeta event={event} />
        {event.description && <p className="line-clamp-3 text-sm text-slate-600 md:text-base">{event.description}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link to={`/events/${event.id}`}>
            <Button size="lg" className="rounded-xl">
              View event details <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
          <Link to={`/events/${event.id}/home`}>
            <Button size="lg" variant="secondary" className="rounded-xl">
              Enter Event Mode
            </Button>
          </Link>
        </div>
      </div>
    </article>
  )
}
