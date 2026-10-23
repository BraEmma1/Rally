import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, MapPin, Search, Store } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { listEventExhibitors, type EventExhibitor } from '@/lib/exhibitors'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ExhibitorLogo } from '@/components/organizer/EventExhibitorsPanel'
import { cn } from '@/lib/utils'

// Event Mode exhibitor directory. Read-only, from get_event_exhibitors —
// visibility is inherited from the event through RLS, so this renders exactly
// what the backend returns and re-creates no visibility rules here.
// Layout follows the Rally Event UI exhibitors design; sponsor tiers, floor maps
// and booking have no data behind them yet, so they are not shown.
export default function EventExhibitorsPage() {
  const { event, eventBasePath } = useEventModeOutlet()
  const [exhibitors, setExhibitors] = useState<EventExhibitor[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listEventExhibitors(event.id).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(err)
        setExhibitors(null)
      } else {
        setExhibitors(data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [event.id])

  // Industry filter values come from this event's exhibitors only — there is
  // no global taxonomy.
  const industries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of exhibitors ?? []) {
      const value = e.industry.trim()
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [exhibitors])

  const needle = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!exhibitors) return []
    return exhibitors.filter((e) => {
      if (industry !== 'all' && e.industry.trim() !== industry) return false
      if (!needle) return true
      return `${e.name} ${e.industry} ${e.booth} ${e.description}`.toLowerCase().includes(needle)
    })
  }, [exhibitors, needle, industry])

  const filtering = needle !== '' || industry !== 'all'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-6 md:py-6">
      <PageHeader
        title="Exhibitors"
        description={
          exhibitors && exhibitors.length > 0
            ? `${exhibitors.length} organization${exhibitors.length === 1 ? '' : 's'} exhibiting at ${event.name}.`
            : event.name
        }
      />

      {loading && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-rally-line bg-white p-4">
              <div className="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-slate-100" />
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

      {!loading && !error && exhibitors && exhibitors.length === 0 && (
        <div className="mt-6 rounded-2xl border border-rally-line bg-white shadow-card">
          <EmptyState icon={<Store className="h-10 w-10" />} title="No exhibitors have been announced for this event yet." />
        </div>
      )}

      {!loading && !error && exhibitors && exhibitors.length > 0 && (
        <>
          <div className="mt-5 space-y-3">
            <label className="relative block">
              <span className="sr-only">Search exhibitors</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exhibitors by name, industry or booth…"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
              />
            </label>
            {industries.length > 0 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter by industry">
                {[['all', 'All exhibitors', exhibitors.length] as const, ...industries.map(([i, n]) => [i, i, n] as const)].map(([key, label, n]) => (
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

          <p className="mt-4 text-sm text-rally-muted" aria-live="polite">
            Showing {visible.length} of {exhibitors.length}
          </p>

          {visible.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-rally-line bg-white shadow-card">
              <EmptyState
                title="No exhibitors match"
                description="Try a different search or filter."
                action={
                  filtering ? (
                    <Button variant="secondary" className="rounded-xl" onClick={() => { setSearch(''); setIndustry('all') }}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {visible.map((exhibitor) => (
                <li key={exhibitor.id}>
                  <Link
                    to={`${eventBasePath}/exhibitors/${exhibitor.id}`}
                    className="relative flex h-full gap-4 rounded-2xl border border-rally-line bg-white p-4 shadow-card transition-shadow hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 sm:p-5"
                  >
                    <ExhibitorLogo name={exhibitor.name} logoUrl={exhibitor.logo_url} size="lg" />
                    <div className="min-w-0 flex-1 pr-5">
                      <h2 className="break-words font-display text-base font-semibold leading-snug text-rally-navy">{exhibitor.name}</h2>
                      {exhibitor.industry && (
                        <span className="mt-1.5 inline-flex rounded-md bg-rally-tint px-2 py-0.5 text-[11px] font-semibold text-primary-700">{exhibitor.industry}</span>
                      )}
                      {exhibitor.booth && (
                        <p className="mt-2 flex items-start gap-1.5 text-sm text-rally-muted">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                          <span className="break-words">{exhibitor.booth}</span>
                        </p>
                      )}
                      {exhibitor.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-slate-600">{exhibitor.description}</p>
                      )}
                    </div>
                    <ChevronRight className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300" aria-hidden="true" />
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
