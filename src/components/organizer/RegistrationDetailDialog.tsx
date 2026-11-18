import { useCallback, useEffect, useState } from 'react'
import { ArrowUpCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog, SheetDialog } from '@/components/organizer/SheetDialog'
import {
  fetchRegistrationDetail,
  formatAnswer,
  friendlyRegistrationError,
  organizerCancelRegistration,
  promoteWaitlistedRegistration,
} from '@/lib/registrations'
import {
  cancelConfirmCopy,
  cancelResultMessage,
  cancelUnavailableReason,
  detailStatusLabel,
  promoteUnavailableReason,
  seatsLine,
  type RegistrationDetail,
} from '@/lib/registrationManagement'

function formatDateTime(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// One attendee's registration, for the people who run the event: status, dates,
// waitlist place and what they answered on the form. Cancel and promote are
// offered only when the server says they are allowed (and it checks again).
// After a change the dialog closes and the list refreshes with the message.
export function RegistrationDetailDialog({
  eventId,
  userId,
  name,
  onClose,
  onChanged,
}: {
  eventId: string
  userId: string
  name: string
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const [detail, setDetail] = useState<RegistrationDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'cancel' | 'promote' | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await fetchRegistrationDetail(eventId, userId)
    if (error || !data) {
      setLoadError(friendlyRegistrationError(error, 'Could not load this registration.'))
      return
    }
    setDetail(data)
  }, [eventId, userId])

  useEffect(() => {
    void load()
  }, [load])

  async function cancel() {
    if (!detail) return
    setBusy('cancel')
    setActionError(null)
    const { data, error } = await organizerCancelRegistration(eventId, userId)
    setBusy(null)
    setConfirming(false)
    if (error || !data) {
      setActionError(friendlyRegistrationError(error, 'Could not cancel this registration. Please try again.'))
      void load() // the situation may have changed under us
      return
    }
    onChanged(cancelResultMessage(detail.full_name, data.previous_status, data.promoted))
  }

  async function promote() {
    if (!detail) return
    setBusy('promote')
    setActionError(null)
    const { error } = await promoteWaitlistedRegistration(eventId, userId)
    setBusy(null)
    if (error) {
      setActionError(friendlyRegistrationError(error, 'Could not promote this person. Please try again.'))
      void load()
      return
    }
    onChanged(`${detail.full_name} has a place now and has been notified.`)
  }

  const cancelWhy = detail ? cancelUnavailableReason(detail) : null
  const promoteWhy = detail ? promoteUnavailableReason(detail) : null
  const confirm = detail ? cancelConfirmCopy(detail) : null

  return (
    <SheetDialog title={detail?.full_name ?? name} subtitle="Registration" onClose={onClose} busy={busy !== null || confirming}>
      {loadError && !detail ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !detail ? (
        <LoadingState message="Loading registration…" />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-gray-500">Status</dt>
              <dd className="mt-0.5">
                <Badge
                  variant={
                    detail.status === 'cancelled' ? 'gray' : detail.checked_in_at ? 'success' : detail.status === 'waitlisted' ? 'warning' : 'default'
                  }
                >
                  {detailStatusLabel(detail)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Registered</dt>
              <dd className="mt-0.5 text-gray-900">{formatDateTime(detail.registered_at)}</dd>
            </div>
            {detail.checked_in_at && (
              <div>
                <dt className="text-xs font-medium text-gray-500">Checked in</dt>
                <dd className="mt-0.5 text-gray-900">{formatDateTime(detail.checked_in_at)}</dd>
              </div>
            )}
            {detail.status === 'cancelled' && (
              <div>
                <dt className="text-xs font-medium text-gray-500">Cancelled</dt>
                <dd className="mt-0.5 text-gray-900">
                  {formatDateTime(detail.cancelled_at)}
                  {detail.cancelled_by_organizer ? ' by an organizer' : ''}
                </dd>
              </div>
            )}
            {detail.status === 'waitlisted' && detail.waitlist_position && (
              <div>
                <dt className="text-xs font-medium text-gray-500">Waitlist</dt>
                <dd className="mt-0.5 text-gray-900">
                  Number {detail.waitlist_position} of {detail.waitlist_length}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-gray-500">Event places</dt>
              <dd className="mt-0.5 text-gray-900">{seatsLine(detail)}</dd>
            </div>
          </dl>

          <section aria-labelledby="registration-answers-heading">
            <h3 id="registration-answers-heading" className="text-sm font-semibold text-gray-900">
              Registration answers
            </h3>
            {detail.answers.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">No answers.</p>
            ) : (
              <dl className="mt-2 space-y-2">
                {detail.answers.map((a) => (
                  <div key={a.question_id}>
                    <dt className="text-xs font-medium text-gray-500">
                      {a.label}
                      {a.archived && <span className="ml-1 text-gray-400">(removed question)</span>}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-sm text-gray-900">{formatAnswer(a.answer)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {actionError && (
            <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
              {actionError}
            </p>
          )}

          {(detail.can_cancel || detail.can_promote || cancelWhy || promoteWhy) && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
              {(promoteWhy || cancelWhy) && (
                <ul className="space-y-1 text-xs text-gray-500">
                  {promoteWhy && <li>{promoteWhy}</li>}
                  {cancelWhy && <li>{cancelWhy}</li>}
                </ul>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {detail.can_cancel && (
                  <Button variant="secondary" onClick={() => setConfirming(true)} disabled={busy !== null}>
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    {detail.status === 'waitlisted' ? 'Remove from waitlist' : 'Cancel registration'}
                  </Button>
                )}
                {detail.can_promote && (
                  <Button onClick={() => void promote()} disabled={busy !== null}>
                    <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
                    {busy === 'promote' ? 'Promoting…' : 'Give them the place'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {confirming && confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          action={confirm.action}
          busy={busy === 'cancel'}
          onConfirm={() => void cancel()}
          onClose={() => setConfirming(false)}
        />
      )}
    </SheetDialog>
  )
}
