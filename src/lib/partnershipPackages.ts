import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// ---------------------------------------------------------------------------
// Event partnership packages -- reusable templates for one event.
//
// Built entirely on phase 5A (migration 20261007000000); nothing here needs a
// backend change. What the database already guarantees, so this layer does not
// have to:
//
//   * A package belongs to ONE event. Deliverables are pinned to their package
//     AND its event by a composite foreign key, so neither can drift to another
//     event.
//   * Both tables are organizer-only: one FOR ALL policy each,
//     can_manage_event(event_id) AND account_is_active(). There is no sponsor or
//     attendee read path, and a suspended account sees nothing.
//   * created_by is auth.uid(), whatever the client sends; a package cannot be
//     moved to another event; an archived EVENT freezes every write.
//   * A package that any partnership was created from cannot be deleted, only
//     archived.
//
// Templates, not bindings: applying a package COPIES its deliverables into a
// partnership once. Editing, archiving or deleting anything here never changes
// a partnership that already exists. The screens say so; the schema is what
// makes it true.
// ---------------------------------------------------------------------------

/** One row of get_event_partnership_packages. */
export type PartnershipPackage = {
  id: string
  event_id: string
  name: string
  description: string | null
  value_amount: number | null
  value_currency: string | null
  display_order: number
  archived_at: string | null
  /** Template deliverables in this package. */
  deliverable_count: number
  /** Partnerships created from it -- the reason Delete may not be offered. */
  partnership_count: number
  created_at: string
  updated_at: string
}

export type PackageDeliverable = {
  id: string
  package_id: string
  event_id: string
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  due_date: string | null
  display_order: number
  created_at: string
  updated_at: string
}

/** What an organizer may write on a package. No event, creator or archive state. */
export type PackageInput = {
  name: string
  description: string | null
  value_amount: number | null
  value_currency: string | null
}

/** The obligation shape minus direction: every template row is organizer-to-partner. */
export type PackageDeliverableInput = {
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  due_date: string | null
}

// ---------------------------------------------------------------------------
// Errors. The trigger messages are written for a person ("This package has
// been used by 2 partnership(s). Archive it instead of deleting it.") and pass
// through; policy violations and constraint names are translated.
// ---------------------------------------------------------------------------
function mapPackageError(
  error: { message?: string; code?: string; details?: string } | null,
  fallback: string
): string {
  const code = error?.code ?? ''
  const message = error?.message?.trim() ?? ''
  const all = message + ' ' + (error?.details ?? '')

  if (/event is archived/i.test(all)) return 'This event is read-only because it is archived.'
  if (code === '42501' || /row-level security|permission denied/i.test(all)) {
    return 'You do not manage this event.'
  }
  if (code === '23514') {
    if (/currency_shape/.test(all)) return 'Use a three-letter currency code, such as GHS or USD.'
    if (/value_non_negative/.test(all)) return 'The suggested value cannot be negative.'
    if (/quantity_positive/.test(all)) return 'Quantity must be a whole number above zero.'
    if (/name_not_blank|title_not_blank/.test(all)) return 'That name cannot be empty.'
    if (/_length/.test(all)) return 'One of the fields is too long. Shorten it and try again.'
    return fallback
  }
  if (code === '23503' || code === '23505') return fallback
  return readableError(error, fallback)
}

// An UPDATE or DELETE that RLS filters to nothing is not an error to
// PostgREST -- it simply touches zero rows. Asking for the ids back is how a
// write that silently did nothing is told apart from one that worked.
const GONE = 'That package is no longer available. Reload and try again.'
const ITEM_GONE = 'That deliverable is no longer available. Reload and try again.'

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every package of one event, archived ones included, with the template and
 * usage counts the list needs -- one round trip.
 */
