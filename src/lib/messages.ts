import { supabase } from './supabase'

export type ConversationSummary = {
  conversation_id: string
  other_user_id: string
  other_full_name: string
  other_job_title: string
  other_company: string
  other_photo_url: string
  event_id: string | null
  event_name: string | null
  last_message_body: string | null
  last_message_at: string | null
  last_message_sender_id: string | null
  unread_count: number
  updated_at: string
}

export type ChatMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  is_mine: boolean
  pending?: boolean
}

export const MESSAGE_PAGE_SIZE = 30

// The messaging RPCs raise a small set of intentional, user-facing errors.
// Anything else is shown as a generic failure so raw database text never
// reaches the screen.
const FRIENDLY_ERRORS = [
  'Authentication required',
  'Choose someone else to message',
  'Your account is not active',
  'You can only message people you are connected with on Rally',
  'That event is not where this connection was made',
  'Conversation not found',
  'You are not a member of this conversation',
  'Message body required',
]

export function toFriendlyMessageError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (raw && FRIENDLY_ERRORS.some((known) => raw.includes(known))) return raw
  return fallback
}

export async function fetchConversations() {
  const { data, error } = await supabase.rpc('get_my_conversations')
  return { data: (data ?? []) as ConversationSummary[], error }
}

// event_id is only ever the event the connection was made at, taken from the
// connection row itself — the backend rejects anything else.
export async function createDirectConversation(otherUserId: string, eventId: string | null) {
  const { data, error } = await supabase.rpc('create_direct_conversation', {
    other_user_id: otherUserId,
    event_id: eventId,
  })
  return { data: (data ?? null) as string | null, error }
}

export async function fetchMessages(conversationId: string, beforeCreatedAt?: string) {
  const { data, error } = await supabase.rpc('get_conversation_messages', {
    conversation_id: conversationId,
    before_created_at: beforeCreatedAt ?? null,
    page_size: MESSAGE_PAGE_SIZE,
  })
  return { data: (data ?? []) as ChatMessage[], error }
}

export async function sendMessage(conversationId: string, body: string) {
  const { error } = await supabase.rpc('send_message', { conversation_id: conversationId, body })
  return { error }
}

export async function markConversationRead(conversationId: string) {
  const { error } = await supabase.rpc('mark_conversation_read', { conversation_id: conversationId })
  return { error }
}

// Live updates for the active conversation only. The backend publication and
// RLS decide what is delivered; this only listens and cleans up after itself.
export function subscribeToMessages(
  conversationId: string,
  onInsert: (message: Omit<ChatMessage, 'is_mine'>) => void,
  onStatus?: (status: string) => void
) {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = payload.new as { id: string; sender_id: string; body: string; created_at: string }
        if (row && row.id) onInsert(row)
      }
    )
    .subscribe((status) => onStatus?.(status))

  return () => {
    void supabase.removeChannel(channel)
  }
}
