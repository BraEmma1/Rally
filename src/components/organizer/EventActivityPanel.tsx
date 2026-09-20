import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Mail, UserPlus, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/States'
import { fetchActivityCounts, type ActivityCounts } from '@/lib/checkin'

// Simple, real metrics from event_activity_counts. Registrations, checked in
// (by timestamp) and connections made at this event — nothing speculative.
export function EventActivityPanel({ eventId }: { eventId: string }) {
  const [counts, setCounts] = useState<ActivityCounts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const { data, error: loadError } = await fetchActivityCounts(eventId)
      if (cancelled) return
      if (loadError) {
        setError(loadError)
        return
      }
      setCounts(data)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [eventId])

  if (error) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-error-700">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!counts) {
    return <Spinner className="mx-auto my-10" />
  }

  const items = [
    { icon: Users, label: 'Registrations', value: counts.registrations },
    { icon: CheckCircle2, label: 'Checked in', value: counts.checked_in },
    {
      icon: UserPlus,
      label: 'Connections',
      value: counts.connections_made,
      hint: 'made between attendees at this event',
    },
    {
      icon: Mail,
      label: 'Invitations',
      value: counts.invitations_pending,
      hint: `${counts.invitations_accepted} accepted`,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(({ icon: Icon, label, value, hint }) => (
          <Card key={label}>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-gray-400">
                <Icon className="h-4 w-4" />
                <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
              {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <Activity className="h-3.5 w-3.5" />
        Counts come straight from the database — no estimates or projections.
      </p>
    </div>
  )
}
