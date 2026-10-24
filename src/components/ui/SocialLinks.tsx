import type { ComponentType, SVGProps } from 'react'
import { Facebook, Instagram, Linkedin, Twitter, Youtube } from 'lucide-react'
import { cn } from '@/lib/utils'

// lucide has no TikTok mark, so it is drawn here.
function TikTok(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M16.6 2h-3.2v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.1 6.1 0 1 0 5.2 6V8.7a7.6 7.6 0 0 0 4.4 1.4V6.9a4.4 4.4 0 0 1-4.4-4.4V2z" />
    </svg>
  )
}

export type SocialHandles = {
  linkedin?: string | null
  facebook?: string | null
  instagram?: string | null
  tiktok?: string | null
  x?: string | null
  youtube?: string | null
}

const NETWORKS: { key: keyof SocialHandles; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: 'linkedin', label: 'LinkedIn', Icon: Linkedin as ComponentType<SVGProps<SVGSVGElement>> },
  { key: 'facebook', label: 'Facebook', Icon: Facebook as ComponentType<SVGProps<SVGSVGElement>> },
  { key: 'instagram', label: 'Instagram', Icon: Instagram as ComponentType<SVGProps<SVGSVGElement>> },
  { key: 'tiktok', label: 'TikTok', Icon: TikTok },
  { key: 'x', label: 'X', Icon: Twitter as ComponentType<SVGProps<SVGSVGElement>> },
  { key: 'youtube', label: 'YouTube', Icon: Youtube as ComponentType<SVGProps<SVGSVGElement>> },
]

// Only web addresses become links, so a malformed value cannot become a script link.
const web = (v: string | null | undefined) => (v && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)

// A row of social icons. A network the organization has not added renders as a
// muted, inert icon, so the full set is visible while only real links are clickable.
export function SocialLinks({ name, handles, className }: { name: string; handles: SocialHandles; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-2', className)} aria-label={`${name} on social media`}>
      {NETWORKS.map(({ key, label, Icon }) => {
        const href = web(handles[key])
        return (
          <li key={key}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${name} on ${label}`}
                title={label}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-rally-tint text-primary-700 transition-colors hover:bg-primary-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span
                title={`${label}: not added yet`}
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-300"
              >
                <Icon className="h-5 w-5" />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
