import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Info, MapPin } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { getEventExhibitor } from '@/lib/exhibitors'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { SocialLinks } from '@/components/ui/SocialLinks'
import { ComingSoonBlock, ComingSoonButton } from '@/components/events/ComingSoon'
import { ExhibitorLogo } from '@/components/organizer/EventExhibitorsPanel'

// Event Mode exhibitor detail. Looked up by id AND the event in the URL, so
// /events/<A>/exhibitors/<an-exhibitor-of-B> is a not-found rather than B's
// exhibitor rendered inside A’s shell. Public company card only — no
// contacts, representatives, or organization internals. Restyled to the Rally
// Event UI; products, downloads and booth meetings have no data yet.
export default function ExhibitorDetailPage() {
  const { exhibitorId } = useParams<{ exhibitorId: string }>()
  const { event, eventBasePath } = useEventModeOutlet()

  const [exhibitor, setExhibitor] = useState<Awaited<ReturnType<typeof getEventExhibitor>>['data']>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!exhibitorId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getEventExhibitor(event.id, exhibitorId).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(err)
      } else {
        setExhibitor(data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [event.id, exhibitorId])

  const backLink = (
    <Link
      to={`${eventBasePath}/exhibitors`}
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-rally-muted hover:text-rally-navy focus:outline-none focus-visible:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to exhibitors
    </Link>
  )

  if (loading) return <LoadingState message="Loading exhibitor…" />

  if (error || !exhibitor) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
        {backLink}
        <ErrorState message={error ?? 'Exhibitor not found.'} onRetry={() => window.location.reload()} />
      </div>
    )
  }

  // Only web addresses become links, so a malformed value cannot become a script link.
  const web = (v: string) => (/^https?:\/\//i.test(v.trim()) ? v.trim() : null)
  const website = web(exhibitor.website)
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-6">
      {backLink}

      <section className="mt-2 flex flex-col items-start gap-5 rounded-2xl border border-rally-line bg-white p-5 shadow-card sm:flex-row sm:items-center md:p-7">
        <div className="shrink-0 [&_img]:h-20 [&_img]:w-20 [&_div]:h-20 [&_div]:w-20 [&_div]:text-xl">
          <ExhibitorLogo name={exhibitor.name} logoUrl={exhibitor.logo_url} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          {exhibitor.industry && <p className="text-xs font-semibold uppercase tracking-wider text-primary-700">{exhibitor.industry}</p>}
          <h1 className="mt-1 break-words font-display text-2xl font-bold tracking-tight text-rally-navy md:text-3xl">{exhibitor.name}</h1>
          {exhibitor.booth && (
            <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-rally-navy md:text-base">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
              <span className="break-words">{exhibitor.booth}</span>
            </p>
          )}
          <SocialLinks name={exhibitor.name} handles={exhibitor} className="mt-3" />
        </div>
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 sm:w-auto"
          >
            Visit website <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-rally-navy">
              <Info className="h-5 w-5 text-primary-600" aria-hidden="true" /> About {exhibitor.name}
            </h2>
            {exhibitor.description ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 md:text-base">{exhibitor.description}</p>
            ) : (
              <p className="mt-3 text-sm text-rally-muted">This exhibitor has not added a description yet.</p>
            )}
          </section>
          <ComingSoonBlock title="Products and live showcases" description="Featured products and booth presentations will appear here." />
        </div>

        <aside className="space-y-6 lg:col-span-4">
          {exhibitor.booth && (
            <section className="rounded-2xl border border-primary-200 bg-rally-tint p-5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-primary-700">Booth / Location</h2>
              <p className="mt-1.5 break-words font-display text-lg font-semibold text-rally-navy">{exhibitor.booth}</p>
              {event.location && <p className="mt-1 text-sm text-rally-muted">{event.location}</p>}
            </section>
          )}
          <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card">
            <h2 className="mb-3 font-display text-lg font-semibold text-rally-navy">Meet at the booth</h2>
            <ComingSoonButton size="lg" className="w-full">
              Book a booth meeting
            </ComingSoonButton>
          </section>
        </aside>
      </div>
    </div>
  )
}
