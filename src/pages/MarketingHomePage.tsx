import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleUserRound,
  FileText,
  Menu,
  MessageCircle,
  Network,
  QrCode,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'

const networkingPhoto = 'https://images.pexels.com/photos/8761650/pexels-photo-8761650.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'

type DemoModalProps = { open: boolean; onClose: () => void }

type ScreenshotProps = {
  label: string
  variant?: 'desktop' | 'mobile'
  className?: string
}

function RallyMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="marketing-logo" aria-label="Rally home">
      <span className="marketing-logo-mark"><span /><span /><span /></span>
      {!compact && <span>Rally</span>}
    </Link>
  )
}

function ProductScreenshot({ label, variant = 'desktop', className = '' }: ScreenshotProps) {
  return (
    <div className={`product-shot product-shot-${variant} ${className}`} role="img" aria-label={`${label} Rally product preview`}>
      <div className="shot-bar"><span className="shot-dot shot-dot-red" /><span className="shot-dot shot-dot-yellow" /><span className="shot-dot shot-dot-green" /><span className="shot-title">Rally / {label}</span></div>
      <div className="shot-body">
        <aside className="shot-sidebar"><RallyMark compact /><span className="shot-nav active">Overview</span><span className="shot-nav">People</span><span className="shot-nav">Events</span><span className="shot-nav">Messages</span></aside>
        <div className="shot-content">
          <div className="shot-heading"><div><small>RALLY WORKSPACE</small><strong>{label}</strong></div><span className="shot-avatar">JW</span></div>
          <div className="shot-stat-row"><div><small>Connections</small><b>482</b><em>+12.4%</em></div><div><small>Follow-ups</small><b>28</b><em>+8.1%</em></div><div><small>Opportunities</small><b>16</b><em>+4.6%</em></div></div>
          <div className="shot-panels"><div className="shot-panel shot-chart"><small>Relationship activity</small><div className="chart-lines"><i /><i /><i /><i /><i /></div><div className="chart-axis"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span></div></div><div className="shot-panel shot-list"><small>Recent connections</small><span><i className="person-dot blue" /> Sarah Chen <b>New</b></span><span><i className="person-dot green" /> Michael Osei <b>Follow up</b></span><span><i className="person-dot orange" /> Priya Sharma <b>Opportunity</b></span></div></div>
        </div>
      </div>
    </div>
  )
}

function MobileProductScreenshot({ label }: { label: string }) {
  return <div className="mobile-shot"><div className="mobile-notch" /><div className="mobile-screen"><div className="mobile-brand"><RallyMark compact /><span>•••</span></div><small>EVENT MODE</small><strong>{label}</strong><div className="qr-box"><QrCode size={72} /><span>Scan to connect</span></div><div className="mobile-actions"><span>My Connections</span><span>Event Schedule</span><span>Messages</span></div></div></div>
}

function DemoModal({ open, onClose }: DemoModalProps) {
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [open])
  if (!open) return null
  function handleSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSubmitted(true) }
  return <div className="demo-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="demo-modal" role="dialog" aria-modal="true" aria-labelledby="demo-title"><button className="demo-close" onClick={onClose} aria-label="Close request demo form"><X size={20} /></button>{submitted ? <div className="demo-success"><span className="success-icon"><Check /></span><h2>Thanks for reaching out.</h2><p>Your request is ready to be reviewed by the Rally team. We’ll be in touch using the details you shared.</p><button className="button button-primary" onClick={onClose}>Close</button></div> : <><span className="eyebrow">REQUEST A DEMO</span><h2 id="demo-title">See how Rally keeps relationships moving.</h2><p className="demo-intro">Tell us a little about yourself and we’ll show you the parts of Rally that fit your event journey.</p><form onSubmit={handleSubmit}><div className="form-grid"><label>Full name<input required name="name" autoComplete="name" /></label><label>Work email<input required type="email" name="email" autoComplete="email" /></label><label>Company / organization<input required name="company" autoComplete="organization" /></label><label>Role<input required name="role" /></label></div><label>What best describes you?<select required name="audience" defaultValue=""><option value="" disabled>Select one</option><option>Event Organizer</option><option>Sponsor</option><option>Exhibitor</option><option>Professional</option><option>Other</option></select></label><label>What would you like to use Rally for? <span>(optional)</span><textarea name="message" rows={3} /></label><button className="button button-primary demo-submit" type="submit">Request a Demo <ArrowRight size={16} /></button></form></>}</div></div>
}

