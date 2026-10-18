import { Link } from 'react-router-dom'
import { ArrowLeft, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

// A truthful placeholder for an admin page whose functionality has not shipped.
// It shows no data and no action buttons — only what the page will do and what
// it is waiting on — so nothing here can be mistaken for a working control.
type ComingNextContent = {
  title: string
  summary: string
  planned: string[]
  waitingOn: string
}

export type ComingNextPageKey = 'events' | 'partnerships' | 'analytics'

const COMING_NEXT: Record<ComingNextPageKey, ComingNextContent> = {
  events: {
    title: 'Events',
    summary: 'A platform-wide event directory.',
    planned: ['Search and filter events', 'Organization, dates, status and registration counts'],
    waitingOn:
      'Backend support. Draft, unlisted and archived events are private to each organization, so a complete directory needs an admin read function.',
  },
  partnerships: {
    title: 'Partnerships',
    summary: 'Sponsor organizations and event partnerships across the platform.',
    planned: ['Partnership status by event', 'Sponsor organizations', 'Deliverable progress where permitted'],
    waitingOn:
      'Backend support. Partnership data is readable only by each event’s organizers; private notes and documents will stay excluded.',
  },
  analytics: {
    title: 'Analytics',
    summary: 'Platform growth and activity over time, with stated date ranges and definitions.',
    planned: ['User growth and account type distribution', 'Event, registration, organization and partnership trends'],
    waitingOn:
      'Backend support for event, organization and partnership figures. Charts will only appear where the data supports them.',
  },
}

export default function AdminComingNextPage({ page }: { page: ComingNextPageKey }) {
  const content = COMING_NEXT[page]
  return (
    <div>
      <AdminPageHeader title={content.title} description={content.summary} />
      <Card>
        <CardContent className="space-y-5 py-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Not available yet</p>
              <p className="mt-1 text-sm text-gray-600">{content.waitingOn}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Planned</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
              {content.planned.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to overview
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
