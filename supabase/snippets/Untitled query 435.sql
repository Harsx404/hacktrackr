-- ============================================================
-- HackTrackr Schema Migration v3
-- Per-source platform tables + unified discover view
-- Open: http://localhost:54323 → SQL Editor → paste & run
-- ============================================================

-- ── MLH Hackathons ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mlh_hackathons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text UNIQUE NOT NULL,               -- MLH event slug/id
  name               text NOT NULL,
  registration_url   text,
  image_url          text,
  start_date         timestamptz,
  end_date           timestamptz,
  submission_deadline timestamptz,                       -- mlh: endsAt
  mode               text,                               -- 'online' | 'hybrid' | 'offline'
  location           text,
  platform           text DEFAULT 'MLH',
  tags               text[],
  updated_at         timestamptz DEFAULT now()
);

ALTER TABLE mlh_hackathons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read mlh" ON mlh_hackathons;
CREATE POLICY "authenticated can read mlh"
  ON mlh_hackathons FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service role can write mlh" ON mlh_hackathons;
CREATE POLICY "service role can write mlh"
  ON mlh_hackathons FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Unstop Hackathons ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unstop_hackathons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text UNIQUE NOT NULL,               -- Unstop internal id
  name               text NOT NULL,
  organizer          text,
  description        text,
  registration_url   text,
  image_url          text,
  reg_start_date     timestamptz,                        -- regnRequirements.start_regn_dt
  reg_end_date       timestamptz,                        -- regnRequirements.end_regn_dt (registration closes)
  end_date           timestamptz,                        -- event end date
  submission_deadline timestamptz,                       -- mirrors reg_end_date for discover view
  team_size_min      int,
  team_size_max      int,
  mode               text,                               -- region field
  location           text,
  prize              text,
  tags               text[],
  reg_status         text,                               -- 'STARTED' | 'FINISHED' | etc.
  platform           text DEFAULT 'Unstop',
  updated_at         timestamptz DEFAULT now()
);

ALTER TABLE unstop_hackathons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read unstop" ON unstop_hackathons;
CREATE POLICY "authenticated can read unstop"
  ON unstop_hackathons FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service role can write unstop" ON unstop_hackathons;
CREATE POLICY "service role can write unstop"
  ON unstop_hackathons FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Devfolio Hackathons ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS devfolio_hackathons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text UNIQUE NOT NULL,
  name               text NOT NULL,
  organizer          text,
  description        text,
  registration_url   text,
  image_url          text,
  start_date         timestamptz,
  end_date           timestamptz,
  submission_deadline timestamptz,
  mode               text,
  location           text,
  prize              text,
  tags               text[],
  platform           text DEFAULT 'Devfolio',
  updated_at         timestamptz DEFAULT now()
);

ALTER TABLE devfolio_hackathons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read devfolio" ON devfolio_hackathons;
CREATE POLICY "authenticated can read devfolio"
  ON devfolio_hackathons FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service role can write devfolio" ON devfolio_hackathons;
CREATE POLICY "service role can write devfolio"
  ON devfolio_hackathons FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Unified Discover View ────────────────────────────────────
-- The app queries this single view — adding a new source = add a UNION ALL here.
DROP VIEW IF EXISTS discover_hackathons;
CREATE VIEW discover_hackathons AS
  SELECT
    id,
    name,
    platform,
    submission_deadline,
    mode,
    location,
    prize,
    tags,
    'mlh'            AS source,
    registration_url AS registration_url,
    image_url
  FROM mlh_hackathons

  UNION ALL

  SELECT
    id,
    name,
    platform,
    submission_deadline,
    mode,
    location,
    prize,
    tags,
    'unstop'         AS source,
    registration_url AS registration_url,
    image_url
  FROM unstop_hackathons

  UNION ALL

  SELECT
    id,
    name,
    platform,
    submission_deadline,
    mode,
    location,
    prize,
    tags,
    'devfolio'       AS source,
    registration_url AS registration_url,
    image_url
  FROM devfolio_hackathons;
