import { supabase } from '@/lib/supabase'

export type SponsorPartnership = {
  partnership_id: string
  event_id: string
  event_name: string
  event_start_date: string | null
  event_end_date: string | null
  event_location: string | null
  event_status: 'upcoming' | 'live' | 'past' | string | null
  event_archived: boolean
  organizer_organization_id: string | null
  organizer_organization_name: string | null
  organizer_organization_logo_url: string | null
  sponsor_organization_id: string
  sponsor_organization_name: string | null
  company_name: string | null
  tier_label: string | null
  status: 'active' | 'completed' | 'cancelled' | string
  acknowledged_at: string | null
  created_at: string | null
  value_amount: number | null
  value_currency: string | null
  roles: string[]
  deliverables_total: number
  deliverables_completed: number
  requirements_total: number
  requirements_completed: number
  overall_total: number
  overall_completed: number
  overall_percent: number | null
}

export async function listMySponsorPartnerships(): Promise<{
  data: SponsorPartnership[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('my_sponsor_partnerships')
  if (error) {
    console.error('Sponsor partnerships could not load:', error)
    return { data: [], error: 'We could not load your partnerships.' }
  }

  return { data: (data as SponsorPartnership[]) ?? [], error: null }
}
