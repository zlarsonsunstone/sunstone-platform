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
