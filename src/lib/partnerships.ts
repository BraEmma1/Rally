import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// ---------------------------------------------------------------------------
// Event partnerships -- the organizer's PRIVATE commercial workspace.
//
// This is deliberately not the exhibitors data layer. `event_exhibitors` is a
// public directory (it carries GRANT SELECT TO anon and inherits event
// visibility); a partnership carries the opposite -- representative email,
// internal notes, sponsorship value, obligations, evidence -- and its RLS asks
// can_manage_event and nothing else. The two systems do not know about each
// other, which is what phase 1 intended, so nothing here imports from
// `exhibitors.ts` and nothing there is widened to fit this.
//
// Backend ownership, so the UI never has to be the authority:
//   * status on creation          -- forced to 'draft' by a trigger
//   * created_by / uploaded_by    -- auth.uid(), whatever the client sends
//   * completed_at / completed_by -- observed on the status change
//   * acknowledged_at             -- frozen outside the acceptance path
//   * sponsor_organization_id     -- only settable by invitation acceptance
//   * the status transition map   -- enforced in the trigger
//   * the archived-event freeze   -- enforced on every table
// The UI's whole job is to not offer buttons the database will refuse.
// ---------------------------------------------------------------------------

export const PARTNERSHIP_ROLES = [
  'sponsor',
  'exhibitor',
  'media_partner',
  'supporting_partner',
  'other',
] as const
export type PartnershipRole = (typeof PARTNERSHIP_ROLES)[number]

export const ROLE_LABELS: Record<PartnershipRole, string> = {
  sponsor: 'Sponsor',
  exhibitor: 'Exhibitor',
  media_partner: 'Media Partner',
  supporting_partner: 'Supporting Partner',
  other: 'Other',
}

export const PARTNERSHIP_STATUSES = [
  'draft',
  'invited',
  'active',
  'completed',
  'cancelled',
] as const
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number]

export const STATUS_LABELS: Record<PartnershipStatus, string> = {
  draft: 'Draft',
  invited: 'Invited',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// Status is never communicated by colour alone -- every badge renders its
// label too. These only reinforce it.
export const STATUS_BADGE: Record<
  PartnershipStatus,
  'gray' | 'warning' | 'primary' | 'success' | 'default'
> = {
  draft: 'gray',
  invited: 'warning',
  active: 'primary',
  completed: 'success',
  cancelled: 'default',
}

export type ObligationDirection = 'organizer_to_partner' | 'partner_to_organizer'
export type ObligationStatus = 'pending' | 'in_progress' | 'completed'

export const OBLIGATION_STATUSES: ObligationStatus[] = ['pending', 'in_progress', 'completed']

export const OBLIGATION_STATUS_LABELS: Record<ObligationStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
}

export const OBLIGATION_STATUS_BADGE: Record<ObligationStatus, 'gray' | 'warning' | 'success'> = {
  pending: 'gray',
  in_progress: 'warning',
  completed: 'success',
}

export type EvidenceKind = 'file' | 'url' | 'note'

/** One row of get_event_partnership_summary -- the Partners list, in one call. */
export type PartnershipSummary = {
  id: string
  event_id: string
  sponsor_organization_id: string | null
  company_name: string
  logo_url: string | null
  industry: string | null
  tier_label: string | null
  status: PartnershipStatus
  acknowledged_at: string | null
  representative_email: string | null
  value_amount: number | null
  value_currency: string | null
  display_order: number
  roles: PartnershipRole[]
  owed_total: number
  owed_completed: number
  required_total: number
  required_completed: number
  updated_at: string
}

/** The full private row. Organizer-only: it carries internal_notes. */
export type Partnership = {
  id: string
  event_id: string
  sponsor_organization_id: string | null
  company_name: string
  description: string | null
  logo_url: string | null
  industry: string | null
  website: string | null
  linkedin: string | null
  tier_label: string | null
  status: PartnershipStatus
  acknowledged_at: string | null
  value_amount: number | null
  value_currency: string | null
  internal_notes: string | null
  representative_email: string | null
  display_order: number
  created_by: string
  created_at: string
  updated_at: string
}

