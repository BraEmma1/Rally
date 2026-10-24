import { supabase } from '@/lib/supabase'

// Event registration. Backend: migration 20261026000000. Registering and
// cancelling go through RPCs (the table cannot be written directly any more), so
// the registration form, capacity and the waitlist cannot be skipped.

export type RegistrationStatus = 'registered' | 'waitlisted' | 'checked_in' | 'cancelled'

// Registered or checked in: a seat is taken.
export function isAttending(status: RegistrationStatus | undefined | null): boolean {
  return status === 'registered' || status === 'checked_in'
}

export type QuestionKind = 'short_text' | 'long_text' | 'single_choice' | 'multi_choice' | 'yes_no'

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  short_text: 'Short answer',
  long_text: 'Long answer',
  single_choice: 'Pick one',
  multi_choice: 'Pick several',
  yes_no: 'Yes / No',
}

export type RegistrationQuestion = {
  id: string
  position: number
  label: string
  help_text: string | null
  kind: QuestionKind
  options: string[] | null
  required: boolean
}

export type AnswerValue = string | boolean | string[]
export type RegistrationAnswers = Record<string, AnswerValue>

export type RegistrationResult = {
  registration_id: string
  registration_status: 'registered' | 'waitlisted'
  waitlist_position: number | null
}

export type MyRegistration = {
  registration_id: string
  registration_status: RegistrationStatus
  registered_at: string
  waitlist_position: number | null
  answers: RegistrationAnswers
}

// What the organizer reads back for one registrant.
export type RegistrationAnswerRow = {
  registration_id: string
  user_id: string
  full_name: string
  job_title: string
  company: string
  registration_status: RegistrationStatus
  registered_at: string
  answers: Array<{
    question_id: string
    label: string
    kind: QuestionKind
    archived: boolean
    answer: AnswerValue
  }>
  total: number
}

// What the organizer sends. `id` is present for a question that already exists,
// so editing a label does not orphan the answers given to it.
export type QuestionDraft = {
  id?: string
  label: string
  help_text?: string | null
  kind: QuestionKind
  options?: string[]
  required: boolean
}

export const MAX_QUESTIONS = 20
export const MAX_OPTIONS = 20

// The functions raise plain-English messages for the cases a person can act on.
// Show those as they are; hide anything else behind the fallback.
const SAFE_MESSAGES = [
  'Authentication required',
  'Your account is not active',
  'That event does not exist',
  'That event is no longer available',
  'That event is not open for registration',
  'That event has already finished',
  'That event is full',
  'You are already registered for this event',
  'You are not registered for this event',
  'You have already checked in to this event',
  'Please answer all required questions',
  'Your answers do not match',
  'An answer is too long',
  'You do not have access to this event',
  'A registration form can have at most',
  'Every question needs a label',
  'Help text can be at most',
  'Choice questions need',
  'cannot change once people have answered',
  'That question does not belong to this event',
]

export function friendlyRegistrationError(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message?.trim() ?? ''
  if (message && SAFE_MESSAGES.some((s) => message.includes(s))) return message
  return fallback
}

export async function fetchRegistrationForm(eventId: string) {
  const { data, error } = await supabase.rpc('get_event_registration_form', { p_event_id: eventId })
  return { data: (data ?? []) as RegistrationQuestion[], error }
}

export async function registerForEvent(eventId: string, answers: RegistrationAnswers) {
  const { data, error } = await supabase.rpc('register_for_event', { p_event_id: eventId, p_answers: answers })
  const row = Array.isArray(data) ? (data[0] as RegistrationResult | undefined) : undefined
  return { data: row ?? null, error }
}

export async function cancelRegistration(eventId: string) {
  const { data, error } = await supabase.rpc('cancel_event_registration', { p_event_id: eventId })
  return { data: (data ?? null) as RegistrationStatus | null, error }
}

export async function fetchMyRegistration(eventId: string) {
  const { data, error } = await supabase.rpc('my_event_registration', { p_event_id: eventId })
  const row = Array.isArray(data) ? (data[0] as MyRegistration | undefined) : undefined
  return { data: row ?? null, error }
}

// My registration status for every event I have one for. Cancelled ones are
// left out: they are history, not a registration.
export async function fetchMyRegistrationStatuses(userId: string) {
  const { data, error } = await supabase
    .from('event_registrations')
    .select('event_id, status')
    .eq('user_id', userId)
  const map = new Map<string, RegistrationStatus>()
  for (const row of (data ?? []) as Array<{ event_id: string; status: RegistrationStatus }>) {
    if (row.status !== 'cancelled') map.set(row.event_id, row.status)
  }
  return { data: map, error }
}

export async function saveRegistrationQuestions(eventId: string, questions: QuestionDraft[]) {
  const { error } = await supabase.rpc('set_event_registration_questions', {
    p_event_id: eventId,
    p_questions: questions.map((q) => ({
      id: q.id ?? null,
      label: q.label,
      help_text: q.help_text ?? null,
      kind: q.kind,
      options: q.kind === 'single_choice' || q.kind === 'multi_choice' ? q.options ?? [] : null,
      required: q.required,
    })),
  })
  return { error }
}

export async function fetchRegistrationAnswers(eventId: string, limit: number, offset: number) {
  const { data, error } = await supabase.rpc('get_event_registration_answers', {
    p_event_id: eventId,
    p_limit: limit,
    p_offset: offset,
  })
  const rows = (data ?? []) as RegistrationAnswerRow[]
  return { data: rows, total: rows[0] ? Number(rows[0].total) : 0, error }
}

// A required question that is still empty, mirroring the server's own check so the
// person is told which one before the request is sent.
export function isAnswerEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false // a boolean (Yes / No) is always an answer
}

// Answers as the server wants them: empty ones left out.
export function cleanAnswers(answers: RegistrationAnswers): RegistrationAnswers {
  const out: RegistrationAnswers = {}
  for (const [id, value] of Object.entries(answers)) {
    if (isAnswerEmpty(value)) continue
    out[id] = typeof value === 'string' ? value.trim() : value
  }
  return out
}

export function formatAnswer(value: AnswerValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return value
}
