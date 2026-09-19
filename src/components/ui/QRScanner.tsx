import { useEffect, useRef, useState, useCallback } from 'react'
import jsQR from 'jsqr'
import { Camera, CameraOff, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface QRScannerProps {
  onScan: (data: string) => void
  onClose: () => void
}

type ScanState = 'idle' | 'requesting' | 'scanning' | 'denied' | 'unavailable' | 'error'

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<ScanState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })
      if (code && code.data) {
        stopCamera()
        onScan(code.data)
        return
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [onScan, stopCamera])

  const startCamera = useCallback(async () => {
    setState('requesting')
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stopCamera()
        setState('error')
        setErrorMsg('Video element not available.')
        return
      }
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play()
      setState('scanning')
      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      stopCamera()
      const name = (err as Error)?.name || ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setState('denied')
      } else if (name === 'NotFoundError' || name === 'NotFoundError' || name === 'OverconstrainedError') {
        setState('unavailable')
      } else {
        setState('error')
        setErrorMsg((err as Error)?.message || 'Could not access camera.')
      }
    }
  }, [tick, stopCamera])

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="text-lg font-semibold text-white">Scan QR Code</h2>
        <button
          onClick={() => { stopCamera(); onClose() }}
          className="rounded-md p-2 text-white hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Camera viewport */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {state === 'scanning' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="h-56 w-56 rounded-lg border-2 border-white/80 shadow-lg" />
          </div>
        )}

        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
        />
        <canvas ref={canvasRef} className="hidden" />

        {state === 'requesting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <Camera className="h-8 w-8 animate-pulse" />
            <p className="text-sm">Requesting camera access…</p>
          </div>
        )}

        {(state === 'denied' || state === 'unavailable' || state === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
              <CameraOff className="h-8 w-8" />
            </div>
            {state === 'denied' && (
              <>
                <h3 className="text-lg font-semibold">Camera permission denied</h3>
                <p className="max-w-xs text-sm text-white/70">
                  Please allow camera access in your browser settings to scan QR codes.
                </p>
                <Button variant="secondary" size="sm" onClick={startCamera}>
                  Try again
                </Button>
              </>
            )}
            {state === 'unavailable' && (
              <>
                <h3 className="text-lg font-semibold">Camera unavailable</h3>
                <p className="max-w-xs text-sm text-white/70">
                  No camera was found on this device. Use the manual entry option below.
                </p>
              </>
            )}
            {state === 'error' && (
              <>
                <h3 className="text-lg font-semibold">Camera error</h3>
                <p className="max-w-xs text-sm text-white/70">{errorMsg}</p>
                <Button variant="secondary" size="sm" onClick={startCamera}>
                  Try again
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {state === 'scanning' && (
        <div className="px-4 py-4 text-center">
          <p className="text-sm text-white/70">Point your camera at a Rally QR code</p>
        </div>
      )}
    </div>
  )
}
