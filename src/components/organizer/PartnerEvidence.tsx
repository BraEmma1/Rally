import { useState } from 'react'
import { ExternalLink, FileText, Link2, Loader2, StickyNote, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { displayUrl } from '@/lib/utils'
import {
  EVIDENCE_ACCEPT,
  addNoteEvidence,
  addUrlEvidence,
  deleteEvidence,
  evidenceFileName,
  signEvidenceFile,
  uploadFileEvidence,
  type Evidence,
  type EvidenceKind,
  type Obligation,
} from '@/lib/partnerships'
import { safeWebUrl } from './PartnerCommon'
import { ConfirmDialog, SheetDialog } from './SheetDialog'

// Evidence belongs to an obligation, never to the partnership at large, so
// both of these take the obligation as their context. The Evidence tab groups
// the same rows by obligation rather than becoming a file manager.
//
// Files live in the PRIVATE partnership-assets bucket. The row stores the
// object PATH; a signed URL is minted when somebody actually opens the file
// and is never written to the database -- a stored signed URL is an access
// grant that outlives the decision to grant it.

const KINDS: { kind: EvidenceKind; label: string; icon: typeof Upload }[] = [
  { kind: 'file', label: 'Upload File', icon: Upload },
  { kind: 'url', label: 'Add Link', icon: Link2 },
  { kind: 'note', label: 'Add Note', icon: StickyNote },
]

export function AddEvidenceDialog({
  obligation,
  onClose,
  onSaved,
}: {
  obligation: Obligation
  onClose: () => void
  onSaved: () => void
}) {
  const [kind, setKind] = useState<EvidenceKind>('file')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)

    if (kind === 'file' && !file) {
      setError('Choose a file to upload.')
      return
    }
    const safeUrl = kind === 'url' ? safeWebUrl(url) : null
    if (kind === 'url' && !safeUrl) {
      setError('Enter a full link, such as https://facebook.com/your-post')
      return
    }
    if (kind === 'note' && !note.trim()) {
      setError('Write the note you want to record.')
      return
    }

    setSaving(true)
    const result =
      kind === 'file'
        ? await uploadFileEvidence(obligation, file as File)
        : kind === 'url'
          ? await addUrlEvidence(obligation, safeUrl as string)
          : await addNoteEvidence(obligation, note.trim())

    if (result.error) {
      setError(result.error)
      setSaving(false)
      return
    }
    setSaving(false)
    onSaved()
  }

  return (
    <SheetDialog
      title="Add Evidence"
      subtitle={obligation.title}
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="label-base">What are you adding?</legend>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((option) => {
              const Icon = option.icon
              const active = kind === option.kind
              return (
                <button
                  key={option.kind}
                  type="button"
                  onClick={() => {
                    setKind(option.kind)
                    setError(null)
                  }}
                  aria-pressed={active}
                  className={
                    'flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs font-medium transition-colors ' +
                    (active
                      ? 'border-primary-600 bg-primary-50 text-primary-800'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50')
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {option.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {kind === 'file' && (
          <div>
            <Label htmlFor="ev-file">File</Label>
            <input
              id="ev-file"
              type="file"
              accept={EVIDENCE_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700"
            />
            <p className="mt-1 text-xs text-gray-500">
              PDF or image, up to 10 MB. Stored privately — only people who manage this event can
              open it.
            </p>
          </div>
        )}

        {kind === 'url' && (
          <div>
            <Label htmlFor="ev-url">Link</Label>
            <Input
              id="ev-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://facebook.com/your-post"
              autoFocus
            />
          </div>
        )}

        {kind === 'note' && (
          <div>
            <Label htmlFor="ev-note">Note</Label>
            <Textarea
              id="ev-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Displayed throughout the main stage."
              autoFocus
            />
          </div>
        )}

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
            {saving ? 'Saving…' : 'Add evidence'}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}

export function EvidenceItems({
  items,
  editable,
  onRemoved,
}: {
  items: Evidence[]
  editable: boolean
  onRemoved: () => void
}) {
  const [confirm, setConfirm] = useState<Evidence | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!confirm) return
    setRemoving(true)
    const { error: removeError } = await deleteEvidence(confirm)
    setRemoving(false)
    setConfirm(null)
    if (removeError) {
      setError(removeError)
      return
    }
    setError(null)
    onRemoved()
  }

  if (items.length === 0) return null

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2"
        >
          <div className="min-w-0 flex-1">
            {item.kind === 'file' && <EvidenceFile evidence={item} />}
            {item.kind === 'url' && item.external_url && (
              <a
                href={item.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{displayUrl(item.external_url)}</span>
              </a>
            )}
            {item.kind === 'note' && item.note && (
              <p className="flex gap-1.5 whitespace-pre-wrap text-sm text-gray-700">
                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="min-w-0">{item.note}</span>
              </p>
            )}
          </div>
          {editable && (
            <button
              type="button"
              onClick={() => setConfirm(item)}
              aria-label={'Remove this ' + item.kind + ' evidence'}
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-white hover:text-error-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {error && (
        <p className="text-xs text-error-600" role="alert">
          {error}
        </p>
      )}

      {confirm && (
        <ConfirmDialog
          busy={removing}
          title="Remove this evidence?"
          body={
            confirm.kind === 'file'
              ? 'The record and the stored file are both removed. This cannot be undone.'
              : 'This removes the record of it. This cannot be undone.'
          }
          action="Remove"
          onConfirm={() => void remove()}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

/**
 * A private file is signed only when somebody asks to open it.
 *
 * `window.open` after an await loses the user-activation in some browsers, so
 * a blocked popup is treated as an expected outcome: the signed link is
 * rendered instead of being lost, and the raw storage error never reaches the
 * screen either way.
 */
function EvidenceFile({ evidence }: { evidence: Evidence }) {
  const [busy, setBusy] = useState(false)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    if (!evidence.file_path || busy) return
    setBusy(true)
    setError(null)
    const { url, error: signError } = await signEvidenceFile(evidence.file_path)
    setBusy(false)
    if (signError || !url) {
      setError(signError ?? 'That file could not be opened.')
      return
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) setFallbackUrl(url)
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
        <span className="truncate text-sm text-gray-700">
          {evidenceFileName(evidence.file_path)}
        </span>
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-800 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          {busy ? 'Opening…' : 'View'}
        </button>
      </div>
      {fallbackUrl && (
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs font-medium text-primary-700 underline"
        >
          Open file (your browser blocked the new tab)
        </a>
      )}
      {error && (
        <p className="mt-1 text-xs text-error-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
