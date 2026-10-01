import { Link } from 'react-router-dom'
import type { SessionSpeaker } from '@/lib/speakers'
import { SPEAKER_ROLE_LABELS, type SpeakerRole } from '@/lib/speakers'
import { Avatar } from '@/components/ui/Avatar'

// Shared by the Agenda and My Schedule session detail dialogs. Both pass the
// speakers for the open session and a link builder so speaker taps stay inside
// Event Mode. Speakers are fetched once per page load and grouped by session,
// never queried per session.
export function SessionSpeakersSection({
  speakers,
  speakerLink,
}: {
  speakers: SessionSpeaker[]
  speakerLink: (speakerId: string) => string
}) {
  if (speakers.length === 0) return null
  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Speakers</h3>
      <ul className="mt-2 space-y-2">
        {speakers.map((s) => (
          <li key={s.speaker_id}>
            <Link
              to={speakerLink(s.speaker_id)}
              className="flex items-center gap-3 rounded-lg p-2 -m-2 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Avatar name={s.full_name} src={s.photo_url || null} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{s.full_name}</p>
                <p className="truncate text-xs text-gray-500">
                  {SPEAKER_ROLE_LABELS[s.speaker_role as SpeakerRole] ?? s.speaker_role}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
