import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Upload, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

// Mirrors the event-banners bucket's allowed_mime_types. SVG is excluded on
// purpose: it can carry script and the bucket is served publicly.
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

interface BannerUploadProps {
  userId: string
  currentUrl: string
  onUploaded: (url: string) => void
  onClear: () => void
  disabled?: boolean
}

export function BannerUpload({ userId, currentUrl, onUploaded, onClear, disabled }: BannerUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

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

    // Timestamped name keeps every upload unique and cache-friendly; the
    // extension comes from the detected type, not the supplied filename.
    const filePath = `${userId}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('event-banners')
      .upload(filePath, file, { contentType: file.type })

    setUploading(false)

    if (uploadError) {
      setError('The image could not be uploaded. Please try again.')
      return
    }

    const { data: urlData } = supabase.storage
      .from('event-banners')
      .getPublicUrl(filePath)

    onUploaded(urlData.publicUrl)
  }

  return (
    <div>
      {currentUrl ? (
        <div className="relative overflow-hidden rounded-md border border-gray-200">
          <img src={currentUrl} alt="Event banner preview" className="h-40 w-full object-cover" />
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Remove banner image"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm transition-colors hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || disabled}
          className={cn(
            'flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors',
            'hover:border-primary-400 hover:bg-primary-50/50 hover:text-primary-700',
            'focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-60'
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <span className="text-sm font-medium">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6" aria-hidden="true" />
              <span className="text-sm font-medium">Choose banner image</span>
              <span className="text-xs text-gray-400">JPEG, PNG, WebP, or GIF · up to 5 MB</span>
            </>
          )}
        </button>
      )}

      {currentUrl && !disabled && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImageIcon className="h-4 w-4" aria-hidden="true" />}
          Replace image
        </Button>
      )}

      {error && <p className="mt-2 text-sm text-error-600">{error}</p>}

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
