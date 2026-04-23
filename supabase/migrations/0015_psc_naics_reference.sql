-- 0015 PSC + NAICS reference tables
--
-- Canonical authoritative sources for Product and Service Codes (PSC,
-- April 2025 edition from GSA) and North American Industry Classification
-- System (NAICS, 2022 revision from Census Bureau). Used by scope
-- generation, keyword analysis, and methodology report to ground all
-- classification decisions in real reference data instead of model hallucination.

SET search_path TO v2, public;

-- ============================================================================
-- PSC (Product and Service Codes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.psc_codes (
  code text PRIMARY KEY,
  name text,
  start_date date,
  end_date date,
  full_name text,
  includes text,
  excludes text,
  notes text,
  parent_code text,
  category text,                  -- 'S' (service) or 'P' (product)
  level_1_code text,
  level_1_name text,
  level_2_code text,
  level_2_name text,
  is_active boolean GENERATED ALWAYS AS (end_date IS NULL) STORED
);

CREATE INDEX IF NOT EXISTS psc_codes_active_idx ON v2.psc_codes (is_active);
CREATE INDEX IF NOT EXISTS psc_codes_prefix_idx ON v2.psc_codes (substr(code, 1, 2));
CREATE INDEX IF NOT EXISTS psc_codes_parent_idx ON v2.psc_codes (parent_code);
CREATE INDEX IF NOT EXISTS psc_codes_category_idx ON v2.psc_codes (category);

ALTER TABLE v2.psc_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psc_codes_read ON v2.psc_codes;
CREATE POLICY psc_codes_read ON v2.psc_codes
  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- NAICS (North American Industry Classification System, 2022)
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.naics_codes (
  code text PRIMARY KEY,
  title text,
  year integer NOT NULL DEFAULT 2022
);

CREATE INDEX IF NOT EXISTS naics_codes_prefix_idx ON v2.naics_codes (substr(code, 1, 3));

ALTER TABLE v2.naics_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS naics_codes_read ON v2.naics_codes;
CREATE POLICY naics_codes_read ON v2.naics_codes
  FOR SELECT TO authenticated USING (true);
