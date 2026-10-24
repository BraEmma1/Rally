import { supabase } from '@/lib/supabase'

// Connection requests ("friend requests"). Backend: public.connection_requests and
// the four RPCs below (migration 20261024000000). Every change goes through an RPC;
// the table itself is read-only through the API.

export type ConnectionRequest = {
  id: string
  direction: 'incoming' | 'outgoing'
  event_id: string | null
  event_name: string | null
  created_at: string
  other_user_id: string
  other_full_name: string
  other_job_title: string
  other_company: string
  other_photo_url: string
}

// The database raises plain-English messages for the cases a person can fix
// (already connected, request already open, not registered ...). Show those as they
// are; hide anything else behind a generic line.
const SAFE_MESSAGES = [
  'already connected',
  'already sent',
  'already open',
  'already been answered',
  'too many open requests',
  'not registered for this event',
  'not attending this event',
  'does not exist',
  'is archived',
  'not active',
  'cannot be withdrawn',
  'yourself',
]

export function friendlyRequestError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message?.trim() ?? ''
  if (message && SAFE_MESSAGES.some((s) => message.includes(s))) return message
  return fallback
}

export async function fetchMyConnectionRequests() {
  const { data, error } = await supabase.rpc('my_connection_requests')
  return { data: (data ?? []) as ConnectionRequest[], error }
}

export async function sendConnectionRequest(eventId: string, userId: string) {
  const { data, error } = await supabase.rpc('send_connection_request', {
    target_event_id: eventId,
    target_user_id: userId,
  })
  return { data: (data ?? null) as string | null, error }
}

export async function respondToConnectionRequest(requestId: string, accept: boolean) {
  const { data, error } = await supabase.rpc('respond_to_connection_request', {
    request_id: requestId,
    accept,
  })
  return { data: (data ?? null) as 'accepted' | 'declined' | null, error }
}

export async function cancelConnectionRequest(requestId: string) {
  const { error } = await supabase.rpc('cancel_connection_request', { request_id: requestId })
  return { error }
}
