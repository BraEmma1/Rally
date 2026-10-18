import { supabase } from '@/lib/supabase'
import type {
  AdminOrganizationDetail,
  AdminOrganizationRow,
  AdminPage,
  OrgApprovalStatus,
  OrgType,
} from '@/lib/supabase'
import { readableError } from '@/lib/admin'

// Organization data for the platform admin workspace, read only through the
// admin_list_organizations and admin_get_organization functions. Both refuse
// unless the caller is an active platform admin and return a fixed set of
// fields: no member emails, no invitee addresses. There is deliberately no
// direct organizations query here — RLS gives an admin no read policy on that
// table, and the functions are the reviewed way in.

export type OrganizationSort = 'newest' | 'oldest' | 'name'

export type OrganizationQuery = {
  search?: string
  type?: OrgType | 'all'
  approval?: OrgApprovalStatus | 'all'
  includeArchived?: boolean
  sort?: OrganizationSort
  page: number
  pageSize: number
}

export async function listOrganizations(
  query: OrganizationQuery
): Promise<{ data: AdminPage<AdminOrganizationRow> | null; error: string | null }> {
  const search = query.search?.trim()
  const { data, error } = await supabase.rpc('admin_list_organizations', {
    p_search: search ? search : null,
    p_org_type: query.type && query.type !== 'all' ? query.type : null,
    p_approval_status: query.approval && query.approval !== 'all' ? query.approval : null,
    p_include_archived: Boolean(query.includeArchived),
    p_sort: query.sort ?? 'newest',
    p_limit: query.pageSize,
    p_offset: query.page * query.pageSize,
  })
  if (error) return { data: null, error: readableError(error, 'Could not load organizations.') }
  return { data: data as AdminPage<AdminOrganizationRow>, error: null }
}

// null data with no error means there is no organization with that id.
export async function getOrganization(
  organizationId: string
): Promise<{ data: AdminOrganizationDetail | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_get_organization', { p_org_id: organizationId })
  if (error) return { data: null, error: readableError(error, 'Could not load this organization.') }
  return { data: (data as AdminOrganizationDetail | null) ?? null, error: null }
}
