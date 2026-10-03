import { useEffect, useRef, useState } from 'react'
import { Calendar, FileUp, Loader2, Lock, Globe, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { ConfirmDialog, SheetDialog } from './SheetDialog'
import { FileTypeIcon } from './DocumentFileIcon'
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  deletePartnershipDocument,
  signPartnershipDocument,
  updatePartnershipDocument,
  uploadPartnershipDocument,
  type DocumentType,
  type DocVisibility,
  type PartnershipDocument,
} from '@/lib/partnershipDocuments'
import { cn } from '@/lib/utils'

// Shared dialog layer for the Partnership Documents workspace: upload, edit
// and delete. The upload flow deliberately follows the backend's safe sequence
// (object upload -> row insert -> remove object if the row fails), which lives
// in the data layer; this UI never re-implements it.

export function UploadDocumentDialog({
  partnershipId,
  eventId,
  onClose,
  onSaved,
}: {
  partnershipId: string
  eventId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [documentType, setDocumentType] = useState<DocumentType>('sponsorship_agreement')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [documentDate, setDocumentDate] = useState('')
  const [visibility, setVisibility] = useState<DocVisibility>('internal')
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function chooseFile(next: File | null) {
    setError(null)
    if (!next) return
    if (next.size > DOCUMENT_MAX_BYTES) {
      setError('File must be 25 MB or smaller.')
      return
    }
    if (
      ![
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
      ].includes(next.type)
    ) {
      setError("This file type isn't supported.")
      return
    }
    setFile(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (uploading) return
    setError(null)
    if (!title.trim()) {
      setError('Give the document a title.')
      return
    }
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    setUploading(true)
    const { error: uploadError } = await uploadPartnershipDocument(partnershipId, eventId, file, {
      document_type: documentType,
      title: title.trim(),
      description: description.trim() || null,
      document_date: documentDate || null,
      visibility,
    })
    if (uploadError) {
      setError(uploadError)
      setUploading(false)
      return
    }
    setUploading(false)
    onSaved()
  }

  return (
    <SheetDialog
      title="Upload document"
      subtitle="Add an agreement, proposal or other document for this partnership."
      onClose={onClose}
      busy={uploading}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="doc-type">
            Document type <span className="text-error-600">*</span>
          </Label>
          <select
            id="doc-type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-600"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="doc-title">
            Title <span className="text-error-600">*</span>
          </Label>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Acme Sponsorship Agreement 2026"
            maxLength={200}
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="doc-description">Description</Label>
          <Textarea
            id="doc-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add a brief description (optional)"
          />
        </div>

        <div>
          <Label htmlFor="doc-date">Document date</Label>
          <input
            id="doc-date"
            type="date"
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <p className="mt-1 text-xs text-gray-500">
            The date on the agreement itself, if any — not the upload date.
          </p>
        </div>

        <div>
          <Label>
            File <span className="text-error-600">*</span>
          </Label>
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
              file ? 'border-primary-300 bg-primary-50/50' : 'border-gray-300 hover:bg-gray-50'
            )}
          >
            <input
              key={fileInputKey}
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                chooseFile(e.target.files?.[0] ?? null)
                setFileInputKey((k) => k + 1)
              }}
            />
            {file ? (
              <>
                <FileTypeIcon mimeType={file.type} filename={file.name} />
                <span className="mt-1 max-w-full truncate text-sm font-medium text-gray-900">
                  {file.name}
                </span>
                <span className="text-xs text-gray-500">Tap to choose a different file</span>
              </>
            ) : (
              <>
                <UploadCloud className="h-6 w-6 text-primary-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-primary-700">Tap to select a file</span>
                <span className="text-xs text-gray-500">or choose from your device</span>
                <span className="mt-1 text-xs text-gray-400">PDF, DOC, DOCX, JPG, PNG</span>
                <span className="text-xs text-gray-400">Max 25 MB</span>
              </>
            )}
          </label>
        </div>

        <fieldset>
          <legend className="label-base">
            Visibility <span className="text-error-600">*</span>
          </legend>
          <div className="space-y-2">
            <VisibilityOption
              active={visibility === 'internal'}
              onSelect={() => setVisibility('internal')}
              icon={<Lock className="h-4 w-4" aria-hidden="true" />}
              iconTint="bg-gray-100 text-gray-600"
              title="Internal"
              body="Only event management can access this document."
            />
            <VisibilityOption
              active={visibility === 'shared'}
              onSelect={() => setVisibility('shared')}
              icon={<Globe className="h-4 w-4" aria-hidden="true" />}
              iconTint="bg-accent-50 text-accent-700"
              title="Shared with partner"
              body="Event management and authorized members of the linked sponsor organization can access this document."
            />
          </div>
        </fieldset>

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button type="submit" disabled={uploading}>
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Uploading…
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" aria-hidden="true" />
                Upload document
              </>
            )}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}

