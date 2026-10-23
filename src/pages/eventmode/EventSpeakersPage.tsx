import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookmarkCheck, ChevronRight, Clock, MapPin, Mic, Search } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { getEventAgenda, type OrganizerSession } from '@/lib/events'
import { listEventSpeakers, listSessionSpeakers, type EventSpeaker, type SessionSpeaker } from '@/lib/speakers'
import { listMySavedSessionIds, removeEventSession, saveEventSession } from '@/lib/schedule'
import { formatDayHeading, formatRange } from '@/lib/sessionTime'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ComingSoonButton } from '@/components/events/ComingSoon'
import { cn } from '@/lib/utils'

// Event Mode speaker directory, from get_event_speakers. Layout follows the Rally
// Event UI "Event Speakers" design. The featured row shows speakers on keynote
// sessions, and each card's next session comes from the event's real agenda.
// Nothing here is invented: no headcounts, no live-stream flags.

type SortKey = 'name' | 'sessions'

export default function EventSpeakersPage() {
  const { event, eventBasePath } = useEventModeOutlet()
  const tz = event.timezone || undefined
  const [speakers, setSpeakers] = useState<EventSpeaker[] | null>(null)
  const [agenda, setAgenda] = useState<OrganizerSession[]>([])
  const [links, setLinks] = useState<SessionSpeaker[]>([])
  const [saved, setSaved] = useState<Set<string> | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('all')
  const [sort, setSort] = useState<SortKey>('name')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void Promise.all([
      listEventSpeakers(event.id),
      getEventAgenda(event.id),
      listSessionSpeakers(event.id),
      listMySavedSessionIds(event.id),
    ]).then(([sp, ag, ln, sv]) => {
      if (cancelled) return
      if (sp.error) {
        setError(sp.error)
        setSpeakers(null)
      } else {
        setSpeakers(sp.data)
        // Agenda, links and saved ids only enrich the page; a failure leaves them empty.
        setAgenda(ag.data)
        setLinks(ln.data)
        setSaved(sv.error ? null : sv.data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [event.id])

  const sessionsById = useMemo(() => new Map(agenda.map((s) => [s.id, s])), [agenda])

  // Each speaker's upcoming (or, failing that, latest) non-cancelled session.
  const featuredSession = useMemo(() => {
    const now = Date.now()
    const byId = new Map<string, OrganizerSession[]>()
    for (const l of links) {
      const s = sessionsById.get(l.session_id)
      if (s && s.status !== 'cancelled') byId.set(l.speaker_id, [...(byId.get(l.speaker_id) ?? []), s])
    }
    const out = new Map<string, OrganizerSession>()
    for (const [id, list] of byId) {
      list.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      out.set(id, list.find((s) => new Date(s.end_at ?? s.start_at).getTime() >= now) ?? list[list.length - 1])
    }
    return out
  }, [links, sessionsById])

  const keynoteSpeakers = useMemo(() => {
    const seen = new Set<string>()
    const out: { speaker: EventSpeaker; session: OrganizerSession }[] = []
    const byId = new Map((speakers ?? []).map((s) => [s.id, s]))
    const keynotes = agenda
      .filter((s) => s.session_type === 'keynote' && s.status !== 'cancelled')
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    for (const k of keynotes) {
      for (const l of links.filter((x) => x.session_id === k.id)) {
        const sp = byId.get(l.speaker_id)
        if (sp && !seen.has(sp.id)) {
          seen.add(sp.id)
          out.push({ speaker: sp, session: k })
        }
      }
    }
    return out.slice(0, 2)
  }, [agenda, links, speakers])

  const industries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of speakers ?? []) if (s.industry) counts.set(s.industry, (counts.get(s.industry) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [speakers])

  const needle = search.trim().toLowerCase()
  const visible = useMemo(() => {
    const list = (speakers ?? []).filter(
      (s) =>
        (industry === 'all' || s.industry === industry) &&
        (!needle ||
          `${s.full_name} ${s.job_title} ${s.company} ${s.industry}`.toLowerCase().includes(needle))
    )
    return [...list].sort((a, b) =>
      sort === 'sessions' ? b.session_count - a.session_count || a.full_name.localeCompare(b.full_name) : a.full_name.localeCompare(b.full_name)
    )
  }, [speakers, needle, industry, sort])

  async function toggleSaved(session: OrganizerSession) {
    if (!saved || pending.has(session.id)) return
    const was = saved.has(session.id)
    setActionError(null)
    setPending((p) => new Set(p).add(session.id))
    setSaved((prev) => {
      const next = new Set(prev ?? [])
      if (was) next.delete(session.id)
      else next.add(session.id)
      return next
    })
    const { error: err } = was ? await removeEventSession(session.id) : await saveEventSession(session.id)
    setPending((p) => {
      const next = new Set(p)
      next.delete(session.id)
      return next
    })
    if (err) {
      setSaved((prev) => {
        const next = new Set(prev ?? [])
        if (was) next.add(session.id)
        else next.delete(session.id)
        return next
      })
      setActionError(was ? 'Could not remove that session. Please try again.' : 'Could not save that session. Please try again.')
    }
  }

  const when = (s: OrganizerSession) =>
    `${formatDayHeading(new Date(s.start_at), tz).split(',')[0]}, ${formatRange(new Date(s.start_at), s.end_at ? new Date(s.end_at) : null, tz)}`

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Speakers"
        description={
          speakers && speakers.length > 0
            ? `Learn from ${speakers.length} speaker${speakers.length === 1 ? '' : 's'} at ${event.name}.`
            : event.name
        }
        actions={
          <ComingSoonButton size="lg" variant="secondary" className="hidden md:inline-flex">
            Download Speaker Directory
          </ComingSoonButton>
        }
      />

      {loading && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3 rounded-2xl border border-rally-line bg-white p-5">
              <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-slate-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mt-6 rounded-2xl border border-rally-line bg-white shadow-card">
          <ErrorState message={error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {!loading && !error && speakers && speakers.length === 0 && (
        <div className="mt-6 rounded-2xl border border-rally-line bg-white shadow-card">
          <EmptyState icon={<Mic className="h-10 w-10" />} title="No speakers have been announced for this event yet." />
        </div>
      )}

      {!loading && !error && speakers && speakers.length > 0 && (
        <>
          <div className="mt-5 space-y-3">
            <label className="relative block">
              <span className="sr-only">Search speakers</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search speakers by name, title or topic…"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
              />
            </label>
            {industries.length > 0 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter by industry">
                {[['all', 'All speakers', speakers.length] as const, ...industries.map(([i, n]) => [i, i, n] as const)].map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={industry === key}
                    onClick={() => setIndustry(key)}
                    className={cn(
                      'min-h-[44px] shrink-0 rounded-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                      industry === key ? 'border-primary-600 bg-primary-600 text-white' : 'border-rally-line bg-white text-rally-muted hover:border-primary-300 hover:text-rally-navy'
                    )}
                  >
                    {label} <span className={industry === key ? 'text-white/80' : 'text-slate-400'}>({n})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {actionError && (
            <p className="mt-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">
              {actionError}
            </p>
          )}

          {keynoteSpeakers.length > 0 && !needle && industry === 'all' && (
            <section className="mt-8" aria-labelledby="featured-heading">
              <h2 id="featured-heading" className="mb-3 font-display text-xl font-semibold tracking-tight text-rally-navy">
                Featured keynote spotlight
              </h2>
              <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
                {keynoteSpeakers.map(({ speaker, session }) => {
                  const isSaved = saved?.has(session.id) ?? false
                  return (
                    <article key={speaker.id} className="relative flex w-[88%] shrink-0 snap-center flex-col gap-4 rounded-2xl border border-rally-line bg-white p-5 shadow-card sm:w-[26rem] lg:w-auto">
                      {/* Keynote is a badge in the card's top-right corner. */}
                      <span className="absolute right-0 top-0 rounded-bl-xl rounded-tr-2xl bg-primary-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
                        Keynote
                      </span>
                      {/* Photo on the left; name, title and field on the right. */}
                      <div className="mt-3 flex items-center gap-4">
                        <Avatar name={speaker.full_name} src={speaker.photo_url || null} size="xl" className="h-20 w-20 shrink-0 text-xl" />
                        <div className="min-w-0">
                          <h3 className="font-display text-lg font-bold leading-snug text-rally-navy">{speaker.full_name}</h3>
                          <p className="text-sm text-rally-muted">{[speaker.job_title, speaker.company].filter(Boolean).join(', ')}</p>
                          {speaker.industry && <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-primary-700">{speaker.industry}</p>}
                        </div>
                      </div>
                      <div className="rounded-xl border border-rally-line bg-rally-canvas p-3">
                        <p className="font-semibold leading-snug text-rally-navy">{session.title}</p>
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rally-muted">
                          <Clock className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" /> {when(session)}
                        </p>
                        {session.location && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-rally-muted">
                            <MapPin className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" /> {session.location}
                          </p>
                        )}
                      </div>
                      <div className="mt-auto flex flex-wrap gap-2">
                        {saved && (
                          <Button size="lg" variant={isSaved ? 'primary' : 'outline'} className="flex-1 rounded-xl" disabled={pending.has(session.id)} onClick={() => void toggleSaved(session)}>
                            {isSaved && <BookmarkCheck className="h-4 w-4" aria-hidden="true" />}
                            {pending.has(session.id) ? 'Saving…' : isSaved ? 'Scheduled' : '+ Add to Schedule'}
                          </Button>
                        )}
                        <Link
                          to={`${eventBasePath}/speakers/${speaker.id}`}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-rally-tint px-4 text-sm font-semibold text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        >
                          View profile
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          <section className="mt-8" aria-labelledby="faculty-heading">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="faculty-heading" className="font-display text-xl font-semibold tracking-tight text-rally-navy">
                  All speakers
                </h2>
                <p className="text-sm text-rally-muted">
                  {visible.length} of {speakers.length}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-rally-muted">
                <span>Sort by</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-primary-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
                >
                  <option value="name">Name</option>
                  <option value="sessions">Most sessions</option>
                </select>
              </label>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-2xl border border-rally-line bg-white shadow-card">
                <EmptyState
                  title="No speakers match"
                  description="Try a different search or filter."
                  action={
                    <Button variant="secondary" className="rounded-xl" onClick={() => { setSearch(''); setIndustry('all') }}>
                      Clear filters
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((speaker) => {
                  const next = featuredSession.get(speaker.id)
                  return (
                    <li key={speaker.id}>
                      <Link
                        to={`${eventBasePath}/speakers/${speaker.id}`}
                        className="relative grid h-full grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card transition-shadow hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 sm:flex sm:flex-col sm:p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <Avatar name={speaker.full_name} src={speaker.photo_url || null} size="lg" />
                          {speaker.industry && (
                            <span className="hidden rounded-md bg-rally-tint px-2 py-0.5 text-[11px] font-semibold text-primary-700 sm:inline-flex">{speaker.industry}</span>
                          )}
                        </div>
                        <div className="min-w-0 self-center pr-5 sm:self-auto sm:pr-0">
                          <h3 className="font-display text-base font-semibold leading-snug text-rally-navy">{speaker.full_name}</h3>
                          <p className="text-sm text-rally-muted">{[speaker.job_title, speaker.company].filter(Boolean).join(', ') || 'Speaker'}</p>
                          {speaker.industry && (
                            <span className="mt-1.5 inline-flex rounded-md bg-rally-tint px-2 py-0.5 text-[11px] font-semibold text-primary-700 sm:hidden">{speaker.industry}</span>
                          )}
                        </div>
                        <div className="col-span-2 rounded-xl border border-rally-line bg-rally-canvas p-3 text-xs sm:mt-auto">
                          {next ? (
                            <>
                              <p className="line-clamp-2 font-semibold text-rally-navy">{next.title}</p>
                              <p className="mt-1 text-rally-muted">
                                {next.location ? `${next.location} · ` : ''}
                                {formatRange(new Date(next.start_at), null, tz)}
                              </p>
                            </>
                          ) : (
                            <p className="text-rally-muted">No sessions scheduled yet</p>
                          )}
                        </div>
                        <ChevronRight className="absolute right-3 top-6 h-5 w-5 text-slate-300 sm:hidden" aria-hidden="true" />
                        <span className="hidden items-center gap-1 text-sm font-semibold text-primary-700 sm:inline-flex">
                          Profile &amp; bio ({speaker.session_count} {speaker.session_count === 1 ? 'session' : 'sessions'})
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
