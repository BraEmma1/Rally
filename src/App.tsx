import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  OrganizerProvider,
  useOrganizer,
} from '@/context/OrganizerContext'
import { isProfileComplete } from '@/lib/profile'
import {
  accountHomePath,
  isActiveAttendee,
  isActiveOrganizer,
  isActivePlatformAdmin,
} from '@/lib/routing'
import { Spinner } from '@/components/ui/States'
import AppLayout from '@/components/AppLayout'
import EventModeLayout from '@/components/eventmode/EventModeLayout'
import { EventModeProvider } from '@/context/EventModeContext'
import OrganizerLayout from '@/components/OrganizerLayout'
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
import MessagesInboxPage from '@/pages/messages/MessagesInboxPage'
import ConversationPage from '@/pages/messages/ConversationPage'
import NotificationsPage from '@/pages/notifications/NotificationsPage'
import EventHomePage from '@/pages/eventmode/EventHomePage'
import EventNetworkPage from '@/pages/eventmode/EventNetworkPage'
import EventComingSoonPage from '@/pages/eventmode/EventComingSoonPage'
import OrganizationInvitationsPage from '@/pages/organizer/OrganizationInvitationsPage'
import AccountStatusPage from '@/pages/account/AccountStatusPage'
import AdminPlaceholderPage from '@/pages/admin/AdminPlaceholderPage'
import OrganizerDashboardPage from '@/pages/organizer/OrganizerDashboardPage'
import OrganizationSetupPage from '@/pages/organizer/OrganizationSetupPage'
import OrganizationSettingsPage from '@/pages/organizer/OrganizationSettingsPage'
import TeamPage from '@/pages/organizer/TeamPage'
import MyInvitationsPage from '@/pages/organizer/MyInvitationsPage'
import EventsListPage from '@/pages/organizer/EventsListPage'
import EventFormPage from '@/pages/organizer/EventFormPage'
import OrganizerEventDetailPage from '@/pages/organizer/EventDetailPage'
import PeoplePage from '@/pages/organizer/PeoplePage'

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  )
}

// Signed out? Carry any query (e.g. ?invitation=) into the login screen so it
// survives the round trip and can be honored after sign-in.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, isRecovery } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (!session) {
    return <Navigate to={{ pathname: '/login', search: location.search }} replace />
  }
  // A recovery grant is a session, but it is not a sign-in: it came from opening
  // a link in an inbox, not from proving knowledge of the password. Keep it on
  // the reset screen until a new password is set or the user signs out.
  if (isRecovery) return <Navigate to="/reset-password" replace />
  return <>{children}</>
}

// The account type gate. Types are mutually exclusive, so a mismatch is not an
// error to report — it means the user is somewhere they do not belong, and the
// honest response is to put them where they do. This is a convenience, not a
// security boundary: every read and write behind it is authorized again by RLS
// against account_type and status.
function RequireAccount({
  allow,
  children,
}: {
  allow: (account: ReturnType<typeof useAuth>['account']) => boolean
  children: React.ReactNode
}) {
  const { account, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!allow(account)) return <Navigate to={accountHomePath(account)} replace />
  return <>{children}</>
}

