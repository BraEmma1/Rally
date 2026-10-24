import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Globe, Linkedin, MapPin } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { SessionTypePill } from '@/components/eventmode/SessionRow'
import { listEventSpeakers, listSpeakerSessions, SPEAKER_ROLE_LABELS, type SpeakerRole } from '@/lib/speakers'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { formatDayHeading, formatRange } from '@/lib/sessionTime'
import { cn } from '@/lib/utils'

// Event Mode speaker detail: the snapshot card plus every session the speaker
// is on, each with its role label. Cancelled sessions stay listed with the
// same CANCELLED treatment as the Agenda. Times use the event's timezone;
// when unset the same honest device-timezone fallback as Agenda applies.
// Restyled to the Rally Event UI tokens; data and behaviour are unchanged.
export default function SpeakerDetailPage() {
  const { speakerId } = useParams<{ speakerId: string }>()
  const { event, eventBasePath } = useEventModeOutlet()

  const [speaker, setSpeaker] = useState<{
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
  } | null>(null)
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listSpeakerSessions>>['data']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!speakerId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      // One directory read gives both the card and RLS-checked visibility:
      // a speaker from another event simply is not in this event's list.
      const [{ data: speakers, error: speakersErr }, { data: speakerSessions, error: sessionsErr }] =
        await Promise.all([listEventSpeakers(event.id), listSpeakerSessions(speakerId)])
      if (cancelled) return
      if (speakersErr || sessionsErr) {
        setError(speakersErr ?? sessionsErr)
      } else {
        setSpeaker(speakers.find((s) => s.id === speakerId) ?? null)
        setSessions(speakerSessions)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [event.id, speakerId])

  const backLink = (
    <Link
      to={`${eventBasePath}/speakers`}
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-rally-muted hover:text-rally-navy focus:outline-none focus-visible:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to speakers
    </Link>
  )

  if (loading) return <LoadingState message="Loading speaker…" />
  if (error || !speaker) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
        {backLink}
        <ErrorState message={error ?? 'Speaker not found for this event.'} onRetry={() => window.location.reload()} />
      </div>
    )
  }

  // The speaker record holds a LinkedIn and a website address. Only web links
  // are shown, so a malformed value can never become a script link.
  const web = (v: string) => (/^https?:\/\//i.test(v.trim()) ? v.trim() : null)
  const socials = [
    { key: 'linkedin', label: `${speaker.full_name} on LinkedIn`, href: web(speaker.linkedin), Icon: Linkedin },
    { key: 'website', label: `${speaker.full_name}'s website`, href: web(speaker.website), Icon: Globe },
  ].filter((x): x is typeof x & { href: string } => x.href !== null)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
      {backLink}

      <div className="mt-2 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <section className="flex flex-col items-start gap-5 rounded-2xl border border-rally-line bg-white p-5 shadow-card sm:flex-row sm:items-center md:p-7">
            <Avatar name={speaker.full_name} src={speaker.photo_url || null} size="xl" />
            <div className="min-w-0">
              {speaker.industry && <p className="text-xs font-semibold uppercase tracking-wider text-primary-700">{speaker.industry}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy md:text-3xl">{speaker.full_name}</h1>
                {speaker.user_id && (
                  <span className="rounded-full bg-rally-tint px-2.5 py-0.5 text-xs font-semibold text-primary-700">On Rally</span>
                )}
              </div>
              {(speaker.job_title || speaker.company) && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-rally-muted md:text-base">
                  {speaker.job_title}
                  {speaker.company && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-4 w-4 text-primary-600" aria-hidden="true" /> {speaker.company}
                    </span>
                  )}
                </p>
              )}
              {socials.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${speaker.full_name} on the web`}>
                  {socials.map(({ key, label, href, Icon }) => (
                    <li key={key}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={label}
                        title={label}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-rally-tint text-primary-700 transition-colors hover:bg-primary-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {speaker.bio && (
            <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6">
              <h2 className="font-display text-lg font-semibold text-rally-navy">Biography</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 md:text-base">{speaker.bio}</p>
            </section>
          )}
        </div>

        <section className="lg:col-span-4" aria-labelledby="speaker-sessions">
          <h2 id="speaker-sessions" className="mb-3 font-display text-lg font-semibold text-rally-navy">
            Sessions{sessions.length > 0 && ` (${sessions.length})`}
          </h2>
          {sessions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500">
              This speaker is not assigned to any sessions.
            </p>
          ) : (
            <ol className="space-y-3">
              {sessions.map((s) => {
                const cancelled = s.status === 'cancelled'
                const sTimeZone = s.event_timezone || undefined
                return (
                  <li key={`${s.session_id}-${s.speaker_role}`}>
                    <Link
                      to={`${eventBasePath}/agenda`}
                      className={cn(
                        'block rounded-2xl border bg-white p-4 shadow-card transition-colors hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                        cancelled ? 'border-rally-line bg-slate-50' : 'border-rally-line'
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold tabular-nums text-slate-700">
                          {formatRange(new Date(s.start_at), s.end_at ? new Date(s.end_at) : null, sTimeZone)}
                        </span>
                        {s.session_type && <SessionTypePill type={s.session_type} />}
                        {cancelled && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Cancelled
                          </span>
                        )}
                      </div>
                      <h3 className={cn('mt-2 font-display text-base font-semibold leading-snug text-rally-navy', cancelled && 'text-slate-400 line-through')}>
                        {s.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {SPEAKER_ROLE_LABELS[s.speaker_role as SpeakerRole] ?? s.speaker_role} · {formatDayHeading(new Date(s.start_at), sTimeZone)}
                      </p>
                      {s.location && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" /> {s.location}
                        </p>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
