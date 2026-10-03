import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// ---------------------------------------------------------------------------
// Partnership documents -- the data layer only. No UI lives here, and none
// should: the production Documents screens are designed separately.
//
// This exists because the ORDER of the upload is load-bearing and is the one
// part of this feature a frontend can get wrong invisibly. Encoding it once,
// here, is better than describing it in a document somebody has to remember.
//
// A document governs the commercial relationship -- the agreement, the
// proposal, an addendum -- and belongs to the PARTNERSHIP. Obligation
// evidence proves one deliverable was done and belongs to the OBLIGATION.
// They are different tables, different buckets and different rules; nothing
// in this file touches evidence.
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPES = [
  'sponsorship_agreement',
  'proposal',
  'contract',
  'memorandum',
  'addendum',
  'package_document',
  'other',
] as const
export type PartnershipDocumentType = (typeof DOCUMENT_TYPES)[number]

/**
 * `internal` is organizer-only. `shared` is additionally readable by members
 * of the organization the partnership is linked to -- which only exists after
 * acceptance, so nothing is ever visible to an invitee.
 *
 * Never inferred from the document type: a proposal may be shared and a
 * signed agreement may be internal, and only the organizer knows which.
 */
export const DOCUMENT_VISIBILITIES = ['internal', 'shared'] as const
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number]

export const DOCUMENT_BUCKET = 'partnership-documents'

/** Mirrors the bucket's allowed_mime_types and the table's CHECK exactly. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export const DOCUMENT_ACCEPT = Object.keys(EXTENSION_BY_MIME).join(',')
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

/** One row of get_partnership_documents. */
export type PartnershipDocument = {
  id: string
  partnership_id: string
  event_id: string
  document_type: PartnershipDocumentType
  title: string
  description: string | null
  original_filename: string
  mime_type: string
  file_size: number
  visibility: DocumentVisibility
  document_date: string | null
  /** Display name of the uploader, or '' when there is no profile. */
  uploaded_by_name: string
  uploaded_by_me: boolean
  created_at: string
  updated_at: string
  /**
   * Needed to ask for a signed URL, and it grants nothing on its own: the
   * storage policy re-checks the document row and its current visibility on
   * every request.
   */
  storage_path: string
}

export type DocumentMetadataInput = {
  title: string
  description: string | null
  document_type: PartnershipDocumentType
  document_date: string | null
  visibility: DocumentVisibility
}

function mapDocumentError(
  error: { message?: string; code?: string; details?: string } | null,
  fallback: string
): string {
  const all = (error?.message ?? '') + ' ' + (error?.details ?? '')
  if (/archived/i.test(all)) return 'This event is read-only because it is archived.'
  if (error?.code === '42501' || /row-level security|permission denied/i.test(all)) {
    return 'You do not manage this event.'
  }
  if (/mime_allowed/.test(all)) return 'That file type is not supported.'
  if (/size_limit|exceeded the maximum|Payload too large/i.test(all)) {
    return 'Files must be under 25 MB.'
  }
  if (/filename_safe|filename_not_blank/.test(all)) return 'That file name is not valid.'
  if (/storage_path_unique/.test(all)) return 'That file has already been added.'
  if (/_length/.test(all)) return 'One of the fields is too long. Shorten it and try again.'
  return readableError(error, fallback)
}

function uniqueName(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now() + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * Every document on a partnership that this caller may see.
 *
 * An organizer gets all of them; a member of the linked sponsor organization
 * gets only the `shared` ones. The filtering happens in the database, so the
 * caller never has to remember to apply it.
 */
export async function listPartnershipDocuments(
  partnershipId: string
): Promise<{ data: PartnershipDocument[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_partnership_documents', {
    target_partnership_id: partnershipId,
  })
  if (error) return { data: [], error: mapDocumentError(error, 'Unable to load the documents.') }
  return {
    data: ((data ?? []) as PartnershipDocument[]).map((row) => ({
      ...row,
      file_size: Number(row.file_size),
    })),
    error: null,
  }
}

/**
 * Upload a document and register it, in the only order that is safe.
 *
 *   1. Upload to `partnerships/<partnership_id>/documents/<uuid>.<ext>`.
 *      Nothing can read it yet -- the storage read policy requires a document
 *      row pointing at the object, and there is none.
 *   2. Insert the row.
 *   3. If the insert fails, remove the object.
 *
 * If step 3 also fails the object stays, but it stays UNREADABLE to everyone,
 * because the row that would authorize it does not exist. An orphan here is
 * inert rather than an exposure -- which is why the upload goes first.
 *
 * The storage name is generated and has nothing to do with the file the user
 * chose; `original_filename` is kept only for display and for the download
 * name, so a hostile filename cannot escape its folder or collide.
 */
