import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Linkedin } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { listEventSpeakers, listSpeakerSessions, SPEAKER_ROLE_LABELS, type SpeakerRole } from '@/lib/speakers'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { formatDayHeading, formatRange } from '@/lib/sessionTime'
import { cn } from '@/lib/utils'

// Event Mode speaker detail: the snapshot card plus every session the speaker
// is on, each with its role label. Cancelled sessions stay listed with the
// same CANCELLED treatment as the Agenda. Times use the event's timezone;
// when unset the same honest device-timezone fallback as Agenda applies.
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

  if (loading) return <LoadingState message="Loading speaker…" />
  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    )
  }
  if (!speaker) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
        <ErrorState message="Speaker not found for this event." onRetry={() => window.location.reload()} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <Link
        to={`${eventBasePath}/speakers`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Speakers
      </Link>

      <Card className="mt-4">
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Avatar
            name={speaker?.full_name ?? 'Speaker'}
            src={speaker?.photo_url || null}
            size="xl"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900">{speaker?.full_name}</h1>
              {speaker?.user_id && <Badge variant="gray">On Rally</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              {[speaker?.job_title, speaker?.company].filter(Boolean).join(' · ')}
            </p>
            {speaker?.industry && <p className="mt-0.5 text-xs text-gray-400">{speaker.industry}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {speaker?.linkedin && (
                <a
                  href={speaker.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
                >
                  <Linkedin className="h-4 w-4" aria-hidden="true" />
                  LinkedIn
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
              {speaker?.website && (
                <a
                  href={speaker.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Website
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {speaker?.bio && (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
          {speaker.bio}
        </p>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            This speaker is not assigned to any sessions.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {sessions.map((s) => {
              const cancelled = s.status === 'cancelled'
              const sTimeZone = s.event_timezone || undefined
              return (
                <li key={`${s.session_id}-${s.speaker_role}`}>
                  <Link
                    to={`${eventBasePath}/agenda`}
                    className={cn(
                      'block rounded-lg border bg-white p-4 transition-colors hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                      cancelled ? 'border-gray-200 bg-gray-50' : 'border-gray-200'
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-gray-900">
                        {formatRange(new Date(s.start_at), s.end_at ? new Date(s.end_at) : null, sTimeZone)}
                      </span>
                      <Badge variant="default">
                        {SPEAKER_ROLE_LABELS[s.speaker_role as SpeakerRole] ?? s.speaker_role}
                      </Badge>
                      {cancelled && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          Cancelled
                        </span>
                      )}
                    </div>
                    <h3
                      className={cn(
                        'mt-1 text-sm font-semibold text-gray-900',
                        cancelled && 'text-gray-400 line-through'
                      )}
                    >
                      {s.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatDayHeading(new Date(s.start_at), sTimeZone)}
                      {s.location ? ` · ${s.location}` : ''}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
