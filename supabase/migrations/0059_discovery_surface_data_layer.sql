-- ============================================================================
-- Migration 0059 — Discovery surface data layer
-- ============================================================================
-- Doctrine source: DOCTRINE.md
--   D4: Boundary — Tenants/Prospects see market shape; Clients see operational
--       depth (vendor, agency, PIID, etc.)
--   D5: Cluster Card doctrine — terminal node of prospect-facing tree
--   D5 amendment (this session, 2026-05-16):
--     Per-award drill-down VISIBLE:
--       description, dollars (obligated/ceiling/direct), NAICS code + title,
--       PSC code + title, parent_idv_piid, pop dates, idv_type / award_kind
--     Per-award drill-down HIDDEN:
--       awardee_name, awardee_parent, awardee_uei, awardee_cage,
--       agency_dept, agency_raw, capability (admin label), match_reasoning
--   D13: Additive only — existing /recon, tenant_recon_awards, recon_feedback,
--        and v_recon_awards_with_feedback are untouched. Dana's in-flight
--        session is preserved.
--
-- This migration creates the data layer the v2 Discovery surface consumes.
-- Two new tenant-safe views sit on top of the existing schema. The legacy
-- v_recon_awards_with_feedback view continues to serve admin/Client surfaces.
--
-- Changes:
--   (1) Add `ring` column to recon_clusters with backfill from MODE(ring)
--       of constituent awards in tenant_recon_awards
--   (2) Create v2.v_discovery_clusters_tenant — cluster card view, per-user
--       progress via auth.uid(), admin columns stripped, agency_dept kept
--       as market-shape signal
--   (3) Create v2.v_discovery_awards_tenant — per-award drill-down view,
--       identifier columns stripped per D5 amendment
--
-- Naming follows corrected vocabulary (Discovery, not Recon — "Recon" is
-- reserved for the Stage 9 deliverable per Naming Hygiene clarification).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) Add ring column to recon_clusters with backfill
-- ----------------------------------------------------------------------------
ALTER TABLE v2.recon_clusters
  ADD COLUMN IF NOT EXISTS ring integer;

UPDATE v2.recon_clusters c
SET ring = sub.modal_ring,
    updated_at = now()
FROM (
  SELECT cluster_id,
         MODE() WITHIN GROUP (ORDER BY ring) AS modal_ring
  FROM v2.tenant_recon_awards
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
) sub
WHERE c.id = sub.cluster_id
  AND c.ring IS NULL;

-- ----------------------------------------------------------------------------
-- (2) Tenant-safe cluster card view
--     Per-user progress columns use auth.uid() so each user sees their own.
--     Strips: capability_kind, campaign_signature, match_reasoning, edited_by
--     Keeps: agency_dept (aggregate market-shape signal, not per-award ID)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v2.v_discovery_clusters_tenant AS
SELECT
  c.id,
  c.tenant_id,
  c.ring,
  c.level,
  c.parent_cluster_id,
  c.name,
  c.description,
  c.agency_dept,
  c.match_score,
  c.vocabulary,
  c.code_pattern,
  c.award_count,
  c.contract_count,
  c.idv_count,
  c.total_obligated,
  c.total_ceiling,
  c.distinct_awardees,
  c.sort_order,
  ( SELECT count(*)::integer
      FROM v2.tenant_recon_awards a
        LEFT JOIN v2.recon_feedback f
          ON f.tenant_id = a.tenant_id
         AND f.award_id = a.award_id
         AND f.user_id = auth.uid()
     WHERE a.cluster_id = c.id
       AND f.fit_status IS NOT NULL
  ) AS awards_decided,
  ( SELECT count(*)::integer
      FROM v2.tenant_recon_awards a
        LEFT JOIN v2.recon_feedback f
          ON f.tenant_id = a.tenant_id
         AND f.award_id = a.award_id
         AND f.user_id = auth.uid()
     WHERE a.cluster_id = c.id
       AND f.fit_status = 'yes'::text
  ) AS awards_accepted,
  ( SELECT count(*)::integer
      FROM v2.tenant_recon_awards a
        LEFT JOIN v2.recon_feedback f
          ON f.tenant_id = a.tenant_id
         AND f.award_id = a.award_id
         AND f.user_id = auth.uid()
     WHERE a.cluster_id = c.id
       AND f.fit_status = 'no'::text
  ) AS awards_declined
FROM v2.recon_clusters c;

-- ----------------------------------------------------------------------------
-- (3) Tenant-safe per-award drill-down view
--     Strips: awardee_name, awardee_parent, awardee_uei, awardee_cage,
--             agency_dept, agency_raw, capability (admin label)
--     Keeps:  description, dollars, NAICS/PSC code+title, parent_idv_piid,
--             pop dates, idv_type / award_kind, confidence, fit_status
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v2.v_discovery_awards_tenant AS
SELECT
  a.id AS award_pk,
  a.tenant_id,
  a.award_id,
  a.cluster_id,
  a.ring,
  a.parent_idv_piid,
  a.award_kind,
  a.idv_type,
  a.description,
  a.naics,
  a.naics_title,
  a.psc,
  a.psc_title,
  a.dollars_obligated,
  a.vehicle_ceiling,
  a.direct_awards,
  a.pop_start,
  a.pop_end,
  a.action_date,
  a.fss,
  a.confidence,
  f.fit_status,
  f.note,
  f.cold_stored,
  f.cold_storage_reason
FROM v2.tenant_recon_awards a
LEFT JOIN v2.recon_feedback f
  ON f.tenant_id = a.tenant_id
 AND f.award_id = a.award_id
 AND f.user_id = auth.uid();

COMMIT;
