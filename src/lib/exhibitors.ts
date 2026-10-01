import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// Exhibitors data layer, shared by organizer management and the attendee Event
// Mode directory. Reads go through get_event_exhibitors (visibility inherited
// from the event through RLS); writes go through event_exhibitors, whose RLS
// resolves through can_manage_event — the backend is the authority.

export type EventExhibitor = {
  id: string
  event_id: string
  organization_id: string | null
  name: string
  description: string
  logo_url: string
  industry: string
  booth: string
  website: string
  linkedin: string
  display_order: number
}

export type ExhibitorInput = {
  name: string
  description: string
  logo_url: string
  industry: string
  booth: string
  website: string
  linkedin: string
}

function mapExhibitorError(
  error: { message?: string; code?: string } | null,
  fallback: string
): string {
  const code = error?.code ?? ''
  const message = error?.message?.trim() ?? ''
  if (code === '42501' || /manage this event/i.test(message)) {
    return "You don't manage this event."
  }
  if (code === '23505' || /already an exhibitor/i.test(message)) {
    return 'That organization is already an exhibitor at this event.'
  }
  if (/archived/i.test(message)) {
    return 'This event is archived. Restore it before changing its exhibitors.'
  }
  if (code === '23514' || /exceeds|too long|length/i.test(message)) {
    return 'One of the fields is too long. Shorten it and try again.'
  }
  return readableError(error, fallback)
}

export async function listEventExhibitors(
  eventId: string
): Promise<{ data: EventExhibitor[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_exhibitors', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: mapExhibitorError(error, 'Could not load the exhibitors.') }
  return { data: (data ?? []) as EventExhibitor[], error: null }
}

export async function getEventExhibitor(
  exhibitorId: string
): Promise<{ data: EventExhibitor | null; error: string | null }> {
  const { data, error } = await supabase
    .from('event_exhibitors')
    .select('*')
    .eq('id', exhibitorId)
    .maybeSingle()
  if (error) {
    return { data: null, error: mapExhibitorError(error, 'Could not load that exhibitor.') }
  }
  return { data: (data as EventExhibitor) ?? null, error: null }
}

export async function createExhibitor(
  eventId: string,
  input: ExhibitorInput
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_exhibitors').insert({ event_id: eventId, ...input })
  if (error) {
    return { error: mapExhibitorError(error, 'Could not add that exhibitor. Please try again.') }
  }
  return { error: null }
}

export async function updateExhibitor(
  exhibitorId: string,
  patch: Partial<ExhibitorInput>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_exhibitors').update(patch).eq('id', exhibitorId)
  if (error) {
    return { error: mapExhibitorError(error, 'Could not save that exhibitor. Please try again.') }
  }
  return { error: null }
}

export async function deleteExhibitor(exhibitorId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_exhibitors').delete().eq('id', exhibitorId)
  if (error) {
    return { error: mapExhibitorError(error, 'Could not remove that exhibitor. Please try again.') }
  }
  return { error: null }
}

export async function reorderEventExhibitors(
  eventId: string,
  exhibitorIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('reorder_event_exhibitors', {
    target_event_id: eventId,
    exhibitor_ids: exhibitorIds,
  })
  if (error) {
    return { error: mapExhibitorError(error, 'Could not save the new order. Please try again.') }
  }
  return { error: null }
}
