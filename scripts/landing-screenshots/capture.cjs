// Captures the real Rally interface for the marketing landing page.
//
//   node scripts/landing-screenshots/capture.cjs            # all shots -> public/landing/screens
//   node scripts/landing-screenshots/capture.cjs --raw      # full-viewport PNGs for review
//   node scripts/landing-screenshots/capture.cjs --only=checkin,team
//
// Same method as tests/browser: Vite is started with VITE_SUPABASE_URL pointing at a port
// nothing listens on, and every request to it is answered inside the browser from the
// fictional data in fixtures.cjs. No real project is contacted, no credential is used, and
// no database changes. The signed-in session is a fabricated token for a fake user id, which
// only this stub accepts. Needs Google Chrome (or CHROME_PATH).
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { launchBrowser } = require('../../tests/browser/launch.cjs')
const F = require('./fixtures.cjs')

const ROOT = path.resolve(__dirname, '../..')
const PORT = 5198
const API = 'http://localhost:54321'
const RAW = process.argv.includes('--raw')
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
const OUT = RAW ? path.join(os.tmpdir(), 'rally-landing-raw') : path.join(ROOT, 'public/landing/screens')
fs.mkdirSync(OUT, { recursive: true })

// ---- the stub API --------------------------------------------------------------------------
const unknown = new Set()

function tables(persona) {
  const uid = persona === 'organizer' ? F.ORG_UID : F.ATT_UID
  const isOrg = persona === 'organizer'
  return {
    profiles: [isOrg ? F.organizerProfile : F.attendeeProfile],
    user_accounts: [{ user_id: uid, account_type: isOrg ? 'organizer' : 'attendee', status: 'active' }],
    events: F.events,
    event_team: F.eventTeam,
    event_sessions: F.sessions,
    event_registrations: isOrg
      ? F.attendeeRows.map((a, i) => ({ id: 'r' + i, event_id: 'e-summit', user_id: a.user_id, status: a.status, checked_in_at: a.checked_in_at, created_at: a.registered_at }))
      : [{ id: 'reg-summit', event_id: 'e-summit', user_id: uid, status: 'checked_in', checked_in_at: '2027-03-12T08:31:00Z', created_at: '2027-02-02T10:00:00Z' }],
    event_invitations: [],
    connections: isOrg ? [] : F.connections,
    notes: isOrg ? [] : F.notes,
    follow_ups: isOrg ? [] : F.followUps,
    opportunities: isOrg ? [] : F.opportunities,
    notifications: [],
    conversation_members: [],
    event_exhibitors: F.exhibitors,
    event_speakers: F.speakers,
    event_partnerships: [F.partnership],
    event_partnership_roles: [{ partnership_id: 'p-meridian', role: 'exhibitor' }, { partnership_id: 'p-meridian', role: 'sponsor' }],
    event_partnership_obligations: F.obligations,
    event_partnership_obligation_evidence: F.evidence,
    event_partnership_documents: F.documents,
    organizations: [],
  }
}

