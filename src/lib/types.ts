/**
 * Type definitions mirroring the v2 schema in Supabase.
 * Source of truth: PRD v1.4 — Data Model section.
 */

// ============================================================
// Role Model (PRD v1.2+ RM-1)
// ============================================================

export type UserRole = 'superadmin' | 'admin' | 'user'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface DisplayPreferences {
  theme: ThemePreference
}

export interface User {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  home_tenant_id: string | null
  admin_tenant_scope: string[] | null  // null = unscoped, [] = none, [...] = specific
  display_preferences: DisplayPreferences
  created_at: string
  last_login_at: string | null
  deleted_at: string | null
}

// ============================================================
// Tenants (PRD v1.2/1.3 expanded in v1.4)
// ============================================================

export interface Tenant {
  id: string                    // slug
  name: string
  status: 'active' | 'inactive'
  federal_posture: 'unknown' | 'has_federal' | 'no_federal'
  client_logo_url: string | null
  client_color: string          // defaults to #D4920A
  cobrand_name: string | null
  cobrand_logo_url: string | null
  report_tagline: string | null
  template_id: string | null
  prompt_variant_enrichment: string
  prompt_variant_dna: string
  prompt_variant_gate: string
  value_threshold: number
  hidden_gem_score_threshold: number
  turn_count: number
  batch_size: number
  archive_age_days: number
  current_round: number
  created_at: string
  updated_at: string
}

// ============================================================
// Prompt Variants (PRD v1.3 PV-1)
// ============================================================

export type PromptUseCase = 'enrichment' | 'dna' | 'gate'

export type IndustryTag = 'defense' | 'it_services' | 'healthcare' | 'pro_services' | 'other'

export interface PromptVariant {
  id: string                    // e.g., 'defense_mfg_enrichment_v1'
  name: string
  industry_tag: IndustryTag
  use_case: PromptUseCase
  version: number
  prompt_template: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  retired_at: string | null
}

// ============================================================
// Tenant Templates (PRD v1.3 TT-1)
// ============================================================

export interface TenantTemplate {
  id: string
  name: string
  description: string
  industry_tag: IndustryTag
  default_prompt_variant_enrichment: string
  default_prompt_variant_dna: string
  default_prompt_variant_gate: string
  default_value_threshold: number
  default_hidden_gem_score: number
  default_turn_count: number
  default_batch_size: number
  default_archive_age_days: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// Tenant Resolution State (PRD v1.4 Tenant Resolution States)
// ============================================================

export type TenantResolutionState = 'loading' | 'ready' | 'needs-picker' | 'stale'

// ============================================================
// Banner State (PRD v1.2 RM-5)
// ============================================================

export type BannerState =
  | { kind: 'none' }
  | { kind: 'tenant-view'; tenantName: string; actorName: string }
  | { kind: 'impersonation'; impersonatedUserName: string; tenantName: string }

// ============================================================
// Profile Architecture (PRD v1.5 — commercial/federal/reconciliation/strategic)
// ============================================================

export type SourceBucket = 'commercial' | 'federal'

export type SourceType =
  | 'website'
  | 'linkedin'
  | 'press_release'
  | 'uploaded_doc'
  | 'free_text'
  | 'highergov'
  | 'sam_gov'
  | 'sba_dsbs'
  | 'usaspending'
  | 'gsa_elibrary'
  | 'cape_statement'

export interface ProfileSource {
  id: string
  tenant_id: string
  bucket: SourceBucket
  source_type: SourceType
  label: string
  url: string | null
  raw_content: string | null
  extracted_text: string | null
  metadata: Record<string, any> | null
  fetched_at: string | null
  created_at: string
  created_by: string | null
  // Digest pipeline (migration 0004)
  digest_text: string | null
  digest_structured: Record<string, any> | null
  digest_status: 'pending' | 'running' | 'ready' | 'error' | 'skipped'
  digest_error: string | null
  digested_at: string | null
}

export interface CommercialProfile {
  id: string
  tenant_id: string
  synthesized_text: string | null
  structured_data: Record<string, any> | null
  last_built_at: string | null
  source_count: number
  created_at: string
  updated_at: string
}

export interface FederalProfile {
  id: string
  tenant_id: string
  synthesized_text: string | null
  structured_data: Record<string, any> | null
  naics_codes: string[] | null
  certifications: string[] | null
  psc_codes: string[] | null
  uei: string | null
  cage: string | null
  last_built_at: string | null
  source_count: number
  created_at: string
  updated_at: string
}

export interface Reconciliation {
  id: string
  tenant_id: string
  mode: 'reconcile' | 'framework'
  alignment: string | null
  divergence: string | null
  suggestions: string | null
  structured_data: Record<string, any> | null
  version: number
  last_built_at: string | null
  created_at: string
  updated_at: string
}

export interface StrategicProfile {
  id: string
  tenant_id: string
  name: string
  description: string | null
  positioning: string | null
  target_agencies: string[] | null
  target_naics: string[] | null
  target_psc: string[] | null
  is_default: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  deleted_at: string | null
}

// ============================================================
// Search Scopes (Round 1 NAICS+PSC cross-pollinated searches)
// ============================================================

export type ScopeTier = 'primary' | 'secondary' | 'exploratory'

export interface SearchScope {
  id: string
  tenant_id: string
  scope_tag: string
  name: string
  tier: ScopeTier
  rationale: string | null
  naics_codes: string[]
  psc_prefixes: string[]
  keyword_layers: string[] | null

  // AI correlation
  correlation_score: number | null       // 1-10
  correlation_rationale: string | null

  // AI estimates (before search)
  estimated_annual_awards: number | null
  estimated_annual_dollars: number | null
  estimated_size_label: string | null

  // Actual data (after dataset import)
  actual_award_count: number | null
  actual_dollar_volume: number | null
  last_imported_at: string | null

  strategic_angle: string | null
  generated_by: string | null
  generated_at: string
  pinned: boolean
  archived: boolean
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ============================================================
// Round 1 Keyword Bank (picked from dataset analysis)
// ============================================================

export interface Round1Keyword {
  id: string
  tenant_id: string
  phrase: string
  dollar_volume: number | null
  award_count: number | null
  avg_contract: number | null
  relevance_score: number | null
  relevance_rationale: string | null
  claude_context: string | null
  source_scope_id: string | null
  source_scope_tag: string | null
  source_session_id: string | null
  notes: string | null
  picked_by: string | null
  picked_at: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}