export async function uploadPartnershipDocument(
  partnership: { id: string; event_id: string },
  file: File,
  metadata: DocumentMetadataInput
): Promise<{ error: string | null }> {
  if (file.size === 0) return { error: 'That file is empty.' }
  if (file.size > DOCUMENT_MAX_BYTES) return { error: 'Files must be under 25 MB.' }

  const extension = EXTENSION_BY_MIME[file.type]
  if (!extension) {
    return { error: 'Attach a PDF, Word document, JPEG or PNG.' }
  }
  if (!metadata.title.trim()) return { error: 'Give this document a title.' }

  const storagePath =
    'partnerships/' + partnership.id + '/documents/' + uniqueName() + '.' + extension

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    return { error: 'Unable to upload this document. Please try again.' }
  }

  const { error } = await supabase.from('event_partnership_documents').insert({
    partnership_id: partnership.id,
    event_id: partnership.event_id,
    document_type: metadata.document_type,
    title: metadata.title.trim(),
    description: metadata.description,
    document_date: metadata.document_date,
    visibility: metadata.visibility,
    storage_path: storagePath,
    original_filename: sanitizeFilename(file.name),
    mime_type: file.type,
    file_size: file.size,
  })

  if (error) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath])
    return { error: mapDocumentError(error, 'Unable to save this document.') }
  }
  return { error: null }
}

/**
 * What is safe to store as the display name.
 *
 * The browser already strips directories from `file.name`, but this is the
 * value a download will be named after, so separators and control characters
 * are removed rather than trusted. It is never used to locate the object.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '-')
    .trim()
  return (cleaned || 'document').slice(0, 255)
}

/** Metadata only. The stored file, its size and its type cannot be changed. */
export async function updatePartnershipDocument(
  documentId: string,
  patch: Partial<DocumentMetadataInput>
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_documents')
    .update(patch)
    .eq('id', documentId)
  if (error) return { error: mapDocumentError(error, 'Unable to save this document.') }
  return { error: null }
}

export async function setDocumentVisibility(
  documentId: string,
  visibility: DocumentVisibility
): Promise<{ error: string | null }> {
  return updatePartnershipDocument(documentId, { visibility })
}

/**
 * Remove a document.
 *
 * The row goes first, deliberately: the storage read policy is anchored on
 * it, so the moment it is gone the object is unreadable by anybody and a
 * failed object removal leaves an inert orphan rather than a reachable file.
 *
 * This is a HARD delete -- no tombstone, matching obligation evidence. If
 * retention of removed agreements is ever required, that is a deliberate
 * audit-log decision rather than something to infer from a soft-delete flag.
 */
export async function deletePartnershipDocument(
  document: Pick<PartnershipDocument, 'id' | 'storage_path'>
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_documents')
    .delete()
    .eq('id', document.id)
  if (error) return { error: mapDocumentError(error, 'Unable to remove this document.') }

  // Best effort, and never reported: see above.
  await supabase.storage.from(DOCUMENT_BUCKET).remove([document.storage_path])
  return { error: null }
}

/**
 * A short-lived URL for one private document, minted on demand.
 *
 * Supabase requires SELECT on the object before it will sign it, and the
 * storage policy asks whether this caller may read THIS document at its
 * CURRENT visibility -- so the authorization happens before the URL exists,
 * and un-sharing a document denies the next request.
 *
 * Caveat worth knowing: a URL already issued keeps working until it expires.
 * The 60-second lifetime is what bounds that window.
 */
export async function signPartnershipDocument(
  storagePath: string
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60)
  if (error || !data?.signedUrl) {
    return { url: null, error: 'That document could not be opened. It may have been removed.' }
  }
  return { url: data.signedUrl, error: null }
}

/** For a download rather than an inline view, with the original name. */
export async function signPartnershipDocumentDownload(
  storagePath: string,
  originalFilename: string
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60, { download: originalFilename })
  if (error || !data?.signedUrl) {
    return { url: null, error: 'That document could not be downloaded. It may have been removed.' }
  }
  return { url: data.signedUrl, error: null }
}
