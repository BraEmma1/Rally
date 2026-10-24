import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  ArrowRight,
  Bookmark,
  Briefcase,
  Building2,
  CalendarPlus,
  CalendarRange,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Handshake,
  Info,
  Layers,
  Link2,
  Lock,
  MapPin,
  Mic,
  Network,
  QrCode,
  Share2,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Wallet,
  Download,
  Target,
} from 'lucide-react'
import { SESSION_TYPE_LABELS, type EventHost, type OrganizerSession } from '@/lib/events'
import type { EventRow } from '@/lib/supabase'
import type { EventSpeaker } from '@/lib/speakers'
import type { EventExhibitor } from '@/lib/exhibitors'
import { dayKey, formatDayHeading, formatRange } from '@/lib/sessionTime'
import { buildEventIcs, downloadIcs } from '@/lib/ics'
import { formatClock, formatDateRange, cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ComingSoonBadge, ComingSoonBlock, ComingSoonButton } from '@/components/events/ComingSoon'

// Event page sections, laid out as in the Rally Event UI design. Anything with a
// data source shows real data; anything without one is a clearly marked
// "coming soon" block so the layout is final and the backend can be added later.
// Sponsor tiers in particular are NOT derived from partnership records, which are
// organizer-private.

const card = 'rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6'

