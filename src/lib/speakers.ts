import { supabase } from '@/lib/supabase'
import { readableError } from '@/lib/events'

// Speakers data layer, shared by organizer management and the attendee Event
// Mode directory. All reads go through the get_event_speakers* RPCs and all
// writes through the event_speakers / event_session_speakers tables, whose RLS
// resolves through can_manage_event — the backend is the authority.

export type EventSpeaker = {
  id: string
  event_id: string
  user_id: string | null
  full_name: string
  job_title: string
  company: string
  bio: string
  photo_url: string
  linkedin: string
  website: string
  industry: string
  display_order: number
  session_count: number
}

export type SpeakerSession = {
  session_id: string
  title: string
  start_at: string
  end_at: string | null
  location: string
  session_type: string
  status: string
  speaker_role: string
  event_timezone: string | null
}

export type SessionSpeaker = {
  session_id: string
  speaker_id: string
  speaker_role: string
  display_order: number
  full_name: string
  job_title: string
  company: string
  photo_url: string
  user_id: string | null
}

export const SPEAKER_ROLES = ['speaker', 'moderator', 'panelist', 'host'] as const
export type SpeakerRole = (typeof SPEAKER_ROLES)[number]

export const SPEAKER_ROLE_LABELS: Record<SpeakerRole, string> = {
  speaker: 'Speaker',
  moderator: 'Moderator',
  panelist: 'Panelist',
  host: 'Host',
}

function mapSpeakerError(error: { message?: string; code?: string } | null, fallback: string): string {
  const code = error?.code ?? ''
  const message = error?.message?.trim() ?? ''
  if (code === '42501' || /manage this event/i.test(message)) return "You don't manage this event."
  if (code === '23505' || /already a speaker/i.test(message)) {
    return 'That person is already a speaker at this event.'
  }
  if (code === '23503' || /belong to different events|different event/i.test(message)) {
    return 'That speaker and session belong to different events.'
  }
  if (code === '23514' || /role_allowed/i.test(message)) return 'Choose a valid speaker role.'
  if (/archived/i.test(message)) {
    return 'This event is archived. Restore it before changing its speakers.'
  }
  return readableError(error, fallback)
}

export async function listEventSpeakers(
  eventId: string
): Promise<{ data: EventSpeaker[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_speakers', { target_event_id: eventId })
  if (error) return { data: [], error: mapSpeakerError(error, 'Could not load the speakers.') }
  return { data: (data ?? []) as EventSpeaker[], error: null }
}

export async function listSpeakerSessions(
  speakerId: string
): Promise<{ data: SpeakerSession[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_speaker_sessions', {
    target_speaker_id: speakerId,
  })
  if (error) return { data: [], error: mapSpeakerError(error, 'Could not load that speaker.') }
  return { data: (data ?? []) as SpeakerSession[], error: null }
}

export async function listSessionSpeakers(
  eventId: string
): Promise<{ data: SessionSpeaker[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_event_session_speakers', {
    target_event_id: eventId,
  })
  if (error) return { data: [], error: mapSpeakerError(error, 'Could not load session speakers.') }
  return { data: (data ?? []) as SessionSpeaker[], error: null }
}

export type SpeakerInput = {
  full_name: string
  job_title: string
  company: string
  bio: string
  photo_url: string
  linkedin: string
  website: string
  industry: string
}

// Session rows returned by get_event_agenda, reused for assignment picking.
export type AgendaSessionLite = {
  id: string
  title: string
  start_at: string
  end_at: string | null
  location: string
  status: string
}

export async function createSpeaker(
  eventId: string,
  input: SpeakerInput,
  userId: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_speakers')
    .insert({ event_id: eventId, user_id: userId, ...input })
  if (error) return { error: mapSpeakerError(error, 'Could not add that speaker. Please try again.') }
  return { error: null }
}

export async function updateSpeaker(
  speakerId: string,
  patch: Partial<SpeakerInput>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_speakers').update(patch).eq('id', speakerId)
  if (error) return { error: mapSpeakerError(error, 'Could not save that speaker. Please try again.') }
  return { error: null }
}

export async function deleteSpeaker(speakerId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('event_speakers').delete().eq('id', speakerId)
  if (error) return { error: mapSpeakerError(error, 'Could not remove that speaker. Please try again.') }
  return { error: null }
}

export async function assignSpeakerToSession(
  sessionId: string,
  speakerId: string,
  eventId: string,
  speakerRole: SpeakerRole
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_session_speakers')
    .insert({ session_id: sessionId, speaker_id: speakerId, event_id: eventId, speaker_role: speakerRole })
  if (error) return { error: mapSpeakerError(error, 'Could not add that assignment. Please try again.') }
  return { error: null }
}

export async function unassignSpeakerFromSession(
  sessionId: string,
  speakerId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('event_session_speakers')
    .delete()
    .match({ session_id: sessionId, speaker_id: speakerId })
  if (error) return { error: mapSpeakerError(error, 'Could not remove that assignment. Please try again.') }
  return { error: null }
}

export async function reorderEventSpeakers(
  eventId: string,
  speakerIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('reorder_event_speakers', {
    target_event_id: eventId,
    speaker_ids: speakerIds,
  })
  if (error) return { error: mapSpeakerError(error, 'Could not save the new order. Please try again.') }
  return { error: null }
}

// Prefill source for "Add Event Attendee as Speaker": the same public card the
// attendee's own profile page shows. A snapshot is copied from it at authoring
// time; afterwards the event speaker record stands alone.
export async function getPublicProfileForPrefill(
  userId: string
): Promise<{ data: { full_name: string; job_title: string; company: string; bio: string; photo_url: string; linkedin: string; website: string; industry: string } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_public_profile', { profile_id: userId }).maybeSingle()
  if (error) return { data: null, error: readableError(error, 'Could not load that profile.') }
  if (!data) return { data: null, error: 'Profile not found.' }
  const p = data as {
    full_name: string
    job_title: string
    company: string
    bio: string
    photo_url: string
    linkedin: string
    website: string
    industry: string
  }
  return {
    data: {
      full_name: p.full_name ?? '',
      job_title: p.job_title ?? '',
      company: p.company ?? '',
      bio: p.bio ?? '',
      photo_url: p.photo_url ?? '',
      linkedin: p.linkedin ?? '',
      website: p.website ?? '',
      industry: p.industry ?? '',
    },
    error: null,
  }
}
