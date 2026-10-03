/*
# Event partnerships phase 5B: partnership documents

One table, one private bucket, four functions. Backend only -- no UI.

## What this is, and what it is not
A partnership DOCUMENT governs or describes the commercial relationship: the
sponsorship agreement, the proposal it came from, an addendum. It belongs to
the partnership.

Obligation EVIDENCE proves one deliverable was done: the photograph of the
backdrop. It belongs to the obligation.

They are not merged and they do not share storage. Nothing in this migration
touches `event_partnership_obligation_evidence` or its bucket.

## Why a second private bucket
`partnership-assets` is 10 MB and accepts only images and PDF. Documents need
DOC and DOCX and want more headroom, and widening that bucket would silently
widen what obligation EVIDENCE accepts too -- a change to a shipped feature
nobody asked for. A separate bucket also lets the read rule differ, which it
must: evidence is readable by anyone who can read the partnership, while a
document is readable according to its own `visibility`.

## Who may read what
    organizer (can_manage_event)        every document of their event
    linked sponsor organization member  only documents marked `shared`
    everyone else                       nothing

The sponsor half deliberately does NOT key on `account_type = 'sponsor'`. A
representative keeps whatever account type they had -- usually `attendee` --
and their authority comes from membership of the organization the partnership
is linked to. That is the same rule phase 3A established and phase 5B reuses
it rather than inventing a parallel one.

Before acceptance there is no linked organization, so an invitee sees no
documents at all. Phase 3B's review contract is untouched and remains the only
pre-acceptance window.

## One predicate, stated once
`can_read_partnership_document_object` is SECURITY DEFINER and is used by the
storage policy, while the table policy spells out the same rule for rows. Both
read the CURRENT `visibility`, so flipping a document back to internal denies
the next request -- see the note at the end about URLs already issued.
*/

