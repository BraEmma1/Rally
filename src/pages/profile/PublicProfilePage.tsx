import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Users, Mail, Phone, Globe, Linkedin, MapPin, Briefcase, Building2 } from 'lucide-react'
import { supabase, type Profile } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState } from '@/components/ui/States'

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setError('Invalid profile link.')
      setLoading(false)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (queryError) {
          setError(queryError.message)
        } else if (!data) {
          setError('Profile not found.')
        } else {
          setProfile(data as Profile)
        }
        setLoading(false)
      })
  }, [id])

  if (loading) return <LoadingState message="Loading profile…" />
  if (error || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="max-w-sm">
          <ErrorState message={error || 'Profile not found.'} />
          <div className="mt-4 text-center">
            <Link to="/" className="text-sm font-medium text-primary-600 hover:text-primary-700">
              Go to Rally
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const displayName = profile.full_name || 'Professional'
  const hasContact = profile.email || profile.phone || profile.linkedin || profile.website
  const hasNetworking = profile.looking_for || profile.can_offer

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header bar */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold text-gray-900">Rally</span>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* Profile header card */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Avatar name={displayName} src={profile.photo_url} size="xl" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{displayName}</h1>
                {profile.job_title && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-600">
                    <Briefcase className="h-3.5 w-3.5" /> {profile.job_title}
                  </p>
                )}
                {profile.company && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-600">
                    <Building2 className="h-3.5 w-3.5" /> {profile.company}
                  </p>
                )}
                {profile.location && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" /> {profile.location}
                  </p>
                )}
                {profile.industry && (
                  <Badge variant="primary" className="mt-2">{profile.industry}</Badge>
                )}
              </div>
            </div>

            {profile.bio && (
              <p className="mt-4 text-sm leading-relaxed text-gray-700">{profile.bio}</p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {hasNetworking && (
              <Card>
                <CardContent className="space-y-4 pt-5">
                  <h2 className="text-base font-semibold text-gray-900">Networking</h2>
                  {profile.looking_for && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Looking for</p>
                      <p className="mt-1 text-sm text-gray-700">{profile.looking_for}</p>
                    </div>
                  )}
                  {profile.can_offer && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Can offer</p>
                      <p className="mt-1 text-sm text-gray-700">{profile.can_offer}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {hasContact && (
              <Card>
                <CardContent className="space-y-3 pt-5">
                  <h2 className="text-base font-semibold text-gray-900">Contact & Links</h2>
                  {profile.email && (
                    <a href={`mailto:${profile.email}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Mail className="h-4 w-4 text-gray-400" /> {profile.email}
                    </a>
                  )}
                  {profile.phone && (
                    <a href={`tel:${profile.phone}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Phone className="h-4 w-4 text-gray-400" /> {profile.phone}
                    </a>
                  )}
                  {profile.linkedin && (
                    <a href={profile.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Linkedin className="h-4 w-4 text-gray-400" /> {profile.linkedin.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {profile.website && (
                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Globe className="h-4 w-4 text-gray-400" /> {profile.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <Card>
              <CardContent className="flex flex-col items-center gap-3 pt-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <Users className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-gray-900">Connect on Rally</p>
                <p className="text-xs text-gray-500">
                  Join Rally to manage your professional network and event connections.
                </p>
                <Link
                  to="/signup"
                  className="mt-1 w-full rounded-md bg-primary-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-700"
                >
                  Get started
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
