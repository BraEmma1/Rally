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

export type Connection = {
  id: string
  owner_id: string
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
  due_date: string
  completed: boolean
  completed_at: string | null
  created_at: string
}

export type EventRow = {
  id: string
  owner_id: string
  name: string
  description: string
  location: string
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
}

export const RELATIONSHIP_TYPES = [
  'Client',
  'Prospect',
  'Partner',
  'Mentor',
  'Investor',
  'Colleague',
  'Recruiter',
  'Other',
] as const
