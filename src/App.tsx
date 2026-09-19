import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { isProfileComplete } from '@/lib/profile'
import { Spinner } from '@/components/ui/States'
import AppLayout from '@/components/AppLayout'
import LoginPage from '@/pages/auth/LoginPage'
import SignUpPage from '@/pages/auth/SignUpPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import AuthCallbackPage from '@/pages/auth/AuthCallbackPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import ProfilePage from '@/pages/profile/ProfilePage'
import PublicProfilePage from '@/pages/profile/PublicProfilePage'
import OnboardingPage from '@/pages/onboarding/OnboardingPage'
import ScanQRPage from '@/pages/scan/ScanQRPage'
import ConnectionsPage from '@/pages/connections/ConnectionsPage'
import ConnectionDetailPage from '@/pages/connections/ConnectionDetailPage'
import EventsPage from '@/pages/events/EventsPage'
import EventDetailPage from '@/pages/events/EventDetailPage'
import FollowUpsPage from '@/pages/followups/FollowUpsPage'
import OpportunitiesPage from '@/pages/opportunities/OpportunitiesPage'
import OpportunityDetailPage from '@/pages/opportunities/OpportunityDetailPage'
import NotificationsPage from '@/pages/notifications/NotificationsPage'

function ProtectedRoute({ children, requireComplete = false }: { children: React.ReactNode; requireComplete?: boolean }) {
  const { session, profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (requireComplete && profile && !isProfileComplete(profile)) {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

export default function App() {
  const { session, loading, isRecovery } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/signup" element={session ? <Navigate to="/dashboard" replace /> : <SignUpPage />} />
      <Route path="/forgot-password" element={session ? <Navigate to="/dashboard" replace /> : <ForgotPasswordPage />} />
      {/* A recovery link signs the user in before they reach this page, so the
          form has to stay reachable while a session exists. */}
      <Route
        path="/reset-password"
        element={session && !isRecovery ? <Navigate to="/dashboard" replace /> : <ResetPasswordPage />}
      />
      {/* Where the email confirmation link lands. Must not be session-gated:
          verification signs the user in, and the page routes them onward. */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/p/:id" element={<PublicProfilePage />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute requireComplete>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/scan" element={<ScanQRPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/connections/:id" element={<ConnectionDetailPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/follow-ups" element={<FollowUpsPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
