import { Link } from 'react-router-dom'
import { CalendarRange } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/States'

// Honest coming-soon state for Event Mode features without backend data yet
// (Agenda, Speakers, Exhibitors, My Schedule, Map). No fake event content.
export default function EventComingSoonPage() {
  return (
    <div className="py-8">
      <Card>
        <CardContent>
          <EmptyState
            icon={<CalendarRange className="h-10 w-10" />}
            title="Coming soon"
            description="This event feature is not available yet. The organizer needs to publish supporting content first."
            action={
              <Link to=".." relative="path" className="text-sm font-medium text-primary-600 hover:text-primary-700">
                Back to event home
              </Link>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