export async function listEventPackages(
  eventId: string
): Promise<{ data: PartnershipPackage[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_partnership_packages', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: mapPackageError(error, 'Unable to load the packages.') }
  return {
    data: ((data ?? []) as PartnershipPackage[]).map((row) => ({
      ...row,
      value_amount: row.value_amount === null ? null : Number(row.value_amount),
      deliverable_count: Number(row.deliverable_count),
      partnership_count: Number(row.partnership_count),
    })),
    error: null,
  }
}

/**
 * One package's template deliverables. Scoped to the event as well as the
 * package, for the same reason getEventPartnership is: RLS authorizes rows by
 * event, so an organizer of two events could otherwise read the other one's
 * package inside this event's screen.
 */
/** What Add Partner needs from one package at the moment it is chosen. */
export type PackageForPartner =
  | {
      status: 'ok'
      pkg: Pick<PartnershipPackage, 'id' | 'name' | 'value_amount' | 'value_currency'>
      deliverables: PackageDeliverable[]
    }
  | { status: 'archived' | 'missing' }
  | { status: 'error'; error: string }

/**
 * One package and its template deliverables, read fresh, for THIS event only.
 *
 * Add Partner calls this when a package is chosen (so the prefill is the
 * template as it is now, not as it was when the list loaded) and again just
 * before saving (so a package archived or deleted in the meantime is caught
 * before a partnership is linked to it). An archived package is reported, not
 * returned: it is not offered for new partners.
 *
 * Only `archived` is decided here. Nothing in the database stops a direct
 * insert from linking an archived package -- apply_partnership_package checks
 * it, a plain insert does not -- so this check is the screen's, and the
 * set-once package-link rule (Spec A) is where the database will enforce it.
 */
export async function loadPackageForPartner(
  eventId: string,
  packageId: string
): Promise<PackageForPartner> {
  const { data, error } = await supabase
    .from('event_partnership_packages')
    .select('id, name, value_amount, value_currency, archived_at')
    .eq('id', packageId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (error) return { status: 'error', error: mapPackageError(error, 'Unable to load that package.') }
  if (!data) return { status: 'missing' }
  const row = data as {
    id: string
    name: string
    value_amount: number | string | null
    value_currency: string | null
    archived_at: string | null
  }
  if (row.archived_at !== null) return { status: 'archived' }

  const { data: deliverables, error: itemsError } = await listPackageDeliverables(eventId, packageId)
  if (itemsError) return { status: 'error', error: itemsError }
  return {
    status: 'ok',
    pkg: {
      id: row.id,
      name: row.name,
      value_amount: row.value_amount === null ? null : Number(row.value_amount),
      value_currency: row.value_currency,
    },
    deliverables,
  }
}

export async function listPackageDeliverables(
  eventId: string,
  packageId: string
): Promise<{ data: PackageDeliverable[]; error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_package_deliverables')
    .select('*')
    .eq('package_id', packageId)
    .eq('event_id', eventId)
    .order('display_order')
    .order('created_at')
  if (error) {
    return { data: [], error: mapPackageError(error, 'Unable to load the deliverables.') }
  }
  return { data: (data ?? []) as PackageDeliverable[], error: null }
}

// ---------------------------------------------------------------------------
// Package writes
// ---------------------------------------------------------------------------

export async function createPackage(
  eventId: string,
  input: PackageInput,
  displayOrder: number
): Promise<{ data: PartnershipPackage | null; error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_packages')
    .insert({
      event_id: eventId,
      name: input.name,
      description: input.description,
      value_amount: input.value_amount,
      value_currency: input.value_currency,
      display_order: displayOrder,
    })
    .select('*')
    .single()
  if (error || !data) {
    return { data: null, error: mapPackageError(error, 'Unable to create this package.') }
  }
  const row = data as Omit<PartnershipPackage, 'deliverable_count' | 'partnership_count'>
  return {
    data: {
      ...row,
      value_amount: row.value_amount === null ? null : Number(row.value_amount),
      deliverable_count: 0,
      partnership_count: 0,
    },
    error: null,
  }
}

export async function updatePackage(
  packageId: string,
  input: PackageInput
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_packages')
    .update({
      name: input.name,
      description: input.description,
      value_amount: input.value_amount,
      value_currency: input.value_currency,
    })
    .eq('id', packageId)
    .select('id')
  if (error) return { error: mapPackageError(error, 'Unable to save this package.') }
  if (!data || data.length === 0) return { error: GONE }
  return { error: null }
}

/**
 * Archive (retire) or restore. An archived package keeps its deliverables and
 * its history; it is simply not offered when adding a partner, and
 * apply_partnership_package refuses it.
 */
export async function setPackageArchived(
  packageId: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_packages')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', packageId)
    .select('id')
  if (error) {
    return {
      error: mapPackageError(
        error,
        archived ? 'Unable to archive this package.' : 'Unable to restore this package.'
      ),
    }
  }
  if (!data || data.length === 0) return { error: GONE }
  return { error: null }
}

/**
 * Hard delete, deliverables included (ON DELETE CASCADE). The database refuses
 * this for a package any partnership was created from.
 */
export async function deletePackage(packageId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_packages')
    .delete()
    .eq('id', packageId)
    .select('id')
  if (error) return { error: mapPackageError(error, 'Unable to delete this package.') }
  if (!data || data.length === 0) return { error: GONE }
  return { error: null }
}

/** Every id must belong to the event; the RPC refuses the whole call otherwise. */
export async function reorderPackages(
  eventId: string,
  packageIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('reorder_event_partnership_packages', {
    target_event_id: eventId,
    package_ids: packageIds,
  })
  if (error) return { error: mapPackageError(error, 'Unable to save the new order.') }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Template deliverables
// ---------------------------------------------------------------------------

export async function createPackageDeliverable(
  pkg: Pick<PartnershipPackage, 'id' | 'event_id'>,
  input: PackageDeliverableInput,
  displayOrder: number
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_partnership_package_deliverables').insert({
    package_id: pkg.id,
    event_id: pkg.event_id,
    display_order: displayOrder,
    title: input.title,
    description: input.description,
    category: input.category,
    quantity: input.quantity,
    due_date: input.due_date,
  })
  if (error) return { error: mapPackageError(error, 'Unable to add this deliverable.') }
  return { error: null }
}

export async function updatePackageDeliverable(
  deliverableId: string,
  input: PackageDeliverableInput
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_package_deliverables')
    .update({
      title: input.title,
      description: input.description,
      category: input.category,
      quantity: input.quantity,
      due_date: input.due_date,
    })
    .eq('id', deliverableId)
    .select('id')
  if (error) return { error: mapPackageError(error, 'Unable to save this deliverable.') }
  if (!data || data.length === 0) return { error: ITEM_GONE }
  return { error: null }
}

export async function deletePackageDeliverable(
  deliverableId: string
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('event_partnership_package_deliverables')
    .delete()
    .eq('id', deliverableId)
    .select('id')
  if (error) return { error: mapPackageError(error, 'Unable to remove this deliverable.') }
  if (!data || data.length === 0) return { error: ITEM_GONE }
  return { error: null }
}

export async function reorderPackageDeliverables(
  packageId: string,
  deliverableIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('reorder_package_deliverables', {
    target_package_id: packageId,
    deliverable_ids: deliverableIds,
  })
  if (error) return { error: mapPackageError(error, 'Unable to save the new order.') }
  return { error: null }
}
