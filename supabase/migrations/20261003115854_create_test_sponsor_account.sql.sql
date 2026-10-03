/*
# Create test sponsor account

1. Purpose
- Creates a dedicated test sponsor user so the Sponsor Home dashboard can be
  exercised end-to-end.
- Creates a sponsor organization + membership (the access key for
  my_sponsor_partnerships()), an organizer org + upcoming event, and an
  active partnership linking the event to the sponsor org.
- Two triggers force created_by/completed_by = auth.uid() (NULL in
  service-role). We temporarily disable them to seed the test rows, then
  re-enable both.
- Adds obligations so the dashboard shows real metrics.

2. Credentials (throwaway test accounts)
- Sponsor:   sponsor.test@rally.dev   /  SponsorTest2026!
- Organizer: organizer.test@rally.dev /  OrganizerTest2026!

3. Idempotent — re-running updates rows in place.
4. No RLS or policy changes. Triggers disabled only for seed inserts.
*/

DO $$
DECLARE
  v_sponsor_user uuid;
  v_organizer_user uuid;
  v_sponsor_org uuid;
  v_organizer_org uuid;
  v_event uuid;
  v_partnership uuid;
BEGIN
  -- 1a. Sponsor auth user ------------------------------------------------------
  SELECT id INTO v_sponsor_user FROM auth.users WHERE email = 'sponsor.test@rally.dev';
  IF v_sponsor_user IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated', 'sponsor.test@rally.dev',
      crypt('SponsorTest2026!', gen_salt('bf')), now(), now(), now(), now(),
      jsonb_build_object('account_type', 'sponsor'),
      jsonb_build_object('full_name', 'Sponsor Test User')
    )
    RETURNING id INTO v_sponsor_user;
  ELSE
    UPDATE auth.users
      SET encrypted_password = crypt('SponsorTest2026!', gen_salt('bf')),
          email_confirmed_at = now(),
          raw_app_meta_data = jsonb_build_object('account_type', 'sponsor'),
          raw_user_meta_data = jsonb_build_object('full_name', 'Sponsor Test User')
    WHERE id = v_sponsor_user;
  END IF;

  -- 1b. Organizer auth user ----------------------------------------------------
  SELECT id INTO v_organizer_user FROM auth.users WHERE email = 'organizer.test@rally.dev';
  IF v_organizer_user IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated', 'organizer.test@rally.dev',
      crypt('OrganizerTest2026!', gen_salt('bf')), now(), now(), now(), now(),
      jsonb_build_object('account_type', 'organizer'),
      jsonb_build_object('full_name', 'Rally Organizer')
    )
    RETURNING id INTO v_organizer_user;
  ELSE
    UPDATE auth.users
      SET encrypted_password = crypt('OrganizerTest2026!', gen_salt('bf')),
          email_confirmed_at = now(),
          raw_app_meta_data = jsonb_build_object('account_type', 'organizer'),
          raw_user_meta_data = jsonb_build_object('full_name', 'Rally Organizer')
    WHERE id = v_organizer_user;
  END IF;

  -- 2a. Sponsor profile + account ----------------------------------------------
  INSERT INTO profiles (id, full_name, job_title, company, email, created_at, updated_at)
  VALUES (v_sponsor_user, 'Sponsor Test User', 'Head of Sponsorship', 'Acme Sponsor Co', 'sponsor.test@rally.dev', now(), now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, job_title = EXCLUDED.job_title,
    company = EXCLUDED.company, email = EXCLUDED.email, updated_at = now();

  INSERT INTO user_accounts (user_id, account_type, status, created_at, updated_at)
  VALUES (v_sponsor_user, 'sponsor', 'active', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    account_type = 'sponsor', status = 'active', updated_at = now();

  -- 2b. Organizer profile + account --------------------------------------------
  INSERT INTO profiles (id, full_name, job_title, company, email, created_at, updated_at)
  VALUES (v_organizer_user, 'Rally Organizer', 'Event Director', 'Rally Events Org', 'organizer.test@rally.dev', now(), now())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, job_title = EXCLUDED.job_title,
    company = EXCLUDED.company, email = EXCLUDED.email, updated_at = now();

  INSERT INTO user_accounts (user_id, account_type, status, created_at, updated_at)
  VALUES (v_organizer_user, 'organizer', 'active', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    account_type = 'organizer', status = 'active', updated_at = now();

  -- 3a. Sponsor organization ---------------------------------------------------
  SELECT id INTO v_sponsor_org FROM organizations WHERE name = 'Acme Sponsor Co';
  IF v_sponsor_org IS NULL THEN
    INSERT INTO organizations (name, org_type, approval_status, created_by, created_at, updated_at)
    VALUES ('Acme Sponsor Co', 'sponsor', 'approved', v_sponsor_user, now(), now())
    RETURNING id INTO v_sponsor_org;
  ELSE
    UPDATE organizations SET org_type = 'sponsor', approval_status = 'approved'
    WHERE id = v_sponsor_org;
  END IF;

  -- 3b. Organizer organization -------------------------------------------------
  SELECT id INTO v_organizer_org FROM organizations WHERE name = 'Rally Events Org';
  IF v_organizer_org IS NULL THEN
    INSERT INTO organizations (name, org_type, approval_status, created_by, created_at, updated_at)
    VALUES ('Rally Events Org', 'organizer', 'approved', v_organizer_user, now(), now())
    RETURNING id INTO v_organizer_org;
  ELSE
    UPDATE organizations SET org_type = 'organizer', approval_status = 'approved',
        created_by = v_organizer_user
    WHERE id = v_organizer_org;
  END IF;

  -- 4. Sponsor organization membership -----------------------------------------
  INSERT INTO organization_members (organization_id, user_id, role, created_at)
  VALUES (v_sponsor_org, v_sponsor_user, 'admin', now())
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'admin';

  -- 5. Sample upcoming event ---------------------------------------------------
  SELECT id INTO v_event FROM events WHERE name = 'Rally DevCon 2026';
  IF v_event IS NULL THEN
    INSERT INTO events (
      name, location, start_date, end_date, status, organization_id,
      visibility, created_at, created_by
    )
    VALUES (
      'Rally DevCon 2026', 'San Francisco, CA',
      (current_date + integer '21')::date,
      (current_date + integer '23')::date,
      'upcoming', v_organizer_org, 'published', now(), v_organizer_user
    )
    RETURNING id INTO v_event;
  ELSE
    UPDATE events
      SET start_date = (current_date + integer '21')::date,
          end_date   = (current_date + integer '23')::date,
          status = 'upcoming', location = 'San Francisco, CA',
          visibility = 'published', organization_id = v_organizer_org
    WHERE id = v_event;
  END IF;

  -- 6. Active partnership ------------------------------------------------------
  -- check_event_partnership_rules forces created_by=auth.uid() and forbids
  -- sponsor_organization_id on INSERT. Disable it to seed the test row.
  SELECT id INTO v_partnership
  FROM event_partnerships
  WHERE event_id = v_event AND sponsor_organization_id = v_sponsor_org;

  ALTER TABLE event_partnerships DISABLE TRIGGER check_event_partnership_rules;
  IF v_partnership IS NULL THEN
    INSERT INTO event_partnerships (
      event_id, sponsor_organization_id, company_name, tier_label,
      status, acknowledged_at, display_order, created_by, created_at, updated_at
    )
    VALUES (
      v_event, v_sponsor_org, 'Acme Sponsor Co', 'Gold',
      'active', now(), 1, v_organizer_user, now(), now()
    )
    RETURNING id INTO v_partnership;
  ELSE
    UPDATE event_partnerships
      SET status = 'active', sponsor_organization_id = v_sponsor_org,
          company_name = 'Acme Sponsor Co', tier_label = 'Gold',
          acknowledged_at = now()
    WHERE id = v_partnership;
  END IF;
  ALTER TABLE event_partnerships ENABLE TRIGGER check_event_partnership_rules;

  -- 7. Partnership role --------------------------------------------------------
  INSERT INTO event_partnership_roles (partnership_id, event_id, role, created_at)
  VALUES (v_partnership, v_event, 'sponsor', now())
  ON CONFLICT DO NOTHING;

  -- 8. Sample obligations ------------------------------------------------------
  -- check_partnership_obligation_rules forces created_by/completed_by =
  -- auth.uid() (NULL in service-role). Disable it to seed the test rows.
  DELETE FROM event_partnership_obligations WHERE partnership_id = v_partnership;

  ALTER TABLE event_partnership_obligations DISABLE TRIGGER check_partnership_obligation_rules;
  INSERT INTO event_partnership_obligations
    (partnership_id, event_id, direction, title, status, display_order, completed_at, completed_by, created_by, created_at, updated_at)
  VALUES
    (v_partnership, v_event, 'organizer_to_partner', 'Logo on event website', 'completed', 1, now(), v_organizer_user, v_organizer_user, now(), now()),
    (v_partnership, v_event, 'organizer_to_partner', 'Booth placement confirmed', 'pending', 2, NULL, NULL, v_organizer_user, now(), now()),
    (v_partnership, v_event, 'partner_to_organizer', 'Sponsor fee payment', 'pending', 1, NULL, NULL, v_organizer_user, now(), now());
  ALTER TABLE event_partnership_obligations ENABLE TRIGGER check_partnership_obligation_rules;
END;
$$;
