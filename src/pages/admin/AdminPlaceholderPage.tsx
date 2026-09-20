import { useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'

// Platform Admin is a separate account type with its own experience, which is
// not part of this phase. The screen exists so an admin signing in lands
// somewhere truthful instead of being routed into the attendee or organizer
// app — the two things the account model says they are not.
export default function AdminPlaceholderPage() {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Users className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Platform administration</h1>
            <p className="mt-1 text-sm text-gray-500">
              Signed in as {profile?.full_name || user?.email}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">The admin dashboard is not built yet</p>
                <p className="mt-1 text-sm text-gray-600">
                  Approving organizer accounts and organizations currently happens through direct
                  database access, deliberately: there is no in-app path that can grant platform
                  authority, so there is nothing to take over if an account is compromised.
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => void signOut().then(() => navigate('/login'))}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
