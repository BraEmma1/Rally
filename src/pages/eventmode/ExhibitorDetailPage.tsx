import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Linkedin, MapPin } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { getEventExhibitor } from '@/lib/exhibitors'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { ExhibitorLogo } from '@/components/organizer/EventExhibitorsPanel'

// Event Mode exhibitor detail. Looked up by id AND the event in the URL, so
// /events/<A>/exhibitors/<an-exhibitor-of-B> is a not-found rather than B's
// exhibitor rendered inside A’s shell. Public company card only — no
// contacts, representatives, or organization internals.
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

  if (loading) return <LoadingState message="Loading exhibitor…" />

  if (error || !exhibitor) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
        <ErrorState
          message={error ?? 'Exhibitor not found.'}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-6">
      <Link
        to={`${eventBasePath}/exhibitors`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Exhibitors
      </Link>

      <Card className="mt-4">
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <ExhibitorLogo name={exhibitor.name} logoUrl={exhibitor.logo_url} size="lg" />
          <div className="min-w-0">
            <h1 className="break-words text-lg font-bold text-gray-900 md:text-2xl">{exhibitor.name}</h1>
            {exhibitor.industry && (
              <div className="mt-1">
                <Badge variant="gray">{exhibitor.industry}</Badge>
              </div>
            )}
            {exhibitor.booth && (
              <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-gray-900">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                <span className="break-words">{exhibitor.booth}</span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {exhibitor.booth && (
        <div className="mt-4 rounded-lg border border-primary-200 bg-primary-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-700">
            Booth / Location
          </h2>
          <p className="mt-1 break-words text-sm font-medium text-gray-900">{exhibitor.booth}</p>
        </div>
      )}

      {exhibitor.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
          {exhibitor.description}
        </p>
      )}

      {(exhibitor.website || exhibitor.linkedin) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {exhibitor.website && (
            <a
              href={exhibitor.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
            >
              Visit Website
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {exhibitor.linkedin && (
            <a
              href={exhibitor.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
            >
              <Linkedin className="h-4 w-4" aria-hidden="true" />
              LinkedIn
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      )}
    </div>
  )
}