export type Obligation = {
  id: string
  partnership_id: string
  event_id: string
  direction: ObligationDirection
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  status: ObligationStatus
  due_date: string | null
  display_order: number
  completed_at: string | null
  completed_by: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type Evidence = {
  id: string
  obligation_id: string
  partnership_id: string
  event_id: string
  kind: EvidenceKind
  file_path: string | null
  external_url: string | null
  note: string | null
  uploaded_by: string
  created_at: string
}

/** The snapshot an organizer may write. No status, no link, no acknowledgement. */
export type PartnershipInput = {
  company_name: string
  description: string | null
  logo_url: string | null
  industry: string | null
  website: string | null
  linkedin: string | null
  tier_label: string | null
  value_amount: number | null
  value_currency: string | null
  internal_notes: string | null
  representative_email: string | null
}

export type ObligationInput = {
  direction: ObligationDirection
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  due_date: string | null
}

// ---------------------------------------------------------------------------
// Errors
//
// Nothing from Postgres reaches the screen raw. The database's own RAISE
// messages are written for a person to read ("Only a draft partnership can be
// deleted. Cancel this one instead.") so those pass through; policy
// violations, constraint names and SQLSTATEs are translated.
// ---------------------------------------------------------------------------
function mapPartnershipError(
  error: { message?: string; code?: string; details?: string } | null,
  fallback: string
): string {
  const code = error?.code ?? ''
  const message = error?.message?.trim() ?? ''
  const all = message + ' ' + (error?.details ?? '')

  if (/archived/i.test(all)) {
    return 'This event is read-only because it is archived.'
  }
  if (code === '42501' || /row-level security|permission denied/i.test(all)) {
    return 'You do not manage this event.'
  }
  if (code === '23514') {
    if (/currency_shape/.test(all)) return 'Use a three-letter currency code, such as GHS or USD.'
    if (/value_non_negative/.test(all)) return 'The commercial value cannot be negative.'
    if (/quantity_positive/.test(all)) return 'Quantity must be a whole number above zero.'
    if (/safe_url/.test(all)) return 'Links must be full URLs starting with https://'
    if (/rep_email_normalized/.test(all)) return 'Enter a valid representative email address.'
    if (/company_not_blank|title_not_blank/.test(all)) return 'That name cannot be empty.'
    if (/_length/.test(all)) return 'One of the fields is too long. Shorten it and try again.'
    return fallback
  }
  if (code === '23503' || code === '23505') return fallback

  return readableError(error, fallback)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The Partners list. One RPC: roles aggregated and obligations counted per
 * direction for every partnership at once, so the list never fans out into a
 * query per partner.
 */
export async function listEventPartnerships(
  eventId: string
): Promise<{ data: PartnershipSummary[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_partnership_summary', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: mapPartnershipError(error, 'Unable to load the partners.') }
  const rows = (data ?? []) as PartnershipSummary[]
  return {
    data: rows.map((row) => ({
      ...row,
      roles: (row.roles ?? []) as PartnershipRole[],
      value_amount: row.value_amount === null ? null : Number(row.value_amount),
      owed_total: Number(row.owed_total),
      owed_completed: Number(row.owed_completed),
      required_total: Number(row.required_total),
      required_completed: Number(row.required_completed),
    })),
    error: null,
  }
}

/**
 * One partnership, scoped to the event in the URL and not just its id.
 *
 * The event filter is the point. RLS authorizes the row -- an organizer who
 * manages both events may legitimately read either -- so without `event_id`
 * here, /organizer/events/<A>/partners/<a-partner-of-B> would render B's
 * partner inside A's shell. That is the exhibitor-detail bug, and asking for
 * the scope is the only thing that prevents it.
 */
export async function getEventPartnership(
  eventId: string,
  partnershipId: string
): Promise<{ data: Partnership | null; error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnerships')
    .select('*')
    .eq('id', partnershipId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (error) return { data: null, error: mapPartnershipError(error, 'Unable to load this partner.') }
  if (!data) return { data: null, error: null }
  const row = data as Partnership
  return {
    data: { ...row, value_amount: row.value_amount === null ? null : Number(row.value_amount) },
    error: null,
  }
}

export async function listPartnershipRoles(
  partnershipId: string
): Promise<{ data: PartnershipRole[]; error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_roles')
    .select('role')
    .eq('partnership_id', partnershipId)
    .order('role')
  if (error) {
    return { data: [], error: mapPartnershipError(error, 'Unable to load the partner roles.') }
  }
  return { data: ((data ?? []) as { role: PartnershipRole }[]).map((r) => r.role), error: null }
}

export async function listPartnershipObligations(
  partnershipId: string
): Promise<{ data: Obligation[]; error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_obligations')
    .select('*')
    .eq('partnership_id', partnershipId)
    .order('display_order')
    .order('created_at')
  if (error) {
    return { data: [], error: mapPartnershipError(error, 'Unable to load the deliverables.') }
  }
  return { data: (data ?? []) as Obligation[], error: null }
}

export async function listPartnershipEvidence(
  partnershipId: string
): Promise<{ data: Evidence[]; error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_obligation_evidence')
    .select('*')
    .eq('partnership_id', partnershipId)
    .order('created_at')
  if (error) return { data: [], error: mapPartnershipError(error, 'Unable to load the evidence.') }
  return { data: (data ?? []) as Evidence[], error: null }
}

// ---------------------------------------------------------------------------
// Partnership writes
// ---------------------------------------------------------------------------

function partnershipPayload(input: PartnershipInput) {
  // Only the snapshot. status, sponsor_organization_id and acknowledged_at are
  // not in this object at all, so no screen can send them by accident.
  return {
    company_name: input.company_name,
    description: input.description,
    logo_url: input.logo_url,
    industry: input.industry,
    website: input.website,
    linkedin: input.linkedin,
    tier_label: input.tier_label,
    value_amount: input.value_amount,
    value_currency: input.value_currency,
    internal_notes: input.internal_notes,
    representative_email: input.representative_email,
  }
}

export type CreatePartnershipResult = {
  /** The new partnership, when every step succeeded. */
  id: string | null
  error: string | null
  /**
   * Set only when the partnership row was created, a later step failed AND the
   * compensating delete also failed -- i.e. a draft really is left behind. The
   * caller says so rather than pretending the whole thing rolled back.
   */
  orphanDraftId?: string
}

/**
 * Create a partnership together with its roles and its obligations.
 *
 * This is NOT atomic, and it is not presented as if it were. The three tables
 * are written by three separate statements -- there is no phase 1 RPC that
 * takes all of it, and inventing one to make a wizard tidier would be
 * redesigning the backend for the frontend's convenience.
 *
 * What is done instead:
 *
 *   1. The order is chosen so any partially-created state is a *valid draft*,
 *      never a broken record: the partnership is born a draft with its company
 *      snapshot complete, then roles, then obligations.
 *   2. Both obligation directions go in ONE insert, so the obligation set
 *      cannot land half-applied.
 *   3. If a later step fails, the draft is deleted -- which phase 1 explicitly
 *      permits for a draft and refuses for anything else. The usual outcome of
 *      a failure is therefore nothing left behind.
 *   4. If even that delete fails, `orphanDraftId` comes back and the caller
 *      says so plainly. The draft is complete enough to open and finish by
 *      hand; it is not corrupt.
 *
 * Success is never shown before step 3 could have run.
 */
export async function createPartnershipWithDetails(
  eventId: string,
  input: PartnershipInput,
  roles: PartnershipRole[],
  obligations: ObligationInput[]
): Promise<CreatePartnershipResult> {
  const { data, error } = await supabase
    .from('event_partnerships')
    .insert({ event_id: eventId, ...partnershipPayload(input) })
    .select('id')
    .single()

  if (error || !data) {
    return { id: null, error: mapPartnershipError(error, 'Unable to save this partner.') }
  }

  const partnershipId = (data as { id: string }).id

  async function rollback(message: string): Promise<CreatePartnershipResult> {
    const { error: deleteError } = await supabase
      .from('event_partnerships')
      .delete()
      .eq('id', partnershipId)
    if (deleteError) return { id: null, error: message, orphanDraftId: partnershipId }
    return { id: null, error: message }
  }

  const { error: rolesError } = await supabase.rpc('set_event_partnership_roles', {
    target_partnership_id: partnershipId,
    new_roles: roles,
  })
  if (rolesError) {
    return rollback(mapPartnershipError(rolesError, 'Unable to save the partner roles.'))
  }

  if (obligations.length > 0) {
    // display_order is per direction, which is how both lists are read back.
    const owed = obligations.filter((o) => o.direction === 'organizer_to_partner')
    const required = obligations.filter((o) => o.direction === 'partner_to_organizer')
    const rows = [
      ...owed.map((o, index) => ({ ...o, display_order: index })),
      ...required.map((o, index) => ({ ...o, display_order: index })),
    ].map((o) => ({ partnership_id: partnershipId, event_id: eventId, ...o }))

    const { error: obligationsError } = await supabase
      .from('event_partnership_obligations')
      .insert(rows)
    if (obligationsError) {
      return rollback(
        mapPartnershipError(obligationsError, 'Unable to save the deliverables and requirements.')
      )
    }
  }

  return { id: partnershipId, error: null }
}

export async function updatePartnership(
  partnershipId: string,
  patch: Partial<PartnershipInput>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_partnerships').update(patch).eq('id', partnershipId)
  if (error) return { error: mapPartnershipError(error, 'Unable to save this partner.') }
  return { error: null }
}

/** Hard delete. The database refuses this for anything but a draft. */
export async function deletePartnership(partnershipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_partnerships').delete().eq('id', partnershipId)
  if (error) return { error: mapPartnershipError(error, 'Unable to delete this partner.') }
  return { error: null }
}

/**
 * Move a partnership along its lifecycle. The transition map lives in the
 * trigger; `allowedStatusTransitions` mirrors it so the UI only offers moves
 * that will succeed, and the database still decides.
 */
export async function setPartnershipStatus(
  partnershipId: string,
  status: PartnershipStatus
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnerships')
    .update({ status })
    .eq('id', partnershipId)
  if (error) return { error: mapPartnershipError(error, 'Unable to update this partnership.') }
  return { error: null }
}

/**
 * The same map as enforce_event_partnership_rules. Transitions that exist only
 * through the invitation backend -- draft -> invited, invited -> active -- are
 * omitted on purpose: this phase has no invitation UI, so offering them would
 * be a button that cannot work.
 */
export function allowedStatusTransitions(status: PartnershipStatus): PartnershipStatus[] {
  switch (status) {
    case 'draft':
      return ['cancelled']
    case 'invited':
      return ['cancelled']
    case 'active':
      return ['completed', 'cancelled']
    case 'completed':
      return ['active']
    case 'cancelled':
      return ['draft']
    default:
      return []
  }
}

export async function setPartnershipRoles(
  partnershipId: string,
  roles: PartnershipRole[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_event_partnership_roles', {
    target_partnership_id: partnershipId,
    new_roles: roles,
  })
  if (error) return { error: mapPartnershipError(error, 'Unable to save the partner roles.') }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------

export async function createObligation(
  partnershipId: string,
  eventId: string,
  input: ObligationInput,
  displayOrder: number
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_partnership_obligations').insert({
    partnership_id: partnershipId,
    event_id: eventId,
    display_order: displayOrder,
    ...input,
  })
  if (error) return { error: mapPartnershipError(error, 'Unable to save this item.') }
  return { error: null }
}

/** direction is not in the patch type: the trigger refuses to change it. */
export async function updateObligation(
  obligationId: string,
  patch: Partial<Omit<ObligationInput, 'direction'>>
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_obligations')
    .update(patch)
    .eq('id', obligationId)
  if (error) return { error: mapPartnershipError(error, 'Unable to save this item.') }
  return { error: null }
}

export async function deleteObligation(obligationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_obligations')
    .delete()
    .eq('id', obligationId)
  if (error) return { error: mapPartnershipError(error, 'Unable to remove this item.') }
  return { error: null }
}

/**
 * Status through the named RPC rather than a direct UPDATE, so completed_at and
 * completed_by are never in a payload this app sends. The trigger owns them
 * either way; this makes it structurally impossible to try.
 */
export async function setObligationStatus(
  obligationId: string,
  status: ObligationStatus
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_partnership_obligation_status', {
    obligation_id: obligationId,
    new_status: status,
  })
  if (error) return { error: mapPartnershipError(error, 'Unable to update this item.') }
  return { error: null }
}