function rpc(name, body, persona) {
  const ev = body.target_event_id || body.p_event_id
  const isSummit = !ev || ev === 'e-summit'
  switch (name) {
    case 'get_my_organization_access': return persona === 'organizer' ? F.access() : []
    case 'organization_member_directory': return F.team
    case 'organization_invitation_list': return F.orgInvitations
    case 'organization_event_counts': return Object.entries(F.counts).map(([event_id, c]) => ({ event_id, ...c }))
    case 'organization_people': return F.people.slice(0, 12).map((p, i) => ({ user_id: p.user_id, full_name: p.full_name, job_title: p.job_title, company: p.company, photo_url: '', events_registered: 1 + (i % 3), first_seen: '2026-09-18T10:00:00Z', last_seen: '2027-03-12T10:00:00Z' }))
    case 'get_event_registration_counts': return (body.event_ids || []).map((id) => ({ event_id: id, registration_count: (F.counts[id] || { registrations: 0 }).registrations }))
    case 'event_activity_counts': return [{ registrations: 214, checked_in: 168, cancelled: 9, connections_made: 341, invitations_pending: 12, invitations_accepted: 31 }]
    case 'event_attendee_list': return isSummit ? F.attendeeRows : []
    case 'find_event_attendees': {
      const q = String(body.search || '').toLowerCase()
      return F.attendeeRows.filter((a) => !q || a.full_name.toLowerCase().includes(q))
    }
    case 'event_invitation_list': return []
    case 'get_event_registration_form': return ev === 'e-fintech' ? F.fintechForm : isSummit ? F.summitForm : []
    case 'get_event_registration_answers': return isSummit ? F.answerRows : []
    case 'my_event_registration': return ev === 'e-summit' && persona === 'attendee'
      ? [{ registration_id: 'reg-summit', registration_status: 'checked_in', registered_at: '2027-02-02T10:00:00Z', waitlist_position: null, answers: {} }]
      : []
    case 'get_event_host': return [{ organization_id: F.ORG, name: 'Volta Forum', logo_url: null, website: null }]
    case 'get_event_agenda': return isSummit ? F.sessions : []
    case 'get_event_speakers': return isSummit ? F.speakers : []
    case 'get_event_session_speakers': return isSummit ? F.sessionSpeakers : []
    case 'get_event_speaker_sessions': return []
    case 'get_event_exhibitors': return isSummit ? F.exhibitors : []
    case 'get_event_partnership_summary': return isSummit ? F.partnerSummary : []
    case 'get_partnership_documents': return F.documents
    case 'event_networking_overview': return [F.networkingOverview]
    case 'event_networking_timeline': return F.timeline
    case 'event_industry_activity': return F.industryActivity
    case 'event_industry_connections': return F.industryConnections
    case 'event_opportunity_breakdown': return F.opportunityBreakdown
    case 'event_attendee_directory': return F.directory
    case 'get_my_event_schedule': return F.sessions.filter((s) => ['s2', 's3', 's5', 's7'].includes(s.id)).map((s) => ({ ...s, session_id: s.id, saved_at: '2027-03-01' }))
    case 'get_my_saved_session_ids': return [{ session_id: 's2' }, { session_id: 's3' }, { session_id: 's5' }, { session_id: 's7' }]
    case 'get_public_profiles': return F.people.map((p) => ({ id: p.user_id, full_name: p.full_name, photo_url: '' }))
    case 'get_public_profile': return []
    case 'get_my_conversations': return []
    case 'my_connection_requests': return []
    case 'my_pending_organization_invitations': return []
    case 'my_sponsor_partnerships': return []
    default:
      unknown.add('rpc ' + name)
      return []
  }
}

// PostgREST-style: col=eq.value filters; one object when a single row is requested.
function filterRows(rows, url) {
  let r = rows
  for (const [k, v] of new URL(url).searchParams) {
    if (!r.length || !(k in r[0])) continue
    if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === v.slice(3))
    else if (v.startsWith('in.(')) {
      const set = new Set(v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')))
      r = r.filter((x) => set.has(String(x[k])))
    }
  }
  return r
}

