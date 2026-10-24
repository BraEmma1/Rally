import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock, MapPin } from 'lucide-react'
import type { EventRow } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/States'
import { formatDateRange } from '@/lib/utils'
import {
  cancelRegistration,
  cleanAnswers,
  fetchRegistrationForm,
  friendlyRegistrationError,
  isAnswerEmpty,
  registerForEvent,
  type AnswerValue,
  type RegistrationAnswers,
  type RegistrationQuestion,
  type RegistrationResult,
  type RegistrationStatus,
} from '@/lib/registrations'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type DialogEvent = Pick<EventRow, 'id' | 'name' | 'start_date' | 'end_date' | 'location'>

// Shared modal frame: focus moves in, Tab stays inside, Escape closes (unless a
// request is in flight), and focus returns to whatever opened it.
function DialogFrame({
  title,
  busy,
  onClose,
  children,
}: {
  title: string
  busy: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!busyRef.current) closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-gray-900/50" aria-hidden="true" onClick={busy ? undefined : onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <h2 id={titleId} className="border-b border-rally-line px-5 py-4 font-display text-lg font-semibold text-rally-navy">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

function EventSummary({ event }: { event: DialogEvent }) {
  return (
    <div className="rounded-xl border border-rally-line bg-rally-canvas p-3 text-sm">
      <p className="font-semibold text-rally-navy">{event.name}</p>
      <p className="mt-1 flex items-center gap-2 text-slate-600">
        <CalendarDays className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
        {formatDateRange(event.start_date, event.end_date)}
      </p>
      {event.location && (
        <p className="mt-1 flex items-center gap-2 text-slate-600">
          <MapPin className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          {event.location}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
export function RegistrationDialog({
  event,
  full,
  onClose,
  onRegistered,
}: {
  event: DialogEvent
  // The event is at capacity, so this registration will join the waitlist.
  full: boolean
  onClose: () => void
  // Fired as soon as the registration is saved, so the page behind can update; the
  // dialog then shows the confirmation until it is closed.
  onRegistered: (result: RegistrationResult) => void
}) {
  const [questions, setQuestions] = useState<RegistrationQuestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<RegistrationAnswers>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const loadForm = useCallback(async () => {
    setLoadError(null)
    setQuestions(null)
    const { data, error } = await fetchRegistrationForm(event.id)
    if (error) {
      setLoadError(friendlyRegistrationError(error, 'Could not load the registration form. Please try again.'))
      return
    }
    setQuestions(data)
  }, [event.id])

  useEffect(() => {
    void loadForm()
  }, [loadForm])

  // The dialog opens before the form has loaded; once it has, start at the first question.
  useEffect(() => {
    if (questions && questions.length > 0) {
      formRef.current?.querySelector<HTMLElement>('[data-question] input, [data-question] textarea')?.focus()
    }
  }, [questions])

  function setAnswer(id: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
    setFieldErrors((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!questions || submitting) return
    const errors: Record<string, string> = {}
    for (const q of questions) {
      if (q.required && isAnswerEmpty(answers[q.id])) errors[q.id] = 'This question is required.'
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      const firstId = questions.find((q) => errors[q.id])?.id
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>(`[data-question="${firstId}"] input, [data-question="${firstId}"] textarea`)?.focus()
      )
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    const { data, error } = await registerForEvent(event.id, cleanAnswers(answers))
    setSubmitting(false)
    if (error || !data) {
      setSubmitError(friendlyRegistrationError(error, 'Could not complete your registration. Please try again.'))
      return
    }
    setResult(data)
    onRegistered(data)
  }

  // ---- confirmation ------------------------------------------------------
  if (result) {
    const waitlisted = result.registration_status === 'waitlisted'
    return (
      <DialogFrame title={waitlisted ? 'You’re on the waitlist' : 'You’re registered'} busy={false} onClose={onClose}>
        <div className="space-y-4 overflow-y-auto px-5 py-5">
          <div className="flex items-start gap-3">
            {waitlisted ? (
              <Clock className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-accent-600" aria-hidden="true" />
            )}
            <p className="text-sm leading-relaxed text-slate-700" role="status">
              {waitlisted
                ? `${event.name} is full. You are number ${result.waitlist_position ?? 1} on the waitlist. If a place opens up we’ll register you automatically and let you know.`
                : `Your place at ${event.name} is confirmed. Your pass is ready in Event Mode.`}
            </p>
          </div>
          <EventSummary event={event} />
        </div>
        <div className="flex justify-end border-t border-rally-line px-5 py-4">
          <Button size="lg" className="rounded-xl" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogFrame>
    )
  }

  // ---- form --------------------------------------------------------------
  return (
    <DialogFrame title={full ? 'Join the waitlist' : 'Register for this event'} busy={submitting} onClose={onClose}>
      <form ref={formRef} onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <EventSummary event={event} />

          {full && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
              This event is full. You’ll join the waitlist, and we’ll register you automatically if a place opens up.
            </p>
          )}

          {loadError ? (
            <div role="alert" className="rounded-xl bg-error-50 px-3 py-3 text-sm text-error-700">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadForm()} className="mt-1 font-semibold underline">
                Try again
              </button>
            </div>
          ) : questions === null ? (
            <div className="flex justify-center py-6" aria-label="Loading the registration form">
              <Spinner />
            </div>
          ) : questions.length === 0 ? (
            <p className="text-sm text-slate-600">
              {full ? 'Confirm to take your place on the waitlist.' : 'Confirm to complete your registration.'}
            </p>
          ) : (
            <div className="space-y-5">
              <p className="text-xs text-slate-500">
                The organizer asks these questions. Only they can see your answers.
              </p>
              {questions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={answers[q.id]}
                  error={fieldErrors[q.id]}
                  disabled={submitting}
                  onChange={(v) => setAnswer(q.id, v)}
                />
              ))}
            </div>
          )}

          {submitError && (
            <div role="alert" className="rounded-xl bg-error-50 px-3 py-2 text-sm text-error-700">
              {submitError}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-rally-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
          <Button type="button" size="lg" variant="secondary" className="rounded-xl" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="rounded-xl" disabled={submitting || questions === null || !!loadError}>
            {submitting && <Spinner size="sm" className="text-white" />}
            {submitting ? 'Saving…' : full ? 'Join waitlist' : 'Confirm registration'}
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}

function QuestionField({
  question: q,
  value,
  error,
  disabled,
  onChange,
}: {
  question: RegistrationQuestion
  value: AnswerValue | undefined
  error: string | undefined
  disabled: boolean
  onChange: (value: AnswerValue) => void
}) {
  const uid = useId()
  const errId = `${uid}-err`
  const helpId = `${uid}-help`
  const describedBy = [q.help_text ? helpId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined

  const legend = (
    <>
      <span className="text-sm font-medium text-slate-800">
        {q.label}
        {q.required ? (
          <span className="text-error-600" aria-hidden="true"> *</span>
        ) : (
          <span className="font-normal text-slate-400"> (optional)</span>
        )}
      </span>
      {q.required && <span className="sr-only"> (required)</span>}
    </>
  )
  const footer = (
    <>
      {q.help_text && (
        <p id={helpId} className="mt-1 text-xs text-slate-500">
          {q.help_text}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="mt-1 text-xs font-medium text-error-700">
          {error}
        </p>
      )}
    </>
  )

  if (q.kind === 'short_text' || q.kind === 'long_text') {
    const common = {
      id: uid,
      value: typeof value === 'string' ? value : '',
      disabled,
      'aria-invalid': !!error,
      'aria-describedby': describedBy,
      'aria-required': q.required,
    }
    return (
      <div data-question={q.id}>
        <label htmlFor={uid} className="block">
          {legend}
        </label>
        <div className="mt-1.5">
          {q.kind === 'short_text' ? (
            <Input {...common} maxLength={500} onChange={(e) => onChange(e.target.value)} />
          ) : (
            <Textarea {...common} rows={4} maxLength={2000} onChange={(e) => onChange(e.target.value)} />
          )}
        </div>
        {footer}
      </div>
    )
  }

  const choiceClass =
    'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-rally-line px-3 py-2 text-sm text-slate-800 has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50'

  if (q.kind === 'yes_no') {
    return (
      <fieldset data-question={q.id} aria-describedby={describedBy} disabled={disabled}>
        <legend className="block">{legend}</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {[true, false].map((opt) => (
            <label key={String(opt)} className={choiceClass}>
              <input
                type="radio"
                name={uid}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="h-4 w-4 accent-primary-600"
              />
              {opt ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
        {footer}
      </fieldset>
    )
  }

  const options = q.options ?? []
  if (q.kind === 'single_choice') {
    return (
      <fieldset data-question={q.id} aria-describedby={describedBy} disabled={disabled}>
        <legend className="block">{legend}</legend>
        <div className="mt-1.5 space-y-2">
          {options.map((opt) => (
            <label key={opt} className={choiceClass}>
              <input
                type="radio"
                name={uid}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="h-4 w-4 accent-primary-600"
              />
              {opt}
            </label>
          ))}
        </div>
        {footer}
      </fieldset>
    )
  }

  // multi_choice
  const picked = Array.isArray(value) ? value : []
  return (
    <fieldset data-question={q.id} aria-describedby={describedBy} disabled={disabled}>
      <legend className="block">{legend}</legend>
      <div className="mt-1.5 space-y-2">
        {options.map((opt) => (
          <label key={opt} className={choiceClass}>
            <input
              type="checkbox"
              checked={picked.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...picked, opt] : picked.filter((p) => p !== opt))}
              className="h-4 w-4 accent-primary-600"
            />
            {opt}
          </label>
        ))}
      </div>
      {footer}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------
export function CancelRegistrationDialog({
  event,
  status,
  onClose,
  onCancelled,
}: {
  event: Pick<EventRow, 'id' | 'name'>
  status: RegistrationStatus
  onClose: () => void
  onCancelled: (previous: RegistrationStatus | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waitlisted = status === 'waitlisted'

  async function confirm() {
    setBusy(true)
    setError(null)
    const { data, error: cancelError } = await cancelRegistration(event.id)
    setBusy(false)
    if (cancelError) {
      setError(friendlyRegistrationError(cancelError, 'Could not cancel your registration. Please try again.'))
      return
    }
    onCancelled(data)
  }

  return (
    <DialogFrame title={waitlisted ? 'Leave the waitlist?' : 'Cancel your registration?'} busy={busy} onClose={onClose}>
      <div className="space-y-3 px-5 py-5 text-sm leading-relaxed text-slate-700">
        <p>
          {waitlisted
            ? `You’ll lose your place in the queue for ${event.name}.`
            : `You’ll give up your place at ${event.name}, and the next person on the waitlist (if any) takes it. You can register again later if there is still room.`}
        </p>
        {error && (
          <div role="alert" className="rounded-xl bg-error-50 px-3 py-2 text-error-700">
            {error}
          </div>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-rally-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
        <Button size="lg" variant="secondary" className="rounded-xl" onClick={onClose} disabled={busy}>
          Keep my place
        </Button>
        <Button size="lg" variant="danger" className="rounded-xl" onClick={() => void confirm()} disabled={busy}>
          {busy && <Spinner size="sm" className="text-white" />}
          {busy ? 'Cancelling…' : waitlisted ? 'Leave waitlist' : 'Cancel registration'}
        </Button>
      </div>
    </DialogFrame>
  )
}