export async function reorderObligations(
  partnershipId: string,
  obligationIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('reorder_partnership_obligations', {
    target_partnership_id: partnershipId,
    obligation_ids: obligationIds,
  })
  if (error) return { error: mapPartnershipError(error, 'Unable to save the new order.') }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Evidence
//
// The bucket is PRIVATE (partnership-assets, public = false). What is stored on
// the row is the object PATH; a signed URL is minted only when somebody
// actually opens the file, and never persisted -- a stored signed URL is an
// access grant baked into a database row that outlives the decision to grant
// it.
// ---------------------------------------------------------------------------

export const PARTNERSHIP_ASSET_BUCKET = 'partnership-assets'

// Mirrors the bucket's allowed_mime_types exactly. SVG is absent on purpose.
const EVIDENCE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

export const EVIDENCE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024

function uniqueName(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now() + '-' + Math.random().toString(36).slice(2, 10)
}

export async function addNoteEvidence(
  obligation: Pick<Obligation, 'id' | 'partnership_id' | 'event_id'>,
  note: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_partnership_obligation_evidence').insert({
    obligation_id: obligation.id,
    partnership_id: obligation.partnership_id,
    event_id: obligation.event_id,
    kind: 'note',
    note,
  })
  if (error) return { error: mapPartnershipError(error, 'Unable to add this note.') }
  return { error: null }
}

