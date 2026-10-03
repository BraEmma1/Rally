import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// Partnership documents data layer (Phase 5B). Documents belong to an event
// partnership; reads/writes go through the event_partnership_documents RLS and
// the get_partnership_documents RPC, and files live in the PRIVATE
// partnership-documents bucket. What is stored on the row is the object PATH;
// a signed URL is minted only when somebody opens the file, never persisted.

export type DocVisibility = 'internal' | 'shared'

export type PartnershipDocument = {
  id: string
  partnership_id: string
  event_id: string
  document_type: string
  title: string
  description: string | null
  original_filename: string
  mime_type: string
  file_size: number
  visibility: DocVisibility
  document_date: string | null
  uploaded_by_name: string | null
  uploaded_by_me: boolean
  created_at: string
  updated_at: string
  storage_path: string
}

export const DOCUMENT_TYPES = [
  'sponsorship_agreement',
  'proposal',
  'contract',
  'memorandum',
  'addendum',
  'package_document',
  'other',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  sponsorship_agreement: 'Sponsorship Agreement',
  proposal: 'Proposal',
  contract: 'Contract',
  memorandum: 'Memorandum',
  addendum: 'Addendum',
  package_document: 'Package Document',
  other: 'Other',
}

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? 'Other'
}

export const VISIBILITY_LABELS: Record<DocVisibility, string> = {
  internal: 'Internal',
  shared: 'Shared with partner',
}

// Mirrors the partnership-documents bucket's allowed_mime_types exactly.
const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export const DOCUMENT_ACCEPT = Object.keys(EXTENSION_BY_MIME).join(',')
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

export const PARTNERSHIP_DOCUMENTS_BUCKET = 'partnership-documents'

function uniqueName(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now() + '-' + Math.random().toString(36).slice(2, 10)
}

function mapDocumentError(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message?.trim() ?? ''
  if (/archived/i.test(message)) {
    return 'This event is archived. Restore it before changing its documents.'
  }
  return readableError(error, fallback)
}

export async function listPartnershipDocuments(
  partnershipId: string
): Promise<{ data: PartnershipDocument[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_partnership_documents', {
    target_partnership_id: partnershipId,
  })
  if (error) return { data: [], error: mapDocumentError(error, 'Could not load the documents.') }
  return { data: (data ?? []) as PartnershipDocument[], error: null }
}

export type DocumentUploadInput = {
  document_type: DocumentType
  title: string
  description: string | null
  document_date: string | null
  visibility: DocVisibility
}

/**
 * Upload a file and create the document row.
 *
 * The storage path shape is fixed by the bucket policy:
 * partnerships/<partnership uuid>/documents/<file>. If the row insert fails
 * after a successful upload, the object is removed again.
 */
export async function uploadPartnershipDocument(
  partnershipId: string,
  eventId: string,
  file: File,
  input: DocumentUploadInput
): Promise<{ error: string | null }> {
  if (file.size > DOCUMENT_MAX_BYTES) {
    return { error: 'Files must be 25 MB or smaller.' }
  }
  const ext = EXTENSION_BY_MIME[file.type]
  if (!ext) {
    return { error: "This file type isn't supported. Use PDF, DOC, DOCX, JPG or PNG." }
  }

  const path = 'partnerships/' + partnershipId + '/documents/' + uniqueName() + '.' + ext

  const { error: uploadError } = await supabase.storage
    .from(PARTNERSHIP_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    return { error: "We couldn't upload this document. Please try again." }
  }

  const { error } = await supabase.from('event_partnership_documents').insert({
    partnership_id: partnershipId,
    event_id: eventId,
    storage_path: path,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
    ...input,
  })
  if (error) {
    await supabase.storage.from(PARTNERSHIP_DOCUMENTS_BUCKET).remove([path])
    return { error: mapDocumentError(error, "We couldn't upload this document. Please try again.") }
  }
  return { error: null }
}

/** Metadata only — the trigger refuses any change to the stored file itself. */
export type DocumentUpdateInput = {
  title?: string
  description?: string | null
  document_type?: DocumentType
  document_date?: string | null
  visibility?: DocVisibility
}

export async function updatePartnershipDocument(
  documentId: string,
  patch: DocumentUpdateInput
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_documents')
    .update(patch)
    .eq('id', documentId)
  if (error) return { error: mapDocumentError(error, 'Could not save those changes.') }
  return { error: null }
}

/**
 * The row goes first, deliberately: the storage read policy is anchored on the
 * row, so the moment it is gone the object is unreadable by anybody. A failed
 * object removal then leaves an inert orphan rather than an exposed file.
 */
export async function deletePartnershipDocument(
  doc: Pick<PartnershipDocument, 'id' | 'storage_path'>
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_documents')
    .delete()
    .eq('id', doc.id)
  if (error) return { error: mapDocumentError(error, 'Could not delete this document.') }

  await supabase.storage.from(PARTNERSHIP_DOCUMENTS_BUCKET).remove([doc.storage_path])
  return { error: null }
}

/** A short-lived URL for one private object, minted on demand. */
export async function signPartnershipDocument(
  storagePath: string
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from(PARTNERSHIP_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60)
  if (error || !data?.signedUrl) {
    return { url: null, error: 'That document could not be opened. It may have been removed.' }
  }
  return { url: data.signedUrl, error: null }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
