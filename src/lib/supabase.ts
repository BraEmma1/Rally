import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export type Profile = {
  id: string
  full_name: string
  photo_url: string
  job_title: string
  company: string
  industry: string
  location: string
  bio: string
  looking_for: string
  can_offer: string
  linkedin: string
  website: string
  email: string
  phone: string
  created_at: string
  updated_at: string
}

// What another user is allowed to see: the public professional card.
// Returned by the get_public_profile / get_public_profiles RPCs — no email or phone.
export type PublicProfile = {
  id: string
  full_name: string
  photo_url: string
  job_title: string
  company: string
  industry: string
  location: string
  bio: string
  looking_for: string
  can_offer: string
  linkedin: string
  website: string
}

// The card plus contact details, returned by get_connect_profile for the
// QR / share-link flow where the two parties are deliberately exchanging details.
export type ConnectProfile = PublicProfile & {
  email: string
  phone: string
}

export type Connection = {
  id: string
  owner_id: string
  connected_user_id: string | null
  full_name: string
  job_title: string
  company: string
  industry: string
  location: string
  email: string
  phone: string
  linkedin: string
  website: string
  photo_url: string
  relationship_type: string
  event_name: string
  event_id: string | null
  follow_up_date: string | null
  status: string
  created_at: string
  updated_at: string
}

export type Note = {
  id: string
  connection_id: string
  owner_id: string
  content: string
  created_at: string
  updated_at: string
}

export type FollowUp = {
  id: string
  connection_id: string
  owner_id: string
  title: string
  note: string
  due_date: string
  completed: boolean
  completed_at: string | null
  created_at: string
}

export type EventRow = {
  id: string
  owner_id: string | null
  name: string
  description: string
  location: string
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  image_url: string
  capacity: number | null
  status: string
  created_at: string
}

export type EventRegistration = {
  id: string
  event_id: string
  user_id: string
  created_at: string
}

export type EventInvitation = {
  id: string
  event_id: string
  invited_user_id: string
  invited_by: string
  status: string
  created_at: string
  responded_at: string | null
}

export type AppNotification = {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  link: string
  read: boolean
  created_at: string
}

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  new_connection: 'New connection',
  event_invitation: 'Event invitation',
  invitation_accepted: 'Invitation accepted',
  invitation_declined: 'Invitation declined',
  follow_up_due: 'Follow-up due',
  follow_up_overdue: 'Follow-up overdue',
  opportunity_stage_changed: 'Opportunity update',
  event_registration: 'Registration confirmed',
  upcoming_event: 'Upcoming event',
}

export type Opportunity = {
  id: string
  owner_id: string
  connection_id: string
  title: string
  description: string
  type: string
  stage: string
  value: number
  expected_close_date: string | null
  event_name: string
  event_id: string | null
  created_at: string
  updated_at: string
}

export const OPPORTUNITY_TYPES = [
  'Sales',
  'Investment',
  'Partnership',
  'Recruitment',
  'Mentorship',
  'Other',
] as const

export const OPPORTUNITY_STAGES = [
  'New',
  'Discussing',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
] as const

export const RELATIONSHIP_TYPES = [
  'Customer',
  'Investor',
  'Partner',
  'Supplier',
  'Employer',
  'Employee',
  'Mentor',
  'Media',
  'Other',
] as const

// ---------------------------------------------------------------------------
// Account model
//
// account_type is the authoritative answer to "what is this user". It is set by
// the signup trigger and changed only by a platform admin through an audited
// RPC; there is no client write path, and the types are mutually exclusive by
// design — an organizer is not also an attendee.
// ---------------------------------------------------------------------------
export type AccountType = 'platform_admin' | 'organizer' | 'attendee' | 'vendor' | 'sponsor'
export type AccountStatus = 'pending_approval' | 'active' | 'suspended'

export type UserAccount = {
  account_type: AccountType
  status: AccountStatus
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  platform_admin: 'Platform admin',
  organizer: 'Organizer',
  attendee: 'Attendee',
  vendor: 'Vendor',
  sponsor: 'Sponsor',
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export type OrgRole = 'owner' | 'admin' | 'manager'
export type OrgType = 'organizer' | 'vendor' | 'sponsor'
export type OrgApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended'

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Event manager',
}

export const ORG_ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: 'Full control, including team and ownership.',
  admin: 'Manages the organization, its events and its team.',
  manager: 'Runs the events they are assigned to.',
}

export type Organization = {
  id: string
  name: string
  slug: string | null
  description: string
  logo_url: string
  website: string
  org_type: OrgType
  approval_status: OrgApprovalStatus
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type OrganizationMembership = {
  role: OrgRole
  organization: Organization
}

// Returned by organization_member_directory: the public professional card only.
// No email or phone — a teammate is not entitled to more than any other user.
export type OrganizationMember = {
  user_id: string
  role: OrgRole
  created_at: string
  full_name: string
  job_title: string
  company: string
  photo_url: string
  is_self: boolean
}

export type OrganizationInvitation = {
  id: string
  invited_user_id: string
  invited_email: string
  role: OrgRole
  status: 'pending' | 'accepted' | 'declined' | 'revoked'
  created_at: string
  responded_at: string | null
  full_name: string
}

export type IncomingInvitation = {
  id: string
  organization_id: string
  organization_name: string
  organization_type: OrgType
  role: OrgRole
  created_at: string
  invited_by_name: string
}

// ---------------------------------------------------------------------------
// Organizer events
//
// The five lifecycle states are derived from three existing columns rather
// than a new one: visibility (draft/published/unlisted), status
// (upcoming/live/past) and archived_at. See eventLifecycle() in lib/events.ts.
// ---------------------------------------------------------------------------
export type EventVisibility = 'draft' | 'published' | 'unlisted'
export type EventTimeStatus = 'upcoming' | 'live' | 'past'

export type OrganizerEvent = {
  id: string
  organization_id: string | null
  created_by: string | null
  owner_id: string | null
  name: string
  description: string
  location: string
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  image_url: string
  capacity: number | null
  visibility: EventVisibility
  status: EventTimeStatus
  archived_at: string | null
  published_at: string | null
  created_at: string
}

// Returned by event_attendee_list. The public professional card only — no
// email or phone, by design.
export type EventAttendee = {
  user_id: string
  full_name: string
  job_title: string
  company: string
  photo_url: string
  registered_at: string
  status: string
  checked_in_at: string | null
}

export type EventInvitationRow = {
  id: string
  invited_user_id: string
  invited_email: string
  full_name: string
  status: 'Pending' | 'Accepted' | 'Declined'
  created_at: string
  responded_at: string | null
}

export type OrganizationPerson = {
  user_id: string
  full_name: string
  job_title: string
  company: string
  photo_url: string
  events_registered: number
  first_seen: string
  last_seen: string
}