async function wire(ctx, persona) {
  const t = tables(persona)
  await ctx.route(API + '/**', async (route) => {
    const req = route.request()
    const url = req.url()
    const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (b) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = new URL(url).pathname
    if (p.includes('/rpc/')) {
      const name = p.split('/rpc/')[1]
      const body = m === 'POST' ? JSON.parse(req.postData() || '{}') : Object.fromEntries(new URL(url).searchParams)
      const out = rpc(name, body, persona)
      const single = (req.headers()['accept'] || '').includes('pgrst.object')
      return json(single ? (Array.isArray(out) ? out[0] ?? null : out) : out)
    }
    const table = p.split('/rest/v1/')[1]
    if (table !== undefined) {
      if (!(table in t)) unknown.add('table ' + table)
      const rows = filterRows(t[table] || [], url)
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${rows.length}` } })
      if (m === 'GET') {
        const single = (req.headers()['accept'] || '').includes('pgrst.object')
        return json(single ? rows[0] ?? null : rows)
      }
      return route.fulfill({ status: 201, headers: cors, body: '' })
    }
    return route.fulfill({ status: 404, headers: cors, body: '' })
  })
}

// ---- shots ----------------------------------------------------------------------------------
const DESK = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const settle = (page, ms = 700) => page.waitForTimeout(ms)

// scrollY scrolls the page before capture; el captures one element; clip crops (CSS px).
// The organizer event workspace header is ~330px tall: scrolling past it leaves the tab bar
// at the top of the frame.
const TABS_Y = 300
const SHOTS = [
  // Hero proof print and the "build the event" step: the whole workspace, sidebar included.
  { name: 'organizer-event-overview', persona: 'organizer', url: '/organizer/events/e-summit', vp: DESK },
  { name: 'organizer-dashboard', persona: 'organizer', url: '/organizer', vp: DESK },
  { name: 'organizer-registration-form', persona: 'organizer', url: '/organizer/events/e-summit?tab=registrations', vp: DESK, elHeight: 600, el: 'h3:text-is("Registration form") >> xpath=ancestor::div[contains(@class,"rounded-lg")][1]' },
  { name: 'organizer-checkin', persona: 'organizer', url: '/organizer/events/e-summit?tab=checkin', vp: DESK, scrollY: TABS_Y },
  { name: 'organizer-networking', persona: 'organizer', url: '/organizer/events/e-summit?tab=networking', vp: DESK, scrollY: TABS_Y },
  { name: 'organizer-agenda', persona: 'organizer', url: '/organizer/events/e-summit?tab=agenda', vp: DESK, scrollY: TABS_Y },
  {
    name: 'organizer-partner-deliverables', persona: 'organizer', url: '/organizer/events/e-summit/partners/p-meridian', vp: DESK,
    act: async (page) => { await page.locator('button:has-text("Deliverables")').first().click().catch(() => {}) },
  },
  { name: 'organizer-team', persona: 'organizer', url: '/organizer/team', vp: DESK },
  {
    name: 'attendee-registration', persona: 'attendee', url: '/events/e-fintech', vp: PHONE, clip: { x: 0, y: 66, width: 390, height: 778 },
    act: async (page) => {
      await page.locator('button:has-text("Register")').first().click().catch(() => {})
      await page.waitForSelector('[role=dialog]', { timeout: 4000 }).catch(() => {})
      await page.locator('[role=dialog] input').first().evaluate((e) => e.blur()).catch(() => {})
    },
  },
  { name: 'attendee-event-home-phone', persona: 'attendee', url: '/events/e-summit/home', vp: PHONE },
  { name: 'attendee-network-phone', persona: 'attendee', url: '/events/e-summit/network', vp: PHONE },
  { name: 'attendee-exhibitors-phone', persona: 'attendee', url: '/events/e-summit/exhibitors', vp: PHONE },
  // Cropped below the tab bar: the Meetings tab is a placeholder today and must not appear on
  // a page that lists meeting scheduling as not yet available.
  { name: 'attendee-connection', persona: 'attendee', url: '/connections/c-ama', vp: DESK, clipFrom: { sel: ':text-is("Ama Boateng")', up: 62, x: 256, w: 1184, h: 640 } },

  // Phone-width captures of the same screens, served to small viewports so the product stays
  // legible instead of being a shrunken desktop.
  { name: 'organizer-event-overview-phone', persona: 'organizer', url: '/organizer/events/e-summit', vp: PHONE },
  { name: 'organizer-dashboard-phone', persona: 'organizer', url: '/organizer', vp: PHONE },
  { name: 'organizer-registration-form-phone', persona: 'organizer', url: '/organizer/events/e-summit?tab=registrations', vp: PHONE, elHeight: 700, el: 'h3:text-is("Registration form") >> xpath=ancestor::div[contains(@class,"rounded-lg")][1]' },
  { name: 'organizer-checkin-phone', persona: 'organizer', url: '/organizer/events/e-summit?tab=checkin', vp: PHONE, scrollTo: 'text=Total registered' },
  { name: 'organizer-agenda-phone', persona: 'organizer', url: '/organizer/events/e-summit?tab=agenda', vp: PHONE, scrollTo: 'text=Opening keynote' },
  { name: 'organizer-team-phone', persona: 'organizer', url: '/organizer/team', vp: PHONE },
  { name: 'organizer-networking-phone', persona: 'organizer', url: '/organizer/events/e-summit?tab=networking', vp: PHONE, scrollTo: 'text=Networking analytics' },
  {
    name: 'organizer-partner-deliverables-phone', persona: 'organizer', url: '/organizer/events/e-summit/partners/p-meridian', vp: PHONE, scrollTo: 'text=What your organization has committed',
    act: async (page) => { await page.locator('button:has-text("Deliverables")').first().click().catch(() => {}) },
  },
  { name: 'attendee-connection-phone', persona: 'attendee', url: '/connections/c-ama', vp: PHONE, clipFrom: { sel: ':text-is("Ama Boateng")', up: 150, x: 0, w: 390, h: 640, scroll: true } },
]

const reachable = (url) => new Promise((resolve) => {
  http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500) }).on('error', () => resolve(false))
})

async function toWebp(browser, png, quality = 0.86) {
  const page = await browser.newPage()
  const data = await page.evaluate(async ([b64, q]) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d').drawImage(img, 0, 0)
    return c.toDataURL('image/webp', q).split(',')[1]
  }, [png.toString('base64'), quality])
  await page.close()
  return Buffer.from(data, 'base64')
}

async function main() {
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
  const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: 'stub-anon-key' },
    stdio: 'ignore',
  })
  const base = `http://localhost:${PORT}`
  try {
    for (let i = 0; i < 80 && !(await reachable(base)); i++) await new Promise((r) => setTimeout(r, 250))
    if (!(await reachable(base))) throw new Error(`Vite did not start on ${PORT}`)

    const browser = await launchBrowser()
    for (const shot of SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.name))) {
      const phone = shot.vp.width < 600
      const ctx = await browser.newContext({ viewport: shot.vp, deviceScaleFactor: phone ? 2 : 1.5, reducedMotion: 'reduce' })
      const uid = shot.persona === 'organizer' ? F.ORG_UID : F.ATT_UID
      await ctx.addInitScript(([id]) => {
        const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '')
        const session = {
          access_token: enc({ alg: 'none', typ: 'JWT' }) + '.' + enc({ sub: id, exp: 4102444800, role: 'authenticated' }) + '.stub',
          refresh_token: 'stub', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
          user: { id, aud: 'authenticated', role: 'authenticated', email: '', app_metadata: {}, user_metadata: {} },
        }
        localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
      }, [uid])
      await wire(ctx, shot.persona)
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(base + shot.url, { waitUntil: 'networkidle' })
      await page.waitForSelector('h1, main', { timeout: 8000 }).catch(() => {})
      await settle(page)
      if (shot.act) { await shot.act(page); await settle(page, 600) }
      if (shot.scrollY) { await page.evaluate((y) => window.scrollTo(0, y), shot.scrollY); await settle(page, 300) }
      if (shot.scrollTo) {
        // put the named content just under the app's sticky header
        const top = await page.locator(shot.scrollTo).first().evaluate((n) => n.getBoundingClientRect().top + window.scrollY).catch(() => null)
        if (top !== null) { await page.evaluate((y) => window.scrollTo(0, y), top - 140); await settle(page, 300) }
      }
      let png
      if (shot.el) {
        // Scroll the element to just below the app's sticky header, then clip a window of
        // it from the viewport (an element screenshot would stitch the header through it).
        const el = page.locator(shot.el).first()
        const top = await el.evaluate((n) => n.getBoundingClientRect().top + window.scrollY)
        await page.evaluate((y) => window.scrollTo(0, y), top - 80)
        await settle(page, 300)
        const box = await el.boundingBox()
        const height = Math.min(shot.elHeight || box.height, shot.vp.height - box.y)
        png = await page.screenshot({ type: 'png', clip: { x: box.x - 1, y: box.y - 1, width: box.width + 2, height } })
      } else if (shot.clipFrom) {
        // crop a fixed window that starts a little above the named content
        const c = shot.clipFrom
        const target = page.locator(c.sel).first()
        if (c.scroll) {
          const top = await target.evaluate((n) => n.getBoundingClientRect().top + window.scrollY)
          await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top - c.up - 72))
          await settle(page, 300)
        }
        const box = await target.boundingBox()
        const y = Math.max(0, box.y - c.up)
        png = await page.screenshot({ type: 'png', clip: { x: c.x, y, width: c.w, height: Math.min(c.h, shot.vp.height - y) } })
      } else {
        png = await page.screenshot({ type: 'png', clip: shot.clip })
      }
      if (RAW) fs.writeFileSync(path.join(OUT, shot.name + '.png'), png)
      else fs.writeFileSync(path.join(OUT, shot.name + '.webp'), await toWebp(browser, png))
      console.log(`${errors.length ? 'WARN' : 'ok  '}  ${shot.name}${errors.length ? '  ' + errors.join(' | ').slice(0, 200) : ''}`)
      await ctx.close()
    }
    await browser.close()
  } finally {
    server.kill()
  }
  if (unknown.size) console.log('\nUnanswered requests (served empty):\n  ' + [...unknown].join('\n  '))
  console.log('\nWrote to ' + OUT)
}

main().catch((e) => { console.error(e); process.exit(1) })
