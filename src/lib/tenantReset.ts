import { supabase } from '@/lib/supabase'
import { logMethodology } from '@/lib/methodologyLog'

/**
 * Reset a tenant's downstream analysis data while preserving the Step 1
 * profile evidence. Logs a retroactive Step 1 summary so the audit trail
 * starts clean with documentation of what was previously ingested.
 *
 * PRESERVES:
 *  - tenant row (resets current_round = 1)
 *  - profile_sources (all 17 document uploads — Step 1 evidence)
 *  - commercial_profiles, federal_profiles, reconciliations
 *  - strategic_profiles
 *  - storage bucket files (profile-documents, branding-assets)
 *
 * DELETES:
 *  - search_scopes
 *  - enrichment_sessions + records + gate_outputs + snapshots
 *  - round_1_keywords
 *  - methodology_log entries
 */
export async function resetTenantDownstream(tenantId: string): Promise<{
  ok: boolean
  summary: Record<string, number>
  error?: string
}> {
  const summary: Record<string, number> = {}

  try {
    // === STEP 1: Snapshot the profile evidence BEFORE wiping the log ===
    // So we can retroactively document what was ingested.
    const { data: profileSources, error: psErr } = await supabase
      .from('profile_sources')
      .select('*')
      .eq('tenant_id', tenantId)
    if (psErr) throw new Error(`Profile sources fetch failed: ${psErr.message}`)

    const { data: commercialProfiles } = await supabase
      .from('commercial_profile')
      .select('built_at, sources_count, synthesized_text')
      .eq('tenant_id', tenantId)

    const step1Summary = {
      sources_count: profileSources?.length || 0,
      sources: (profileSources || []).map((s: any) => ({
        id: s.id,
        label: s.label,
        source_type: s.source_type,
        bucket: s.bucket,
        fetched_at: s.fetched_at,
        filename: s?.metadata?.filename,
        size: s?.metadata?.size,
        content_type: s?.metadata?.content_type,
      })),
      commercial_profile: commercialProfiles?.[0]
        ? {
            built_at: commercialProfiles[0].built_at,
            sources_count: commercialProfiles[0].sources_count,
            synthesized_text_length: (commercialProfiles[0].synthesized_text || '').length,
          }
        : null,
    }

    // === STEP 2: Delete downstream tables (order matters: FK dependencies) ===

    // 2a. Round 1 keywords
    const { count: kwCount } = await supabase
      .from('round_1_keywords')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
    summary.round_1_keywords = kwCount || 0

    // 2b. Enrichment records (FK to sessions)
    const { count: recCount } = await supabase
      .from('enrichment_records')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
    summary.enrichment_records = recCount || 0

    // 2c. Gate outputs (FK to sessions)
    await supabase.from('gate_outputs').delete().eq('tenant_id', tenantId)

    // 2d. Session snapshots
    await supabase.from('session_snapshots').delete().eq('tenant_id', tenantId)

    // 2e. Enrichment sessions
    const { count: sessCount } = await supabase
      .from('enrichment_sessions')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
    summary.enrichment_sessions = sessCount || 0

    // 2f. Search scopes
    const { count: scopeCount } = await supabase
      .from('search_scopes')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
    summary.search_scopes = scopeCount || 0

    // 2g. Wipe prior methodology log for a clean slate
    const { count: logCount } = await supabase
      .from('methodology_log')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
    summary.methodology_log_cleared = logCount || 0

    // === STEP 3: Reset tenant to Round 1 ===
    await supabase.from('tenants').update({ current_round: 1 }).eq('id', tenantId)

    // === STEP 4: Write the first entries of the new audit trail ===

    // 4a. Retroactive Step 1 summary
    await logMethodology({
      tenantId,
      eventType: 'step_1_profile_ingestion_summary',
      actor: 'system',
      summary: `Step 1: Commercial profile built from ${step1Summary.sources_count} source documents (ingested prior to audit trail start; retroactively documented here).`,
      details: step1Summary,
    })

    // 4b. Session reset event marking start of clean audit trail
    await logMethodology({
      tenantId,
      eventType: 'session_reset',
      actor: 'user',
      summary: `User reset downstream analysis data and restarted audit trail from Round 1. All Step 1 profile evidence preserved.`,
      details: {
        preserved: {
          profile_sources_count: step1Summary.sources_count,
          commercial_profile: !!step1Summary.commercial_profile,
        },
        deleted: summary,
      },
    })

    return { ok: true, summary }
  } catch (err: any) {
    return {
      ok: false,
      summary,
      error: err?.message || 'Reset failed',
    }
  }
}
