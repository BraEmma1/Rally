import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Clock3 } from 'lucide-react'
import { LandingNav, RallyMark, SECTIONS } from '@/components/landing/LandingNav'
import { OrganizerStory } from '@/components/landing/OrganizerStory'
import { PhotoPrint, ProofPrint, QrCode, TurnCard, useDeal } from '@/components/landing/parts'
import '@/components/landing/landing.css'

// The public landing page (signed out, `/`). Every screen on it is the real Rally interface
// captured with fictional sample data (scripts/landing-screenshots); every capability it
// names is live in the app today, and the ledger lists what is not.

const deal = (rotate: number, delay = 0) =>
  ({ '--deal-rotate': `${rotate}deg`, '--deal-delay': `${delay}ms` }) as CSSProperties

function EventCard({ compact }: { compact?: boolean }) {
  return (
    <div className="rl-card">
      <span className="rl-card__label">Event</span>
      <div style={{ alignSelf: 'center' }}>
        <p className="rl-card__title">Accra Founders Summit</p>
        <p className="rl-card__meta" style={{ marginTop: 6 }}>
          {compact ? '12–13 Mar 2027 · Accra' : '12–13 March 2027 · Accra'}
        </p>
      </div>
      <div className="rl-card__foot">
        <span className="rl-card__pill">Registration open</span>
        {!compact && <span className="rl-card__meta rl-num">300 places</span>}
      </div>
    </div>
  )
}

function PersonFront({ signupUrl }: { signupUrl: string }) {
  return (
    <div className="rl-card">
      <div className="rl-person" style={{ gridRow: '1 / -1' }}>
        <div className="rl-person__who">
          <span className="rl-person__avatar" aria-hidden="true">AB</span>
          <div>
            <p className="rl-person__name">Ama Boateng</p>
            <p className="rl-person__role">Head of Partnerships<br />Meridian Microfinance</p>
          </div>
        </div>
        <div className="rl-person__qr">
          <QrCode value={signupUrl} label="QR code that opens Rally sign-up" />
          <span>Scan to connect</span>
        </div>
      </div>
    </div>
  )
}

function PersonBack() {
  return (
    <div className="rl-card">
      <div className="rl-back" style={{ gridRow: '1 / -1' }}>
        <dl>
          <div className="rl-back__row">
            <dt>Met at</dt>
            <dd>Accra Founders Summit, 12 Mar 2027</dd>
          </div>
          <div className="rl-back__row">
            <dt>Follow up</dt>
            <dd>Thu 18 Mar · send route data</dd>
          </div>
          <div className="rl-back__row rl-back__row--wide">
            <dt>Note</dt>
            <dd className="rl-back__hand">Wants a freight-finance pilot for exporters in Kumasi.</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

const JOURNEY = [
  {
    stage: 'Before',
    organizer: 'Publishes the event and its registration form.',
    attendee: 'Finds it, answers the questions, and gets a place or a waitlist spot.',
    card: () => <EventCard compact />,
  },
  {
    stage: 'At the door',
    organizer: 'Scans each arrival’s Rally QR, or finds them by name.',
    attendee: 'Walks in. The event app opens on the agenda.',
    card: () => (
      <div className="rl-card">
        <span className="rl-card__label">Registration</span>
        <div style={{ alignSelf: 'center' }}>
          <p className="rl-card__title">You’re in</p>
          <p className="rl-card__meta" style={{ marginTop: 6 }}>Kwabena Adjei · Riverline Freight</p>
        </div>
        <div className="rl-card__foot">
          <span className="rl-card__pill">Checked in</span>
          <span className="rl-card__meta rl-num">08:31</span>
        </div>
      </div>
    ),
  },
  {
    stage: 'In the room',
    organizer: 'Sees how many attendees are networking.',
    attendee: 'Scans a badge or sends a request from the attendee directory.',
    card: (signupUrl: string) => (
      <div className="rl-card">
        <span className="rl-card__label">Connect</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'end', gap: 14 }}>
          <span className="rl-qr-mini" style={{ width: 56 }}><QrCode value={signupUrl} label="QR code that opens Rally sign-up" /></span>
          <div>
            <p className="rl-card__title">Ama Boateng</p>
            <p className="rl-card__meta" style={{ marginTop: 6 }}>Head of Partnerships</p>
          </div>
        </div>
        <span />
      </div>
    ),
  },
  {
    stage: 'Afterwards',
    organizer: 'Counts the connections and opportunities the event produced.',
    attendee: 'Keeps notes, follow-ups and opportunities on every connection.',
    card: () => (
      <div className="rl-card">
        <span className="rl-card__label">Met at</span>
        <div style={{ alignSelf: 'center' }}>
          <p className="rl-card__title">Accra Founders Summit</p>
          <p className="rl-card__meta" style={{ marginTop: 6 }}>Note: wants a pilot in Kumasi</p>
        </div>
        <div className="rl-card__foot">
          <span className="rl-card__meta">Follow up</span>
          <span className="rl-card__meta rl-num">18 Mar</span>
        </div>
      </div>
    ),
  },
]

