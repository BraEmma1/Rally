import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ScanLine, QrCode, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import type { EventRow } from '@/lib/supabase'

// The CONNECT action sheet: exactly two options — Scan QR Code and My QR Code.
// Scanning hands off to the existing Event Mode connect flow (camera, lookup,
// event-scoped connection). My QR reuses the same profile-URL scheme as the
// profile page and ConnectSheet.
export default function EventConnectSheet({
  open,
  onClose,
  onScan,
  event,
}: {
  open: boolean
  onClose: () => void
  onScan: () => void
  event: EventRow
}) {
  const { profile, user } = useAuth()
  const [showMyQr, setShowMyQr] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

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
          <div className="flex flex-col items-center gap-3 pt-2">
            <Avatar name={displayName} src={profile?.photo_url} size="xl" />
            <div className="text-center">
              <p className="text-base font-semibold text-gray-900">{displayName}</p>
              {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
              <p className="mt-0.5 text-xs text-gray-400">Scan my code to connect at {event.name}</p>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 p-4">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Your Rally QR code" className="h-52 w-52" />
              ) : (
                <div className="flex h-52 w-52 items-center justify-center text-gray-300">
                  <QrCode className="h-16 w-16" aria-hidden="true" />
                </div>
              )}
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
              onClick={() => setShowMyQr(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-700">
                <QrCode className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">My QR Code</span>
                <span className="block text-xs text-gray-500">Let someone scan your code</span>
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
