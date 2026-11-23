import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/organizer/SheetDialog'
import { useAuth } from '@/context/AuthContext'
import { closeEventRegistration, reopenEventRegistration } from '@/lib/events'
import { fetchRegistrationWindows } from '@/lib/registrations'
import {
  TIMEZONE_FALLBACK_WARNING,
  organizerStatus,
  type RegistrationWindow,
} from '@/lib/registrationWindow'
import type { OrganizerEvent } from '@/lib/supabase'

// Registration open/close for one event (migration 20261104000000). The status
// is the database's own decision (get_event_registration_states), so what this
// card says is what register_for_event will do. Closing and reopening are plain
// event updates under the same policy as every other event setting: owners,
// admins and assigned event managers with an active account.
export function RegistrationWindowCard({
  event,
  canChange,
  confirmed,
  waitlisted,
  onChanged,
}: {
  event: OrganizerEvent
  // Event authority and not archived (eventCapabilities.changeLifecycle).
  canChange: boolean
  confirmed: number | null
  waitlisted: number
  // Reload the page's event after a change.
  onChanged: () => Promise<void> | void
}) {
  const { user } = useAuth()
  const [current, setCurrent] = useState<RegistrationWindow | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await fetchRegistrationWindows([event.id])
    setCurrent(data.get(event.id) ?? null)
    setLoadFailed(Boolean(loadError) || !data.has(event.id))
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load, event.registration_closed_at, event.registration_deadline])

  async function change(fn: () => Promise<{ error: string | null }>) {
    setBusy(true)
    setError(null)
    const { error: changeError } = await fn()
    setConfirming(false)
    if (changeError) {
      setError(changeError)
      setBusy(false)
      return
    }
    await load()
    setBusy(false)
    await onChanged()
  }

  const archived = event.archived_at !== null
  const closedByHand = Boolean(current?.registration_closed_at)
  const status = current ? organizerStatus(current, event, user?.id ?? null) : null
  const offerClose = canChange && current !== null && !closedByHand && current.registration_state !== 'ended'
  const offerReopen = canChange && current !== null && closedByHand

  const keepPlaces =
    confirmed === null
      ? 'Everyone already registered or on the waitlist keeps their place.'
      : `${confirmed.toLocaleString()} confirmed and ${waitlisted.toLocaleString()} waitlisted keep their places.`

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Registration</CardTitle>
        {status && <Badge variant={status.tone}>{status.label}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {current === null && !loadFailed && <p className="text-sm text-gray-500">Checking registration status…</p>}
        {current === null && loadFailed && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-600">Registration status could not be loaded.</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        {status && (
          <div className="space-y-1" aria-live="polite">
            <p className="text-sm text-gray-700">{status.detail}</p>
            {status.hint && <p className="text-sm text-gray-500">{status.hint}</p>}
          </div>
        )}

        {current?.timezone_fallback && !archived && (
          <div className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0">
              {TIMEZONE_FALLBACK_WARNING}{' '}
              {canChange && (
                <Link to={`/organizer/events/${event.id}/edit`} className="font-medium underline">
                  Set the timezone
                </Link>
              )}
            </p>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
            {error}
          </div>
        )}

        {(offerClose || offerReopen) && (
          <div className="flex flex-wrap gap-2">
            {offerClose && (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                Close registration
              </Button>
            )}
            {offerReopen && (
              <Button variant="secondary" disabled={busy} onClick={() => void change(() => reopenEventRegistration(event.id))}>
                <LockKeyholeOpen className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Reopening…' : 'Reopen registration'}
              </Button>
            )}
            {canChange && (
              <Link
                to={`/organizer/events/${event.id}/edit`}
                className="inline-flex min-h-[40px] items-center text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                {current?.registration_deadline ? 'Change the deadline' : 'Set a deadline'}
              </Link>
            )}
          </div>
        )}

        {offerReopen && current && current.registration_state !== 'closed' && current.registration_state !== 'unavailable' && (
          <p className="text-xs text-gray-500">
            Reopening removes the manual close. Registration stays closed until the reason above changes.
          </p>
        )}
        {!canChange && !archived && (
          <p className="text-xs text-gray-500">You can view registration settings but not change them.</p>
        )}
      </CardContent>

      {confirming && (
        <ConfirmDialog
          title="Close registration?"
          body={`New registrations and new waitlist entries stop now. ${keepPlaces} Cancellations still move the waitlist up, and anyone who cancels cannot register again while registration is closed. You can reopen it at any time.`}
          action="Close registration"
          busy={busy}
          onConfirm={() => void change(() => closeEventRegistration(event.id))}
          onClose={() => setConfirming(false)}
        />
      )}
    </Card>
  )
}