// The attendee app additionally requires a usable professional profile, which
// is what the whole attendee experience is built around. Organizers are not
// sent through it: their onboarding is creating an organization.
function RequireCompleteProfile({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  if (profile && !isProfileComplete(profile)) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

// An active organization membership — owner, admin or event manager — opens the
// organization area, whatever the person's primary account type is. An attendee
// on a team and an organizer account both pass; what each may do inside is
// decided by the backend, page by page, from the same membership.
function RequireOrganizationAccess({ children }: { children: React.ReactNode }) {
  const { memberships, loading } = useOrganizer()
  const { account } = useAuth()
  if (loading) return <FullPageSpinner />
  if (memberships.length === 0) {
    // An organizer account with no organization yet still owns this area: the
    // inner guard sends them to setup. Anyone else — an attendee whose
    // membership was revoked, say — has no organization home to show.
    if (account?.account_type === 'organizer' && account.status === 'active') {
      return <>{children}</>
    }
    return <Navigate to={accountHomePath(account)} replace />
  }
  return <>{children}</>
}

// An organizer with no organization has nothing to show, so the organizer area
// redirects to setup until they have one — except setup itself, which is where
// they either create one or accept an invitation to join one.
function RequireOrganization({ children }: { children: React.ReactNode }) {
  const { memberships, loading } = useOrganizer()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (memberships.length === 0 && location.pathname !== '/organizer/setup') {
    return <Navigate to="/organizer/setup" replace />
  }
  return <>{children}</>
}

// Where a signed-in user goes when they hit a route that is not theirs, or the
// catch-all. Reads the account rather than assuming the attendee dashboard.
function AccountHomeRedirect() {
  const { account, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  return <Navigate to={accountHomePath(account)} replace />
}

// Entry for organization-invitation emails, which link here with
// `?invitation=<id>`. With that parameter the link is an invitation context,
// not an organizer-area page: it opens the existing invitation review/accept
// experience for whoever is signed in, regardless of account type — accepting
// is decided by the invitation RPCs, not the account type. Without the
// parameter this is the organizer's own invitations screen inside the organizer
// area, guarded exactly as before.
function OrganizerInvitationsEntry() {
  const [searchParams] = useSearchParams()
  if (searchParams.has('invitation')) return <OrganizationInvitationsPage />
  return (
    <RequireOrganizationAccess>
      <RequireOrganization>
        <OrganizerLayout />
      </RequireOrganization>
    </RequireOrganizationAccess>
  )
}

export default function App() {
  const { session, account, loading, isRecovery } = useAuth()

  if (loading) return <FullPageSpinner />

  // Signed-in users are bounced off the auth screens to wherever their account
  // type says they belong — not to /dashboard, which only attendees have.
  const signedIn = session && !isRecovery
  const home = accountHomePath(account)

  return (
    <OrganizerProvider>
      <Routes>
      {/* `session && !isRecovery` throughout: during recovery a session exists,
          and treating it as a normal sign-in is what sent "Back to sign in" to
          the dashboard instead of the login screen. */}
      <Route path="/login" element={signedIn ? <Navigate to={home} replace /> : <LoginPage />} />
      <Route path="/signup" element={signedIn ? <Navigate to={home} replace /> : <SignUpPage />} />
      <Route
        path="/forgot-password"
        element={signedIn ? <Navigate to={home} replace /> : <ForgotPasswordPage />}
      />
      {/* A recovery link signs the user in before they reach this page, so the
          form has to stay reachable while a session exists. */}
      <Route
        path="/reset-password"
        element={signedIn ? <Navigate to={home} replace /> : <ResetPasswordPage />}
      />
      {/* Where the email confirmation link lands. Must not be session-gated:
          verification signs the user in, and the page routes them onward. */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/p/:id" element={<PublicProfilePage />} />

      {/* Pending approval, suspended, vendor, sponsor, or a missing account
          record. Any signed-in user may reach it; it redirects them onward if
          their account turns out to have a home. */}
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountStatusPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <RequireAccount allow={isActivePlatformAdmin}>
              <AdminPlaceholderPage />
            </RequireAccount>
          </ProtectedRoute>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* Organizer — entry by account type (organizer) OR by an active        */}
      {/* organization membership (e.g. an attendee on a team).                */}
      {/* ------------------------------------------------------------------ */}
      <Route
        path="/organizer/setup"
        element={
          <ProtectedRoute>
            <RequireAccount allow={isActiveOrganizer}>
              <OrganizationSetupPage />
            </RequireAccount>
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <RequireOrganizationAccess>
              <RequireOrganization>
                <OrganizerLayout />
              </RequireOrganization>
            </RequireOrganizationAccess>
          </ProtectedRoute>
        }
      >
        <Route path="/organizer" element={<OrganizerDashboardPage />} />
        <Route path="/organizer/events" element={<EventsListPage />} />
        {/* Ordered before :id so "new" is not read as an event id. */}
        <Route path="/organizer/events/new" element={<EventFormPage />} />
        <Route path="/organizer/events/:id" element={<OrganizerEventDetailPage />} />
        <Route path="/organizer/events/:id/edit" element={<EventFormPage />} />
        <Route path="/organizer/people" element={<PeoplePage />} />
        <Route path="/organizer/team" element={<TeamPage />} />
        <Route path="/organizer/settings" element={<OrganizationSettingsPage />} />
      </Route>

      {/* Email invitation entry. Standalone from the organizer area: with
          ?invitation= it must reach the existing invitation experience for any
          signed-in user; without it, the entry re-applies the same guards and
          the index route renders the organizer's invitations screen inside the
          organizer layout. */}
      <Route
        path="/organizer/invitations"
        element={
          <ProtectedRoute>
            <OrganizerInvitationsEntry />
          </ProtectedRoute>
        }
      >
        <Route index element={<MyInvitationsPage />} />
      </Route>

      {/* ------------------------------------------------------------------ */}
      {/* Attendee                                                            */}
      {/* ------------------------------------------------------------------ */}
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <RequireAccount allow={isActiveAttendee}>
              <OnboardingPage />
            </RequireAccount>
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <RequireAccount allow={isActiveAttendee}>
              <RequireCompleteProfile>
                <AppLayout />
              </RequireCompleteProfile>
            </RequireAccount>
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

        {/* Event Mode — a dedicated shell for one event, its own nav and its
            own connect flow. Same attendee guards and profile gate as the main
            attendee app; the event id comes from the route itself. */}
        <Route
          element={
            <ProtectedRoute>
              <RequireAccount allow={isActiveAttendee}>
                <RequireCompleteProfile>
                  <EventModeProvider>
                    <EventModeLayout />
                  </EventModeProvider>
                </RequireCompleteProfile>
              </RequireAccount>
            </ProtectedRoute>
          }
        >
          <Route path="/events/:eventId/home" element={<EventHomePage />} />
          <Route path="/events/:eventId/network" element={<EventNetworkPage />} />
          <Route path="/events/:eventId/info" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/agenda" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/speakers" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/exhibitors" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/schedule" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/map" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/deal-room" element={<EventComingSoonPage />} />
          <Route path="/events/:eventId/coming-soon" element={<EventComingSoonPage />} />
        </Route>

        <Route path="/follow-ups" element={<FollowUpsPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        <Route path="/messages" element={<MessagesInboxPage />} />
        <Route path="/messages/:conversationId" element={<ConversationPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/invitations/organizations" element={<OrganizationInvitationsPage />} />
      </Route>

      <Route
        path="*"
        element={
          <ProtectedRoute>
            <AccountHomeRedirect />
          </ProtectedRoute>
        }
      />
      </Routes>
    </OrganizerProvider>
  )
}
