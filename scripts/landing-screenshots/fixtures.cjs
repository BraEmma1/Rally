// Fictional sample data for the landing-page screenshots. Every person, company and event
// here is invented; ids are fixed so the capture is repeatable. Nothing here is a credential
// and nothing reaches a real Supabase project: capture.cjs answers the app's requests from
// these objects inside the browser.
//
// Avatars are left empty on purpose so the app renders initials: the marketing page must not
// imply that anyone photographed uses or endorses Rally (Pexels licence).

const ORG_UID = '11111111-1111-4111-8111-111111111111' // organizer persona
const ATT_UID = '44444444-4444-4444-8444-444444444444' // attendee persona
const ORG = 'org-volta'
const BANNER = '/landing/photos/room-mingling-1800.webp'

const iso = (d, t = '09:00:00') => `${d}T${t}Z`

const profileOf = (id, full_name, job_title, company, industry, location, extra = {}) => ({
  id, full_name, photo_url: '', job_title, company, industry, location,
  bio: 'Fictional sample profile.', looking_for: 'Partners and customers', can_offer: 'Introductions',
  linkedin: '', website: '', email: '', phone: '', created_at: '2026-01-10', updated_at: '2026-01-10', ...extra,
})

const organizerProfile = profileOf(ORG_UID, 'Esi Quaye', 'Founder & Programme Director', 'Volta Forum', 'Media & Entertainment', 'Accra, Ghana')
const attendeeProfile = profileOf(ATT_UID, 'Kwabena Adjei', 'Head of Growth', 'Riverline Freight', 'Transportation', 'Accra, Ghana', {
  bio: 'Building cross-border freight for West African exporters.',
  looking_for: 'Logistics partners, investors',
  can_offer: 'Route data, customs know-how',
})

// ---- events ------------------------------------------------------------------------------
const event = (id, name, over = {}) => ({
  id, name, description: '', location: 'Accra, Ghana', start_date: '2027-03-12', end_date: null,
  start_time: '09:00:00', end_time: '17:30:00', image_url: '', capacity: null, status: 'upcoming',
  timezone: 'Africa/Accra', created_at: '2026-08-01', owner_id: ORG_UID, created_by: ORG_UID,
  organization_id: ORG, visibility: 'published', archived_at: null, published_at: '2026-09-01T10:00:00Z', ...over,
})

const events = [
  event('e-summit', 'Accra Founders Summit 2027', {
    description:
      'Two days for founders, operators and investors building across West Africa: keynotes, sector tracks, ' +
      'investor office hours and structured networking.',
    location: 'Riverside Convention Centre, Accra', start_date: '2027-03-12', end_date: '2027-03-13',
    capacity: 300, status: 'live', image_url: BANNER,
  }),
  event('e-fintech', 'Women in Fintech Breakfast', {
    description: 'A morning of candid conversation with women building payments, lending and insurance products.',
    location: 'Osu, Accra', start_date: '2027-04-08', start_time: '08:00:00', end_time: '11:00:00', capacity: 80,
    image_url: '/landing/photos/networking-smile-1800.webp',
  }),
  event('e-agri', 'Kumasi Agritech Day', {
    location: 'Kumasi, Ghana', start_date: '2027-05-20', visibility: 'draft', published_at: null,
  }),
  event('e-logistics', 'West Africa Logistics Exchange', {
    location: 'Tema, Ghana', start_date: '2026-09-18', status: 'past', capacity: 200,
    image_url: '/landing/photos/badges-conversation-1800.webp',
  }),
]

const counts = {
  'e-summit': { registrations: 214, checked_in: 168, connections_made: 341 },
  'e-fintech': { registrations: 62, checked_in: 0, connections_made: 0 },
  'e-agri': { registrations: 0, checked_in: 0, connections_made: 0 },
  'e-logistics': { registrations: 187, checked_in: 171, connections_made: 296 },
}