// A list the organizer has not filled in yet. The backend for these exists (the
// organizer adds them in the event's Agenda / Speakers / Exhibitors tabs), so this
// is an ordinary empty state, not a "coming soon" marker.
function EmptyNote({ icon, title, description }: { icon?: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
      {icon && <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-600">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  )
}

function parseDay(value: string | null): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function dayCount(event: EventRow): number {
  const s = parseDay(event.start_date)
  const e = parseDay(event.end_date) ?? s
  if (!s || !e) return 0
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
}

export function SectionCard({
  icon,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(card, className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <span className="mt-0.5 shrink-0 text-primary-600">{icon}</span>}
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight text-rally-navy md:text-xl">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-rally-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-rally-tint px-3.5 text-sm font-semibold text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
    >
      {children} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function MetaTile({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rally-line bg-rally-canvas p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-primary-600 shadow-card">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {children}
      </div>
    </div>
  )
}

export function EventHero({
  event,
  past,
  registered,
  waitlisted,
  full,
  attendeeCount,
  host,
  onRegister,
  onUnregister,
  onEnter,
}: {
  event: EventRow
  past: boolean
  registered: boolean
  // On the waitlist: no seat yet.
  waitlisted: boolean
  // At capacity: registering joins the waitlist.
  full: boolean
  attendeeCount: number
  // null until loaded, and when the event has no public host to show.
  host: EventHost | null
  onRegister: () => void
  onUnregister: () => void
  onEnter: () => void
}) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const days = dayCount(event)
  const times = event.start_time
    ? `${formatClock(event.start_time)}${event.end_time ? ` – ${formatClock(event.end_time)}` : ''}`
    : ''
  const tagline = event.description ? (/^[\s\S]*?[.!?](?=\s|$)/.exec(event.description)?.[0] ?? event.description).slice(0, 200) : ''
  const ics = buildEventIcs(event)

  async function share() {
    const url = `${window.location.origin}/events/${event.id}`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: event.name, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setShareState('copied')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // the person closed the share sheet
      setShareState('failed')
    }
    setTimeout(() => setShareState('idle'), 2500)
  }

  function addToCalendar() {
    if (!ics) return
    const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
    downloadIcs(`${slug}.ics`, ics)
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card lg:grid lg:grid-cols-5">
      <div className="relative lg:col-span-2">
        {event.image_url ? (
          <img src={event.image_url} alt="" className="h-52 w-full object-cover sm:h-72 lg:h-full lg:min-h-[26rem]" />
        ) : (
          <div
            className="flex h-40 w-full items-center justify-center bg-gradient-to-br from-primary-700 to-rally-ink text-white/70 sm:h-56 lg:h-full lg:min-h-[26rem]"
            aria-hidden="true"
          >
            <Calendar className="h-12 w-12" />
          </div>
        )}
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-lg bg-rally-ink/80 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur">
          Live broadcast <ComingSoonBadge className="bg-white/20 text-white" />
        </span>
      </div>

      <div className="flex flex-col gap-5 p-5 md:p-8 lg:col-span-3">
        <div className="space-y-3">
          {event.location && (
            <p className="hidden items-center gap-1.5 md:flex text-xs font-semibold uppercase tracking-wider text-primary-700">
              <Building2 className="h-4 w-4" aria-hidden="true" /> {event.location}
            </p>
          )}
          <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-rally-navy md:text-4xl md:leading-[1.15]">
            {event.name}
          </h1>
          {tagline && <p className="line-clamp-3 text-base text-slate-600 md:text-lg">{tagline}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MetaTile icon={<Calendar className="h-4 w-4" aria-hidden="true" />} label="Dates">
            <p className="text-sm font-semibold text-rally-navy">{formatDateRange(event.start_date, event.end_date)}</p>
            <p className="text-xs text-rally-muted">
              {[days > 0 ? `${days} full day${days === 1 ? '' : 's'}` : '', times, event.timezone || ''].filter(Boolean).join(' • ') ||
                'Times to be announced'}
            </p>
          </MetaTile>
          <MetaTile icon={<MapPin className="h-4 w-4" aria-hidden="true" />} label="Venue">
            <p className="text-sm font-semibold text-rally-navy">{event.location || 'To be announced'}</p>
          </MetaTile>
          <MetaTile icon={<Users className="h-4 w-4" aria-hidden="true" />} label="Attendance">
            <p className="text-sm font-semibold text-rally-navy">
              {attendeeCount}
              {event.capacity ? ` / ${event.capacity}` : ''} registered
            </p>
          </MetaTile>
          <MetaTile icon={<Briefcase className="h-4 w-4" aria-hidden="true" />} label="Hosted by">
            {host ? (
              <div className="flex min-w-0 items-center gap-2">
                {host.logo_url && (
                  <img src={host.logo_url} alt="" className="h-6 w-6 shrink-0 rounded border border-rally-line bg-white object-contain" loading="lazy" />
                )}
                {host.website ? (
                  <a
                    href={host.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-sm font-semibold text-primary-700 hover:underline focus:outline-none focus-visible:underline"
                  >
                    {host.name}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <p className="min-w-0 truncate text-sm font-semibold text-rally-navy">{host.name}</p>
                )}
              </div>
            ) : (
              <p className="text-sm font-semibold text-slate-500">Not listed</p>
            )}
          </MetaTile>
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex flex-wrap gap-2">
            {registered ? (
              <>
                <Button size="lg" className="rounded-xl" onClick={onEnter}>
                  Enter Event Mode <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                {/* Wallet pass: not built yet; hidden on phones to keep the actions tidy. */}
                <ComingSoonButton size="lg" variant="secondary" className="hidden md:inline-flex">
                  <Wallet className="h-4 w-4" aria-hidden="true" /> Download Digital Pass (Wallet)
                </ComingSoonButton>
              </>
            ) : (
              <>
                {!past && waitlisted && (
                  <p className="inline-flex min-h-[44px] items-center rounded-xl bg-amber-50 px-4 text-sm font-semibold text-amber-900" role="status">
                    You’re on the waitlist. We’ll register you if a place opens.
                  </p>
                )}
                {!past && !waitlisted && (
                  <Button size="lg" className="rounded-xl" onClick={onRegister}>
                    {full ? 'Join waitlist' : 'Register for Event'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                <ComingSoonButton size="lg" variant="secondary">
                  <Bookmark className="h-4 w-4" aria-hidden="true" /> Save to Watchlist
                </ComingSoonButton>
              </>
            )}
            {/* Phones: compact icon buttons. md and up: the full labels. */}
            <Button
              size="lg"
              variant="secondary"
              className="w-11 rounded-xl px-0 md:w-auto md:px-6"
              onClick={addToCalendar}
              disabled={!ics}
              aria-label="Add to calendar"
              title="Add to calendar"
            >
              <CalendarPlus className="h-5 w-5 md:h-4 md:w-4" aria-hidden="true" />
              <span className="hidden md:inline">Add to Calendar</span>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="w-11 rounded-xl px-0 md:w-auto md:border-transparent md:bg-transparent md:px-6"
              onClick={share}
              aria-label="Share event"
              title="Share event"
            >
              <Share2 className="h-5 w-5 md:h-4 md:w-4" aria-hidden="true" />
              <span className="hidden md:inline">Share Event</span>
            </Button>
            {(registered || waitlisted) && !past && (
              <Button size="lg" variant="ghost" className="rounded-xl text-slate-600" onClick={onUnregister}>
                {waitlisted ? 'Leave waitlist' : 'Unregister'}
              </Button>
            )}
          </div>
          <p className="min-h-[1.25rem] text-sm" role="status" aria-live="polite">
            {shareState === 'copied' && <span className="text-accent-700">Link copied to clipboard.</span>}
            {shareState === 'failed' && <span className="text-error-700">Could not copy the link. Copy it from the address bar.</span>}
          </p>
        </div>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
export function AboutEvent({ event }: { event: EventRow }) {
  return (
    <SectionCard icon={<Info className="h-5 w-5" aria-hidden="true" />} title="About the Event">
      {event.description ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 md:text-base">{event.description}</p>
      ) : (
        <p className="text-sm text-rally-muted">The organizer has not added a description yet.</p>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <ComingSoonBlock
          icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          title="Key focus tracks"
          description="Industry tracks and sandboxes will be listed here."
        />
        <ComingSoonBlock
          icon={<Target className="h-5 w-5" aria-hidden="true" />}
          title="Who should attend"
          description="The intended audience for this event will appear here."
        />
      </div>
      <ComingSoonBlock
        className="mt-3"
        icon={<Handshake className="h-5 w-5" aria-hidden="true" />}
        title="Dedicated deal rooms"
        description="Request a confidential 1-on-1 room slot once deal rooms are available."
      />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Agenda highlights: one card per day, from the event's real sessions
// ---------------------------------------------------------------------------
export function AgendaHighlights({
  sessions,
  registered,
  registering,
  past,
  onUnlock,
  fullAgendaPath,
}: {
  sessions: OrganizerSession[]
  registered: boolean
  registering: boolean
  past: boolean
  onUnlock: () => void
  fullAgendaPath: string
}) {
  const live = sessions
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
  const groups = new Map<string, OrganizerSession[]>()
  for (const s of live) {
    const key = dayKey(new Date(s.start_at), s.event_timezone || undefined)
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const days = [...groups.values()]
  const shown = days.slice(0, 3)
  const noZone = live.length > 0 && live.every((s) => !s.event_timezone)

  return (
    <SectionCard
      icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
      title="Event Agenda Highlights"
      subtitle={days.length > 0 ? `${days.length}-day program overview` : 'Program overview'}
      action={registered ? <ActionLink to={fullAgendaPath}>View Full Schedule</ActionLink> : undefined}
    >
      {days.length === 0 ? (
        <EmptyNote
          icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
          title="Agenda not published yet"
          description="The organizer has not added any sessions yet."
        />
      ) : (
        <ol className="space-y-3">
          {shown.map((list, i) => {
            const first = list[0]
            const tz = first.event_timezone || undefined
            const last = list[list.length - 1]
            const headline = list.find((s) => s.session_type === 'keynote') ?? first
            const types = [...new Set(list.map((s) => SESSION_TYPE_LABELS[s.session_type]).filter(Boolean))].slice(0, 2)
            const places = [...new Set(list.map((s) => s.location).filter(Boolean))].slice(0, 2)
            return (
              <li key={first.id} className="rounded-xl border border-rally-line bg-rally-canvas p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-primary-600 px-2 py-0.5 text-xs font-bold text-white">Day {i + 1}</span>
                    <span className="text-sm font-semibold text-rally-muted">{formatDayHeading(new Date(first.start_at), tz)}</span>
                  </div>
                  <span className="text-sm font-medium text-rally-muted">
                    {formatRange(new Date(first.start_at), last.end_at ? new Date(last.end_at) : new Date(last.start_at), tz)}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-base font-semibold leading-snug text-rally-navy md:text-lg">{headline.title}</h3>
                {headline.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{headline.description}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-rally-line">
                    {list.length} session{list.length === 1 ? '' : 's'}
                  </span>
                  {places.map((p) => (
                    <span key={p} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-rally-line">
                      {p}
                    </span>
                  ))}
                  {types.map((t) => (
                    <span key={t} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-rally-line">
                      {t}
                    </span>
                  ))}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {days.length > shown.length && <p className="mt-3 text-sm text-rally-muted">+ {days.length - shown.length} more days</p>}
      {noZone && <p className="mt-3 text-xs text-slate-500">Event time zone not set. Times are shown in your device's time zone.</p>}

      {!registered && !past && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-primary-300 bg-rally-tint p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-rally-navy">Your full personalized agenda unlocks after registration</p>
              <p className="text-sm text-rally-muted">Add sessions to your schedule and follow the program in Event Mode.</p>
            </div>
          </div>
          <Button className="rounded-xl" onClick={onUnlock} disabled={registering}>
            {registering ? 'Registering…' : 'Unlock Schedule'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Speakers
// ---------------------------------------------------------------------------
export function FeaturedSpeakers({
  speakers,
  registered,
  speakersPath,
}: {
  speakers: EventSpeaker[]
  registered: boolean
  speakersPath: string
}) {
  const shown = speakers.slice(0, 4)
  return (
    <SectionCard
      icon={<Mic className="h-5 w-5" aria-hidden="true" />}
      title="Featured Keynote Speakers"
      subtitle="Leading voices at this event"
      action={
        speakers.length === 0 ? undefined : registered ? (
          <ActionLink to={speakersPath}>View All {speakers.length} Speakers</ActionLink>
        ) : (
          <span className="text-sm text-rally-muted">
            {shown.length} of {speakers.length} speakers
          </span>
        )
      }
    >
      {speakers.length === 0 ? (
        <EmptyNote
          icon={<Mic className="h-5 w-5" aria-hidden="true" />}
          title="Speakers not announced yet"
          description="The organizer has not added any speakers yet."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((sp) => (
            <li key={sp.id} className="flex items-center gap-4 rounded-xl border border-rally-line bg-rally-canvas p-3">
              <Avatar name={sp.full_name || '?'} src={sp.photo_url} size="lg" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-rally-navy">{sp.full_name}</p>
                {sp.job_title && <p className="truncate text-sm font-semibold text-primary-700">{sp.job_title}</p>}
                {sp.company && <p className="truncate text-sm text-rally-muted">{sp.company}</p>}
                {sp.industry && (
                  <span className="mt-1 inline-block rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-rally-line">
                    {sp.industry}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Exhibitors & sponsors (sponsor tiers have no public data source)
// ---------------------------------------------------------------------------
export function ExhibitorsSponsors({
  exhibitors,
  registered,
  exhibitorsPath,
}: {
  exhibitors: EventExhibitor[]
  registered: boolean
  exhibitorsPath: string
}) {
  return (
    <SectionCard
      icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
      title="Exhibitors & Sponsors"
      subtitle="Organizations taking part in this event"
      action={registered && exhibitors.length > 0 ? <ActionLink to={exhibitorsPath}>All exhibitors</ActionLink> : undefined}
    >
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Store className="h-4 w-4 text-primary-600" aria-hidden="true" /> Exhibitors
      </p>
      {exhibitors.length === 0 ? (
        <EmptyNote title="Exhibitors not announced yet" description="The organizer has not added any exhibitors yet." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {exhibitors.slice(0, 6).map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-xl border border-rally-line bg-rally-canvas p-3">
              {x.logo_url ? (
                <img src={x.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-rally-line bg-white object-contain" loading="lazy" />
              ) : (
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white font-display font-bold text-primary-700 ring-1 ring-rally-line"
                  aria-hidden="true"
                >
                  {x.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-rally-navy">{x.name}</p>
                <p className="truncate text-xs text-rally-muted">{[x.industry, x.booth ? `Booth ${x.booth}` : ''].filter(Boolean).join(' · ')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-3 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <ShieldCheck className="h-4 w-4 text-primary-600" aria-hidden="true" /> Sponsors
      </p>
      <ComingSoonBlock title="Sponsor tiers" description="Diamond, Platinum and Gold sponsors will be listed here." />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// "The Rally advantage" (shown before registration)
// ---------------------------------------------------------------------------
export function RallyAdvantage() {
  const items: { icon: ReactNode; title: string; text: string; soon?: boolean }[] = [
    { icon: <Handshake className="h-5 w-5" />, title: 'Verified 1-on-1 meetings', text: 'Book confirmed sessions with the people you want to meet.', soon: true },
    { icon: <Sparkles className="h-5 w-5" />, title: 'Smart matchmaking', text: 'Introductions matched to what you are looking for.', soon: true },
    { icon: <QrCode className="h-5 w-5" />, title: 'Instant contactless badging', text: 'Swap contacts by scanning Rally QR codes, with notes saved to your network.' },
    { icon: <Network className="h-5 w-5" />, title: 'Post-event pipeline', text: 'Turn every connection into follow-ups and opportunities you can track.' },
  ]
  return (
    <SectionCard icon={<Sparkles className="h-5 w-5" aria-hidden="true" />} title="The Rally Advantage" subtitle="How Rally helps you get more from this event">
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.title} className="rounded-xl border border-rally-line bg-rally-canvas p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-primary-600 shadow-card">{it.icon}</span>
              {it.soon && <ComingSoonBadge />}
            </div>
            <p className="mt-3 font-semibold text-rally-navy">{it.title}</p>
            <p className="mt-1 text-sm text-slate-600">{it.text}</p>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

export function EventFaq() {
  return (
    <SectionCard icon={<Info className="h-5 w-5" aria-hidden="true" />} title="Pre-Registration FAQ">
      <ComingSoonBlock title="Frequently asked questions" description="Answers about passes, transfers and meeting requests will appear here." />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Sidebar cards
// ---------------------------------------------------------------------------
export function SecurePass({
  event,
  past,
  full,
  onRegister,
}: {
  event: EventRow
  past: boolean
  full: boolean
  onRegister: () => void
}) {
  return (
    <section className="rounded-2xl border-2 border-primary-200 bg-white p-5 shadow-card md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-rally-navy">Secure Your Pass</h2>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-semibold',
            past ? 'bg-slate-100 text-slate-600' : 'bg-accent-50 text-accent-700'
          )}
        >
          {past ? 'Event ended' : 'Registration open'}
        </span>
      </div>
      {past ? (
        <p className="text-sm text-rally-muted">This event has already taken place, so registration is closed.</p>
      ) : (
        <>
          <div className="rounded-xl border-2 border-primary-600 bg-rally-tint p-4">
            <p className="font-semibold text-rally-navy">Event registration</p>
            <p className="mt-0.5 text-sm text-rally-muted">Reserve your place at {event.name}.</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {['Full access to the event page and Event Mode', 'Attendee directory, agenda and your own schedule', 'QR badge for fast connections'].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-600">Investor / VIP pass</p>
              <ComingSoonBadge />
            </div>
            <p className="mt-1 text-sm text-slate-500">Additional pass tiers and pricing will appear here.</p>
          </div>
          <Button size="lg" className="mt-4 w-full rounded-xl" onClick={onRegister}>
            {full ? 'Join the waitlist' : 'Proceed to registration'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-500">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" /> Instant confirmation</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" /> Change your mind? Unregister from this page</li>
          </ul>
        </>
      )}
    </section>
  )
}

export function AttendancePass({
  holderName,
  userId,
  registrationId,
}: {
  holderName: string
  userId: string | null
  registrationId: string | null
}) {
  const [qr, setQr] = useState('')
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    QRCode.toDataURL(`${window.location.origin}/p/${userId}`, { width: 256, margin: 2, color: { dark: '#0A66C2', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setQr(url) })
      .catch(() => { if (!cancelled) setQr('') })
    return () => {
      cancelled = true
    }
  }, [userId])

  const row = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <dt className="text-rally-muted">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-rally-navy">{value}</dd>
    </div>
  )
  return (
    <section className="relative rounded-2xl border-2 border-primary-200 bg-white p-5 shadow-card md:p-6">
      <span className="absolute -top-3 right-5 rounded-md bg-primary-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
        Official credential
      </span>
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-rally-navy">
        <QrCode className="h-5 w-5 text-primary-600" aria-hidden="true" /> Your Attendance Pass
      </h2>
      <div className="rounded-xl bg-rally-tint p-4 text-center">
        {qr ? (
          <img src={qr} alt="Your Rally QR code" className="mx-auto h-44 w-44 rounded-lg bg-white p-1" />
        ) : (
          <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-lg bg-white text-sm text-slate-400">QR unavailable</div>
        )}
        <p className="mt-3 font-mono text-xs font-semibold text-primary-700">
          {registrationId ? registrationId.slice(0, 8).toUpperCase() : '—'}
        </p>
        <p className="text-xs text-rally-muted">Your Rally QR code. Others can scan it to connect with you.</p>
      </div>
      <dl className="mt-3 divide-y divide-rally-line">
        {row('Pass holder', holderName || 'Registered account')}
        {row('Tier', <span className="inline-flex items-center gap-2 text-slate-500">— <ComingSoonBadge /></span>)}
        {row('Entitlements', <span className="inline-flex items-center gap-2 text-slate-500">— <ComingSoonBadge /></span>)}
      </dl>
      <ComingSoonButton variant="secondary" className="mt-3 w-full">
        <Download className="h-4 w-4" aria-hidden="true" /> Save Offline Pass (.PKPASS)
      </ComingSoonButton>
    </section>
  )
}

export function VenueLogistics({ event }: { event: EventRow }) {
  const mapsUrl = event.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}` : null
  return (
    <section className={card}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-rally-navy">
          <Building2 className="h-5 w-5 text-primary-600" aria-hidden="true" /> Venue &amp; Logistics
        </h2>
        {event.location && <span className="max-w-[10rem] truncate text-sm text-rally-muted">{event.location}</span>}
      </div>
      <div
        className="flex h-32 items-center justify-center rounded-xl bg-gradient-to-br from-rally-tint to-primary-100 text-primary-600"
        aria-hidden="true"
      >
        <MapPin className="h-8 w-8" />
      </div>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline"
        >
          Open in Maps <ExternalLink className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      <ComingSoonBlock className="mt-3" title="Shuttles, parking and partner hotels" description="Travel and accommodation details will be listed here." />
      <ComingSoonButton variant="ghost" className="mt-3 w-full">
        <Link2 className="h-4 w-4" aria-hidden="true" /> View Full Logistics &amp; Travel Guide
      </ComingSoonButton>
    </section>
  )
}

export function WhoYouCanMeet({
  attendeeCount,
  registered,
  networkPath,
}: {
  attendeeCount: number
  registered: boolean
  networkPath: string
}) {
  return (
    <section className={card}>
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-rally-navy">
        <Users className="h-5 w-5 text-primary-600" aria-hidden="true" /> {registered ? 'Who You Can Meet' : 'Your Network'}
      </h2>
      <div className="rounded-xl bg-rally-tint p-4">
        <p className="text-sm font-semibold text-rally-navy">
          {attendeeCount} {attendeeCount === 1 ? 'person' : 'people'} registered
        </p>
        <p className="mt-0.5 text-sm text-rally-muted">
          {registered ? 'Browse the attendee directory to start connecting.' : 'Register to see who is attending.'}
        </p>
      </div>
      <ComingSoonBlock className="mt-3" icon={<Sparkles className="h-5 w-5" aria-hidden="true" />} title="Smart matches" description="Suggested people to meet will appear here." />
      {registered ? (
        <Link
          to={networkPath}
          className="mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-primary-600 px-4 text-sm font-semibold text-primary-700 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          <Users className="h-4 w-4" aria-hidden="true" /> Explore Attendee Directory
        </Link>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-primary-300 bg-white p-3 text-sm text-rally-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          Register to unlock the attendee directory and 1-on-1 meeting requests.
        </div>
      )}
    </section>
  )
}
