import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  QUESTION_KIND_LABELS,
  fetchRegistrationForm,
  friendlyRegistrationError,
  saveRegistrationQuestions,
  type QuestionDraft,
  type QuestionKind,
} from '@/lib/registrations'

type EventLike = { id: string; archived_at: string | null }

// A question being edited. `key` identifies the row in the editor (a new
// question has no id yet); `id` is what the server knows it by.
type Draft = QuestionDraft & { key: string }

const isChoice = (kind: QuestionKind) => kind === 'single_choice' || kind === 'multi_choice'

let nextKey = 0
const newKey = () => `q${++nextKey}`

// The questions a person answers when they register. Removing one hides it from
// the form but keeps the answers already given; the type of a question that has
// been answered cannot change (the server says so).
export function RegistrationFormPanel({ event, manages }: { event: EventLike; manages: boolean }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [saved, setSaved] = useState('[]')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const editable = manages && event.archived_at === null

  const serialize = (list: Draft[]) =>
    JSON.stringify(
      list.map((d) => ({
        id: d.id ?? null,
        label: d.label.trim(),
        help: (d.help_text ?? '').trim(),
        kind: d.kind,
        options: isChoice(d.kind) ? (d.options ?? []).map((o) => o.trim()) : [],
        required: d.required,
      }))
    )

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await fetchRegistrationForm(event.id)
    if (error) {
      setLoadError(friendlyRegistrationError(error, 'Could not load the registration form.'))
      return
    }
    const list: Draft[] = data.map((q) => ({
      key: newKey(),
      id: q.id,
      label: q.label,
      help_text: q.help_text,
      kind: q.kind,
      options: q.options ?? [],
      required: q.required,
    }))
    setDrafts(list)
    setSaved(serialize(list))
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => drafts !== null && serialize(drafts) !== saved, [drafts, saved])

  function update(key: string, patch: Partial<Draft>) {
    setJustSaved(false)
    setDrafts((prev) => prev && prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }
  function move(index: number, delta: -1 | 1) {
    setJustSaved(false)
    setDrafts((prev) => {
      if (!prev) return prev
      const to = index + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }
  function remove(key: string) {
    setJustSaved(false)
    setDrafts((prev) => prev && prev.filter((d) => d.key !== key))
  }
  function add() {
    setJustSaved(false)
    setDrafts((prev) => prev && [...prev, { key: newKey(), label: '', kind: 'short_text', required: false, options: [] }])
  }

  // Mirrors the server's rules so the organizer is told what to fix before saving.
  function validate(list: Draft[]): string | null {
    for (const [i, d] of list.entries()) {
      const n = i + 1
      if (!d.label.trim()) return `Question ${n} needs a label.`
      if (isChoice(d.kind)) {
        const opts = (d.options ?? []).map((o) => o.trim())
        if (opts.length < 2) return `Question ${n} needs at least two options.`
        if (opts.some((o) => !o)) return `Question ${n} has an empty option.`
        if (new Set(opts).size !== opts.length) return `Question ${n} has the same option twice.`
      }
    }
    return null
  }

  async function save() {
    if (!drafts || saving) return
    const problem = validate(drafts)
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError(null)
    const { error } = await saveRegistrationQuestions(
      event.id,
      drafts.map((d) => ({
        id: d.id,
        label: d.label.trim(),
        help_text: (d.help_text ?? '').trim() || null,
        kind: d.kind,
        options: isChoice(d.kind) ? (d.options ?? []).map((o) => o.trim()) : undefined,
        required: d.required,
      }))
    )
    setSaving(false)
    if (error) {
      setSaveError(friendlyRegistrationError(error, 'Could not save the registration form. Please try again.'))
      return
    }
    await load()
    setJustSaved(true)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Registration form</CardTitle>
        <ListChecks className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">
          Questions people answer when they register. Only people who manage this event can read the answers.
          {!editable && ' This event is archived, so the form can’t be changed.'}
        </p>

        {loadError ? (
          <ErrorState message={loadError} onRetry={() => void load()} />
        ) : drafts === null ? (
          <LoadingState message="Loading the form…" />
        ) : (
          <>
            {drafts.length === 0 && (
              <EmptyState
                icon={<ListChecks className="h-8 w-8" />}
                title="No questions yet"
                description="People register with one tap. Add questions if you want to know more about them."
              />
            )}

            <ol className="space-y-3">
              {drafts.map((d, i) => (
                <QuestionEditor
                  key={d.key}
                  index={i}
                  count={drafts.length}
                  draft={d}
                  editable={editable}
                  onChange={(patch) => update(d.key, patch)}
                  onMove={(delta) => move(i, delta)}
                  onRemove={() => remove(d.key)}
                />
              ))}
            </ol>

            {editable && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={add} disabled={drafts.length >= MAX_QUESTIONS}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add question
                </Button>
                <Button onClick={() => void save()} disabled={!dirty || saving}>
                  {saving ? 'Saving…' : 'Save form'}
                </Button>
                {drafts.length >= MAX_QUESTIONS && (
                  <span className="text-xs text-gray-500">Up to {MAX_QUESTIONS} questions.</span>
                )}
                {justSaved && !dirty && (
                  <span role="status" className="text-sm font-medium text-accent-700">
                    Saved.
                  </span>
                )}
              </div>
            )}

            {saveError && (
              <div role="alert" className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
                {saveError}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function QuestionEditor({
  index,
  count,
  draft: d,
  editable,
  onChange,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  draft: Draft
  editable: boolean
  onChange: (patch: Partial<Draft>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const uid = useId()
  const options = d.options ?? []

  return (
    <li className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-600 shadow-sm">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <Label htmlFor={`${uid}-label`}>Question</Label>
            <Input
              id={`${uid}-label`}
              value={d.label}
              maxLength={200}
              disabled={!editable}
              placeholder="e.g. Which company do you work for?"
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${uid}-kind`}>Answer type</Label>
              <Select
                id={`${uid}-kind`}
                value={d.kind}
                disabled={!editable}
                onChange={(e) => {
                  const kind = e.target.value as QuestionKind
                  onChange({ kind, options: isChoice(kind) && options.length < 2 ? ['', ''] : options })
                }}
              >
                {(Object.keys(QUESTION_KIND_LABELS) as QuestionKind[]).map((k) => (
                  <option key={k} value={k}>
                    {QUESTION_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex min-h-[40px] items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={d.required}
                  disabled={!editable}
                  onChange={(e) => onChange({ required: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 accent-primary-600"
                />
                Required
              </label>
            </div>
          </div>

          <div>
            <Label htmlFor={`${uid}-help`}>Help text (optional)</Label>
            <Input
              id={`${uid}-help`}
              value={d.help_text ?? ''}
              maxLength={300}
              disabled={!editable}
              onChange={(e) => onChange({ help_text: e.target.value })}
            />
          </div>

          {isChoice(d.kind) && (
            <fieldset disabled={!editable}>
              <legend className="label-base">Options</legend>
              <ul className="space-y-2">
                {options.map((opt, oi) => (
                  <li key={oi} className="flex items-center gap-2">
                    <Input
                      aria-label={`Option ${oi + 1}`}
                      value={opt}
                      maxLength={100}
                      onChange={(e) => onChange({ options: options.map((o, j) => (j === oi ? e.target.value : o)) })}
                    />
                    {editable && (
                      <button
                        type="button"
                        aria-label={`Remove option ${oi + 1}`}
                        disabled={options.length <= 2}
                        onClick={() => onChange({ options: options.filter((_, j) => j !== oi) })}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  disabled={options.length >= MAX_OPTIONS}
                  onClick={() => onChange({ options: [...options, ''] })}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add option
                </Button>
              )}
            </fieldset>
          )}
        </div>

        {editable && (
          <div className="flex shrink-0 flex-col gap-1">
            <IconButton label="Move question up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton label="Move question down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton label="Remove question" onClick={onRemove} danger>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>
    </li>
  )
}

function IconButton({
  label,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-40 ${
        danger ? 'hover:text-error-600' : 'hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