const LIVE = {
  organizers: [
    'Draft, published and unlisted events',
    'Registration forms with five question types',
    'Capacity limits with an automatic waitlist',
    'Door check-in by QR or by name, with undo',
    'Agenda, speakers and exhibitors',
    'Team roles, with event managers per event',
    'Partnerships: deliverables, evidence, documents',
    'Networking analytics for each event',
  ],
  attendees: [
    'Event discovery and registration',
    'Event Mode: agenda, saved sessions, speakers, exhibitors',
    'Attendee directory and connection requests',
    'QR connections',
    'Notes, follow-ups and opportunities',
    'Direct messages',
    'Add events to your calendar',
  ],
}
const NOT_YET = [
  'Sponsor invitations and the sponsor workspace',
  'Ticket sales and payments',
  'Venue maps',
  'Deal room',
  'Event info pages in Event Mode',
  'Live broadcast',
  'Meeting scheduling',
  'Saving events and people',
  'Contact export (CSV, vCard)',
]

export default function MarketingHomePage() {
  const root = useRef<HTMLDivElement>(null)
  useDeal(root)
  const [activeStage, setActiveStage] = useState(JOURNEY.length - 1)
  const signupUrl = useMemo(() => `${window.location.origin}/signup`, [])

  return (
    <div className="rl" ref={root}>
      <a href="#main" className="rl-skip">Skip to content</a>
      <LandingNav />

      <main id="main">
        {/* ---------------------------------------------------------------- hero */}
        <section className="rl-hero" aria-labelledby="hero-title">
          <div className="rl-wrap rl-hero__grid">
            <div className="rl-hero__copy">
              <h1 id="hero-title" className="rl-h1">Run the event. Keep every connection it makes.</h1>
              <p className="rl-lede">
                Rally runs registration, door check-in, the programme, your team and your partners. Every attendee
                who meets someone at your event keeps that connection, with your event written on the back.
              </p>
              <div className="rl-actions">
                <Link to="/signup?type=organizer" className="rl-btn rl-btn--primary">
                  Create organizer account <ArrowRight aria-hidden="true" />
                </Link>
                <Link to="/signup" className="rl-btn rl-btn--line">Join as an attendee</Link>
              </div>
              <div className="rl-hero__fine">
                <p className="rl-fine">Organizer accounts are approved by a Rally administrator before you create your organization.</p>
                <p className="rl-fine">Already on Rally? <Link to="/login" className="rl-textlink">Log in</Link></p>
              </div>
            </div>

            <div className="rl-hand">
              <div className="rl-hand__photo" data-intro style={{ '--intro-delay': '0ms' } as CSSProperties}>
                <PhotoPrint
                  name="badges-conversation"
                  alt="Attendees in conversation at a conference, name badges on blue lanyards."
                  position="58% 50%"
                  eager
                  sizes="(max-width: 1023px) 80vw, 34vw"
                />
              </div>
              <div className="rl-hand__event" data-intro style={{ '--intro-delay': '160ms' } as CSSProperties} aria-hidden="true">
                <EventCard />
              </div>
              <div className="rl-hand__person" data-intro style={{ '--intro-delay': '320ms' } as CSSProperties}>
                <TurnCard name="Ama Boateng" autoTurn front={<PersonFront signupUrl={signupUrl} />} back={<PersonBack />} />
              </div>
            </div>
          </div>

          <div className="rl-rise rl-wrap">
            <ProofPrint
              src="/landing/screens/organizer-event-overview.webp"
              small={{ src: '/landing/screens/organizer-event-overview-phone.webp', width: 780, height: 1688 }}
              width={2160}
              height={1350}
              eager
              alt="Rally organizer workspace for Accra Founders Summit 2027: 214 registrations, 168 checked in, 341 connections made at the event and 12 open invitations."
              slug={['Organizer', 'Event workspace', 'Sample data']}
            />
          </div>
        </section>

        {/* ------------------------------------------------------- how it works */}
        <section id="how" className="rl-sheet rl-sheet--over" aria-labelledby="how-title">
          <div className="rl-wrap">
            <div className="rl-head rl-head--split">
              <h2 id="how-title" className="rl-h2">One event. Both sides of the table.</h2>
              <p className="rl-lede">
                Organizers run the event on Rally, and the people who attend use the same event to find each other,
                connect and follow up. Nothing is exported from one tool into another: it is one record.
              </p>
            </div>
            <ol className="rl-deal">
              {JOURNEY.map((j, i) => (
                <li
                  key={j.stage}
                  className="rl-deal__item"
                  data-active={i === activeStage}
                  onMouseEnter={() => setActiveStage(i)}
                  data-deal
                  style={deal(i % 2 ? 4 : -4, i * 90)}
                >
                  <div className="rl-deal__card" aria-hidden="true">{j.card(signupUrl)}</div>
                  <h3 className="rl-deal__stage">{j.stage}</h3>
                  <div className="rl-deal__who">
                    <p><b>Organizer</b><span>{j.organizer}</span></p>
                    <p><b>Attendee</b><span>{j.attendee}</span></p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------- organizers */}
        <section id="organizers" className="rl-section" aria-labelledby="org-title">
          <div className="rl-wrap">
            <div className="rl-head rl-head--split">
              <div style={{ display: 'grid', gap: 20 }}>
                <h2 id="org-title" className="rl-h2">Everything the organizer runs, in one workspace.</h2>
                <p className="rl-lede">From the first draft to the last check-in, you and your team work from the same event.</p>
              </div>
              <div>
                <PhotoPrint
                  name="speaker-session"
                  alt="A conference session: a presenter speaks while a participant is handed a microphone."
                  className="rl-photo--wide"
                  position="50% 40%"
                />
              </div>
            </div>
            <OrganizerStory />
          </div>
        </section>

        {/* ----------------------------------------------------------- attendees */}
        <section id="attendees" className="rl-sheet" aria-labelledby="att-title">
          <div className="rl-wrap">
            <div className="rl-attend-top">
              <div style={{ display: 'grid', gap: 24 }}>
                <h2 id="att-title" className="rl-h2">Attendees meet people. Rally remembers where.</h2>
                <p className="rl-lede">
                  Attendees find events, register, and use Event Mode on their phone while they are there. Everyone
                  they connect with is saved with the event they met at.
                </p>
                <div className="rl-actions">
                  <Link to="/signup" className="rl-btn rl-btn--primary">Join as an attendee <ArrowRight aria-hidden="true" /></Link>
                </div>
              </div>
              <div>
                <PhotoPrint
                  name="qr-badge"
                  alt="Two attendees at a refreshment table; one wears a conference badge with a QR code."
                  position="72% 50%"
                />
              </div>
            </div>

            <ul className="rl-phones" aria-label="The attendee app">
              {[
                {
                  title: 'Register in a minute',
                  body: 'Answer the organizer’s questions and get a confirmed place, or a waitlist position when the event is full.',
                  shot: 'attendee-registration', h: 1556, slug: ['Attendee', 'Registration', 'Sample data'] as [string, ...string[]],
                  alt: 'Rally registration sheet for Women in Fintech Breakfast, asking for a company and an area of work.',
                },
                {
                  title: 'Event Mode on the day',
                  body: 'Agenda, saved sessions, speakers, exhibitors and messages for the event you are at. Map, deal room and event info are still to come.',
                  shot: 'attendee-event-home-phone', h: 1688, slug: ['Attendee', 'Event Mode', 'Sample data'] as [string, ...string[]],
                  alt: 'Rally Event Mode home for Accra Founders Summit 2027, marked checked in, with agenda, attendees, speakers, exhibitors, messages and schedule; map, deal room and event info are marked coming soon.',
                },
                {
                  title: 'Find the people worth meeting',
                  body: 'Browse the attendee directory by industry or location, scan a badge, or send a connection request.',
                  shot: 'attendee-network-phone', h: 1688, slug: ['Attendee', 'Event Mode', 'Network', 'Sample data'] as [string, ...string[]],
                  alt: 'Rally attendee directory for the summit with search, industry and location filters, and an attendee marked Connected.',
                },
              ].map((p, i) => (
                <li key={p.shot} className="rl-phones__item" data-deal style={deal(i === 1 ? 4 : -4, i * 120)}>
                  <ProofPrint src={`/landing/screens/${p.shot}.webp`} alt={p.alt} width={780} height={p.h} slug={p.slug} phone />
                  <div className="rl-phones__text">
                    <h3 className="rl-h3">{p.title}</h3>
                    <p>{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="rl-keep">
              <div className="rl-keep__copy">
                <h3 className="rl-h2" style={{ fontSize: 'clamp(1.8rem, 1.2rem + 1.8vw, 2.8rem)' }}>
                  The back of the card is where the value is.
                </h3>
                <p className="rl-body">
                  A connection in Rally keeps the event you met at. After the event, it is where the relationship carries on.
                </p>
                <ul>
                  {[
                    'Notes on what you talked about',
                    'Follow-ups with due dates',
                    'Opportunities, from first conversation to won or lost',
                    'Direct messages',
                    'Connection requests, with a 30-day pause after a decline',
                  ].map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
              <div className="rl-keep__cards">
                <div>
                  <ProofPrint
                    src="/landing/screens/attendee-connection.webp"
                    small={{ src: '/landing/screens/attendee-connection-phone.webp', width: 780, height: 1280 }}
                    width={1776}
                    height={960}
                    alt="A Rally connection for Ama Boateng, met at Accra Founders Summit 2027, with message, schedule and share actions, two notes and a next step due 18 March."
                    slug={['Attendee', 'Connection', 'Sample data']}
                  />
                </div>
                <TurnCard name="Ama Boateng" front={<PersonFront signupUrl={signupUrl} />} back={<PersonBack />} style={{ rotate: '-1.5deg' }} />
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ partners */}
        <section id="partners" className="rl-section" aria-labelledby="partners-title">
          <div className="rl-wrap">
            <div className="rl-head">
              <h2 id="partners-title" className="rl-h2">Sponsors and exhibitors, with every promise tracked.</h2>
              <p className="rl-lede">Partnerships live inside the event they belong to, private to your team.</p>
            </div>
            <div className="rl-partners">
              <div className="rl-partners__visual">
                <div>
                  <ProofPrint
                    src="/landing/screens/organizer-partner-deliverables.webp"
                    small={{ src: '/landing/screens/organizer-partner-deliverables-phone.webp', width: 780, height: 1688 }}
                    width={2160}
                    height={1350}
                    alt="Rally partner page for Meridian Microfinance, headline sponsor: deliverables such as logo on the main stage screen and an exhibition stand, each marked completed with evidence attached."
                    slug={['Organizer', 'Partner', 'Deliverables', 'Sample data']}
                  />
                </div>
                <div className="rl-partners__phone">
                  <ProofPrint
                    src="/landing/screens/attendee-exhibitors-phone.webp"
                    width={780}
                    height={1688}
                    phone
                    alt="Rally Event Mode exhibitor list showing five exhibitors with their stand numbers and descriptions."
                    slug={['Attendee', 'Exhibitors', 'Sample data']}
                  />
                </div>
              </div>
              <div className="rl-partners__copy">
                <p>
                  Record each partner’s package, value and roles. List what you owe them and what they owe you, mark
                  each item as it is delivered, and attach the evidence.
                </p>
                <p className="rl-rule">
                  Keep agreements and proposals with the partnership, each one marked internal or shared with the partner.
                </p>
                <p className="rl-rule">
                  Internal notes and internal documents stay with your team. A workspace where sponsors see their own
                  deliverables and the documents you share is on the way.
                </p>
                <p className="rl-rule">Exhibitors appear in the event app with their stand and description.</p>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- ledger */}
        <section id="ledger" className="rl-sheet" aria-labelledby="ledger-title">
          <div className="rl-wrap">
            <div className="rl-head">
              <h2 id="ledger-title" className="rl-h2">What’s in Rally today.</h2>
              <p className="rl-lede">
                A plain list, so you know what you are signing up for. Checked against the product in November 2026.
              </p>
            </div>
            <div className="rl-ledger">
              <div className="rl-ledger__groups">
                {([
                  ['For organizers', LIVE.organizers],
                  ['For attendees', LIVE.attendees],
                ] as const).map(([title, items]) => (
                  <div key={title}>
                    <h3>{title}<span className="rl-num">{items.length}</span></h3>
                    <ul>{items.map((t) => <li key={t}><Check aria-hidden="true" />{t}</li>)}</ul>
                  </div>
                ))}
              </div>
              <div className="rl-ledger__no">
                <h3>Not in Rally yet</h3>
                <ul>{NOT_YET.map((t) => <li key={t}><Clock3 aria-hidden="true" />{t}</li>)}</ul>
              </div>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- close */}
        <section className="rl-close" aria-labelledby="close-title">
          <div className="rl-wrap rl-close__grid">
            <div className="rl-close__copy">
              <h2 id="close-title" className="rl-h1" style={{ fontSize: 'clamp(2.4rem, 1.2rem + 3.8vw, 4.6rem)' }}>
                Put your next event on Rally.
              </h2>
              <p className="rl-lede">
                Create an organizer account. Once it is approved, set up your organization, invite your team and
                publish your first event.
              </p>
              <div className="rl-actions">
                <Link to="/signup?type=organizer" className="rl-btn rl-btn--primary">
                  Create organizer account <ArrowRight aria-hidden="true" />
                </Link>
                <Link to="/signup" className="rl-btn rl-btn--line">Join as an attendee</Link>
              </div>
              <p className="rl-fine">Already on Rally? <Link to="/login" className="rl-textlink">Log in</Link></p>
            </div>
            <div className="rl-close__hand" aria-hidden="true">
              <div>
                <PhotoPrint name="networking-smile" alt="" position="38% 50%" />
              </div>
              <div className="rl-close__blank" data-deal style={deal(8, 160)}>
                <div className="rl-card">
                  <span className="rl-card__label">Your event</span>
                  <div className="rl-blank">
                    <div>Name</div>
                    <div>Date</div>
                    <div>Venue</div>
                    <div>Capacity</div>
                  </div>
                  <span />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="rl-foot">
        <div className="rl-wrap">
          <div className="rl-foot__grid">
            <div className="rl-foot__brand">
              <RallyMark />
              <p>Events, the people at them, and what happens next.</p>
            </div>
            <nav aria-labelledby="foot-product">
              <h2 id="foot-product">On this page</h2>
              <ul>{SECTIONS.map((s) => <li key={s.href}><a href={s.href}>{s.label}</a></li>)}</ul>
            </nav>
            <nav aria-labelledby="foot-account">
              <h2 id="foot-account">Account</h2>
              <ul>
                <li><Link to="/signup?type=organizer">Create organizer account</Link></li>
                <li><Link to="/signup">Join as an attendee</Link></li>
                <li><Link to="/login">Log in</Link></li>
                <li><Link to="/forgot-password">Reset your password</Link></li>
              </ul>
            </nav>
          </div>
          <div className="rl-foot__base">
            <span>© 2026 Rally</span>
            <span>Product screens and cards show fictional sample data. Event photography by Pavel Danilyuk on Pexels.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
