import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Search, Store } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { listEventExhibitors, type EventExhibitor } from '@/lib/exhibitors'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ExhibitorLogo } from '@/components/organizer/EventExhibitorsPanel'
import { cn } from '@/lib/utils'

// Event Mode exhibitor directory. Read-only, from get_event_exhibitors —
// visibility is inherited from the event through RLS, so this renders exactly
// what the backend returns and re-creates no visibility rules here.
export default function EventExhibitorsPage() {
  const { event, eventBasePath } = useEventModeOutlet()
  const [exhibitors, setExhibitors] = useState<EventExhibitor[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

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
    const set = new Set<string>()
    for (const e of exhibitors ?? []) {
      const value = e.industry.trim()
      if (value) set.add(value)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [exhibitors])

  const needle = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!exhibitors) return []
    return exhibitors.filter((e) => {
      if (industry !== 'all' && e.industry.trim() !== industry) return false
      if (!needle) return true
      return (
        e.name.toLowerCase().includes(needle) ||
        e.industry.toLowerCase().includes(needle) ||
        e.booth.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle)
      )
    })
  }, [exhibitors, needle, industry])

  const filtering = needle !== '' || industry !== 'all'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-6 md:py-6">
      <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Exhibitors</h1>
      <p className="mt-0.5 text-sm text-gray-500">{event.name}</p>

      {loading && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-gray-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
                </div>
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

      {!loading && !error && exhibitors && exhibitors.length === 0 && (
        <div className="mt-4">
          <Card>
            <CardContent>
              <EmptyState
                icon={<Store className="h-10 w-10" />}
                title="No exhibitors have been announced for this event yet."
              />
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && exhibitors && exhibitors.length > 0 && (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exhibitors..."
                className="pl-9"
                aria-label="Search exhibitors"
              />
            </div>
            {industries.length > 0 && (
              <div className="relative sm:hidden">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  aria-label="Filter by industry"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                >
                  {industry === 'all' ? 'All industries' : industry}
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </button>
                {filtersOpen && (
                  <ul className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    {['all', ...industries].map((value) => (
                      <li key={value}>
                        <button
                          type="button"
                          onClick={() => {
                            setIndustry(value)
                            setFiltersOpen(false)
                          }}
                          className={cn(
                            'block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600',
                            industry === value ? 'font-medium text-primary-700' : 'text-gray-700'
                          )}
                        >
                          {value === 'all' ? 'All industries' : value}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {industries.length > 0 && (
            <div className="mt-3 hidden flex-wrap gap-2 sm:flex">
              {['all', ...industries].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIndustry(value)}
                  aria-pressed={industry === value}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                    industry === value
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                  )}
                >
                  {value === 'all' ? 'All' : value}
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-500">No exhibitors match your search.</p>
              {filtering && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setIndustry('all')
                  }}
                  className="mt-2 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((exhibitor) => (
                <li key={exhibitor.id}>
                  <Link
                    to={`${eventBasePath}/exhibitors/${exhibitor.id}`}
                    className="flex h-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    <ExhibitorLogo name={exhibitor.name} logoUrl={exhibitor.logo_url} />
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words text-sm font-semibold text-gray-900">
                        {exhibitor.name}
                      </h2>
                      {exhibitor.industry && (
                        <p className="mt-0.5 truncate text-xs text-gray-500">{exhibitor.industry}</p>
                      )}
                      {exhibitor.booth && (
                        <p className="mt-1 break-words text-xs font-medium text-gray-700">
                          {exhibitor.booth}
                        </p>
                      )}
                      <p className="mt-1 text-xs font-medium text-primary-600">View Exhibitor →</p>
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
