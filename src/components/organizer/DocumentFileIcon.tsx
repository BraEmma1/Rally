import { FileText, FileImage } from 'lucide-react'
import { cn } from '@/lib/utils'

// Small tile for a document's file type: a tinted badge with an explicit
// label, never color alone.
export function FileTypeIcon({
  mimeType,
  filename,
  className,
}: {
  mimeType: string
  filename: string
  className?: string
}) {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  let label = 'FILE'
  let tint = 'bg-gray-100 text-gray-600'
  let icon = <FileText className="h-4 w-4" />

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    label = 'PDF'
    tint = 'bg-error-50 text-error-600'
  } else if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'doc' ||
    ext === 'docx'
  ) {
    label = ext === 'doc' ? 'DOC' : 'DOCX'
    tint = 'bg-primary-50 text-primary-600'
  } else if (mimeType === 'image/jpeg' || mimeType === 'image/png' || ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
    label = ext === 'png' ? 'PNG' : 'JPG'
    tint = 'bg-accent-50 text-accent-700'
    icon = <FileImage className="h-4 w-4" />
  }

  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md text-[9px] font-bold leading-none',
        tint,
        className
      )}
      aria-label={label + ' file'}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
    </span>
  )
}
