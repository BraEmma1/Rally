import { useEffect, useRef, useState } from 'react'
import { ProofPrint } from './parts'

type Step = {
  title: string
  body: string
  shot: string
  alt: string
  w: number
  h: number
  slug: [string, ...string[]]
}

// Each step is one organizer job, proved by the screen that does it.
const STEPS: Step[] = [
  {
    title: 'Publish the event',
    body: 'Draft privately, then publish to everyone on Rally or keep it unlisted for invited guests. The dashboard shows registrations, check-ins and connections for every event.',
    shot: 'organizer-dashboard', w: 2160, h: 1350,
    alt: 'Rally organizer dashboard listing four events with registrations, check-ins, connections and status for each.',
    slug: ['Organizer', 'Dashboard', 'Sample data'],
  },
  {
    title: 'Ask the right questions at registration',
    body: 'Build the form from five question types: short and long answers, pick one, pick several, yes or no. Set a capacity and Rally runs the waitlist. Only your team reads the answers.',
    shot: 'organizer-registration-form', w: 1443, h: 900,
    alt: 'Rally registration form builder with a required short-answer question and a pick-one question listing four tracks.',
    slug: ['Organizer', 'Event', 'Registration form', 'Sample data'],
  },
  {
    title: 'Check people in at the door',
    body: 'Scan an attendee’s Rally QR or find them by name. The count moves as people arrive, and a mistaken check-in can be undone.',
    shot: 'organizer-checkin', w: 2160, h: 1350,
    alt: 'Rally check-in screen showing 168 of 214 attendees checked in, a scan button, manual search and the door list with undo buttons.',
    slug: ['Organizer', 'Event', 'Check-in', 'Sample data'],
  },
  {
    title: 'Publish the programme',
    body: 'Sessions, rooms, speakers and exhibitors. Attendees see the agenda in the event app and save sessions to their own schedule.',
    shot: 'organizer-agenda', w: 2160, h: 1350,
    alt: 'Rally agenda editor listing the summit’s sessions with times, rooms, session types and status.',
    slug: ['Organizer', 'Event', 'Agenda', 'Sample data'],
  },
  {
    title: 'Share the work with your team',
    body: 'Owners and admins run the whole organization. Event managers see only the events they are assigned to.',
    shot: 'organizer-team', w: 2160, h: 1350,
    alt: 'Rally team page listing an owner, an admin and two event managers with the events each can access.',
    slug: ['Organizer', 'Team', 'Sample data'],
  },
  {
    title: 'See what the event started',
    body: 'Networking analytics count who took part, the connections they made and the opportunities that followed, from the event’s own data.',
    shot: 'organizer-networking', w: 2160, h: 1350,
    alt: 'Rally networking analytics for an event: registered, checked in, networking participants, connections made and opportunities.',
    slug: ['Organizer', 'Event', 'Networking', 'Sample data'],
  },
]

export function OrganizerStory() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index))
        }
      },
      { rootMargin: '-45% 0px -45% 0px' }
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  const state = (i: number) =>
    i === active ? 'active' : i === active - 1 ? 'prev' : i < active ? 'old' : 'next'

  return (
    <div className="rl-story">
      <ol className="rl-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="rl-step"
            data-index={i}
            data-active={i === active}
            ref={(el) => { refs.current[i] = el }}
          >
            <h3 className="rl-h3">{s.title}</h3>
            <p>{s.body}</p>
            <div className="rl-step__print">
              <ProofPrint
                src={`/landing/screens/${s.shot}.webp`}
                small={{
                  src: `/landing/screens/${s.shot}-phone.webp`,
                  width: s.shot === 'organizer-registration-form' ? 720 : 780,
                  height: s.shot === 'organizer-registration-form' ? 1400 : 1688,
                }}
                alt={s.alt}
                width={s.w}
                height={s.h}
                slug={s.slug}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="rl-stack" aria-hidden="true">
        <div className="rl-stack__frame">
          {STEPS.map((s, i) => (
            <div key={s.shot} className="rl-stack__item" data-state={state(i)}>
              <ProofPrint src={`/landing/screens/${s.shot}.webp`} alt="" width={s.w} height={s.h} slug={s.slug} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
