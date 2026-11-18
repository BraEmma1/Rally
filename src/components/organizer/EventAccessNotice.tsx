import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/States'
import type { EventAccess } from '@/lib/eventAccess'

// What an organizer event page shows when the caller may not (yet) manage the
// event: still checking, could not tell, or no. One component so the event
// page, the edit form and partner detail all answer a direct link the same way
// they answer navigation.
export function EventAccessNotice({
  access,
  onRetry,
}: {
  access: Exclude<EventAccess, { state: 'manage' }>
  onRetry: () => void
}) {
  if (access.state === 'checking') return <LoadingState message="Checking your access…" />
  if (access.state === 'error') return <ErrorState message={access.message} onRetry={onRetry} />

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold text-gray-900">You don't manage this event</h1>
        <p className="max-w-md text-sm text-gray-500">
          Event managers can open only the events assigned to them. An owner or admin of your
          organization can assign this event to you from the Team page.
        </p>
        <Link to="/organizer/events">
          <Button variant="secondary">Back to events</Button>
        </Link>
      </CardContent>
    </Card>
  )
}
