-- ============================================================
-- HackTrackr Schema Migration v2
-- Open: http://localhost:54323 → SQL Editor → paste & run
-- ============================================================

-- Extend the existing hackathons table with missing columns
ALTER TABLE hackathons ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE hackathons ALTER COLUMN deadline DROP NOT NULL;
ALTER TABLE hackathons ALTER COLUMN platform DROP NOT NULL;
ALTER TABLE hackathons ALTER COLUMN website_url DROP NOT NULL;
ALTER TABLE hackathons ALTER COLUMN theme DROP NOT NULL;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS registration_url text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS start_date timestamptz;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS end_date timestamptz;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS submission_deadline timestamptz;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS prize text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS eligibility text;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Unique index on registration_url for deduplication (partial — allows NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS hackathons_registration_url_key
  ON hackathons(registration_url)
  WHERE registration_url IS NOT NULL;

-- ── user_hackathons (bookmarks) ──────────────────────────────
CREATE TABLE IF NOT EXISTS user_hackathons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  hackathon_id uuid REFERENCES hackathons(id) ON DELETE CASCADE NOT NULL,
  saved        boolean DEFAULT true,
  status       text DEFAULT 'interested',
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, hackathon_id)
);

ALTER TABLE user_hackathons ENABLE ROW LEVEL SECURITY;

-- Drop then recreate (avoids IF NOT EXISTS which isn't supported on all PG versions)
DROP POLICY IF EXISTS "user owns user_hackathons" ON user_hackathons;
CREATE POLICY "user owns user_hackathons"
  ON user_hackathons FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── hackathons RLS ───────────────────────────────────────────
ALTER TABLE hackathons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read hackathons" ON hackathons;
CREATE POLICY "authenticated can read hackathons"
  ON hackathons FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user can insert own hackathons" ON hackathons;
CREATE POLICY "user can insert own hackathons"
  ON hackathons FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "user can update own hackathons" ON hackathons;
CREATE POLICY "user can update own hackathons"
  ON hackathons FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);
