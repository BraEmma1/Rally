import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Event-owned media
//
// A speaker photo or an exhibitor logo belongs to the event, not to the person
// who uploaded it. That distinction is the whole reason this file exists
// separately from PhotoUpload, which writes a *user's own* avatar to the fixed
// path `<uid>/avatar.<ext>` with upsert and is correct for exactly that.
//
// Two rules make the previous collision impossible rather than unlikely:
//
//   1. The owning folder is read from the session here, never accepted from a
//      caller. The original bug was a caller passing the organizer's id for
//      somebody else's photo; a parameter that does not exist cannot be
//      passed wrongly.
//   2. Every upload gets a fresh uuid filename, and upsert is off. Two
//      speakers can never share an object, and replacing one photo cannot
//      touch another.
// ---------------------------------------------------------------------------

export const EVENT_ASSET_BUCKET = 'event-assets'

// Mirrors the bucket's allowed_mime_types. SVG is excluded on purpose: it can
// carry script and the bucket is served publicly.
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const EVENT_ASSET_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const MAX_BYTES = 5 * 1024 * 1024

/** Folders under the uploader's own id. Keeps one kind of asset out of another's way. */
export type EventAssetFolder = 'speakers' | 'exhibitors'

function uniqueName(): string {
  // randomUUID is available in every browser this app targets and, unlike a
  // timestamp, cannot collide when two uploads start in the same millisecond.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Upload one image to the event-assets bucket and return its public URL.
 *
 * The path is `<auth.uid()>/<folder>/<uuid>.<ext>`. The first segment has to be
 * the caller's own id because that is what the bucket's INSERT policy checks;
 * taking it from the session rather than an argument means the policy and the
 * code can never disagree.
 */
export async function uploadEventAsset(
  file: File,
  folder: EventAssetFolder
): Promise<{ url: string | null; error: string | null }> {
  if (file.size > MAX_BYTES) {
    return { url: null, error: 'Image must be under 5 MB.' }
  }

  // The extension comes from the detected type, not the supplied filename.
  const ext = EXTENSION_BY_MIME_TYPE[file.type]
  if (!ext) {
    return { url: null, error: 'Please select a JPEG, PNG, WebP, or GIF image.' }
  }

  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) {
    return { url: null, error: 'Please sign in again to upload an image.' }
  }

  const path = `${uid}/${folder}/${uniqueName()}.${ext}`

  // upsert stays off: a fresh uuid should never collide, and if one somehow
  // did, an error is the right outcome rather than a silent overwrite.
  const { error: uploadError } = await supabase.storage
    .from(EVENT_ASSET_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    return { url: null, error: 'The image could not be uploaded. Please try again.' }
  }

  const { data } = supabase.storage.from(EVENT_ASSET_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

const PUBLIC_PREFIX = `/storage/v1/object/public/${EVENT_ASSET_BUCKET}/`

/**
 * The object path inside event-assets that this URL refers to, but only when
 * the current user demonstrably owns it.
 *
 * Returns null for anything else, and "anything else" very much includes the
 * legacy `avatars/<uid>/avatar.jpg` URLs that existing speaker records may
 * still carry. Deleting one of those would delete somebody's profile picture,
 * so the check is a whitelist rather than a guess.
 */
export async function ownedEventAssetPath(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  const at = url.indexOf(PUBLIC_PREFIX)
  if (at === -1) return null

  const path = decodeURIComponent(url.slice(at + PUBLIC_PREFIX.length).split('?')[0])
  if (!path) return null

  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return null

  // <uid>/<folder>/<file> and the uid has to be ours.
  const segments = path.split('/')
  if (segments.length < 3 || segments[0] !== uid) return null

  return path
}

/**
 * Best-effort removal of an event asset this user uploaded.
 *
 * Only ever called *after* the database no longer references the object, so a
 * failure here leaves a harmless orphan rather than a broken image. Nothing
 * is reported to the caller for the same reason.
 */
export async function deleteOwnEventAsset(url: string | null | undefined): Promise<void> {
  const path = await ownedEventAssetPath(url)
  if (!path) return
  await supabase.storage.from(EVENT_ASSET_BUCKET).remove([path])
}
