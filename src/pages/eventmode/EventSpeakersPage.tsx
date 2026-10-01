import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mic, Search } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { listEventSpeakers, type EventSpeaker } from '@/lib/speakers'
import { Avatar } from '@/components/ui/Avatar'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/States'
// Event Mode speaker directory. Read-only, from get_event_speakers; the
// snapshot fields on each speaker record are the display source.
export default function EventSpeakersPage() {
  const { event, eventBasePath } = useEventModeOutlet()
  const [speakers, setSpeakers] = useState<EventSpeaker[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listEventSpeakers(event.id).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(err)
        setSpeakers(null)
      } else {
        setSpeakers(data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [event.id])

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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Speakers</h1>
      <p className="mt-0.5 text-sm text-gray-500">{event.name}</p>

      {loading && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4">
              <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <ErrorState message={error} onRetry={() => window.location.reload()} />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && speakers && speakers.length === 0 && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <EmptyState
                icon={<Mic className="h-10 w-10" />}
                title="No speakers have been announced for this event yet."
              />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && speakers && speakers.length > 0 && (
        <>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search speakers…"
              className="pl-9"
            />
          </div>

          {visible.length === 0 ? (
            <p className="mt-6 text-center text-sm text-gray-500">No speakers match your search.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {visible.map((speaker) => (
                <li key={speaker.id}>
                  <Link
                    to={`${eventBasePath}/speakers/${speaker.id}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    <Avatar name={speaker.full_name} src={speaker.photo_url || null} size="lg" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold text-gray-900">
                        {speaker.full_name}
                      </h2>
                      <p className="truncate text-xs text-gray-500">
                        {[speaker.job_title, speaker.company].filter(Boolean).join(' · ') ||
                          'Speaker'}
                      </p>
                      {speaker.industry && (
                        <p className="mt-0.5 truncate text-xs text-gray-400">{speaker.industry}</p>
                      )}
                      <p className="mt-1 text-xs font-medium text-primary-600">
                        {speaker.session_count} {speaker.session_count === 1 ? 'session' : 'sessions'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