// ---- people ------------------------------------------------------------------------------
const people = [
  ['Ama Boateng', 'Head of Partnerships', 'Meridian Microfinance', 'Finance', 'Accra, Ghana'],
  ['Tunde Adebayo', 'Founder & CEO', 'Ayo Health', 'Healthcare', 'Lagos, Nigeria'],
  ['Naledi Khumalo', 'Investment Associate', 'Northbridge Advisory', 'Finance', 'Johannesburg, South Africa'],
  ['Kofi Mensah', 'Operations Lead', 'Oduro Solar', 'Energy', 'Kumasi, Ghana'],
  ['Zainab Bello', 'Product Manager', 'Sable Analytics', 'Technology', 'Abuja, Nigeria'],
  ['Daniel Tetteh', 'Managing Partner', 'Harbor & Pine Legal', 'Legal', 'Accra, Ghana'],
  ['Grace Nyarko', 'Programme Officer', 'Asante Agro Co-op', 'Agriculture', 'Kumasi, Ghana'],
  ['Ibrahim Sesay', 'CTO', 'Lumen Health', 'Healthcare', 'Freetown, Sierra Leone'],
  ['Mariam Diallo', 'Country Director', 'Tide Mobile Money', 'Finance', 'Dakar, Senegal'],
  ['Yaw Darko', 'Founder', 'Nsuo Water Co.', 'Energy', 'Accra, Ghana'],
  ['Chiamaka Obi', 'Head of Talent', 'Sable Analytics', 'Technology', 'Lagos, Nigeria'],
  ['Joseph Kamau', 'Partner', 'Rift Valley Capital', 'Finance', 'Nairobi, Kenya'],
  ['Leila Haddad', 'Growth Lead', 'Atlas Courier', 'Transportation', 'Casablanca, Morocco'],
  ['Samuel Ofori', 'Analyst', 'Northbridge Advisory', 'Finance', 'Accra, Ghana'],
  ['Abena Asare', 'Founder', 'Adwen Learning', 'Education', 'Cape Coast, Ghana'],
  ['Peter Mwangi', 'Head of Sales', 'Oduro Solar', 'Energy', 'Nairobi, Kenya'],
].map(([full_name, job_title, company, industry, location], i) => ({
  user_id: `5a3e0000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  full_name, job_title, company, industry, location, photo_url: '',
}))

// The door list: the 16 named people first, then a generated roster so every screen agrees
// on 214 registered / 168 checked in (the counts the overview and analytics report).
const FIRST = ['Akosua', 'Emeka', 'Fatou', 'Kwame', 'Nana', 'Ayodele', 'Wanjiru', 'Kojo', 'Halima', 'Sipho', 'Adjoa', 'Musa', 'Thandiwe', 'Yaa', 'Obinna', 'Esther']
const LAST = ['Appiah', 'Okonkwo', 'Ndiaye', 'Owusu', 'Addo', 'Balogun', 'Njoroge', 'Quansah', 'Abdullahi', 'Dlamini', 'Frimpong', 'Konaté', 'Mbeki', 'Agyei', 'Eze', 'Lamptey']
const ROLES = [['Founder', 'Studio Tano'], ['Product Lead', 'Sable Analytics'], ['Associate', 'Rift Valley Capital'], ['Engineer', 'Lumen Health'], ['Operations Manager', 'Atlas Courier'], ['Analyst', 'Northbridge Advisory']]
const roster = [
  ...people,
  ...Array.from({ length: 214 - people.length }, (_, i) => {
    const [job_title, company] = ROLES[i % ROLES.length]
    return { user_id: `5a3e0000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`, full_name: `${FIRST[i % 16]} ${LAST[(i * 7 + 3) % 16]}`, job_title, company, industry: '', location: '', photo_url: '' }
  }),
]
const notYet = new Set([3, 6, 9, 10, 13, 15])
const isIn = (i) => (i < 16 ? !notYet.has(i) : i < 16 + 158)
const attendeeRows = roster.map((p, i) => ({
  user_id: p.user_id, full_name: p.full_name, job_title: p.job_title, company: p.company, photo_url: '',
  registered_at: iso(`2027-02-${String(10 + (i % 15)).padStart(2, '0')}`, '10:12:00'),
  status: isIn(i) ? 'checked_in' : 'registered',
  checked_in_at: isIn(i) ? new Date(Date.parse('2027-03-12T08:20:00Z') + i * 47000).toISOString() : null,
}))
const checkedIn = new Set(attendeeRows.map((r, i) => (r.checked_in_at ? i : -1)).filter((i) => i >= 0))

// ---- registration form -------------------------------------------------------------------
const summitForm = [
  { id: 'q1', position: 1, label: 'Company or organisation', help_text: null, kind: 'short_text', options: null, required: true },
  { id: 'q2', position: 2, label: 'Which track interests you most?', help_text: 'We use this to plan room sizes.', kind: 'single_choice', options: ['Fintech', 'Agritech', 'Climate & energy', 'Health'], required: true },
  { id: 'q3', position: 3, label: 'Who are you hoping to meet?', help_text: null, kind: 'multi_choice', options: ['Investors', 'Customers', 'Partners', 'Hires'], required: false },
  { id: 'q4', position: 4, label: 'Is this your first Founders Summit?', help_text: null, kind: 'yes_no', options: null, required: false },
  { id: 'q5', position: 5, label: 'Accessibility or dietary needs', help_text: null, kind: 'long_text', options: null, required: false },
]
const fintechForm = [
  { id: 'f1', position: 1, label: 'Company or organisation', help_text: null, kind: 'short_text', options: null, required: true },
  { id: 'f2', position: 2, label: 'Which area do you work in?', help_text: null, kind: 'single_choice', options: ['Payments', 'Lending', 'Insurance', 'Savings & investment'], required: true },
  { id: 'f3', position: 3, label: 'What would make this morning worth it?', help_text: null, kind: 'multi_choice', options: ['Meeting peers', 'Finding mentors', 'Hiring', 'Funding'], required: false },
]
const answerRows = people.slice(0, 8).map((p, i) => ({
  registration_id: 'r-' + i, user_id: p.user_id, full_name: p.full_name, job_title: p.job_title, company: p.company,
  registration_status: checkedIn.has(i) ? 'checked_in' : 'registered', registered_at: attendeeRows[i].registered_at,
  answers: [
    { question_id: 'q1', label: 'Company or organisation', kind: 'short_text', archived: false, answer: p.company },
    { question_id: 'q2', label: 'Which track interests you most?', kind: 'single_choice', archived: false, answer: ['Fintech', 'Health', 'Fintech', 'Climate & energy', 'Fintech', 'Agritech', 'Agritech', 'Health'][i] },
    { question_id: 'q3', label: 'Who are you hoping to meet?', kind: 'multi_choice', archived: false, answer: [['Investors', 'Partners'], ['Investors'], ['Customers'], ['Partners', 'Customers'], ['Hires'], ['Customers'], ['Partners'], ['Investors', 'Hires']][i] },
    { question_id: 'q4', label: 'Is this your first Founders Summit?', kind: 'yes_no', archived: false, answer: i % 3 === 0 },
  ],
  total: 214,
}))

// ---- agenda, speakers, exhibitors --------------------------------------------------------
const sess = (n, title, type, day, start, end, room, description, status = 'scheduled') => ({
  id: 's' + n, event_id: 'e-summit', title, description, start_at: iso(day, start), end_at: iso(day, end),
  location: room, session_type: type, status, display_order: n, created_by: null, created_at: '2026-10-01',
  updated_at: '2026-10-01', event_timezone: 'Africa/Accra',
})
const sessions = [
  sess(1, 'Registration and breakfast', 'networking', '2027-03-12', '08:00:00', '09:00:00', 'Main foyer', 'Collect your badge and meet the room.', 'ended'),
  sess(2, 'Opening keynote: Building for the next 400 million', 'keynote', '2027-03-12', '09:00:00', '09:45:00', 'Hall A', 'What it takes to build products for West Africa’s fastest-growing markets.', 'live'),
  sess(3, 'Panel: Cross-border payments without the friction', 'panel', '2027-03-12', '10:00:00', '11:00:00', 'Hall A', 'Operators and regulators on settlement, FX and instant payments.'),
  sess(4, 'Workshop: The first ten customers', 'workshop', '2027-03-12', '10:00:00', '11:30:00', 'Room 3', 'A hands-on session on early sales for technical founders.'),
  sess(5, 'Investor office hours', 'networking', '2027-03-12', '11:30:00', '13:00:00', 'Terrace', 'Fifteen-minute slots with early-stage investors.'),
  sess(6, 'Lunch', 'break', '2027-03-12', '13:00:00', '14:00:00', 'Terrace', ''),
  sess(7, 'Climate and energy track: Financing mini-grids', 'session', '2027-03-12', '14:00:00', '15:00:00', 'Room 2', 'Structuring blended finance for distributed energy.'),
  sess(8, 'Closing keynote: What lasts after the summit', 'keynote', '2027-03-13', '16:00:00', '16:45:00', 'Hall A', ''),
]
const speakers = [
  ['sp1', 'Dr. Efua Owusu', 'Director of Research', 'Coastal Policy Lab', 'Public Policy'],
  ['sp2', 'Tunde Adebayo', 'Founder & CEO', 'Ayo Health', 'Healthcare'],
  ['sp3', 'Mariam Diallo', 'Country Director', 'Tide Mobile Money', 'Finance'],
  ['sp4', 'Joseph Kamau', 'Partner', 'Rift Valley Capital', 'Venture Capital'],
  ['sp5', 'Naledi Khumalo', 'Investment Associate', 'Northbridge Advisory', 'Finance'],
  ['sp6', 'Yaw Darko', 'Founder', 'Nsuo Water Co.', 'Energy'],
].map(([id, full_name, job_title, company, industry], i) => ({
  id, event_id: 'e-summit', user_id: null, full_name, job_title, company, bio: 'Fictional sample speaker.',
  photo_url: '', linkedin: '', website: '', industry, display_order: i + 1, session_count: (i % 2) + 1,
}))
const sessionSpeakers = [
  ['sp1', 's2'], ['sp3', 's3'], ['sp4', 's3'], ['sp2', 's4'], ['sp5', 's5'], ['sp6', 's7'], ['sp1', 's8'],
].map(([sid, session_id], i) => {
  const s = speakers.find((x) => x.id === sid)
  return { speaker_id: sid, session_id, speaker_role: 'speaker', display_order: i, full_name: s.full_name, job_title: s.job_title, company: s.company, photo_url: '', user_id: null }
})
const exhibitors = [
  ['x1', 'Meridian Microfinance', 'Finance', 'Stand A1', 'Working-capital loans for small exporters, approved in days.'],
  ['x2', 'Oduro Solar', 'Energy', 'Stand A2', 'Solar and storage for clinics, schools and cold rooms.'],
  ['x3', 'Sable Analytics', 'Technology', 'Stand A3', 'Market data and dashboards for consumer brands.'],
  ['x4', 'Lumen Health', 'Healthcare', 'Stand B1', 'Appointment and records software for private clinics.'],
  ['x5', 'Atlas Courier', 'Transportation', 'Stand B2', 'Same-day delivery across Accra, Kumasi and Tema.'],
].map(([id, name, industry, booth, description], i) => ({
  id, event_id: 'e-summit', organization_id: null, name, description, logo_url: '', industry, booth,
  website: '', linkedin: '', display_order: i + 1,
}))

// ---- partnerships --------------------------------------------------------------------------
const partnerSummary = [
  { id: 'p-meridian', company_name: 'Meridian Microfinance', industry: 'Finance', tier_label: 'Headline sponsor', status: 'active', acknowledged_at: '2026-11-02T10:00:00Z', sponsor_organization_id: 'org-meridian', roles: ['sponsor', 'exhibitor'], value_amount: 120000, value_currency: 'GHS', owed_total: 6, owed_completed: 4, required_total: 3, required_completed: 2 },
  { id: 'p-oduro', company_name: 'Oduro Solar', industry: 'Energy', tier_label: 'Exhibitor', status: 'active', acknowledged_at: '2026-11-05T10:00:00Z', sponsor_organization_id: 'org-oduro', roles: ['exhibitor'], value_amount: 18000, value_currency: 'GHS', owed_total: 3, owed_completed: 1, required_total: 2, required_completed: 1 },
  { id: 'p-sable', company_name: 'Sable Analytics', industry: 'Technology', tier_label: 'Track sponsor', status: 'invited', acknowledged_at: null, sponsor_organization_id: null, roles: ['sponsor'], value_amount: 45000, value_currency: 'GHS', owed_total: 4, owed_completed: 0, required_total: 2, required_completed: 0 },
  { id: 'p-coastal', company_name: 'Coastline FM', industry: 'Media', tier_label: null, status: 'draft', acknowledged_at: null, sponsor_organization_id: null, roles: ['media_partner'], value_amount: null, value_currency: null, owed_total: 2, owed_completed: 0, required_total: 1, required_completed: 0 },
].map((p, i) => ({ event_id: 'e-summit', logo_url: null, representative_email: null, display_order: i + 1, updated_at: '2026-11-10T09:00:00Z', ...p }))

const partnership = {
  id: 'p-meridian', event_id: 'e-summit', sponsor_organization_id: 'org-meridian', company_name: 'Meridian Microfinance',
  description: 'Headline sponsor of the summit and host of the investor office hours.', logo_url: null, industry: 'Finance',
  website: null, linkedin: null, tier_label: 'Headline sponsor', status: 'active', acknowledged_at: '2026-11-02T10:00:00Z',
  value_amount: 120000, value_currency: 'GHS', internal_notes: 'Renewal conversation after the event.',
  representative_email: null, display_order: 1, created_by: ORG_UID, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-11-10T09:00:00Z',
}
const ob = (n, direction, title, category, status, due_date, extra = {}) => ({
  id: 'ob' + n, partnership_id: 'p-meridian', event_id: 'e-summit', direction, title, description: null, category,
  quantity: null, status, due_date, display_order: n, completed_at: status === 'completed' ? '2027-02-20T10:00:00Z' : null,
  completed_by: null, created_by: ORG_UID, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-11-10T09:00:00Z', ...extra,
})
const obligations = [
  ob(1, 'organizer_to_partner', 'Logo on main stage screen', 'Branding', 'completed', '2027-03-01'),
  ob(2, 'organizer_to_partner', 'Exhibition stand A1', 'Exhibition', 'completed', '2027-03-05'),
  ob(3, 'organizer_to_partner', 'Speaking slot at investor office hours', 'Speaking', 'completed', '2027-02-15'),
  ob(4, 'organizer_to_partner', 'Delegate passes', 'Access', 'completed', '2027-02-28', { quantity: 10 }),
  ob(5, 'organizer_to_partner', 'Post-event networking report', 'Reporting', 'in_progress', '2027-03-27'),
  ob(6, 'organizer_to_partner', 'Social media mentions', 'Promotion', 'pending', '2027-03-20', { quantity: 4 }),
  ob(7, 'partner_to_organizer', 'Sponsorship payment', 'Finance', 'completed', '2027-01-31'),
  ob(8, 'partner_to_organizer', 'Logo files and brand guide', 'Branding', 'completed', '2027-02-10'),
  ob(9, 'partner_to_organizer', 'Names for delegate passes', 'Access', 'in_progress', '2027-03-05'),
]
const evidence = [
  { id: 'ev1', obligation_id: 'ob1', partnership_id: 'p-meridian', event_id: 'e-summit', kind: 'note', file_path: null, external_url: null, note: 'Shown before each Hall A session.', uploaded_by: ORG_UID, created_at: '2027-03-12T09:05:00Z' },
  { id: 'ev2', obligation_id: 'ob7', partnership_id: 'p-meridian', event_id: 'e-summit', kind: 'note', file_path: null, external_url: null, note: 'Received in full.', uploaded_by: ORG_UID, created_at: '2027-01-30T12:00:00Z' },
]
const documents = [
  { id: 'd1', partnership_id: 'p-meridian', event_id: 'e-summit', document_type: 'sponsorship_agreement', title: 'Sponsorship agreement 2027', description: null, original_filename: 'meridian-agreement-2027.pdf', mime_type: 'application/pdf', file_size: 482113, visibility: 'shared', document_date: '2026-11-01', uploaded_by_name: 'Esi Quaye', uploaded_by_me: true, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', storage_path: 'x/1.pdf' },
  { id: 'd2', partnership_id: 'p-meridian', event_id: 'e-summit', document_type: 'proposal', title: 'Headline package proposal', description: null, original_filename: 'proposal.pdf', mime_type: 'application/pdf', file_size: 1203112, visibility: 'internal', document_date: '2026-10-15', uploaded_by_name: 'Kofi Ansah', uploaded_by_me: false, created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z', storage_path: 'x/2.pdf' },
]

// ---- organization ------------------------------------------------------------------------
const access = (role = 'owner') => [{
  organization_id: ORG, organization_name: 'Volta Forum', organization_slug: 'volta-forum',
  organization_description: 'Independent conferences for founders and operators in West Africa.',
  organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
  archived_at: null, organization_created_by: ORG_UID, organization_created_at: '2026-06-01T00:00:00Z',
  organization_updated_at: '2026-06-01T00:00:00Z', organization_role: role, joined_at: '2026-06-01T00:00:00Z',
  event_assignments: [],
}]
const member = (user_id, full_name, role, job_title, extra = {}) => ({
  user_id, role, full_name, job_title, company: 'Volta Forum', photo_url: '', created_at: '2026-06-01T00:00:00Z', is_self: false, ...extra,
})
const MGR1 = '22222222-2222-4222-8222-222222222222'
const MGR2 = '33333333-3333-4333-8333-333333333333'
const ADM = '66666666-6666-4666-8666-666666666666'
const team = [
  member(ORG_UID, 'Esi Quaye', 'owner', 'Founder & Programme Director', { is_self: true }),
  member(ADM, 'Kofi Ansah', 'admin', 'Partnerships Lead'),
  member(MGR1, 'Adwoa Mensima', 'manager', 'Event Manager'),
  member(MGR2, 'Selorm Agbeko', 'manager', 'Operations Coordinator'),
]
const eventTeam = [
  { user_id: MGR1, event_id: 'e-summit' }, { user_id: MGR1, event_id: 'e-fintech' }, { user_id: MGR2, event_id: 'e-summit' },
]
const orgInvitations = [
  { id: 'oi1', invited_user_id: null, invited_email: 'new.colleague@example.invalid', role: 'manager', status: 'pending', created_at: '2026-11-12T10:00:00Z', responded_at: null, full_name: '' },
]

// ---- networking analytics ----------------------------------------------------------------
const networkingOverview = {
  registered_attendees: 214, checked_in_attendees: 168, networking_participants: 131,
  attendees_without_networking: 37, participation_percent: 78, connections_made: 341,
  opportunities_total: 23, opportunities_value: 410000, unavailable_metrics: [],
}
const timeline = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17'].map((h, i) => ({
  bucket_start: iso('2027-03-12', `${h}:00:00`), bucket_interval: '1 hour', connections_made: [4, 11, 38, 57, 49, 63, 41, 34, 27, 17][i],
}))
const industryActivity = [
  ['Finance', 46, 128, 35], ['Technology', 31, 92, 24], ['Energy', 19, 51, 15], ['Healthcare', 15, 37, 11], ['Agriculture', 11, 22, 8], ['Transportation', 9, 11, 7],
].map(([industry, participants, connections_made, participant_share]) => ({ industry, participants, connections_made, participant_share, industry_known: true }))
const industryConnections = [
  ['Finance', 'Technology', 61], ['Finance', 'Energy', 34], ['Technology', 'Healthcare', 22], ['Energy', 'Agriculture', 15], ['Finance', 'Healthcare', 14],
].map(([industry_from, industry_to, connections_made]) => ({ industry_from, industry_to, connections_made }))
const opportunityBreakdown = [['New', 9, 0], ['Discussing', 8, 0], ['Proposal', 4, 0], ['Won', 2, 0]].map(([stage, opportunities, total_value]) => ({ stage, opportunities, total_value }))

// ---- the attendee's side -----------------------------------------------------------------
const directory = people.slice(0, 12).map((p, i) => ({ ...p, already_connected: i === 0 || i === 3 }))
const conn = (id, p, over = {}) => ({
  id, owner_id: ATT_UID, connected_user_id: p.user_id, full_name: p.full_name, job_title: p.job_title, company: p.company,
  industry: p.industry, location: p.location, email: '', phone: '', linkedin: '', website: '', photo_url: '',
  relationship_type: 'Partner', event_name: 'Accra Founders Summit 2027', event_id: 'e-summit', follow_up_date: null,
  status: 'active', created_at: '2027-03-12T11:42:00Z', updated_at: '2027-03-12T11:42:00Z', ...over,
})
const connections = [
  conn('c-ama', people[0], { relationship_type: 'Partner', follow_up_date: '2027-03-18' }),
  conn('c-kofi', people[3], { relationship_type: 'Supplier', created_at: '2027-03-12T14:05:00Z' }),
  conn('c-naledi', people[2], { relationship_type: 'Investor', created_at: '2027-03-13T10:20:00Z' }),
  conn('c-leila', people[12], { relationship_type: 'Customer', event_name: 'West Africa Logistics Exchange', event_id: 'e-logistics', created_at: '2026-09-18T12:00:00Z' }),
]
const notes = [
  { id: 'n1', connection_id: 'c-ama', owner_id: ATT_UID, content: 'Met at the investor office hours. Meridian wants a freight-finance pilot for exporters in Kumasi; she will send their lending criteria.', created_at: '2027-03-12T11:50:00Z', updated_at: '2027-03-12T11:50:00Z' },
  { id: 'n2', connection_id: 'c-ama', owner_id: ATT_UID, content: 'Introduce her to our Tema warehouse partner.', created_at: '2027-03-12T16:10:00Z', updated_at: '2027-03-12T16:10:00Z' },
]
const followUps = [
  { id: 'f1', connection_id: 'c-ama', owner_id: ATT_UID, title: 'Send Kumasi route data', note: 'Before the pilot call.', due_date: '2027-03-18', completed: false, completed_at: null, created_at: '2027-03-12T12:00:00Z' },
  { id: 'f2', connection_id: 'c-ama', owner_id: ATT_UID, title: 'Thank-you note', note: '', due_date: '2027-03-13', completed: true, completed_at: '2027-03-13T09:00:00Z', created_at: '2027-03-12T12:00:00Z' },
]
const opportunities = [
  { id: 'o1', owner_id: ATT_UID, connection_id: 'c-ama', title: 'Freight-finance pilot, Kumasi exporters', description: 'Fictional sample opportunity.', type: 'Partnership', stage: 'Discussing', value: 0, expected_close_date: '2027-05-30', event_name: 'Accra Founders Summit 2027', event_id: 'e-summit', created_at: '2027-03-12T12:05:00Z', updated_at: '2027-03-14T12:05:00Z' },
]

module.exports = {
  ORG_UID, ATT_UID, ORG, organizerProfile, attendeeProfile, events, counts, people, attendeeRows,
  summitForm, fintechForm, answerRows, sessions, speakers, sessionSpeakers, exhibitors, partnerSummary,
  partnership, obligations, evidence, documents, access, team, eventTeam, orgInvitations,
  networkingOverview, timeline, industryActivity, industryConnections, opportunityBreakdown,
  directory, connections, notes, followUps, opportunities,
}
