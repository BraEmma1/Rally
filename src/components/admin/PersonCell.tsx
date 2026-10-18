import { Avatar } from '@/components/ui/Avatar'
import type { ProfileName } from '@/lib/supabase'

// Name and avatar for an account. Without a profile card, show a short id
// rather than an email: admins cannot read email, and inventing a name is worse.
export function PersonCell({
  id,
  names,
  fallback,
}: {
  id: string | null
  names: Record<string, ProfileName>
  fallback?: string
}) {
  if (!id) return <span className="text-sm text-gray-500">{fallback ?? '—'}</span>
  const person = names[id]
  const name = person?.full_name?.trim()
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name || '?'} src={person?.photo_url || undefined} size="sm" className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">{name || 'Unnamed account'}</span>
        <span className="block truncate font-mono text-xs text-gray-400">{id.slice(0, 8)}</span>
      </span>
    </span>
  )
}
