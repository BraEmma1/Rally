import { useCallback, useEffect, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import {
  fetchRegistrationAnswers,
  formatAnswer,
  friendlyRegistrationError,
  type RegistrationAnswerRow,
} from '@/lib/registrations'

const PAGE = 25

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// What registrants answered on the registration form, newest first. Cancelled
// registrations are not listed. Visible only to people who manage the event.
export function RegistrationAnswersPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<RegistrationAnswerRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(
    async (offset: number) => {
      const { data, total: count, error: loadError } = await fetchRegistrationAnswers(eventId, PAGE, offset)
      if (loadError) {
        setError(friendlyRegistrationError(loadError, 'Could not load the answers.'))
        return false
      }
      setError(null)
      setTotal(count)
      setRows((prev) => (offset === 0 || !prev ? data : [...prev, ...data]))
      return true
    },
    [eventId]
  )

  useEffect(() => {
    setRows(null)
    void load(0)
  }, [load])

  async function more() {
    if (!rows) return
    setLoadingMore(true)
    await load(rows.length)
    setLoadingMore(false)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Registration answers</CardTitle>
        <MessageSquareText className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {error && rows === null ? (
          <ErrorState message={error} onRetry={() => void load(0)} />
        ) : rows === null ? (
          <LoadingState message="Loading answers…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<MessageSquareText className="h-8 w-8" />}
            title="No registrations yet"
            description="Answers appear here as people register."
          />
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.registration_id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{r.full_name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {[r.job_title, r.company].filter(Boolean).join(' · ') || 'Rally member'} · Registered {formatDate(r.registered_at)}
                      </p>
                    </div>
                    <Badge variant={r.registration_status === 'waitlisted' ? 'warning' : r.registration_status === 'checked_in' ? 'success' : 'default'}>
                      {r.registration_status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  {r.answers.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-400">No answers.</p>
                  ) : (
                    <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      {r.answers.map((a) => (
                        <div key={a.question_id} className="min-w-0">
                          <dt className="text-xs font-medium text-gray-500">
                            {a.label}
                            {a.archived && <span className="ml-1 text-gray-400">(removed question)</span>}
                          </dt>
                          <dd className="whitespace-pre-wrap break-words text-sm text-gray-900">{formatAnswer(a.answer)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                Showing {rows.length} of {total}
              </span>
              {rows.length < total && (
                <Button variant="secondary" size="sm" onClick={() => void more()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
            {error && <p role="alert" className="mt-2 text-xs text-error-700">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