export async function addUrlEvidence(
  obligation: Pick<Obligation, 'id' | 'partnership_id' | 'event_id'>,
  externalUrl: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_partnership_obligation_evidence').insert({
    obligation_id: obligation.id,
    partnership_id: obligation.partnership_id,
    event_id: obligation.event_id,
    kind: 'url',
    external_url: externalUrl,
  })
  if (error) return { error: mapPartnershipError(error, 'Unable to add this link.') }
  return { error: null }
}

/**
 * Upload a file and record it as evidence.
 *
 * The first path segment has to be the caller's own id, because that is what
 * the bucket's INSERT policy checks; it is read from the session rather than
 * taken as an argument so the policy and the code cannot disagree.
 *
 * If the row insert fails after a successful upload, the object is removed
 * again -- the uploader always owns it, so that removal is always permitted.
 */
export async function uploadFileEvidence(
  obligation: Pick<Obligation, 'id' | 'partnership_id' | 'event_id'>,
  file: File
): Promise<{ error: string | null }> {
  if (file.size > EVIDENCE_MAX_BYTES) {
    return { error: 'Files must be under 10 MB.' }
  }
  const ext = EVIDENCE_EXTENSION_BY_MIME[file.type]
  if (!ext) {
    return { error: 'Attach a PDF or a JPEG, PNG, WebP or GIF image.' }
  }

  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return { error: 'Please sign in again to upload a file.' }

  const path = uid + '/' + obligation.partnership_id + '/' + uniqueName() + '.' + ext

  const { error: uploadError } = await supabase.storage
    .from(PARTNERSHIP_ASSET_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    return { error: 'Unable to upload evidence. Please try again.' }
  }

  const { error } = await supabase.from('event_partnership_obligation_evidence').insert({
    obligation_id: obligation.id,
    partnership_id: obligation.partnership_id,
    event_id: obligation.event_id,
    kind: 'file',
    file_path: path,
  })
  if (error) {
    await supabase.storage.from(PARTNERSHIP_ASSET_BUCKET).remove([path])
    return { error: mapPartnershipError(error, 'Unable to upload evidence. Please try again.') }
  }
  return { error: null }
}

