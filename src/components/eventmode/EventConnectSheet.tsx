import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ScanLine, QrCode, Send, X, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDateRange } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import type { EventRow } from '@/lib/supabase'

// The CONNECT action sheet: Scan QR Code, Send a request (opens the attendee
// directory, where you pick the person) and My Event Pass.
// Scanning hands off to the existing Event Mode connect flow (camera, lookup,
// event-scoped connection). The pass shows this event's name, the attendee, their
// registration reference and status, with the same profile-URL QR the profile
// page uses, so scanning it connects people.
export default function EventConnectSheet({
  open,
  onClose,
  onScan,
  onSendRequest,
  event,
}: {
  open: boolean
  onClose: () => void
  onScan: () => void
  onSendRequest: () => void
  event: EventRow
}) {
  const { profile, user } = useAuth()
  const [showMyQr, setShowMyQr] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [reg, setReg] = useState<{ id: string; checked_in_at: string | null } | null>(null)

  const shareUrl = profile ? `${window.location.origin}/p/${profile.id}` : ''

  useEffect(() => {
    if (!open || !showMyQr || !shareUrl) return
    QRCode.toDataURL(shareUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#0A66C2', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [open, showMyQr, shareUrl])

  // The pass needs this person's registration for this event.
  useEffect(() => {
    if (!open || !showMyQr || !user) return
    let cancelled = false
    void supabase
      .from('event_registrations')
      .select('id, checked_in_at')
      .eq('event_id', event.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setReg((data as { id: string; checked_in_at: string | null } | null) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [open, showMyQr, user, event.id])

  // Reopening the sheet starts at the two options again.
  useEffect(() => {
    if (!open) setShowMyQr(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  const displayName = profile?.full_name || user?.email || 'Your profile'
  const subtitle = [profile?.job_title, profile?.company].filter(Boolean).join(' at ')

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Connect">
      <button className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:w-[24rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 md:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Connect</h2>
          <button
            onClick={onClose}
            aria-label="Close connect"
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {showMyQr ? (
          <div className="mt-3 overflow-hidden rounded-2xl border-2 border-primary-200">
            <div className="bg-gradient-to-br from-primary-700 to-rally-ink p-4 text-white">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Event pass</p>
              <p className="mt-0.5 font-display text-lg font-bold leading-snug">{event.name}</p>
              <p className="text-xs text-white/80">{formatDateRange(event.start_date, event.end_date)}</p>
            </div>
            <div className="flex flex-col items-center gap-3 bg-white p-4">
              <div className="flex items-center gap-3 self-stretch">
                <Avatar name={displayName} src={profile?.photo_url} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-gray-900">{displayName}</p>
                  {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Your event pass QR code" className="h-52 w-52" />
                ) : (
                  <div className="flex h-52 w-52 items-center justify-center text-gray-300">
                    <QrCode className="h-16 w-16" aria-hidden="true" />
                  </div>
                )}
              </div>
              <p className="text-center text-xs text-gray-500">Show this pass so people can scan it and connect with you.</p>
              <dl className="grid w-full grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-sm">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Pass ID</dt>
                  <dd className="font-mono font-semibold text-gray-900">{reg ? reg.id.slice(0, 8).toUpperCase() : '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status</dt>
                  <dd className="flex items-center gap-1 font-semibold text-gray-900">
                    {reg?.checked_in_at && <CheckCircle2 className="h-4 w-4 text-accent-600" aria-hidden="true" />}
                    {reg ? (reg.checked_in_at ? 'Checked in' : 'Registered') : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            <button
              onClick={onScan}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0A66C2] text-white">
                <ScanLine className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">Scan QR Code</span>
                <span className="block text-xs text-gray-500">Connect with someone here at {event.name}</span>
              </span>
            </button>
            <button
              onClick={onSendRequest}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                <Send className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">Send a request</span>
                <span className="block text-xs text-gray-500">Pick someone in the attendee directory. They accept, you connect.</span>
              </span>
            </button>
            <button
              onClick={() => setShowMyQr(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-700">
                <QrCode className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">My Event Pass</span>
                <span className="block text-xs text-gray-500">Show your pass for others to scan</span>
              </span>
            </button>
          </div>
        )}

        {showMyQr && (
          <button
            onClick={() => setShowMyQr(false)}
            className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            Back
          </button>
        )}
      </div>
    </div>
  )
}
