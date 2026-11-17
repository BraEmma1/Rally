import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { RefreshCw } from 'lucide-react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// A real, scannable code. On the landing page it points at sign-up, so scanning the card
// does what a Rally card does: it takes you somewhere useful.
export function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b2554', light: '#00000000' } })
      .then((out) => { if (live) setSvg(out) })
      .catch(() => {})
    return () => { live = false }
  }, [value])
  // The SVG string comes from the qrcode library, not from user input.
  return <span role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
}

type PrintProps = {
  src: string
  alt: string
  width: number
  height: number
  slug: [string, ...string[]]
  phone?: boolean
  // A phone-width capture of the same screen, used below 640px so it stays legible.
  small?: { src: string; width: number; height: number }
  eager?: boolean
  className?: string
}

// A real Rally screen shown as a proof print: card-stock mat, printer's crop marks, and a
// slug naming where the screen comes from.
export function ProofPrint({ src, alt, width, height, slug, phone, small, eager, className = '' }: PrintProps) {
  const [where, ...rest] = slug
  const img = (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      {...(eager ? { fetchpriority: 'high' } : {})}
    />
  )
  return (
    <figure className={`rl-print${phone ? ' rl-print--phone' : ''}${small ? ' rl-print--adaptive' : ''} ${className}`}>
      <div className="rl-print__mat">
        <span className="rl-crop rl-crop--tl" aria-hidden="true" />
        <span className="rl-crop rl-crop--tr" aria-hidden="true" />
        <span className="rl-crop rl-crop--bl" aria-hidden="true" />
        <span className="rl-crop rl-crop--br" aria-hidden="true" />
        {small ? (
          <picture>
            <source media="(max-width: 640px)" srcSet={small.src} width={small.width} height={small.height} />
            {img}
          </picture>
        ) : img}
      </div>
      <figcaption className="rl-slug">
        <b>{where}</b>
        {rest.map((part) => <span key={part}>{part}</span>)}
      </figcaption>
    </figure>
  )
}

type PhotoProps = {
  name: string
  alt: string
  position?: string
  eager?: boolean
  className?: string
  sizes?: string
}

// Event photography, mounted like a print. Pexels licence: the people pictured are never
// named or presented as Rally users.
export function PhotoPrint({ name, alt, position = 'center', eager, className = '', sizes = '(max-width: 1023px) 90vw, 40vw' }: PhotoProps) {
  return (
    <figure className={`rl-photo ${className}`}>
      <img
        src={`/landing/photos/${name}-1800.webp`}
        srcSet={`/landing/photos/${name}-900.webp 900w, /landing/photos/${name}-1800.webp 1800w`}
        sizes={sizes}
        alt={alt}
        width={900}
        height={601}
        style={{ objectPosition: position }}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </figure>
  )
}

type TurnProps = {
  front: ReactNode
  back: ReactNode
  autoTurn?: boolean
  className?: string
  style?: React.CSSProperties
  name: string
}

// The signature interaction: a card that turns over to show its back. The face that is
// turned away is hidden from assistive tech so it is never read twice.
export function TurnCard({ front, back, autoTurn, className = '', style, name }: TurnProps) {
  const [side, setSide] = useState<'front' | 'back'>('front')
  const touched = useRef(false)

  useEffect(() => {
    if (!autoTurn || prefersReducedMotion()) return
    const t = window.setTimeout(() => { if (!touched.current) setSide('back') }, 2200)
    return () => window.clearTimeout(t)
  }, [autoTurn])

  const turn = () => {
    touched.current = true
    setSide((s) => (s === 'front' ? 'back' : 'front'))
  }

  return (
    <div className={`rl-turn ${className}`} data-side={side} style={style}>
      <button
        type="button"
        className="rl-turn__button"
        onClick={turn}
        aria-label={side === 'front' ? `Turn ${name}'s card over to see where you met` : `Turn ${name}'s card back to the front`}
      >
        <RefreshCw aria-hidden="true" />
        Turn over
      </button>
      <div className="rl-turn__inner">
        <div className="rl-turn__face" aria-hidden={side !== 'front'}>{front}</div>
        <div className="rl-turn__face rl-turn__back" aria-hidden={side !== 'back'}>{back}</div>
      </div>
    </div>
  )
}

// Elements marked data-deal that start below the fold arrive like dealt cards when they
// scroll into view. Anything already on screen, or any page without the observer, simply
// shows; nothing depends on this to be visible.
export function useDeal(root: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current
    if (!el || prefersReducedMotion() || !('IntersectionObserver' in window)) return
    el.dataset.js = 'true'
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-deal]'))
    const fold = window.innerHeight
    for (const item of items) item.dataset.dealt = item.getBoundingClientRect().top < fold ? 'true' : 'false'
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).dataset.dealt = 'true'
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    )
    items.filter((i) => i.dataset.dealt === 'false').forEach((i) => io.observe(i))
    return () => io.disconnect()
  }, [root])
}
