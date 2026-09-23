import { supabase } from '@/lib/supabase'
import type { EventSession } from '@/lib/supabase'

// Personal saved sessions ("My Schedule"). Every call goes through RPCs that
// derive the user from the authenticated session server-side; the frontend
// never passes a user id, and each attendee only ever sees their own rows.

export type ScheduleEntry = {
  session_id: string
  event_id: string
  title: string
  description: string
  start_at: string
  end_at: string | null
  location: string
  session_type: string
  status: string
  display_order: number
  event_timezone: string | null
  saved_at: string
}

// My Schedule rows carry the same fields as event_sessions plus saved_at;
// adapt one so the shared Agenda row/detail components can render it.
export function scheduleEntryToSession(entry: ScheduleEntry): EventSession {
  return {
    id: entry.session_id,
    event_id: entry.event_id,
    title: entry.title,
    description: entry.description,
    start_at: entry.start_at,
    end_at: entry.end_at,
    location: entry.location,
    session_type: entry.session_type,
    status: entry.status,
    display_order: entry.display_order,
  }
}

export async function listMyEventSchedule(
  eventId: string
): Promise<{ data: ScheduleEntry[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_my_event_schedule', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: 'Could not load your schedule. Please try again.' }
  return { data: (data ?? []) as ScheduleEntry[], error: null }
}

export async function listMySavedSessionIds(
  eventId: string
): Promise<{ data: Set<string>; error: string | null }> {
  const { data, error } = await supabase.rpc('get_my_saved_session_ids', {
    target_event_id: eventId,
  })
  if (error) return { data: new Set(), error: 'Could not load your saved sessions.' }
  const ids = ((data ?? []) as { session_id: string }[]).map((r) => r.session_id)
  return { data: new Set(ids), error: null }
}

export async function saveEventSession(sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('save_event_session', { session_id: sessionId })
  if (error) return { error: 'Could not save that session. Please try again.' }
  return { error: null }
}

export async function removeEventSession(sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('remove_event_session', { session_id: sessionId })
  if (error) return { error: 'Could not remove that session. Please try again.' }
  return { error: null }
}
