-- ── Run this in Supabase → SQL Editor ─────────────────────────────────

-- 1. Categories table
CREATE TABLE IF NOT EXISTS categories (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📍',
  color      TEXT NOT NULL DEFAULT '#DDA0DD',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Places table
CREATE TABLE IF NOT EXISTS places (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  city        TEXT,
  country     TEXT,
  note        TEXT,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  photos      JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Row Level Security (open — PIN handles auth on the client)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE places     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_places"     ON places     FOR ALL USING (true) WITH CHECK (true);

-- 4. Storage bucket for photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('place-photos', 'place-photos', true)
ON CONFLICT DO NOTHING;

CREATE POLICY "open_storage" ON storage.objects
  FOR ALL USING (bucket_id = 'place-photos')
  WITH CHECK (bucket_id = 'place-photos');