function MarketingHeader({ onDemo }: { onDemo: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const links = [['Product', '#platform'], ['Solutions', '#audiences'], ['How It Works', '#how-it-works'], ['For Organizers', '#organizers'], ['For Sponsors', '#sponsors'], ['About', '#problem']]
  return <header className="marketing-header"><div className="marketing-container header-inner"><RallyMark /><nav className={menuOpen ? 'mobile-open' : ''} aria-label="Marketing navigation">{links.map(([label, href]) => <a key={label} href={href} onClick={() => setMenuOpen(false)}>{label}{label === 'Product' && <ChevronDown size={13} />}</a>)}<div className="mobile-nav-actions"><Link to="/login" className="button button-outline">Sign In</Link><button className="button button-primary" onClick={onDemo}>Request a Demo</button></div></nav><div className="header-actions"><Link to="/login" className="header-signin">Sign In</Link><button className="button button-primary button-small" onClick={onDemo}>Request a Demo</button></div><button className="mobile-menu-button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X /> : <Menu />}</button></div></header>
}

function AudienceStrip() { const audiences: Array<{ icon: typeof UsersRound; title: string; text: string }> = [{ icon: UsersRound, title: 'For Professionals', text: 'Build your network' }, { icon: CalendarDays, title: 'For Organizers', text: 'Create impactful events' }, { icon: BriefcaseBusiness, title: 'For Sponsors', text: 'Strengthen partnerships' }, { icon: Network, title: 'For Exhibitors', text: 'Turn participation into opportunities' }]; return <div className="audience-strip" id="audiences">{audiences.map(({ icon: Icon, title, text }) => <div key={title}><span className="audience-icon"><Icon size={18} /></span><div><strong>{title}</strong><small>{text}</small></div></div>)}</div> }

function SectionLabel({ children }: { children: ReactNode }) { return <span className="eyebrow">{children}</span> }
function CheckList({ items }: { items: string[] }) { return <ul className="check-list">{items.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul> }

function MarketingFooter({ onDemo }: { onDemo: () => void }) { return <footer className="marketing-footer"><div className="marketing-container footer-main"><div className="footer-brand"><RallyMark /><p>Turn event connections into business opportunities.</p><button className="button button-primary" onClick={onDemo}>Request a Demo</button></div><div className="footer-column"><strong>PRODUCT</strong><a href="#platform">Event Networking</a><a href="#how-it-works">Messaging</a><a href="#professionals">Follow-ups</a><a href="#platform">Opportunities</a></div><div className="footer-column"><strong>SOLUTIONS</strong><a href="#organizers">For Organizers</a><a href="#sponsors">For Sponsors</a><a href="#sponsors">For Exhibitors</a><a href="#professionals">For Professionals</a></div><div className="footer-column"><strong>RESOURCES</strong><a href="#showcase">Product Tour</a><button onClick={onDemo}>Contact</button></div><div className="footer-column"><strong>COMPANY</strong><a href="#problem">About Us</a><a href="#problem">Our story</a><a href="#cta">Get started</a></div></div><div className="marketing-container footer-bottom"><span>© 2026 Rally. All rights reserved.</span><span>Built for the relationships that make events matter.</span></div></footer> }

export default function MarketingHomePage() {
  const [demoOpen, setDemoOpen] = useState(false)
  const journeySteps: Array<{ icon: typeof CircleUserRound; title: string; text: string }> = [{ icon: CircleUserRound, title: 'Connect', text: 'Meet someone and connect through Rally or QR.' }, { icon: FileText, title: 'Remember', text: 'Capture where you met, the event context and why the relationship matters.' }, { icon: MessageCircle, title: 'Follow Up', text: 'Keep important relationships moving after the event.' }, { icon: BarChart3, title: 'Grow', text: 'Turn relationships into meetings, opportunities and meaningful outcomes.' }]
  return <div className="marketing-page"><MarketingHeader onDemo={() => setDemoOpen(true)} /><main>
    <section className="hero-section"><div className="marketing-container hero-grid"><div className="hero-copy"><SectionLabel>EVENT NETWORKING &amp; RELATIONSHIP PLATFORM</SectionLabel><h1>Turn event connections<br />into business <span>opportunities.</span></h1><p>Rally helps professionals, organizers, sponsors and exhibitors build valuable relationships before, during and after events — from the first connection to the follow-up, opportunity and outcome.</p><div className="hero-actions"><button className="button button-primary" onClick={() => setDemoOpen(true)}>Request a Demo <ArrowRight size={16} /></button><a className="button button-outline" href="#how-it-works"><Sparkles size={16} /> See How Rally Works</a></div></div><div className="hero-visual"><ProductScreenshot label="Organizer Dashboard" /><MobileProductScreenshot label="Tech Summit 2026" /></div></div><div className="marketing-container"><AudienceStrip /></div></section>
    <section className="problem-section" id="problem"><div className="marketing-container problem-grid"><div className="problem-image"><img src={networkingPhoto} alt="Professionals connecting at a business networking event" /></div><div className="problem-copy"><SectionLabel>THE PROBLEM</SectionLabel><h2>Great conversations shouldn’t disappear when the event ends.</h2><p>You meet valuable people at events — but often forget who you met, lose the context of the conversation, and fail to follow up.</p><p>Organizers can count registrations and attendance, but struggle to understand the relationships and opportunities their event helped create.</p></div></div></section>
    <section className="how-section" id="how-it-works"><div className="marketing-container"><div className="section-heading centered"><SectionLabel>HOW RALLY WORKS</SectionLabel><h2>From connection to real opportunities.</h2></div><div className="journey-grid">{journeySteps.map(({ icon: Icon, title, text }, index) => <div className="journey-step" key={title}><span className={`journey-icon journey-${index}`}><Icon size={21} /></span><div><strong>{index + 1}. {title}</strong><p>{text}</p></div>{index < 3 && <ArrowRight className="journey-arrow" size={22} />}</div>)}</div></div></section>
    <section className="lifecycle-section"><div className="marketing-container"><div className="section-heading centered"><h2>Built for what happens before, during and after the event.</h2></div><div className="lifecycle-grid"><div className="lifecycle-card"><span className="lifecycle-number blue-bg">01</span><h3>Before the event</h3><CheckList items={['Discover relevant people', 'Prepare for the event', 'Build your professional presence']} /><div className="mini-preview"><UsersRound size={18} /><span>Browse attendees</span><small>Find the people worth meeting.</small></div></div><div className="lifecycle-card"><span className="lifecycle-number green-bg">02</span><h3>During the event</h3><CheckList items={['Connect instantly', 'Use event context', 'Network through Event Mode', 'Continue conversations']} /><div className="mini-preview"><QrCode size={18} /><span>Event Mode</span><small>Make every introduction count.</small></div></div><div className="lifecycle-card"><span className="lifecycle-number orange-bg">03</span><h3>After the event</h3><CheckList items={['Remember every valuable connection', 'Follow up', 'Manage relationships', 'Develop opportunities']} /><div className="mini-preview"><Network size={18} /><span>My Connections</span><small>Keep relationships moving forward.</small></div></div></div></div></section>
    <section className="audience-solutions" id="professionals"><div className="marketing-container solution-grid"><article className="solution-card solution-blue"><div><SectionLabel>FOR PROFESSIONALS</SectionLabel><h2>Never lose a valuable connection again.</h2><CheckList items={['Professional profile', 'QR networking', 'Connection context', 'Follow-ups', 'Opportunity tracking']} /><a href="#how-it-works" className="text-link">Build your network <ArrowRight size={15} /></a></div><MobileProductScreenshot label="My Connections" /></article><article className="solution-card solution-green" id="organizers"><div><SectionLabel>FOR ORGANIZERS</SectionLabel><h2>See what your event actually creates.</h2><CheckList items={['Event management', 'Attendee participation', 'Networking activity', 'Connections', 'Partnership management']} /><a href="#showcase" className="text-link">Explore the organizer workspace <ArrowRight size={15} /></a></div><ProductScreenshot label="Event Networking" /></article><article className="solution-card solution-navy" id="sponsors"><div><SectionLabel>FOR SPONSORS &amp; EXHIBITORS</SectionLabel><h2>Turn event participation into lasting business relationships.</h2><CheckList items={['Event partnerships', 'Partnership obligations', 'Deliverables & requirements', 'Shared documents', 'Partnership progress']} /><a href="#showcase" className="text-link">Strengthen partnerships <ArrowRight size={15} /></a></div><ProductScreenshot label="Sponsor Workspace" /></article></div></section>
    <section className="platform-section" id="platform"><div className="marketing-container platform-grid"><div><SectionLabel>THE RALLY PLATFORM</SectionLabel><h2>A complete event relationship platform.</h2><p>Everything you need to connect, collaborate and grow before, during and after your events.</p><div className="platform-list"><span><Network size={17} />Professional networking</span><span><CalendarDays size={17} />Event management</span><span><BriefcaseBusiness size={17} />Partnership management</span><span><MessageCircle size={17} />Messaging</span><span><CircleUserRound size={17} />Relationship tracking</span><span><BarChart3 size={17} />Business opportunity pipeline</span></div></div><div className="platform-showcase"><ProductScreenshot label="Event Networking" /><MobileProductScreenshot label="Event Mode" /><MobileProductScreenshot label="My Network" /></div></div></section>
    <section className="showcase-section" id="showcase"><div className="marketing-container"><div className="section-heading centered"><SectionLabel>ONE CONNECTED EXPERIENCE</SectionLabel><h2>The event ends. The relationship continues.</h2><p>Rally preserves the context behind every introduction so valuable conversations can become lasting professional relationships.</p></div><div className="showcase-visual"><ProductScreenshot label="Rally Workspace" /><MobileProductScreenshot label="Connect at the event" /></div></div></section>
    <section className="cta-section" id="cta"><div className="marketing-container cta-inner"><div><SectionLabel>MAKE EVERY CONNECTION COUNT</SectionLabel><h2>Create event experiences where valuable conversations become lasting professional relationships.</h2></div><div className="cta-actions"><button className="button button-white" onClick={() => setDemoOpen(true)}>Request a Demo <ArrowRight size={16} /></button><Link to="/signup" className="button button-ghost-white">Get Started</Link></div></div></section>
  </main><MarketingFooter onDemo={() => setDemoOpen(true)} /><DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} /></div>
}
