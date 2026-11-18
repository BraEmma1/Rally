import { useEffect, useId, useState } from 'react'
import { Mail } from 'lucide-react'
import { Spinner } from '@/components/ui/States'
import { fetchMyMarketingConsent, friendlyRegistrationError, setMarketingConsent, type MarketingConsent } from '@/lib/registrations'

// The attendee's marketing choice for one event, changeable at any time. It is
// separate from the registration: turning it off never affects the place, and
// registering never turns it on. Withdrawing is as easy as opting in, and the
// server keeps a dated record of each change with the wording shown.
export function MarketingConsentCard({ eventId }: { eventId: string }) {
  const [consent, setConsent] = useState<MarketingConsent | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    let live = true
    void fetchMyMarketingConsent(eventId).then(({ data }) => {
      if (live) setConsent(data)
    })
    return () => {
      live = false
    }
  }, [eventId])

  // Nothing to show until the wording has loaded; a failed load hides the card
  // rather than showing a choice that cannot be saved.
  if (!consent) return null

  async function change(next: boolean) {
    setSaving(true)
    setError(null)
    const { data, error: saveError } = await setMarketingConsent(eventId, next)
    setSaving(false)
    if (saveError || !data) {
      setError(friendlyRegistrationError(saveError, 'Could not save your choice. Please try again.'))
      return
    }
    setConsent((c) => (c ? { ...c, consented: data.consented, recorded_at: data.recorded_at } : c))
  }

  return (
    <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-rally-navy">
        <Mail className="h-5 w-5 text-primary-600" aria-hidden="true" /> Marketing from the organizer
      </h2>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
        <input
          id={id}
          type="checkbox"
          checked={consent.consented}
          disabled={saving}
          onChange={(e) => void change(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
        />
        <span>{consent.statement}</span>
        {saving && <Spinner size="sm" className="ml-auto shrink-0" />}
      </label>
      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        {consent.recorded_at
          ? `${consent.consented ? 'Turned on' : 'Turned off'} ${new Date(consent.recorded_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}. `
          : ''}
        Messages about this event itself, such as schedule changes, are not affected.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-error-700">
          {error}
        </p>
      )}
    </section>
  )
}
