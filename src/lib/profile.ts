import type { Profile } from '@/lib/supabase'

export const REQUIRED_FIELDS: (keyof Profile)[] = [
  'full_name',
  'job_title',
  'company',
  'industry',
  'location',
  'bio',
]

export const ALL_PROFILE_FIELDS: (keyof Profile)[] = [
  'full_name',
  'photo_url',
  'job_title',
  'company',
  'industry',
  'location',
  'bio',
  'looking_for',
  'can_offer',
  'linkedin',
  'website',
  'email',
  'phone',
]

export function isFieldFilled(profile: Partial<Profile> | null, field: keyof Profile): boolean {
  if (!profile) return false
  const value = profile[field]
  if (typeof value === 'string') return value.trim().length > 0
  return value != null
}

export function getCompletionPercentage(profile: Partial<Profile> | null): number {
  if (!profile) return 0
  const filled = ALL_PROFILE_FIELDS.filter((f) => isFieldFilled(profile, f)).length
  return Math.round((filled / ALL_PROFILE_FIELDS.length) * 100)
}

export function getCompletionCount(profile: Partial<Profile> | null): { filled: number; total: number } {
  if (!profile) return { filled: 0, total: ALL_PROFILE_FIELDS.length }
  return {
    filled: ALL_PROFILE_FIELDS.filter((f) => isFieldFilled(profile, f)).length,
    total: ALL_PROFILE_FIELDS.length,
  }
}

export function getMissingRequiredFields(profile: Partial<Profile> | null): (keyof Profile)[] {
  if (!profile) return REQUIRED_FIELDS
  return REQUIRED_FIELDS.filter((f) => !isFieldFilled(profile, f))
}

export function isProfileComplete(profile: Partial<Profile> | null): boolean {
  if (!profile) return false
  return getMissingRequiredFields(profile).length === 0
}

export const FIELD_LABELS: Record<keyof Profile, string> = {
  id: 'ID',
  full_name: 'Full name',
  photo_url: 'Profile photo',
  job_title: 'Job title',
  company: 'Company',
  industry: 'Industry',
  location: 'Location',
  bio: 'Bio',
  looking_for: "What I'm looking for",
  can_offer: 'What I can offer',
  linkedin: 'LinkedIn',
  website: 'Website',
  email: 'Email',
  phone: 'Phone / WhatsApp',
  created_at: 'Created',
  updated_at: 'Updated',
}

export const INDUSTRIES = [
  'Technology',
  'Finance',
  'Healthcare',
  'Education',
  'Marketing & Advertising',
  'Consulting',
  'Real Estate',
  'Manufacturing',
  'Retail & E-commerce',
  'Media & Entertainment',
  'Legal',
  'Nonprofit',
  'Government',
  'Hospitality',
  'Construction',
  'Energy',
  'Transportation',
  'Agriculture',
  'Other',
] as const
