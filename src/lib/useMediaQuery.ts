import { useEffect, useState } from 'react'

// True while the viewport matches a CSS media query. Used where two layouts
// need different data (so the hidden one should not fetch), not for styling.
export function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== 'undefined' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(read)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
