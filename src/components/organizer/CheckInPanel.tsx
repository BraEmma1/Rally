import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  QrCode,
  Search,
  Undo2,
} from 'lucide-react'
import { QRScanner } from '@/components/ui/QRScanner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, Spinner } from '@/components/ui/States'
import { cn, extractProfileId } from '@/lib/utils'
import {
  checkInAttendee,
  searchCheckInRows,
  undoCheckIn,
  type CheckInRow,
} from '@/lib/checkin'
import { CheckInConfirmation, type CheckInOutcome } from '@/components/organizer/CheckInConfirmation'

// The event check-in desk. Two ways in — scan a badge QR or search the door
// list — converge on the same backend RPC, exactly as the database does.
//
// Check-in state comes from checked_in_at, never from status: undoing a
// check-in clears the timestamp but leaves the status column alone.
export function CheckInPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<CheckInRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'already' | 'error'
    title: string
    detail: string
  } | null>(null)
  const [outcome, setOutcome] = useState<CheckInOutcome | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const { data, error } = await searchCheckInRows(eventId, '')
    if (error) {
      setLoadError(error)
      return
    }
    setRows(data)
    setLoadError(null)
  }, [eventId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Debounced server-side search through find_event_attendees — the same RPC
  // that loads the list, so a stale client filter can never show someone the
  // server would not return.
  useEffect(() => {
    const handle = setTimeout(async () => {
      if (search.trim() === '') {
        await refresh()
        return
      }
      const { data, error } = await searchCheckInRows(eventId, search.trim())
      if (!error) setRows(data)
    }, 250)
    return () => clearTimeout(handle)
  }, [search, eventId, refresh])

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    }
  }, [])

  function showFeedback(kind: 'success' | 'already' | 'error', title: string, detail: string) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ kind, title, detail })
    // Errors stay up longer so staff can read them; the next scan replaces this.
    feedbackTimer.current = setTimeout(() => setFeedback(null), kind === 'error' ? 8000 : 6000)
  }

  // A scan resolves the profile id from the QR payload, then the same RPC the
  // manual path uses does the rest — authorization, registration checks and
  // duplicate handling are all enforced server-side.
  async function handleScan(data: string) {
    setScanOpen(false)
    const id = extractProfileId(data)
    if (!id) {
      showFeedback('error', 'Not a Rally code', 'That QR code is not a valid Rally profile code.')
      return
    }
    const known = rows?.find((r) => r.user_id === id)
    setProcessing(true)
    const result = await checkInAttendee(eventId, id)
    setProcessing(false)

    if (result.error) {
      if (/not registered/i.test(result.error)) {
        setOutcome({ kind: 'not-registered' })
      } else {
        showFeedback('error', 'Check-in failed', result.error)
      }
      return
    }
    if (result.already_checked_in) {
      setOutcome({
        kind: 'already',
        name: known?.full_name || 'Rally member',
        company: known?.company || undefined,
        checkedInAt: result.checked_in_at ?? new Date().toISOString(),
      })
    } else {
      setOutcome({
        kind: 'success',
        name: known?.full_name || 'Rally member',
        company: known?.company || undefined,
        checkedInAt: result.checked_in_at ?? new Date().toISOString(),
      })
    }
    await refresh()
  }

  async function checkInById(userId: string, name?: string) {
    setProcessing(true)
    const result = await checkInAttendee(eventId, userId)
    setProcessing(false)
    if (result.error) {
      const notRegistered = /not registered/i.test(result.error)
      showFeedback('error', notRegistered ? 'Not registered' : 'Check-in failed', result.error)
      return
    }
    if (result.already_checked_in) {
      showFeedback('already', 'Already checked in', `Arrived at ${formatTime(result.checked_in_at)}`)
      await refresh()
      return
    }
    showFeedback('success', name ? `${name} checked in` : 'Checked in', `Arrived at ${formatTime(result.checked_in_at)}`)
    await refresh()
  }

  async function handleUndo(userId: string) {
    setUndoing(userId)
    const { error } = await undoCheckIn(eventId, userId)
    setUndoing(null)
    if (error) {
      showFeedback('error', 'Could not undo', error)
      return
    }
    showFeedback('success', 'Check-in undone', 'They now appear as not checked in.')
    await refresh()
  }

  const total = rows?.length ?? 0
  const checkedIn = rows?.filter((r) => r.checked_in_at !== null).length ?? 0
  const notCheckedIn = total - checkedIn
  const pct = total === 0 ? 0 : Math.round((checkedIn / total) * 100)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total registered" value={total} />
        <StatCard label="Checked in" value={checkedIn} accent="text-accent-700" />
        <StatCard label="Not checked in" value={notCheckedIn} accent="text-warning-700" />
        <StatCard label="Check-in rate" value={`${pct}%`} />
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Check-in progress</span>
            <span className="font-medium text-gray-700">
              {checkedIn} of {total}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-accent-600 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => setScanOpen(true)}
          className="flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-100"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Scan attendee</p>
            <p className="text-xs text-gray-500">Open the camera and scan their Rally QR</p>
          </div>
        </button>

        <div className="relative flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <Search className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="checkin-search" className="block font-semibold text-gray-900">
              Manual check-in
            </label>
            <Input
              id="checkin-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or company…"
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-lg px-4 py-3',
            feedback.kind === 'success' && 'bg-accent-50 text-accent-800',
            feedback.kind === 'already' && 'bg-primary-50 text-primary-800',
            feedback.kind === 'error' && 'bg-error-50 text-error-800'
          )}
        >
          {feedback.kind === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
          {feedback.kind === 'already' && <Clock className="mt-0.5 h-5 w-5 shrink-0" />}
          {feedback.kind === 'error' && <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold">{feedback.title}</p>
            <p className="text-sm">{feedback.detail}</p>
          </div>
        </div>
      )}

      {/* Check-in list */}
      <Card>
        <CardContent className="py-2">
          {rows === null && !loadError && <Spinner className="mx-auto my-8" />}
          {loadError && (
            <EmptyState
              icon={<AlertCircle className="h-8 w-8" />}
              title="Could not load the list"
              description={loadError}
              action={<Button variant="secondary" onClick={() => void refresh()}>Try again</Button>}
            />
          )}
          {rows !== null && !loadError && rows.length === 0 && (
            <EmptyState
              icon={<QrCode className="h-8 w-8" />}
              title={search ? 'No matches' : 'No registrations yet'}
              description={
                search
                  ? 'Try a different name or company.'
                  : 'The door list fills in as people register for this event.'
              }
            />
          )}
          {rows !== null && !loadError && rows.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.user_id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={r.full_name || 'Attendee'} src={r.photo_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {r.full_name || 'Rally member'}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {[r.job_title, r.company].filter(Boolean).join(' · ') || 'Registered'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.checked_in_at ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Check className="h-3.5 w-3.5 text-accent-600" />
                          {formatTime(r.checked_in_at)}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={undoing === r.user_id || processing}
                          onClick={() => void handleUndo(r.user_id)}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          {undoing === r.user_id ? 'Undoing…' : 'Undo'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        disabled={processing || undoing === r.user_id || r.status === 'cancelled'}
                        onClick={() => void checkInById(r.user_id, r.full_name || undefined)}
                      >
                        Check in
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {scanOpen && <QRScanner onScan={handleScan} onClose={() => setScanOpen(false)} />}

      <CheckInConfirmation
        outcome={outcome}
        onClose={() => setOutcome(null)}
        onContinueScanning={() => {
          setOutcome(null)
          setScanOpen(true)
        }}
      />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <p className={cn('mt-1 text-2xl font-bold text-gray-900', accent)}>{value}</p>
      </CardContent>
    </Card>
  )
}

function formatTime(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
