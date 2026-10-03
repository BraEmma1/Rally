import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpDown,
  CalendarPlus,
  Filter,
  Lock,
  Globe,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  DOCUMENT_TYPE_LABELS,
  VISIBILITY_LABELS,
  documentTypeLabel,
  formatFileSize,
  listPartnershipDocuments,
  type PartnershipDocument,
} from '@/lib/partnershipDocuments'
import {
  DeleteDocumentDialog,
  DocumentDateText,
  EditDocumentDialog,
  UploaderChip,
  UploadDocumentDialog,
  useDocumentOpener,
} from './PartnershipDocumentDialogs'
import { FileTypeIcon } from './DocumentFileIcon'
import { cn } from '@/lib/utils'

type SortOrder = 'newest' | 'oldest'

// Documents workspace for one event partnership. Search, filters and sorting
// are client-side over the loaded rows — no backend search. Read failures stay
// local to this tab so the rest of the partner page keeps working.
export function PartnershipDocumentsPanel({
  partnershipId,
  eventId,
  editable,
  archived,
}: {
  partnershipId: string
  eventId: string
  editable: boolean
  archived: boolean
}) {
  const [documents, setDocuments] = useState<PartnershipDocument[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [visibilityFilter, setVisibilityFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')

  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState<PartnershipDocument | null>(null)
  const [deleting, setDeleting] = useState<PartnershipDocument | null>(null)
  const [menuDocId, setMenuDocId] = useState<string | null>(null)

  const opener = useDocumentOpener()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await listPartnershipDocuments(partnershipId)
    if (loadError) {
      setError(loadError)
      setDocuments(null)
    } else {
      setDocuments(data)
    }
    setLoading(false)
  }, [partnershipId])

  useEffect(() => {
    void load()
  }, [load])

  const presentTypes = useMemo(() => {
    if (!documents) return []
    const present = new Set(documents.map((d) => d.document_type))
    return Object.entries(DOCUMENT_TYPE_LABELS).filter(([key]) => present.has(key))
  }, [documents])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (documents ?? [])
      .filter((d) => {
        if (typeFilter !== 'all' && d.document_type !== typeFilter) return false
        if (visibilityFilter !== 'all' && d.visibility !== visibilityFilter) return false
        if (!query) return true
        return (
          d.title.toLowerCase().includes(query) ||
          d.original_filename.toLowerCase().includes(query) ||
          (d.description ?? '').toLowerCase().includes(query) ||
          documentTypeLabel(d.document_type).toLowerCase().includes(query)
        )
      })
      .sort((a, b) => {
        const left = new Date(a.created_at).getTime()
        const right = new Date(b.created_at).getTime()
        return sortOrder === 'newest' ? right - left : left - right
      })
  }, [documents, search, typeFilter, visibilityFilter, sortOrder])

  const hasDocuments = (documents?.length ?? 0) > 0

  function closeAndReload() {
    setUploadOpen(false)
    setEditing(null)
    setDeleting(null)
    setMenuDocId(null)
    void load()
  }

  const uploadButton = editable ? (
    <Button onClick={() => setUploadOpen(true)} className="w-full shrink-0 sm:w-auto">
      <Upload className="h-4 w-4" aria-hidden="true" />
      Upload document
    </Button>
  ) : null

  // Rendered from every return path: the empty state returns early, and
  // without this layer the upload dialog would never open from it.
  const dialogLayer = (
    <>
      {uploadOpen && (
        <UploadDocumentDialog
          partnershipId={partnershipId}
          eventId={eventId}
          onClose={() => setUploadOpen(false)}
          onSaved={closeAndReload}
        />
      )}
      {editing && <EditDocumentDialog doc={editing} onClose={() => setEditing(null)} onSaved={closeAndReload} />}
      {deleting && <DeleteDocumentDialog doc={deleting} onClose={() => setDeleting(null)} onDeleted={closeAndReload} />}
    </>
  )

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-4" aria-hidden="true">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-72 max-w-full animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-10 w-36 animate-pulse rounded-md bg-gray-100" />
          </div>
          <div className="h-9 w-full animate-pulse rounded-md bg-gray-100 sm:max-w-xs" />
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border border-gray-100 p-3">
                <div className="h-9 w-9 animate-pulse rounded-md bg-gray-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="hidden h-3 w-16 animate-pulse rounded bg-gray-100 md:block" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <ErrorState message={error} onRetry={() => void load()} />
        </CardContent>
      </Card>
    )
  }

  if (!hasDocuments) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<CalendarPlus className="h-10 w-10" />}
            title="Partnership Documents"
            description="Keep sponsorship agreements, proposals and other partnership documents together."
            action={editable ? <Button onClick={() => setUploadOpen(true)}>Upload document</Button> : undefined}
          />
        </CardContent>
        {dialogLayer}
      </Card>
    )
  }

  const typeOptions = (
    <>
      <option value="all">All document types</option>
      {presentTypes.map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </>
  )
  const visibilityOptions = (
    <>
      <option value="all">All visibility</option>
      <option value="internal">Internal</option>
      <option value="shared">Shared with partner</option>
    </>
  )

  function visibilityBadge(d: PartnershipDocument) {
    const shared = d.visibility === 'shared'
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
          shared ? 'bg-accent-50 text-accent-700' : 'bg-gray-100 text-gray-600'
        )}
      >
        {shared ? (
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        {VISIBILITY_LABELS[d.visibility] ?? d.visibility}
      </span>
    )
  }

  function actionMenu(d: PartnershipDocument) {
    const open = menuDocId === d.id
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label={'More actions for "' + d.title + '"'}
          aria-expanded={open}
          onClick={() => setMenuDocId(open ? null : d.id)}
          className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-hidden="true"
              onClick={() => setMenuDocId(null)}
            />
            <div className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                onClick={() => {
                  setMenuDocId(null)
                  void opener.open(d.storage_path)
                }}
              >
                View / open
              </button>
              {editable && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    onClick={() => {
                      setMenuDocId(null)
                      setEditing(d)
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit details
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-error-700 hover:bg-error-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    onClick={() => {
                      setMenuDocId(null)
                      setDeleting(d)
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* Workspace header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">Partnership Documents</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Manage agreements, proposals and other documents for this partnership.
            </p>
          </div>
          {uploadButton && <div className="w-full sm:w-auto">{uploadButton}</div>}
        </div>

        {archived && editable === false && (
          <p className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
            This event is archived, so documents are read-only.
          </p>
        )}

        {opener.error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {opener.error}
          </div>
        )}
        {opener.fallbackUrl && (
          <a
            href={opener.fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700"
          >
            Open document (your browser blocked the new tab)
          </a>
        )}

        {/* Controls */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents..."
              aria-label="Search documents"
              className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-[11rem]">
              <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <select
                aria-label="Filter by document type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 bg-white pl-7 pr-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600"
              >
                {typeOptions}
              </select>
            </div>
            <div className="min-w-0 flex-1 sm:max-w-[10rem]">
              <select
                aria-label="Filter by visibility"
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600"
              >
                {visibilityOptions}
              </select>
            </div>
            <div className="hidden shrink-0 items-center gap-1.5 md:flex">
              <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              <select
                aria-label="Sort documents"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
          {/* Mobile sort */}
          <div className="flex items-center justify-between md:hidden">
            <p className="text-xs text-gray-500">
              {visible.length} document{visible.length === 1 ? '' : 's'}
            </p>
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              <select
                aria-label="Sort documents"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6">
            <EmptyState
              title="No documents match your filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setTypeFilter('all')
                    setVisibilityFilter('all')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-2 py-2.5 font-medium">Document</th>
                    <th className="px-2 py-2.5 font-medium">Type</th>
                    <th className="px-2 py-2.5 font-medium">Date</th>
                    <th className="px-2 py-2.5 font-medium">Visibility</th>
                    <th className="px-2 py-2.5 font-medium">Uploaded by</th>
                    <th className="px-2 py-2.5 font-medium">Size</th>
                    <th className="px-2 py-2.5 font-medium">Added</th>
                    <th className="px-2 py-2.5 font-medium" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map((d) => (
                    <tr key={d.id} className="align-top">
                      <td className="px-2 py-3">
                        <div className="flex items-start gap-3">
                          <FileTypeIcon mimeType={d.mime_type} filename={d.original_filename} />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => void opener.open(d.storage_path)}
                              disabled={opener.busyPath === d.storage_path}
                              className="block max-w-[16rem] truncate text-left font-semibold text-gray-900 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-60"
                              title={d.title}
                            >
                              {d.title}
                            </button>
                            <p className="max-w-[16rem] truncate text-xs text-gray-500" title={d.original_filename}>
                              {d.original_filename}
                            </p>
                            {d.description && (
                              <p className="mt-0.5 line-clamp-1 max-w-[20rem] text-xs text-gray-500" title={d.description}>
                                {d.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <TypeBadge type={d.document_type} />
                      </td>
                      <td className="px-2 py-3">
                        <DocumentDateText value={d.document_date} />
                      </td>
                      <td className="px-2 py-3">{visibilityBadge(d)}</td>
                      <td className="px-2 py-3">
                        <UploaderChip name={d.uploaded_by_name} />
                      </td>
                      <td className="px-2 py-3 text-sm text-gray-600">{formatFileSize(d.file_size)}</td>
                      <td className="px-2 py-3 text-xs text-gray-500">
                        {new Date(d.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        <br />
                        {new Date(d.created_at).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-2 py-3 text-right">{actionMenu(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-gray-100 px-2 pt-2 text-xs text-gray-500">
                {visible.length} document{visible.length === 1 ? '' : 's'}
              </p>
            </div>

            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {visible.map((d) => (
                <div key={d.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-start gap-3">
                    <FileTypeIcon mimeType={d.mime_type} filename={d.original_filename} />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold leading-snug text-gray-900">{d.title}</h4>
                      <p className="truncate text-xs text-gray-500">{d.original_filename}</p>
                      {d.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{d.description}</p>
                      )}
                    </div>
                    {actionMenu(d)}
                  </div>
                  <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-gray-100 pt-2.5 text-xs">
                    <span className="flex items-center gap-1 text-gray-500">
                      <DocumentDateText value={d.document_date} />
                    </span>
                    {visibilityBadge(d)}
                    <span className="text-gray-600">{formatFileSize(d.file_size)}</span>
                    <UploaderChip name={d.uploaded_by_name} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>

      {dialogLayer}
    </Card>
  )
}

const TYPE_BADGE_TINTS: Record<string, string> = {
  sponsorship_agreement: 'bg-primary-50 text-primary-700',
  proposal: 'bg-violet-50 text-violet-700',
  contract: 'bg-error-50 text-error-700',
  memorandum: 'bg-gray-100 text-gray-600',
  addendum: 'bg-warning-50 text-warning-700',
  package_document: 'bg-accent-50 text-accent-700',
  other: 'bg-gray-100 text-gray-600',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[10rem] items-center whitespace-pre-line rounded-md px-2 py-1 text-xs font-medium',
        TYPE_BADGE_TINTS[type] ?? TYPE_BADGE_TINTS.other
      )}
    >
      {DOCUMENT_TYPE_LABELS[type as keyof typeof DOCUMENT_TYPE_LABELS] ?? type}
    </span>
  )
}
