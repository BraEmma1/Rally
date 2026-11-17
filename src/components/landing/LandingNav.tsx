import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'

export const SECTIONS = [
  { href: '#organizers', label: 'Organizers' },
  { href: '#attendees', label: 'Attendees' },
  { href: '#partners', label: 'Partners' },
  { href: '#ledger', label: 'What’s live' },
] as const

export function RallyMark() {
  return (
    <Link to="/" className="rl-mark" aria-label="Rally, home">
      <span className="rl-mark__tile" aria-hidden="true">R</span>
      <span aria-hidden="true">Rally</span>
    </Link>
  )
}

export function LandingNav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const wide = window.matchMedia('(min-width: 1024px)')
    const onWide = () => { if (wide.matches) setOpen(false) }
    window.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => { window.removeEventListener('keydown', onKey); wide.removeEventListener('change', onWide) }
  }, [open])

  return (
    <header className="rl-nav" data-scrolled={scrolled}>
      <div className="rl-wrap">
        <div className="rl-nav__bar">
          <RallyMark />
          <nav aria-label="Sections">
            <ul className="rl-nav__links">
              {SECTIONS.map((s) => <li key={s.href}><a href={s.href}>{s.label}</a></li>)}
            </ul>
          </nav>
          <div className="rl-nav__end">
            <Link to="/login" className="rl-nav__login">Log in</Link>
            <Link to="/signup?type=organizer" className="rl-btn rl-btn--card">Create organizer account</Link>
          </div>
          <button
            type="button"
            className="rl-nav__toggle"
            aria-expanded={open}
            aria-controls="rl-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
        <div id="rl-menu" className="rl-nav__panel" data-open={open} hidden={!open}>
          <nav aria-label="Sections">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    onClick={(e) => {
                      // Close first, then scroll: collapsing the panel moves the page, so a
                      // scroll started while it is open lands short of the section.
                      e.preventDefault()
                      setOpen(false)
                      requestAnimationFrame(() => {
                        document.querySelector(s.href)?.scrollIntoView()
                        history.pushState(null, '', s.href)
                      })
                    }}
                  >
                    {s.label}<ArrowRight size={18} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="rl-actions">
            <Link to="/signup?type=organizer" className="rl-btn rl-btn--primary">Create organizer account</Link>
            <Link to="/signup" className="rl-btn rl-btn--line">Join as an attendee</Link>
            <Link to="/login" className="rl-btn rl-btn--line">Log in</Link>
          </div>
        </div>
      </div>
    </header>
  )
}
