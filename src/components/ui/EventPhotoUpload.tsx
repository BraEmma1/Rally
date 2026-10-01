import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { EVENT_ASSET_ACCEPT, uploadEventAsset, type EventAssetFolder } from '@/lib/uploads'
import { cn } from '@/lib/utils'

// The event-content counterpart to PhotoUpload.
//
// PhotoUpload is for a user's own avatar: one fixed object per person, upserted
// in place so the URL never changes. That is exactly wrong for a speaker photo
// or an exhibitor logo, which belongs to the event and must not collide with
// the uploader's avatar or with another record's image. This writes a fresh
// object per upload instead, and takes no user id at all -- the owning folder
// comes from the session inside uploadEventAsset.

interface EventPhotoUploadProps {
  folder: EventAssetFolder
  /** Shown as the avatar fallback while there is no image. */
  fullName: string
  currentPhotoUrl: string | null
  onUploaded: (url: string) => void
  size?: 'lg' | 'xl'
  hint?: string
  className?: string
}

export function EventPhotoUpload({
  folder,
  fullName,
  currentPhotoUrl,
  onUploaded,
  size = 'xl',
  hint = 'Click to upload a photo',
  className,
}: EventPhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setUploading(true)

    const { url, error: uploadError } = await uploadEventAsset(file, folder)

    setUploading(false)
    // Let the same file be chosen again after a failure.
    if (inputRef.current) inputRef.current.value = ''

    if (uploadError || !url) {
      setError(uploadError ?? 'The image could not be uploaded. Please try again.')
      return
    }

    onUploaded(url)
  }

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group relative rounded-full focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-2 disabled:opacity-60"
      >
        <Avatar name={fullName || '?'} src={currentPhotoUrl} size={size} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/40">
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-white opacity-0 transition-opacity group-hover:opacity-100" />
          ) : (
            <Camera className="h-6 w-6 text-white opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      </button>
      {error && <p className="text-sm text-error-600">{error}</p>}
      <p className="text-xs text-gray-500">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={EVENT_ASSET_ACCEPT}
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}
