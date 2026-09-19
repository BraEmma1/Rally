import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

// Mirrors the avatars bucket's allowed_mime_types. SVG is excluded on purpose:
// it can carry script and the bucket is served publicly.
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

interface PhotoUploadProps {
  userId: string
  fullName: string
  currentPhotoUrl: string | null
  onUploaded: (url: string) => void
  size?: 'lg' | 'xl'
  className?: string
}

export function PhotoUpload({
  userId,
  fullName,
  currentPhotoUrl,
  onUploaded,
  size = 'xl',
  className,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5 MB.')
      return
    }
    const ext = EXTENSION_BY_MIME_TYPE[file.type]
    if (!ext) {
      setError('Please select a JPEG, PNG, WebP, or GIF image.')
      return
    }

    setError(null)
    setUploading(true)

    // Extension comes from the detected type, not the supplied filename.
    const filePath = `${userId}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

    onUploaded(urlData.publicUrl)
    setUploading(false)
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
      <p className="text-xs text-gray-500">Click to upload a photo</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}