-- ============================================================================
-- Is the caller a member of the organization this partnership is linked to?
--
-- The second half of phase 3A's can_read_partnership, on its own, because
-- documents need the two halves separately: an organizer sees everything and
-- a sponsor sees only what is shared.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_partnership_sponsor_member(target_partnership_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_partnerships p
    WHERE p.id = target_partnership_id
      AND p.sponsor_organization_id IS NOT NULL
      AND public.is_org_member(p.sponsor_organization_id)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_partnership_sponsor_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_partnership_sponsor_member(uuid) TO authenticated;

-- ============================================================================
-- event_partnership_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id uuid NOT NULL,
  event_id uuid NOT NULL,

  -- A short, closed vocabulary. Not inferred from anything, and never used to
  -- decide visibility: a proposal can be shared and a signed agreement can be
  -- internal, and only the organizer knows which.
  document_type text NOT NULL DEFAULT 'other',

  title text NOT NULL,
  description text,

  -- The object inside the private bucket. Never a URL: a URL is an access
  -- grant, and this column outlives any decision to grant access. UNIQUE so
  -- two rows can never claim the same object and make deletion ambiguous.
  storage_path text NOT NULL,
  -- Kept for display and for the download filename, never used to locate the
  -- object. The storage path is generated, so a hostile filename cannot
  -- escape its folder or collide with anything.
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,

  visibility text NOT NULL DEFAULT 'internal',

  -- The date ON the document -- when the agreement was signed or the proposal
  -- issued -- as opposed to when somebody uploaded it. Optional, and worth a
  -- column because "Agreement dated 1 September" is what a person looks for
  -- and created_at cannot answer it.
  document_date date,

  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partnership_documents_type_allowed CHECK (
    document_type IN ('sponsorship_agreement', 'proposal', 'contract',
                      'memorandum', 'addendum', 'package_document', 'other')
  ),
  CONSTRAINT partnership_documents_visibility_allowed CHECK (
    visibility IN ('internal', 'shared')
  ),
  CONSTRAINT partnership_documents_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT partnership_documents_title_length CHECK (length(title) <= 200),
  CONSTRAINT partnership_documents_description_length
    CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT partnership_documents_filename_not_blank CHECK (btrim(original_filename) <> ''),
  CONSTRAINT partnership_documents_filename_length CHECK (length(original_filename) <= 255),
  -- No separators and no control characters: whatever the browser handed over,
  -- what is stored cannot be read as a path.
  CONSTRAINT partnership_documents_filename_safe CHECK (
    original_filename !~ '[/\\]' AND original_filename !~ '[\x00-\x1f\x7f]'
  ),
  CONSTRAINT partnership_documents_path_length CHECK (length(storage_path) <= 1024),
  -- The same list as the bucket's allowed_mime_types, asserted again here so a
  -- row cannot claim a type the bucket would have refused.
  CONSTRAINT partnership_documents_mime_allowed CHECK (
    mime_type IN (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    )
  ),
  CONSTRAINT partnership_documents_size_positive CHECK (file_size > 0),
  CONSTRAINT partnership_documents_size_limit CHECK (file_size <= 26214400),
  CONSTRAINT partnership_documents_storage_path_unique UNIQUE (storage_path),

  -- Cross-partnership and cross-event containment, declared rather than
  -- checked: a document cannot belong to one event while its partnership
  -- belongs to another.
  CONSTRAINT partnership_documents_partnership_fk
    FOREIGN KEY (partnership_id, event_id)
    REFERENCES event_partnerships (id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_partnership_documents_partnership
  ON event_partnership_documents (partnership_id, created_at DESC);
-- The storage policy looks an object path up here on every read.
CREATE INDEX IF NOT EXISTS idx_partnership_documents_storage_path
  ON event_partnership_documents (storage_path);

-- ============================================================================
-- RLS
--
-- SELECT splits: organizers see everything, a linked sponsor member sees only
-- what is shared. Writes are organizer-only -- sponsor upload, editing and
-- deletion are out of scope for this phase, so there is no policy that would
-- permit them.
-- ============================================================================
ALTER TABLE event_partnership_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_partnership_documents FROM anon;
REVOKE TRUNCATE ON public.event_partnership_documents FROM anon, authenticated;

DROP POLICY IF EXISTS "read_partnership_documents" ON event_partnership_documents;
CREATE POLICY "read_partnership_documents"
  ON event_partnership_documents FOR SELECT TO authenticated
  USING (
    public.can_manage_event(event_id)
    OR (visibility = 'shared' AND public.is_partnership_sponsor_member(partnership_id))
  );

DROP POLICY IF EXISTS "write_partnership_documents" ON event_partnership_documents;
CREATE POLICY "write_partnership_documents"
  ON event_partnership_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "update_partnership_documents" ON event_partnership_documents;
CREATE POLICY "update_partnership_documents"
  ON event_partnership_documents FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "delete_partnership_documents" ON event_partnership_documents;
CREATE POLICY "delete_partnership_documents"
  ON event_partnership_documents FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

-- ============================================================================
-- What a document write may contain
--
-- The lifecycle rule is deliberately the SAME one obligations and evidence
-- already follow: only an archived EVENT freezes writes. A cancelled or
-- completed partnership stays editable, because that is what every other
-- child of a partnership does today and a document that behaved differently
-- would be a second, undocumented rule.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_partnership_document_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  NEW.title := btrim(NEW.title);
  NEW.original_filename := btrim(NEW.original_filename);

  IF TG_OP = 'INSERT' THEN
    -- Observed, never accepted from the caller.
    NEW.uploaded_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
       OR NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A document cannot be moved to another partnership';
    END IF;
    -- Repointing a row at a different object would hand its authorization to
    -- a file it was never checked against. Replace the document instead.
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
      RAISE EXCEPTION 'The stored file of a document cannot be changed';
    END IF;
    IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
      RAISE EXCEPTION 'The uploader of a document cannot be changed';
    END IF;
    IF NEW.file_size IS DISTINCT FROM OLD.file_size
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type THEN
      RAISE EXCEPTION 'The stored file of a document cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_document_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_partnership_document_rules ON event_partnership_documents;
CREATE TRIGGER check_partnership_document_rules
  BEFORE INSERT OR UPDATE ON event_partnership_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_document_rules();

-- Deleting on an archived event is a write too. Phase 1's shared helper
-- already performs exactly this check from OLD.event_id.
DROP TRIGGER IF EXISTS check_partnership_document_delete_archive ON event_partnership_documents;
CREATE TRIGGER check_partnership_document_delete_archive
  BEFORE DELETE ON event_partnership_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_child_not_archived();

-- ============================================================================
-- Private storage: partnership-documents
--
-- 25 MB, and business document types only. No SVG, no archives, nothing
-- executable.
--
-- HONEST LIMITATION: `allowed_mime_types` checks the Content-Type the client
-- declares, not the bytes. A caller can label an arbitrary file
-- `application/pdf`. What that buys them is a private object only their own
-- event team (and, if shared, the sponsor) can ever retrieve, served as an
-- attachment rather than executed -- so the exposure is to the organization
-- that uploaded it. Real content sniffing needs a server-side step and is not
-- available at this layer; it is recorded here rather than implied away.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partnership-documents', 'partnership-documents', false, 26214400,
        ARRAY['application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg',
              'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- Who may write an object, decided from the path
--
-- Objects live at `partnerships/<partnership_id>/documents/<uuid>.<ext>`
-- rather than under the uploader's own id, which is the convention the other
-- buckets use. The reason is cleanup: a folder keyed on the uploader means
-- only the uploader can delete, so a teammate tidying up after somebody who
-- has left the team cannot. Keyed on the partnership, anybody who manages the
-- event can.
--
-- That makes the path meaningful, so it has to be parsed -- carefully. A
-- malformed segment returns false rather than raising, and the function is
-- SECURITY DEFINER only so that it can consult event_partnerships; the
-- authority it reports is still can_manage_event's.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_write_partnership_document_object(object_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  parts text[];
  v_partnership uuid;
BEGIN
  parts := string_to_array(COALESCE(object_name, ''), '/');
  IF array_length(parts, 1) <> 4
     OR parts[1] <> 'partnerships'
     OR parts[3] <> 'documents'
     OR COALESCE(btrim(parts[4]), '') = '' THEN
    RETURN false;
  END IF;

  BEGIN
    v_partnership := parts[2]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1 FROM event_partnerships p
    WHERE p.id = v_partnership
      AND public.can_manage_event(p.event_id)
      AND public.account_is_active()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_write_partnership_document_object(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_partnership_document_object(text) TO authenticated;

-- ============================================================================
-- Who may read an object
--
-- The document ROW is the authorization anchor, exactly as the evidence row
-- is for evidence. An object nothing points at is unreadable by everyone,
-- which is what makes a failed upload inert rather than exposed.
--
-- Supabase requires SELECT on an object before it will sign a URL for it, so
-- this function IS the check that happens before a signed URL is issued --
-- no Edge Function, no service-role key near the client. It reads the current
-- `visibility` every time it is called.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_read_partnership_document_object(object_name text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_partnership_documents d
    WHERE d.storage_path = object_name
      AND (
        public.can_manage_event(d.event_id)
        OR (d.visibility = 'shared'
            AND public.is_partnership_sponsor_member(d.partnership_id))
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_read_partnership_document_object(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_partnership_document_object(text) TO authenticated;

DROP POLICY IF EXISTS "Read partnership documents" ON storage.objects;
CREATE POLICY "Read partnership documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'partnership-documents'
    AND public.can_read_partnership_document_object(storage.objects.name)
  );

DROP POLICY IF EXISTS "Upload partnership documents" ON storage.objects;
CREATE POLICY "Upload partnership documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'partnership-documents'
    AND public.can_write_partnership_document_object(storage.objects.name)
  );

DROP POLICY IF EXISTS "Update partnership documents" ON storage.objects;
CREATE POLICY "Update partnership documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'partnership-documents'
    AND public.can_write_partnership_document_object(storage.objects.name)
  )
  WITH CHECK (
    bucket_id = 'partnership-documents'
    AND public.can_write_partnership_document_object(storage.objects.name)
  );

DROP POLICY IF EXISTS "Delete partnership documents" ON storage.objects;
CREATE POLICY "Delete partnership documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'partnership-documents'
    AND public.can_write_partnership_document_object(storage.objects.name)
  );

-- ============================================================================
-- Read contract
--
-- The rows are a plain SELECT under the policy above -- an RPC that only
-- repeated the policy would be ceremony. This one exists for the single thing
-- a plain select cannot do: name the uploader. `profiles` is not readable to
-- a sponsor for an arbitrary organizer, so the join happens here, returning a
-- display name and nothing else about that person.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_partnership_documents(target_partnership_id uuid)
RETURNS TABLE (
  id uuid,
  partnership_id uuid,
  event_id uuid,
  document_type text,
  title text,
  description text,
  original_filename text,
  mime_type text,
  file_size bigint,
  visibility text,
  document_date date,
  uploaded_by_name text,
  uploaded_by_me boolean,
  created_at timestamptz,
  updated_at timestamptz,
  -- Deliberately last, and deliberately present: the client needs it to ask
  -- for a signed URL. It grants nothing -- the storage policy re-checks the
  -- row and the visibility on every request -- but it is only returned to a
  -- caller who already passed the same predicate.
  storage_path text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    d.id, d.partnership_id, d.event_id,
    d.document_type, d.title, d.description,
    d.original_filename, d.mime_type, d.file_size,
    d.visibility, d.document_date,
    COALESCE(prof.full_name, ''),
    (d.uploaded_by = auth.uid()),
    d.created_at, d.updated_at,
    d.storage_path
  FROM event_partnership_documents d
  LEFT JOIN profiles prof ON prof.id = d.uploaded_by
  WHERE d.partnership_id = target_partnership_id
    AND (
      public.can_manage_event(d.event_id)
      OR (d.visibility = 'shared'
          AND public.is_partnership_sponsor_member(d.partnership_id))
    )
  ORDER BY d.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_partnership_documents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_partnership_documents(uuid) TO authenticated;

/*
## The signed-URL caveat, stated plainly

Authorization is re-evaluated when a URL is REQUESTED, not while it is in
flight. A sponsor who obtains a signed URL for a shared document, after which
the organizer flips it to internal, can still fetch that URL until it expires.
Shortening the lifetime shrinks the window; it does not close it. Closing it
entirely would mean proxying every download through a server that re-checks on
each byte, which is a different architecture and is not what this phase buys.
The recommended lifetime is 60 seconds, matching obligation evidence.

## The upload sequence the frontend must follow

There is no single transaction spanning storage and the database, so the order
is chosen to make every failure inert:

  1. Upload to `partnerships/<partnership_id>/documents/<uuid>.<ext>`, with a
     client-generated uuid. Nothing can read it yet: the read policy needs a
     row pointing at it, and there is none.
  2. INSERT the document row with that `storage_path`.
  3. If step 2 fails, delete the object. If that delete also fails, the object
     remains UNREADABLE by everyone -- an inert orphan, not an exposure.

Deleting runs the other way: delete the row first, then the object. The moment
the row is gone the object is unreadable, so a failed object delete is again
inert. Deletion is a HARD delete: `event_partnership_documents` keeps no
tombstone, matching obligation evidence. If retention of removed agreements
ever matters, that is a deliberate audit-log decision, not something to infer.

## Future AI -- architecture only, nothing built

A document has a stable `id` and a server-side path reachable only through the
policies above, which is all a future extraction step needs to fetch one
safely. No AI table, column, job or endpoint exists here.

When it is built it must never silently change partnership terms. The workflow
is: extract -> PROPOSED changes -> human review -> explicit approval -> apply.
`event_partnership_obligations` and the partnership's own commercial fields
stay the only source of truth, and nothing may write them without an organizer
saying so.

## Not built here

Sponsor upload, editing or deletion. Pre-acceptance document sharing. A
document library at organization or event level. Versioning. Signature
workflow. Any UI.
*/