/**
 * Remove a piece of evidence.
 *
 * The row goes first, deliberately. The storage read policy is anchored on the
 * evidence row, so the moment the row is gone the object is unreadable by
 * anybody -- which means a failed object removal leaves an inert orphan rather
 * than an exposed file. That matters because object DELETE is folder-scoped to
 * the uploader: a teammate removing somebody else's file evidence legitimately
 * cannot delete the object, and the right outcome there is a harmless orphan,
 * not a refusal to tidy the record.
 */
export async function deleteEvidence(evidence: Evidence): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_partnership_obligation_evidence')
    .delete()
    .eq('id', evidence.id)
  if (error) return { error: mapPartnershipError(error, 'Unable to remove this evidence.') }

  if (evidence.kind === 'file' && evidence.file_path) {
    // Best effort, and never reported: see above.
    await supabase.storage.from(PARTNERSHIP_ASSET_BUCKET).remove([evidence.file_path])
  }
  return { error: null }
}

/**
 * A short-lived URL for one private object, minted on demand.
 *
 * Supabase requires SELECT on the object before it will sign it, so the phase 1
 * storage policy -- an evidence row points at this path AND the caller can read
 * that partnership -- is itself the signing authorization. No Edge Function, no
 * service-role key near the client.
 */
export async function signEvidenceFile(
  filePath: string
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from(PARTNERSHIP_ASSET_BUCKET)
    .createSignedUrl(filePath, 60)
  if (error || !data?.signedUrl) {
    return { url: null, error: 'That file could not be opened. It may have been removed.' }
  }
  return { url: data.signedUrl, error: null }
}

/** The stored name of a file, for a label. Never rendered as a link. */
export function evidenceFileName(filePath: string | null): string {
  if (!filePath) return 'File'
  return filePath.split('/').pop() ?? filePath
}
