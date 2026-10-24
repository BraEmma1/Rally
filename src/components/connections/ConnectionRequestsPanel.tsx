import { Check, Clock, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { formatRelativeDate } from '@/lib/utils'
import type { ConnectionRequest } from '@/lib/connectionRequests'

// Open connection requests: ones sent to you (Accept / Decline) and ones you sent
// (waiting, with Cancel). Used on the Connections page and in the Event Mode
// directory. All actions are callbacks, so the page owns loading and errors.
export default function ConnectionRequestsPanel({
  requests,
  busyId,
  onRespond,
  onCancel,
}: {
  requests: ConnectionRequest[]
  busyId: string | null
  onRespond: (request: ConnectionRequest, accept: boolean) => void
  onCancel: (request: ConnectionRequest) => void
}) {
  const incoming = requests.filter((r) => r.direction === 'incoming')
  const outgoing = requests.filter((r) => r.direction === 'outgoing')

  const row = (r: ConnectionRequest) => {
    const busy = busyId === r.id
    return (
      <li key={r.id} className="flex flex-col gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={r.other_full_name || '?'} src={r.other_photo_url} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-rally-navy">{r.other_full_name}</p>
            <p className="truncate text-xs text-slate-500">
              {[r.other_job_title, r.other_company].filter(Boolean).join(' · ') || 'Rally member'}
            </p>
            <p className="truncate text-xs text-slate-400">
              {r.event_name ? `${r.event_name} · ` : ''}
              {formatRelativeDate(r.created_at)}
            </p>
          </div>
        </div>
        {r.direction === 'incoming' ? (
          <div className="flex gap-2">
            <Button size="lg" className="flex-1 rounded-xl sm:flex-none" disabled={busy} onClick={() => onRespond(r, true)}>
              <Check className="h-4 w-4" aria-hidden="true" /> {busy ? 'Working…' : 'Accept'}
            </Button>
            <Button size="lg" variant="secondary" className="flex-1 rounded-xl sm:flex-none" disabled={busy} onClick={() => onRespond(r, false)}>
              <X className="h-4 w-4" aria-hidden="true" /> Decline
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Waiting for a reply
            </span>
            <Button size="lg" variant="ghost" className="rounded-xl" disabled={busy} onClick={() => onCancel(r)}>
              {busy ? 'Working…' : 'Cancel request'}
            </Button>
          </div>
        )}
      </li>
    )
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        No open connection requests. When someone sends you one, or you send one, it shows here.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {incoming.length > 0 && (
        <section aria-label="Requests sent to you">
          <h2 className="mb-2 font-display text-lg font-semibold text-rally-navy">
            Requests for you <span className="text-sm font-medium text-slate-400">({incoming.length})</span>
          </h2>
          <ul className="space-y-3">{incoming.map(row)}</ul>
        </section>
      )}
      {outgoing.length > 0 && (
        <section aria-label="Requests you sent">
          <h2 className="mb-2 font-display text-lg font-semibold text-rally-navy">
            Requests you sent <span className="text-sm font-medium text-slate-400">({outgoing.length})</span>
          </h2>
          <ul className="space-y-3">{outgoing.map(row)}</ul>
        </section>
      )}
    </div>
  )
}