function VisibilityOption({
  active,
  onSelect,
  icon,
  iconTint,
  title,
  body,
}: {
  active: boolean
  onSelect: () => void
  icon: React.ReactNode
  iconTint: string
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        active ? 'border-primary-600 bg-primary-50/50' : 'border-gray-300 hover:bg-gray-50'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-primary-600' : 'border-gray-400'
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-primary-600" />}
      </span>
      <span className={cn('mt-0.5 shrink-0', iconTint)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{body}</span>
      </span>
    </button>
  )
}

export function EditDocumentDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: PartnershipDocument
  onClose: () => void
  onSaved: () => void
}) {
  const [documentType, setDocumentType] = useState<DocumentType>(
    (DOCUMENT_TYPES as readonly string[]).includes(doc.document_type)
      ? (doc.document_type as DocumentType)
      : 'other'
  )
  const [title, setTitle] = useState(doc.title)
  const [description, setDescription] = useState(doc.description ?? '')
  const [documentDate, setDocumentDate] = useState(doc.document_date ?? '')
  const [visibility, setVisibility] = useState<DocVisibility>(doc.visibility)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!title.trim()) {
      setError('Give the document a title.')
      return
    }
    setSaving(true)
    const { error: saveError } = await updatePartnershipDocument(doc.id, {
      title: title.trim(),
      description: description.trim() || null,
      document_type: documentType,
      document_date: documentDate || null,
      visibility,
    })
    if (saveError) {
      setError(saveError)
      setSaving(false)
      return
    }
    setSaving(false)
    onSaved()
  }

  return (
    <SheetDialog title="Edit document" subtitle={doc.title} onClose={onClose} busy={saving}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="edit-doc-type">Document type</Label>
          <select
            id="edit-doc-type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-600"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="edit-doc-title">Title</Label>
          <Input
            id="edit-doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="edit-doc-description">Description</Label>
          <Textarea
            id="edit-doc-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add a brief description (optional)"
          />
        </div>

        <div>
          <Label htmlFor="edit-doc-date">Document date</Label>
          <input
            id="edit-doc-date"
            type="date"
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
        </div>

        <fieldset>
          <legend className="label-base">Visibility</legend>
          <div className="space-y-2">
            <VisibilityOption
              active={visibility === 'internal'}
              onSelect={() => setVisibility('internal')}
              icon={<Lock className="h-4 w-4" aria-hidden="true" />}
              iconTint="bg-gray-100 text-gray-600"
              title="Internal"
              body="Only event management can access this document."
            />
            <VisibilityOption
              active={visibility === 'shared'}
              onSelect={() => setVisibility('shared')}
              icon={<Globe className="h-4 w-4" aria-hidden="true" />}
              iconTint="bg-accent-50 text-accent-700"
              title="Shared with partner"
              body="Event management and authorized members of the linked sponsor organization can access this document."
            />
          </div>
        </fieldset>

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}

export function DeleteDocumentDialog({
  doc,
  onClose,
  onDeleted,
}: {
  doc: PartnershipDocument
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setError(null)
    const { error: deleteError } = await deletePartnershipDocument(doc)
    setDeleting(false)
    if (deleteError) {
      setError(deleteError)
      return
    }
    onClose()
    onDeleted()
  }

  return (
    <div>
      <ConfirmDialog
        title="Delete this document?"
        body={'"' + doc.title + '" will be permanently removed from this partnership, including the stored file. This cannot be undone.'}
        action="Delete document"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onClose={onClose}
      />
      {error && (
        <div className="fixed inset-x-4 bottom-4 z-[60] rounded-md bg-error-50 px-3 py-2 text-sm text-error-700 md:left-1/2 md:right-auto md:w-96 md:-translate-x-1/2" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/** Opens a signed URL in a new tab, with a rendered-link fallback. */
export function useDocumentOpener() {
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  async function open(storagePath: string) {
    if (busyPath) return
    setBusyPath(storagePath)
    setError(null)
    setFallbackUrl(null)
    const { url, error: signError } = await signPartnershipDocument(storagePath)
    setBusyPath(null)
    if (signError || !url) {
      setError(signError ?? 'That document could not be opened.')
      timer.current = window.setTimeout(() => setError(null), 5000)
      return
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) {
      setFallbackUrl(url)
      timer.current = window.setTimeout(() => setFallbackUrl(null), 15000)
    }
  }

  return { busyPath, fallbackUrl, error, open, dismissError: () => setError(null) }
}

export function DocumentDateText({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-300">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
      <Calendar className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
      {new Date(value + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}
    </span>
  )
}

export function UploaderChip({ name }: { name: string | null }) {
  if (!name) return <span className="text-sm text-gray-400">Unknown</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={name} src={null} size="xs" />
      <span className="truncate text-sm text-gray-700">{name}</span>
    </span>
  )
}
