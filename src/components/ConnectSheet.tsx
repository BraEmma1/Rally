import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { X, ScanLine, Share2, Check, QrCode } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'

// Full-screen mobile Connect sheet: shows the user's own Rally QR and hands
// off to the existing scan flow. QR generation reuses the same profile-URL
// scheme as the profile page (`/p/<id>`); scanning reuses /scan?code=<id>,
// where the existing self/duplicate validation and connection flow runs.
export default function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, user } = useAuth()
  const navigate = useNavigate()
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [shared, setShared] = useState(false)

  const shareUrl = profile ? `${window.location.origin}/p/${profile.id}` : ''

  useEffect(() => {
    if (!open || !shareUrl) return
    QRCode.toDataURL(shareUrl, { width: 512, margin: 2, color: { dark: '#0A66C2', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [open, shareUrl])

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

  if (!open || !profile) return null

  const displayName = profile.full_name || user?.email || 'Your profile'
  const subtitle = [profile.job_title, profile.company].filter(Boolean).join(' at ')
  const location = profile.location

  function handleScanSomeone() {
    onClose()
    navigate('/scan')
  }

  async function handleShare() {
    if (!shareUrl) return
    try {
      if (navigator.share) {
        await navigator.share({ title: `Connect with ${displayName} on Rally`, url: shareUrl })
      } else {
        await navigator.clipboard.writeText(shareUrl)
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      }
    } catch {
      // user cancelled share or clipboard unavailable
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Connect"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-lg font-bold text-gray-900">Connect</h1>
        <button
          onClick={onClose}
          aria-label="Close connect"
          className="rounded-full p-2.5 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 pb-6">
        <Avatar name={displayName} src={profile.photo_url} size="xl" />
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">{displayName}</p>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
          {location && <p className="text-sm text-gray-400">{location}</p>}
        </div>

        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 p-5">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Your Rally QR code" className="h-56 w-56" />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center text-gray-300">
              <QrCode className="h-16 w-16" aria-hidden="true" />
            </div>
          )}
          <p className="text-sm font-medium text-gray-700">Scan to connect with me</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-200 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        <Button size="lg" className="w-full" onClick={handleScanSomeone}>
          <ScanLine className="h-5 w-5" /> Scan someone
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={handleShare}>
          {shared ? <Check className="h-5 w-5" /> : <Share2 className="h-5 w-5" />}
          {shared ? 'Link copied!' : 'Share my profile'}
        </Button>
      </div>
    </div>
  )
}
