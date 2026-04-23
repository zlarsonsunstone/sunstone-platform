import { useEffect, useState, CSSProperties } from 'react'
import { useStore } from '@/store/useStore'
import { supabase } from '@/lib/supabase'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'
import { resetTenantDownstream } from '@/lib/tenantReset'
import { logMethodology } from '@/lib/methodologyLog'
import { TabPage } from '@/components/TabPage'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { Modal } from '@/components/Modal'
import type {
  ProfileSource,
  SourceType,
  SourceBucket,
  Reconciliation,
  StrategicProfile,
  SearchScope,
} from '@/lib/types'
import { AddSourceModal } from '@/components/onboard/AddSourceModal'
import { StrategicProfileEditor } from '@/components/onboard/StrategicProfileEditor'

export function OnboardTab() {
  const activeTenant = useStore((s) => s.activeTenant)
  const commercialProfile = useStore((s) => s.commercialProfile)
  const federalProfile = useStore((s) => s.federalProfile)
  const reconciliation = useStore((s) => s.reconciliation)
  const strategicProfiles = useStore((s) => s.strategicProfiles)
  const searchScopes = useStore((s) => s.searchScopes)
  const loadProfileData = useStore((s) => s.loadProfileData)

  const [sources, setSources] = useState<ProfileSource[]>([])
  const [addSourceOpen, setAddSourceOpen] = useState<{ bucket: SourceBucket } | null>(null)
  const [building, setBuilding] = useState<'commercial' | 'federal' | 'reconcile' | null>(null)
  const [digesting, setDigesting] = useState<'commercial' | 'federal' | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [buildProgress, setBuildProgress] = useState<string | null>(null)
  const [stratEditor, setStratEditor] = useState<
    { mode: 'new' | 'edit'; profile?: StrategicProfile } | null
  >(null)
  const [viewingProfile, setViewingProfile] = useState<{
    title: string
    text: string
    structured: any
    builtAt: string | null
    sourceCount: number | null
  } | null>(null)

  useEffect(() => {
    if (!activeTenant) return
    loadSources()
  }, [activeTenant?.id])

  async function loadSources() {
    if (!activeTenant) return
    const { data } = await supabase
      .from('profile_sources')
      .select('*')
      .eq('tenant_id', activeTenant.id)
      .order('created_at', { ascending: false })
    setSources((data as ProfileSource[]) || [])
  }

  async function deleteSource(id: string) {
    if (!confirm('Delete this source? This cannot be undone.')) return
    await supabase.from('profile_sources').delete().eq('id', id)
    await loadSources()
  }

  async function digestOne(sourceId: string) {
    const src = sources.find((s) => s.id === sourceId)
    if (!src || !activeTenant) return
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, digest_status: 'running', digest_error: null } : s))
    )
    try {
      const { data: variant } = await supabase
        .from('prompt_variants')
        .select('prompt_template')
        .eq('id', 'source_digest_v1')
        .single()
      if (!variant) throw new Error('source_digest_v1 prompt not found — run migration 0004')

      // Fill in the prompt template. PDF sources not yet supported via browser direct
      // call (would need multimodal content blocks). For now, text digests only.
      const meta = src.metadata as any
      if (meta?.needs_extraction) {
        throw new Error(
          'PDF digesting via browser not yet supported. Paste the PDF text manually for now.'
        )
      }

      const sourceContent = src.extracted_text || src.raw_content || ''
      if (!sourceContent) throw new Error('Source has no content to digest')

      const urlLine = src.url ? `SOURCE URL: ${src.url}` : ''
      const prompt = variant.prompt_template
        .replace(/\{\{tenant_name\}\}/g, activeTenant.name)
        .replace(/\{\{source_type\}\}/g, src.source_type || 'unknown')
        .replace(/\{\{source_label\}\}/g, src.label || 'unlabeled')
        .replace(/\{\{#if source_url\}\}SOURCE URL: \{\{source_url\}\}\{\{\/if\}\}/g, urlLine)
        .replace(/\{\{source_content\}\}/g, sourceContent)

      const { text } = await callClaudeBrowser(prompt, {
        model: 'claude-haiku-4-5',
        maxTokens: 2048,
      })

      const structured = extractJsonBlock(text)
      const digest = text.replace(/```json[\s\S]*?```/i, '').trim()

      await supabase
        .from('profile_sources')
        .update({
          digest_text: digest,
          digest_structured: structured,
          digest_status: 'ready',
          digest_error: null,
          digested_at: new Date().toISOString(),
        })
        .eq('id', sourceId)

      await loadSources()
    } catch (err: any) {
      await supabase
        .from('profile_sources')
        .update({
          digest_status: 'error',
          digest_error: err.message || 'Digest failed',
        })
        .eq('id', sourceId)
      await loadSources()
    }
  }

  async function digestAllPending(bucket: SourceBucket) {
    const pending = sources.filter(
      (s) => s.bucket === bucket && (s.digest_status === 'pending' || s.digest_status === 'error')
    )
    if (pending.length === 0) return
    setDigesting(bucket)
    try {
      // Run sequentially to be kind to the API. Could parallelize with p-limit later.
      for (const src of pending) {
        await digestOne(src.id)
      }
    } finally {
      setDigesting(null)
    }
  }

  async function skipDigest(sourceId: string) {
    await supabase
      .from('profile_sources')
      .update({ digest_status: 'skipped' })
      .eq('id', sourceId)
    await loadSources()
  }

  async function buildProfile(bucket: SourceBucket) {
    if (!activeTenant) return
    const kind = bucket === 'commercial' ? 'commercial' : 'federal'
    setBuilding(kind)
    setBuildError(null)
    try {
      const variantId = bucket === 'commercial' ? 'commercial_profile_v1' : 'federal_profile_v1'
      const { data: variant } = await supabase
        .from('prompt_variants')
        .select('prompt_template')
        .eq('id', variantId)
        .single()
      if (!variant) throw new Error(`Prompt variant ${variantId} not found — run migration 0002`)

      const bucketSources = sources.filter((s) => s.bucket === bucket)
      if (bucketSources.length === 0) throw new Error('Add at least one source first')

      const usableSources = bucketSources.filter((s) => {
        if (s.digest_status === 'ready') return true
        if (s.digest_status === 'skipped' && (s.extracted_text || s.raw_content)) return true
        return false
      })
      const unusable = bucketSources.filter((s) => !usableSources.includes(s))
      if (usableSources.length === 0) {
        throw new Error(
          'No sources are ready to build from. Click "Digest all" first to process your sources.'
        )
      }
      if (unusable.length > 0) {
        const proceed = confirm(
          `${unusable.length} source(s) are not yet digested and will be skipped. ` +
            `Build profile from the ${usableSources.length} ready source(s)?`
        )
        if (!proceed) {
          setBuilding(null)
          return
        }
      }

      setBuildProgress(`Synthesizing profile from ${usableSources.length} sources…`)

      // Build the sources blob from digests
      const sourcesBlob = usableSources
        .map((s, i) => {
          const content =
            s.digest_text ||
            s.extracted_text ||
            (s.raw_content ? s.raw_content.slice(0, 2000) : '(no content)')
          return `### Source ${i + 1}: ${s.label} (${s.source_type})\n${content}`
        })
        .join('\n\n---\n\n')

      const placeholderKey = bucket === 'federal' ? 'federal_sources' : 'commercial_sources'
      const web = bucketSources.find((s) => s.source_type === 'website' && s.url)

      let prompt = variant.prompt_template
        .replace(/\{\{tenant_name\}\}/g, activeTenant.name)
        .replace(new RegExp(`\\{\\{${placeholderKey}\\}\\}`, 'g'), sourcesBlob)
      if (bucket === 'commercial') {
        prompt = prompt.replace(/\{\{tenant_website\}\}/g, web?.url || '(not provided)')
      }

      // Call Claude directly from the browser — no Netlify function proxy, no timeout
      const { text } = await callClaudeBrowser(prompt, {
        model: 'claude-sonnet-4-5',
        maxTokens: 8192,
      })

      const structured = extractJsonBlock(text)
      const narrative = text.replace(/```json[\s\S]*?```/i, '').trim()

      if (bucket === 'commercial') {
        await supabase.from('commercial_profile').upsert(
          {
            tenant_id: activeTenant.id,
            synthesized_text: narrative,
            structured_data: structured,
            source_count: usableSources.length,
            last_built_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id' }
        )
      } else {
        const s = structured || {}
        await supabase.from('federal_profile').upsert(
          {
            tenant_id: activeTenant.id,
            synthesized_text: narrative,
            structured_data: structured,
            naics_codes: s.naics_codes || null,
            certifications: s.certifications || null,
            psc_codes: s.psc_codes || null,
            uei: s.uei || null,
            cage: s.cage || null,
            source_count: usableSources.length,
            last_built_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id' }
        )
      }

      setBuildProgress(null)
      await loadProfileData(activeTenant.id)

      // === METHODOLOGY LOG: profile built ===
      await logMethodology({
        tenantId: activeTenant.id,
        eventType: bucket === 'commercial' ? 'commercial_profile_built' : 'federal_profile_built',
        actor: 'claude-sonnet-4-5',
        summary: `${bucket === 'commercial' ? 'Commercial' : 'Federal'} profile synthesized from ${usableSources.length} source${usableSources.length === 1 ? '' : 's'} (${narrative.length} chars)`,
        details: {
          bucket,
          variant_id: variantId,
          model: 'claude-sonnet-4-5',
          max_tokens: 8192,
          source_count: usableSources.length,
          narrative_length_chars: narrative.length,
          sources_used: usableSources.map((s) => ({
            id: s.id,
            label: s.label,
            source_type: s.source_type,
            digest_status: s.digest_status,
          })),
          sources_skipped: unusable.map((s) => ({
            id: s.id,
            label: s.label,
            reason: s.digest_status === 'pending' ? 'not digested' : `status: ${s.digest_status}`,
          })),
          has_structured_output: !!structured,
        },
      })
    } catch (err: any) {
      if (activeTenant) {
        await logMethodology({
          tenantId: activeTenant.id,
          eventType: `${bucket}_profile_build_failed`,
          actor: 'system',
          summary: `${bucket} profile build failed: ${err?.message || 'unknown error'}`,
          details: { error: err?.message, bucket },
        })
      }
      setBuildError(err.message || 'Build failed')
      setBuildProgress(null)
    } finally {
      setBuilding(null)
    }
  }

  async function runReconciliation() {
    if (!activeTenant) return
    setBuilding('reconcile')
    setBuildError(null)
    setBuildProgress('Running reconciliation…')
    try {
      const isFramework = activeTenant.federal_posture === 'no_federal'
      const variantId = isFramework ? 'federal_entry_framework_v1' : 'reconciliation_v1'

      const { data: variant } = await supabase
        .from('prompt_variants')
        .select('prompt_template')
        .eq('id', variantId)
        .single()
      if (!variant)
        throw new Error(
          `Prompt variant ${variantId} not found — run migration ${isFramework ? '0003' : '0002'}`
        )

      const prompt = variant.prompt_template
        .replace(/\{\{tenant_name\}\}/g, activeTenant.name)
        .replace(/\{\{commercial_profile\}\}/g, commercialProfile?.synthesized_text || '(no commercial profile built yet)')
        .replace(/\{\{federal_profile\}\}/g, federalProfile?.synthesized_text || '(no federal profile built yet)')

      const { text } = await callClaudeBrowser(prompt, {
        model: 'claude-sonnet-4-5',
        maxTokens: 8000,
      })

      const structured = extractJsonBlock(text)
      const cleaned = text.replace(/```json[\s\S]*?```/i, '').trim()

      // Split into alignment / divergence / suggestions sections
      const sections = splitReconciliationSections(cleaned)

      const nextVersion = (reconciliation?.version || 0) + 1

      await supabase.from('reconciliation').insert({
        tenant_id: activeTenant.id,
        mode: isFramework ? 'framework' : 'reconcile',
        alignment: isFramework ? null : sections.alignment || null,
        divergence: isFramework ? null : sections.divergence || null,
        suggestions: isFramework ? cleaned : sections.suggestions || null,
        structured_data: structured,
        version: nextVersion,
        last_built_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      setBuildProgress(null)
      await loadProfileData(activeTenant.id)

      // === METHODOLOGY LOG: reconciliation complete ===
      await logMethodology({
        tenantId: activeTenant.id,
        eventType: 'reconciliation_built',
        actor: 'claude-sonnet-4-5',
        summary: `${isFramework ? 'Federal entry framework' : 'Reconciliation'} v${nextVersion} generated (${cleaned.length} chars)`,
        details: {
          mode: isFramework ? 'framework' : 'reconcile',
          variant_id: variantId,
          model: 'claude-sonnet-4-5',
          version: nextVersion,
          narrative_length: cleaned.length,
          has_alignment: !!sections.alignment,
          has_divergence: !!sections.divergence,
          has_suggestions: !!sections.suggestions || isFramework,
          has_structured_output: !!structured,
        },
      })
    } catch (err: any) {
      if (activeTenant) {
        await logMethodology({
          tenantId: activeTenant.id,
          eventType: 'reconciliation_failed',
          actor: 'system',
          summary: `Reconciliation failed: ${err?.message || 'unknown error'}`,
          details: { error: err?.message },
        })
      }
      setBuildError(err.message || 'Reconciliation failed')
      setBuildProgress(null)
    } finally {
      setBuilding(null)
    }
  }

  function splitReconciliationSections(text: string) {
    const out = { alignment: '', divergence: '', suggestions: '' }
    const lines = text.split('\n')
    let current: 'alignment' | 'divergence' | 'suggestions' | null = null
    for (const line of lines) {
      const lower = line.toLowerCase().trim()
      if (/^#+\s*alignment/.test(lower)) { current = 'alignment'; continue }
      if (/^#+\s*divergence/.test(lower)) { current = 'divergence'; continue }
      if (/^#+\s*suggestions?/.test(lower)) { current = 'suggestions'; continue }
      if (current) out[current] += line + '\n'
    }
    out.alignment = out.alignment.trim()
    out.divergence = out.divergence.trim()
    out.suggestions = out.suggestions.trim()
    return out
  }

  async function generateSearchScopes() {
    if (!activeTenant) return
    if (!commercialProfile?.synthesized_text) {
      setBuildError('Build the commercial profile first.')
      return
    }
    setBuilding('reconcile')
    setBuildError(null)
    setBuildProgress('Generating Round 1 search scopes…')
    const startedAt = new Date()
    try {
      const prompt = `You are generating Round 1 federal search scopes for ${activeTenant.name} based on their commercial company profile.

A "search scope" is a NAICS + PSC code combination that represents one shape of federal procurement — the same NAICS code can have very different markets depending on which PSC prefix the work falls under. Example: NAICS 541511 (Custom Computer Programming) + PSC R- (Support Services) is professional services consulting; NAICS 541511 + PSC D3 is sustained IT services; NAICS 541511 + PSC 70 is bundled with IT equipment.

COMMERCIAL PROFILE:
${commercialProfile.synthesized_text}

Generate 6-10 search scopes that together cover the company's realistic federal pursuit surface.

RULES — NON-NEGOTIABLE:
- Use ONLY real, published NAICS codes (6 digits) and real PSC prefixes (letters + optional digit). Do not invent codes.
- Each scope MUST combine NAICS + PSC — never NAICS alone, never PSC alone.
- Prefer BROAD scopes that will actually return hits (hundreds to thousands of opportunities per year in federal contracting) over narrow scopes that perfectly describe the company's tech stack but return zero results. The goal is to get a dataset to analyze.
- Each scope should have a clear strategic rationale.
- Include at least one EXPLORATORY scope — adjacent/unexpected where the company's core capability could credibly apply.

COMMON PSC PREFIXES (for reference):
- A: Research & Development
- B: Special Studies / Analyses (not R&D)
- D: Information Technology & Telecommunications (D3 = IT services, D3XX are specific IT scopes)
- R: Support Services (professional, administrative, management)
- 70: General Purpose IT Equipment
- 7A: IT Services (hardware-adjacent)
- H: Quality Control / Testing
- J: Maintenance / Repair
- 6W: AI / Machine Learning

FOR EACH SCOPE PROVIDE:
- name: short memorable label (3-5 words)
- scope_tag: lowercase snake_case slug (e.g. "core_prof_services")
- tier: "primary" | "secondary" | "exploratory"
- naics_codes: array of 1-4 NAICS codes (6 digits each)
- psc_prefixes: array of 1-4 PSC prefixes (e.g. ["R-", "D3"])
- rationale: 1-2 sentences on why this scope fits
- correlation_score: integer 1-10 — how strongly does this scope match the company's ACTUAL capability (not aspiration)? 10 = direct capability match. 5 = partial match or requires meaningful pivot. 1 = very weak match (only include such scopes if they're exploratory and there's a clear strategic angle).
- correlation_rationale: 1 sentence explaining the score
- estimated_annual_awards: rough integer estimate — how many federal awards per year are let under this NAICS+PSC combo across all agencies? Your best guess, grounded in what you know about federal contracting scale.
- estimated_annual_dollars: rough integer dollar volume per year (e.g. 2000000000 = $2B). Be realistic.
- estimated_size_label: one of "large" | "medium" | "small" | "niche"
- keyword_layers: OPTIONAL 2-5 short phrases (1-3 words each) — reality-checked SOW language for narrowing
- strategic_angle: 1 sentence — "displace incumbent X", "subcontract under primes", "capture emerging Z demand"

IMPORTANT: Don't inflate correlation scores. A score below 5 is a signal to the user that the scope is a stretch — include such scopes only when the strategic_angle genuinely justifies exploring anyway.

Return ONLY valid JSON in a \`\`\`json block, no other text:

\`\`\`json
{
  "scopes": [
    {
      "name": "...",
      "scope_tag": "...",
      "tier": "primary",
      "naics_codes": ["541511"],
      "psc_prefixes": ["R-", "D3"],
      "rationale": "...",
      "correlation_score": 9,
      "correlation_rationale": "...",
      "estimated_annual_awards": 2500,
      "estimated_annual_dollars": 8000000000,
      "estimated_size_label": "large",
      "keyword_layers": ["cloud services", "IT professional services"],
      "strategic_angle": "..."
    }
  ]
}
\`\`\``

      // === METHODOLOGY LOG: scope generation start ===
      await logMethodology({
        tenantId: activeTenant.id,
        eventType: 'scope_generation_start',
        actor: 'claude-sonnet-4-5',
        summary: `Generating Round 1 search scopes for ${activeTenant.name} from commercial profile (${commercialProfile.synthesized_text.length} chars)`,
        details: {
          model: 'claude-sonnet-4-5',
          max_tokens: 3000,
          profile_length: commercialProfile.synthesized_text.length,
          started_at: startedAt.toISOString(),
          prompt_length_chars: prompt.length,
          prompt_summary: 'Generate 6-10 NAICS+PSC scopes covering the federal pursuit surface with correlation scoring',
        },
      })

      const { text } = await callClaudeBrowser(prompt, {
        model: 'claude-sonnet-4-5',
        maxTokens: 3000,
      })

      const parsed = extractJsonBlock(text)
      if (!parsed?.scopes || !Array.isArray(parsed.scopes)) {
        throw new Error('No scopes returned from Claude — try again')
      }

      // Clear prior NON-PINNED scopes for this tenant before inserting new ones
      await supabase
        .from('search_scopes')
        .delete()
        .eq('tenant_id', activeTenant.id)
        .eq('pinned', false)

      const inserts = parsed.scopes.map((s: any) => ({
        tenant_id: activeTenant.id,
        scope_tag: s.scope_tag || slugify(s.name || 'scope'),
        name: s.name || 'Untitled scope',
        tier: (['primary', 'secondary', 'exploratory'].includes(s.tier) ? s.tier : 'secondary') as
          | 'primary'
          | 'secondary'
          | 'exploratory',
        rationale: s.rationale || null,
        naics_codes: Array.isArray(s.naics_codes) ? s.naics_codes.slice(0, 10) : [],
        psc_prefixes: Array.isArray(s.psc_prefixes) ? s.psc_prefixes.slice(0, 10) : [],
        keyword_layers: Array.isArray(s.keyword_layers) ? s.keyword_layers.slice(0, 10) : null,
        correlation_score:
          typeof s.correlation_score === 'number'
            ? Math.max(1, Math.min(10, Math.round(s.correlation_score)))
            : null,
        correlation_rationale: s.correlation_rationale || null,
        estimated_annual_awards:
          typeof s.estimated_annual_awards === 'number' ? s.estimated_annual_awards : null,
        estimated_annual_dollars:
          typeof s.estimated_annual_dollars === 'number' ? s.estimated_annual_dollars : null,
        estimated_size_label: s.estimated_size_label || null,
        strategic_angle: s.strategic_angle || null,
        generated_by: 'claude_sonnet_4_5',
      }))

      if (inserts.length > 0) {
        const { error: insertError } = await supabase.from('search_scopes').insert(inserts)
        if (insertError) throw new Error(`Failed to save scopes: ${insertError.message}`)
      }

      // === METHODOLOGY LOG: scope generation complete ===
      const runtimeMs = Date.now() - startedAt.getTime()
      await logMethodology({
        tenantId: activeTenant.id,
        eventType: 'scope_generation_complete',
        actor: 'claude-sonnet-4-5',
        summary: `Generated ${inserts.length} Round 1 search scopes in ${(runtimeMs / 1000).toFixed(1)}s. Total estimated annual market: $${inserts.reduce((sum: number, s: any) => sum + (s.estimated_annual_dollars || 0), 0).toLocaleString()}.`,
        details: {
          runtime_ms: runtimeMs,
          runtime_seconds: runtimeMs / 1000,
          scope_count: inserts.length,
          scopes: inserts.map((s: any) => ({
            name: s.name,
            scope_tag: s.scope_tag,
            tier: s.tier,
            naics_codes: s.naics_codes,
            psc_prefixes: s.psc_prefixes,
            correlation_score: s.correlation_score,
            correlation_rationale: s.correlation_rationale,
            rationale: s.rationale,
            strategic_angle: s.strategic_angle,
            estimated_annual_awards: s.estimated_annual_awards,
            estimated_annual_dollars: s.estimated_annual_dollars,
            estimated_size_label: s.estimated_size_label,
            keyword_layers: s.keyword_layers,
          })),
          tier_breakdown: {
            primary: inserts.filter((s: any) => s.tier === 'primary').length,
            secondary: inserts.filter((s: any) => s.tier === 'secondary').length,
            exploratory: inserts.filter((s: any) => s.tier === 'exploratory').length,
          },
          correlation_distribution: {
            '9-10': inserts.filter((s: any) => (s.correlation_score || 0) >= 9).length,
            '7-8': inserts.filter((s: any) => (s.correlation_score || 0) >= 7 && (s.correlation_score || 0) < 9).length,
            '5-6': inserts.filter((s: any) => (s.correlation_score || 0) >= 5 && (s.correlation_score || 0) < 7).length,
            '<5': inserts.filter((s: any) => (s.correlation_score || 0) < 5).length,
          },
        },
      })

      setBuildProgress(null)
      await loadProfileData(activeTenant.id)
    } catch (err: any) {
      // === METHODOLOGY LOG: scope generation failed ===
      if (activeTenant) {
        await logMethodology({
          tenantId: activeTenant.id,
          eventType: 'scope_generation_failed',
          actor: 'system',
          summary: `Scope generation failed: ${err?.message || 'unknown error'}`,
          details: { error: err?.message, stack: err?.stack?.slice(0, 2000) },
        })
      }
      setBuildError(err.message || 'Scope generation failed')
      setBuildProgress(null)
    } finally {
      setBuilding(null)
    }
  }

  function slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50)
  }

  async function deleteScope(scopeId: string) {
    if (!confirm('Delete this search scope?')) return
    const scope = searchScopes.find((s) => s.id === scopeId)
    await supabase.from('search_scopes').delete().eq('id', scopeId)
    if (activeTenant && scope) {
      await logMethodology({
        tenantId: activeTenant.id,
        eventType: 'scope_deleted',
        actor: 'user',
        summary: `User deleted scope "${scope.name}" (#${scope.scope_tag}) — correlation ${scope.correlation_score}/10`,
        details: {
          scope_id: scopeId,
          name: scope.name,
          scope_tag: scope.scope_tag,
          correlation_score: scope.correlation_score,
          tier: scope.tier,
          naics_codes: scope.naics_codes,
          psc_prefixes: scope.psc_prefixes,
          estimated_annual_dollars: scope.estimated_annual_dollars,
        },
      })
    }
    if (activeTenant) await loadProfileData(activeTenant.id)
  }

  async function togglePinScope(scopeId: string, nextPinned: boolean) {
    const scope = searchScopes.find((s) => s.id === scopeId)
    await supabase.from('search_scopes').update({ pinned: nextPinned }).eq('id', scopeId)
    if (activeTenant && scope) {
      await logMethodology({
        tenantId: activeTenant.id,
        eventType: nextPinned ? 'scope_pinned' : 'scope_unpinned',
        actor: 'user',
        summary: `User ${nextPinned ? 'pinned' : 'unpinned'} scope "${scope.name}" (#${scope.scope_tag})`,
        details: {
          scope_id: scopeId,
          name: scope.name,
          scope_tag: scope.scope_tag,
          correlation_score: scope.correlation_score,
        },
      })
    }
    if (activeTenant) await loadProfileData(activeTenant.id)
  }

  async function setFederalPosture(posture: 'unknown' | 'has_federal' | 'no_federal') {
    if (!activeTenant) return
    await supabase.from('tenants').update({ federal_posture: posture }).eq('id', activeTenant.id)
    // Trigger tenant re-fetch so the UI reflects the new posture
    await useStore.getState().setActiveTenant(activeTenant.id)
  }

  async function deleteStrategicProfile(id: string) {
    if (!confirm('Delete this strategic profile?')) return
    await supabase
      .from('strategic_profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (activeTenant) await loadProfileData(activeTenant.id)
  }

  if (!activeTenant) return null

  const commercialSources = sources.filter((s) => s.bucket === 'commercial')
  const federalSources = sources.filter((s) => s.bucket === 'federal')

  return (
    <TabPage
      eyebrow="Onboard"
      title="Intelligence profile"
      description={`Building ${activeTenant.name}'s commercial and federal profiles, then reconciling them.`}
      actions={
        <Button
          variant="secondary"
          size="small"
          onClick={async () => {
            if (!activeTenant) return
            const confirmed = confirm(
              `Reset ${activeTenant.name}'s downstream analysis data?\n\n` +
                `KEEPS: profile documents, commercial/federal profiles, strategic profiles, branding.\n` +
                `DELETES: search scopes, enrichment sessions + records, keyword bank, methodology log.\n\n` +
                `This starts a fresh audit trail from Round 1 with full logging.`
            )
            if (!confirmed) return
            const result = await resetTenantDownstream(activeTenant.id)
            if (result.ok) {
              alert(
                `Reset complete.\n\n` +
                  `Deleted:\n` +
                  `  • ${result.summary.search_scopes || 0} search scopes\n` +
                  `  • ${result.summary.enrichment_sessions || 0} sessions\n` +
                  `  • ${result.summary.enrichment_records || 0} contract records\n` +
                  `  • ${result.summary.round_1_keywords || 0} saved keywords\n` +
                  `  • ${result.summary.methodology_log_cleared || 0} prior log entries\n\n` +
                  `Profile evidence preserved. Methodology log restarted with Step 1 summary.`
              )
              // Reload everything
              await loadProfileData(activeTenant.id)
              window.location.reload()
            } else {
              alert(`Reset failed: ${result.error}`)
            }
          }}
        >
          Reset downstream data
        </Button>
      }
    >
      {buildError && (
        <div
          style={{
            marginBottom: '24px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-input)',
            background: 'rgba(255, 59, 48, 0.1)',
            border: '1px solid rgba(255, 59, 48, 0.3)',
            color: 'var(--color-danger)',
            fontSize: '14px',
          }}
        >
          {buildError}
        </div>
      )}

      {buildProgress && (
        <div
          style={{
            marginBottom: '24px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-input)',
            background: 'rgba(0, 122, 255, 0.08)',
            border: '1px solid rgba(0, 122, 255, 0.2)',
            color: 'var(--color-accent)',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span style={{ display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }}>●</span>
          {buildProgress}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}
      >
        <ProfileColumn
          title="Commercial"
          subtitle="What the company looks like to non-federal buyers"
          sources={commercialSources}
          onAdd={() => setAddSourceOpen({ bucket: 'commercial' })}
          onDelete={deleteSource}
          onBuild={() => buildProfile('commercial')}
          onDigestOne={digestOne}
          onDigestAll={() => digestAllPending('commercial')}
          onSkipDigest={skipDigest}
          onViewProfile={() =>
            setViewingProfile({
              title: 'Commercial profile — ' + activeTenant.name,
              text: commercialProfile?.synthesized_text || '',
              structured: commercialProfile?.structured_data,
              builtAt: commercialProfile?.last_built_at || null,
              sourceCount: commercialProfile?.source_count || null,
            })
          }
          building={building === 'commercial'}
          digesting={digesting === 'commercial'}
          profileBuilt={!!commercialProfile?.synthesized_text}
          lastBuiltAt={commercialProfile?.last_built_at || null}
          profileText={commercialProfile?.synthesized_text || null}
          buildLabel="Build commercial profile"
        />

        <FederalColumnWithPosture
          posture={activeTenant.federal_posture || 'unknown'}
          onSetPosture={setFederalPosture}
          sources={federalSources}
          onAdd={() => setAddSourceOpen({ bucket: 'federal' })}
          onDelete={deleteSource}
          onBuild={() => buildProfile('federal')}
          onDigestOne={digestOne}
          onDigestAll={() => digestAllPending('federal')}
          onSkipDigest={skipDigest}
          onViewProfile={() =>
            setViewingProfile({
              title: 'Federal profile — ' + activeTenant.name,
              text: federalProfile?.synthesized_text || '',
              structured: federalProfile?.structured_data,
              builtAt: federalProfile?.last_built_at || null,
              sourceCount: federalProfile?.source_count || null,
            })
          }
          building={building === 'federal'}
          digesting={digesting === 'federal'}
          profileBuilt={!!federalProfile?.synthesized_text}
          lastBuiltAt={federalProfile?.last_built_at || null}
          profileText={federalProfile?.synthesized_text || null}
        />

        <ReconciliationColumn
          mode={activeTenant.federal_posture === 'no_federal' ? 'framework' : 'reconcile'}
          commercialReady={!!commercialProfile?.synthesized_text}
          federalReady={!!federalProfile?.synthesized_text}
          reconciliation={reconciliation}
          onBuild={runReconciliation}
          building={building === 'reconcile'}
          onCreateStrategicFromFramework={() => {
            // Pre-fill strategic profile editor with framework suggestions
            const s = reconciliation?.structured_data as any
            if (!s) {
              setStratEditor({ mode: 'new' })
              return
            }
            setStratEditor({
              mode: 'new',
              profile: {
                id: '',
                tenant_id: activeTenant.id,
                name: 'Federal entry — ' + (s.wedge_capability || 'Framework'),
                description: s.narrative_summary || null,
                positioning: s.narrative_summary || null,
                target_agencies: s.target_agencies || null,
                target_naics: (s.all_naics || []).map((n: any) => n.code).filter(Boolean).slice(0, 10),
                target_psc: (s.psc_codes || []).map((p: any) => p.code).filter(Boolean).slice(0, 10),
                is_default: false,
                created_at: '',
                updated_at: '',
                created_by: null,
                deleted_at: null,
              },
            })
          }}
        />
      </div>

      {/* Round 1 Search Scopes */}
      {commercialProfile?.synthesized_text && (
        <SearchScopesCard
          scopes={searchScopes}
          onGenerate={generateSearchScopes}
          onDelete={deleteScope}
          onTogglePin={togglePinScope}
          generating={building === 'reconcile' && buildProgress === 'Generating Round 1 search scopes…'}
        />
      )}

      {/* Strategic Profiles */}
      <div
        style={{
          marginTop: '64px',
          paddingTop: '32px',
          borderTop: '1px solid var(--color-hairline)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '24px',
            marginBottom: '20px',
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '24px',
                fontWeight: 600,
                letterSpacing: '-0.015em',
                margin: 0,
              }}
            >
              Strategic Profiles
            </h2>
            <p
              style={{
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
                margin: '6px 0 0',
                maxWidth: '560px',
              }}
            >
              Different hunts, different lanes. Each profile represents a distinct federal
              pursuit strategy. Create as many as make sense — one per lane you want to work.
            </p>
          </div>
          <Button onClick={() => setStratEditor({ mode: 'new' })}>+ New strategic profile</Button>
        </div>

        {strategicProfiles.length === 0 ? (
          <Card>
            <div
              style={{
                textAlign: 'center',
                padding: '32px 0',
                color: 'var(--color-text-secondary)',
                fontSize: '14px',
              }}
            >
              No strategic profiles yet. Create one to lock in a specific federal pursuit lane.
            </div>
          </Card>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
            }}
          >
            {strategicProfiles.map((sp) => (
              <StrategicProfileCard
                key={sp.id}
                profile={sp}
                onEdit={() => setStratEditor({ mode: 'edit', profile: sp })}
                onDelete={() => deleteStrategicProfile(sp.id)}
              />
            ))}
          </div>
        )}
      </div>

      {addSourceOpen && (
        <AddSourceModal
          bucket={addSourceOpen.bucket}
          tenantId={activeTenant.id}
          tenantName={activeTenant.name}
          onClose={() => setAddSourceOpen(null)}
          onAdded={() => {
            setAddSourceOpen(null)
            loadSources()
          }}
        />
      )}

      {stratEditor && (
        <StrategicProfileEditor
          mode={stratEditor.mode}
          profile={stratEditor.profile}
          tenantId={activeTenant.id}
          onClose={() => setStratEditor(null)}
          onSaved={() => {
            setStratEditor(null)
            if (activeTenant) loadProfileData(activeTenant.id)
          }}
        />
      )}

      {viewingProfile && (
        <ProfileViewModal
          title={viewingProfile.title}
          text={viewingProfile.text}
          structured={viewingProfile.structured}
          builtAt={viewingProfile.builtAt}
          sourceCount={viewingProfile.sourceCount}
          onClose={() => setViewingProfile(null)}
        />
      )}
    </TabPage>
  )
}

/* ========================================================================== */
/* Profile column                                                             */
/* ========================================================================== */

function ProfileColumn({
  title,
  subtitle,
  sources,
  onAdd,
  onDelete,
  onBuild,
  onDigestOne,
  onDigestAll,
  onSkipDigest,
  onViewProfile,
  building,
  digesting,
  profileBuilt,
  lastBuiltAt,
  profileText,
  buildLabel,
}: {
  title: string
  subtitle: string
  sources: ProfileSource[]
  onAdd: () => void
  onDelete: (id: string) => void
  onBuild: () => void
  onDigestOne: (id: string) => void
  onDigestAll: () => void
  onSkipDigest: (id: string) => void
  onViewProfile: () => void
  building: boolean
  digesting: boolean
  profileBuilt: boolean
  lastBuiltAt: string | null
  profileText: string | null
  buildLabel: string
}) {
  const ready = sources.filter((s) => s.digest_status === 'ready').length
  const pending = sources.filter(
    (s) => s.digest_status === 'pending' || s.digest_status === 'error'
  ).length
  const running = sources.filter((s) => s.digest_status === 'running').length
  const hasPending = pending > 0 || running > 0
  const buildReady = sources.length > 0 && ready > 0

  return (
    <Card padding="standard" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.011em', margin: 0 }}>
          {title}
        </h3>
        <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          {sources.length} source{sources.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '0 0 12px' }}>{subtitle}</p>

      {/* Digest progress bar */}
      {sources.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            background: 'var(--color-bg-subtle)',
            borderRadius: 'var(--radius-input)',
            marginBottom: '12px',
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span style={{ color: 'var(--color-success)' }}>● {ready} ready</span>
          {pending > 0 && <span style={{ color: 'var(--color-warning)' }}>● {pending} pending</span>}
          {running > 0 && <span style={{ color: 'var(--color-accent)' }}>● {running} running</span>}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
        {sources.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '20px 0',
              fontSize: '12px',
              color: 'var(--color-text-tertiary)',
              border: '1px dashed var(--color-hairline)',
              borderRadius: 'var(--radius-input)',
            }}
          >
            No sources yet
          </div>
        ) : (
          sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              onDelete={() => onDelete(s.id)}
              onDigest={() => onDigestOne(s.id)}
              onSkip={() => onSkipDigest(s.id)}
            />
          ))
        )}
      </div>

      <Button variant="secondary" size="small" onClick={onAdd} style={{ width: '100%', marginBottom: '8px' }}>
        + Add source
      </Button>

      {hasPending && (
        <Button
          variant="secondary"
          size="small"
          onClick={onDigestAll}
          disabled={digesting}
          style={{ width: '100%', marginBottom: '8px' }}
        >
          {digesting ? `Digesting…` : `Digest all (${pending + running})`}
        </Button>
      )}

      <Button
        size="small"
        onClick={onBuild}
        disabled={!buildReady || building}
        style={{ width: '100%' }}
      >
        {building ? 'Building…' : buildLabel}
      </Button>

      {profileBuilt && (
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-hairline)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--color-text-tertiary)',
              marginBottom: '8px',
            }}
          >
            <span style={{ color: 'var(--color-success)' }}>●</span>
            Built {lastBuiltAt ? new Date(lastBuiltAt).toLocaleString() : ''}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              maxHeight: '160px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}
          >
            {profileText?.slice(0, 500)}
            {(profileText?.length || 0) > 500 ? '…' : ''}
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={onViewProfile}
            style={{ width: '100%', marginTop: '12px' }}
          >
            View full profile
          </Button>
        </div>
      )}
    </Card>
  )
}

function SourceRow({
  source,
  onDelete,
  onDigest,
  onSkip,
}: {
  source: ProfileSource
  onDelete: () => void
  onDigest: () => void
  onSkip: () => void
}) {
  const hasContent = !!(source.extracted_text || source.raw_content || (source.metadata as any)?.needs_extraction)
  const status = source.digest_status

  const statusTone: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning',
    running: 'info',
    ready: 'success',
    error: 'danger',
    skipped: 'neutral',
  }
  const statusLabel: Record<string, string> = {
    pending: 'Not digested',
    running: 'Digesting…',
    ready: 'Ready',
    error: 'Error',
    skipped: 'Skipped',
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--color-hairline)',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {source.label}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--color-text-tertiary)',
              marginTop: '2px',
              flexWrap: 'wrap',
            }}
          >
            <span>{sourceTypeLabel(source.source_type)}</span>
            <Badge tone={statusTone[status] || 'neutral'} style={{ fontSize: '10px' }}>
              {statusLabel[status] || status}
            </Badge>
            {!hasContent && status === 'pending' && (
              <Badge tone="warning" style={{ fontSize: '10px' }}>Empty</Badge>
            )}
          </div>
        </div>
        <button
          onClick={onDelete}
          aria-label="Delete source"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: '16px',
            fontFamily: 'inherit',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Action buttons based on digest state */}
      {(status === 'pending' || status === 'error') && hasContent && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={onDigest}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: '11px',
              fontFamily: 'inherit',
              color: 'var(--color-accent)',
              background: 'transparent',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-input)',
              cursor: 'pointer',
            }}
          >
            {status === 'error' ? 'Retry digest' : 'Digest'}
          </button>
          <button
            onClick={onSkip}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              fontFamily: 'inherit',
              color: 'var(--color-text-tertiary)',
              background: 'transparent',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-input)',
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
        </div>
      )}

      {status === 'error' && source.digest_error && (
        <div style={{ fontSize: '10px', color: 'var(--color-danger)' }}>{source.digest_error}</div>
      )}

      {status === 'ready' && source.digest_text && (
        <details>
          <summary
            style={{
              fontSize: '10px',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            View digest ({source.digest_text.length.toLocaleString()} chars)
          </summary>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              padding: '6px',
              marginTop: '4px',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-input)',
              maxHeight: '120px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.4,
            }}
          >
            {source.digest_text}
          </div>
        </details>
      )}
    </div>
  )
}

function sourceTypeLabel(type: SourceType): string {
  const map: Record<SourceType, string> = {
    website: 'Website',
    linkedin: 'LinkedIn',
    press_release: 'Press',
    uploaded_doc: 'Document',
    free_text: 'Notes',
    highergov: 'HigherGov',
    sam_gov: 'SAM.gov',
    sba_dsbs: 'SBA DSBS',
    usaspending: 'USASpending',
    gsa_elibrary: 'GSA eLibrary',
    cape_statement: 'Cape statement',
  }
  return map[type] || type
}

/* ========================================================================== */
/* Reconciliation column                                                      */
/* ========================================================================== */

function ReconciliationColumn({
  mode,
  commercialReady,
  federalReady,
  reconciliation,
  onBuild,
  building,
  onCreateStrategicFromFramework,
}: {
  mode: 'reconcile' | 'framework'
  commercialReady: boolean
  federalReady: boolean
  reconciliation: Reconciliation | null
  onBuild: () => void
  building: boolean
  onCreateStrategicFromFramework: () => void
}) {
  const isFramework = mode === 'framework'
  const canBuild = isFramework ? commercialReady : commercialReady || federalReady

  const title = isFramework ? 'Federal Entry Framework' : 'Reconciliation'
  const subtitle = isFramework
    ? 'Recommended federal entry plan (built from commercial profile)'
    : 'Alignment, divergence, and strategic suggestions'

  const buildLabel = isFramework
    ? reconciliation
      ? 'Re-run framework'
      : 'Build entry framework'
    : reconciliation
    ? 'Re-run reconciliation'
    : 'Run reconciliation'

  // Has this reconciliation row actually been rendered for this mode?
  // If posture flipped between runs, we might have a reconcile row but be in framework mode.
  const recMatchesMode = reconciliation && reconciliation.mode === mode

  return (
    <Card padding="standard" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.011em', margin: 0 }}>
          {title}
        </h3>
        {isFramework && <Badge tone="info">Framework mode</Badge>}
      </div>
      <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '0 0 16px' }}>
        {subtitle}
      </p>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <PrerequisiteRow label="Commercial profile" ready={commercialReady} />
        {!isFramework && <PrerequisiteRow label="Federal profile" ready={federalReady} />}

        {isFramework && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              padding: '10px 12px',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-input)',
              lineHeight: 1.5,
            }}
          >
            This tenant has <strong>no existing federal presence</strong>. The framework will
            propose NAICS, PSC codes, certifications to pursue, keywords, and a narrative for
            federal market entry — built purely from the commercial profile.
          </div>
        )}

        {!isFramework && !federalReady && commercialReady && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              padding: '10px 12px',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-input)',
              lineHeight: 1.5,
            }}
          >
            No federal profile yet → reconciliation operates in <strong>suggestions mode</strong>,
            proposing what the federal profile <em>should</em> look like.
          </div>
        )}

        {recMatchesMode && reconciliation && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              v{reconciliation.version}
              {reconciliation.last_built_at &&
                ' · ' + new Date(reconciliation.last_built_at).toLocaleString()}
            </div>

            {isFramework ? (
              <>
                {reconciliation.suggestions && (
                  <Section title="Framework" tone="info" text={reconciliation.suggestions} />
                )}
                {reconciliation.structured_data && (
                  <FrameworkStructuredPreview data={reconciliation.structured_data} />
                )}
              </>
            ) : (
              <>
                {reconciliation.alignment && <Section title="Alignment" tone="success" text={reconciliation.alignment} />}
                {reconciliation.divergence && <Section title="Divergence" tone="warning" text={reconciliation.divergence} />}
                {reconciliation.suggestions && <Section title="Suggestions" tone="info" text={reconciliation.suggestions} />}
              </>
            )}
          </div>
        )}

        {!recMatchesMode && reconciliation && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-tertiary)',
              padding: '10px 12px',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-input)',
              fontStyle: 'italic',
            }}
          >
            Previous output was built in {reconciliation.mode} mode. Re-run to refresh for the
            current posture.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
        <Button size="small" onClick={onBuild} disabled={!canBuild || building} style={{ width: '100%' }}>
          {building ? 'Running…' : buildLabel}
        </Button>
        {isFramework && recMatchesMode && reconciliation?.structured_data && (
          <Button
            variant="secondary"
            size="small"
            onClick={onCreateStrategicFromFramework}
            style={{ width: '100%' }}
          >
            Create strategic profile from these suggestions
          </Button>
        )}
      </div>
    </Card>
  )
}

function FrameworkStructuredPreview({ data }: { data: any }) {
  if (!data) return null
  const primary = data.primary_naics || []
  const allNaics = data.all_naics || []
  const psc = data.psc_codes || []
  const certs = data.certifications || []
  const agencies = data.target_agencies || []
  const keywords = data.keywords || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.wedge_capability && (
        <MiniSection label="Wedge capability">
          <div style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}>
            {data.wedge_capability}
          </div>
        </MiniSection>
      )}
      {primary.length > 0 && (
        <MiniSection label="Primary NAICS">
          <ChipRow items={primary.map((c: string) => `NAICS ${c}`)} />
        </MiniSection>
      )}
      {allNaics.length > primary.length && (
        <MiniSection label={`All NAICS (${allNaics.length})`}>
          <ChipRow
            items={allNaics.slice(0, 12).map((n: any) =>
              typeof n === 'string' ? n : `${n.code}${n.priority ? ` (${n.priority})` : ''}`
            )}
          />
        </MiniSection>
      )}
      {psc.length > 0 && (
        <MiniSection label={`PSC codes (${psc.length})`}>
          <ChipRow items={psc.slice(0, 10).map((p: any) => (typeof p === 'string' ? p : p.code))} />
        </MiniSection>
      )}
      {certs.length > 0 && (
        <MiniSection label="Certifications">
          <ChipRow
            items={certs
              .filter((c: any) => c.recommendation !== 'SKIP')
              .slice(0, 8)
              .map((c: any) =>
                typeof c === 'string' ? c : `${c.name}${c.recommendation ? ` · ${c.recommendation}` : ''}`
              )}
          />
        </MiniSection>
      )}
      {agencies.length > 0 && (
        <MiniSection label="Target agencies">
          <ChipRow items={agencies.slice(0, 10)} />
        </MiniSection>
      )}
      {keywords.length > 0 && (
        <MiniSection label={`SAM keywords (${keywords.length})`}>
          <ChipRow items={keywords.slice(0, 15)} />
        </MiniSection>
      )}
    </div>
  )
}

function MiniSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: '10px',
          fontWeight: 500,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function ChipRow({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      {items.map((s, i) => (
        <Badge key={i}>{s}</Badge>
      ))}
    </div>
  )
}

/* ========================================================================== */
/* Federal column with posture selector                                       */
/* ========================================================================== */

function FederalColumnWithPosture({
  posture,
  onSetPosture,
  sources,
  onAdd,
  onDelete,
  onBuild,
  onDigestOne,
  onDigestAll,
  onSkipDigest,
  onViewProfile,
  building,
  digesting,
  profileBuilt,
  lastBuiltAt,
  profileText,
}: {
  posture: 'unknown' | 'has_federal' | 'no_federal'
  onSetPosture: (p: 'unknown' | 'has_federal' | 'no_federal') => void
  sources: ProfileSource[]
  onAdd: () => void
  onDelete: (id: string) => void
  onBuild: () => void
  onDigestOne: (id: string) => void
  onDigestAll: () => void
  onSkipDigest: (id: string) => void
  onViewProfile: () => void
  building: boolean
  digesting: boolean
  profileBuilt: boolean
  lastBuiltAt: string | null
  profileText: string | null
}) {
  const [showPostureInfo] = useState(posture === 'unknown')

  const ready = sources.filter((s) => s.digest_status === 'ready').length
  const pending = sources.filter(
    (s) => s.digest_status === 'pending' || s.digest_status === 'error'
  ).length
  const running = sources.filter((s) => s.digest_status === 'running').length
  const hasPending = pending > 0 || running > 0
  const buildReady = sources.length > 0 && ready > 0

  return (
    <Card padding="standard" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.011em', margin: 0 }}>
          Federal
        </h3>
        <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          {sources.length} source{sources.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '0 0 12px' }}>
        What exists in federal systems of record
      </p>

      {/* Posture selector */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
            marginBottom: '6px',
          }}
        >
          Federal posture
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <PostureButton active={posture === 'has_federal'} onClick={() => onSetPosture('has_federal')}>
            Has federal
          </PostureButton>
          <PostureButton active={posture === 'no_federal'} onClick={() => onSetPosture('no_federal')}>
            No federal yet
          </PostureButton>
          <PostureButton active={posture === 'unknown'} onClick={() => onSetPosture('unknown')}>
            Not sure
          </PostureButton>
        </div>
        {showPostureInfo && posture === 'unknown' && (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              padding: '8px 10px',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-input)',
              marginTop: '8px',
              lineHeight: 1.5,
            }}
          >
            Pick <strong>Has federal</strong> if the company has a SAM.gov entity, federal awards,
            or a capability statement. Pick <strong>No federal yet</strong> if they're a purely
            commercial company — the Reconciliation column will build a federal entry framework
            instead.
          </div>
        )}
      </div>

      {/* If no_federal, hide source adder and show a different empty state */}
      {posture === 'no_federal' ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '24px 16px',
            border: '1px dashed var(--color-hairline)',
            borderRadius: 'var(--radius-input)',
            color: 'var(--color-text-secondary)',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          <div style={{ marginBottom: '8px', color: 'var(--color-text-primary)', fontWeight: 500 }}>
            Federal profile skipped
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            The Reconciliation column on the right will build a Federal Entry Framework from the
            commercial profile.
          </div>
        </div>
      ) : (
        <>
          {/* Digest progress */}
          {sources.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                background: 'var(--color-bg-subtle)',
                borderRadius: 'var(--radius-input)',
                marginBottom: '12px',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span style={{ color: 'var(--color-success)' }}>● {ready} ready</span>
              {pending > 0 && <span style={{ color: 'var(--color-warning)' }}>● {pending} pending</span>}
              {running > 0 && <span style={{ color: 'var(--color-accent)' }}>● {running} running</span>}
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
            {sources.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '20px 0',
                  fontSize: '12px',
                  color: 'var(--color-text-tertiary)',
                  border: '1px dashed var(--color-hairline)',
                  borderRadius: 'var(--radius-input)',
                }}
              >
                No sources yet
              </div>
            ) : (
              sources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  onDelete={() => onDelete(s.id)}
                  onDigest={() => onDigestOne(s.id)}
                  onSkip={() => onSkipDigest(s.id)}
                />
              ))
            )}
          </div>

          <Button variant="secondary" size="small" onClick={onAdd} style={{ width: '100%', marginBottom: '8px' }}>
            + Add source
          </Button>
          {hasPending && (
            <Button
              variant="secondary"
              size="small"
              onClick={onDigestAll}
              disabled={digesting}
              style={{ width: '100%', marginBottom: '8px' }}
            >
              {digesting ? 'Digesting…' : `Digest all (${pending + running})`}
            </Button>
          )}
          <Button
            size="small"
            onClick={onBuild}
            disabled={!buildReady || building}
            style={{ width: '100%' }}
          >
            {building ? 'Building…' : 'Build federal profile'}
          </Button>

          {profileBuilt && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-hairline)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: 'var(--color-text-tertiary)',
                  marginBottom: '8px',
                }}
              >
                <span style={{ color: 'var(--color-success)' }}>●</span>
                Built {lastBuiltAt ? new Date(lastBuiltAt).toLocaleString() : ''}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--color-text-secondary)',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                }}
              >
                {profileText?.slice(0, 500)}
                {(profileText?.length || 0) > 500 ? '…' : ''}
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={onViewProfile}
                style={{ width: '100%', marginTop: '12px' }}
              >
                View full profile
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function PostureButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '6px 10px',
        fontSize: '12px',
        fontFamily: 'inherit',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        background: active ? 'var(--color-bg-subtle)' : 'transparent',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-input)',
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  )
}

function PrerequisiteRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: ready ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: ready ? 'var(--color-success)' : 'var(--color-hairline)',
        }}
      />
      {label}
    </div>
  )
}

function Section({
  title,
  tone,
  text,
}: {
  title: string
  tone: 'success' | 'warning' | 'info'
  text: string
}) {
  return (
    <div>
      <div style={{ marginBottom: '6px' }}>
        <Badge tone={tone}>{title}</Badge>
      </div>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* Strategic profile card                                                     */
/* ========================================================================== */

function StrategicProfileCard({
  profile,
  onEdit,
  onDelete,
}: {
  profile: StrategicProfile
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card padding="standard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h4 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>{profile.name}</h4>
            {profile.is_default && <Badge tone="info">Default</Badge>}
          </div>
          {profile.description && (
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
              {profile.description}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <ActionIcon onClick={onEdit} label="Edit">✎</ActionIcon>
          <ActionIcon onClick={onDelete} label="Delete" danger>×</ActionIcon>
        </div>
      </div>
      {profile.positioning && (
        <p
          style={{
            fontSize: '12px',
            color: 'var(--color-text-tertiary)',
            margin: '8px 0 0',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.5,
          }}
        >
          {profile.positioning}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '12px' }}>
        {(profile.target_agencies || []).slice(0, 3).map((a) => (
          <Badge key={a}>{a}</Badge>
        ))}
        {(profile.target_naics || []).slice(0, 3).map((n) => (
          <Badge key={n}>NAICS {n}</Badge>
        ))}
      </div>
    </Card>
  )
}

function ActionIcon({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  const style: CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: danger ? 'var(--color-danger)' : 'var(--color-text-tertiary)',
    cursor: 'pointer',
    padding: '4px 8px',
    fontSize: '14px',
    fontFamily: 'inherit',
    lineHeight: 1,
    borderRadius: 'var(--radius-input)',
  }
  return (
    <button onClick={onClick} aria-label={label} style={style}>
      {children}
    </button>
  )
}


/* ========================================================================== */
/* Profile view modal                                                         */
/* ========================================================================== */

function ProfileViewModal({
  title,
  text,
  structured,
  builtAt,
  sourceCount,
  onClose,
}: {
  title: string
  text: string
  structured: any
  builtAt: string | null
  sourceCount: number | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<'narrative' | 'structured' | 'raw'>('narrative')

  async function copyToClipboard(content: string) {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      // no-op
    }
  }

  const rawJson = structured ? JSON.stringify(structured, null, 2) : '(no structured data)'

  return (
    <Modal open={true} onClose={onClose} title={title} size="xl">
      {/* Meta row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '12px',
          color: 'var(--color-text-tertiary)',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--color-hairline)',
        }}
      >
        {sourceCount !== null && (
          <span>
            Built from <strong>{sourceCount}</strong> source{sourceCount !== 1 ? 's' : ''}
          </span>
        )}
        {builtAt && <span>·</span>}
        {builtAt && <span>{new Date(builtAt).toLocaleString()}</span>}
      </div>

      {/* Tab switcher */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '16px',
          borderBottom: '1px solid var(--color-hairline)',
        }}
      >
        <TabButton active={tab === 'narrative'} onClick={() => setTab('narrative')}>
          Narrative
        </TabButton>
        {structured && (
          <TabButton active={tab === 'structured'} onClick={() => setTab('structured')}>
            Structured
          </TabButton>
        )}
        <TabButton active={tab === 'raw'} onClick={() => setTab('raw')}>
          Raw JSON
        </TabButton>
      </div>

      {/* Tab content */}
      <div
        style={{
          maxHeight: '60vh',
          overflowY: 'auto',
          padding: '4px 0',
        }}
      >
        {tab === 'narrative' && (
          <div
            style={{
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'var(--color-text-primary)',
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-text)',
            }}
          >
            {text || '(empty)'}
          </div>
        )}

        {tab === 'structured' && structured && (
          <StructuredPretty data={structured} />
        )}

        {tab === 'raw' && (
          <pre
            style={{
              fontSize: '12px',
              lineHeight: 1.5,
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-bg-subtle)',
              padding: '12px',
              borderRadius: 'var(--radius-input)',
              overflowX: 'auto',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {rawJson}
          </pre>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid var(--color-hairline)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
        }}
      >
        <Button
          variant="secondary"
          size="small"
          onClick={() => copyToClipboard(tab === 'raw' ? rawJson : text)}
        >
          Copy {tab === 'raw' ? 'JSON' : 'text'}
        </Button>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        fontSize: '13px',
        fontFamily: 'inherit',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
        marginBottom: '-1px',
      }}
    >
      {children}
    </button>
  )
}

function StructuredPretty({ data }: { data: any }) {
  if (!data || typeof data !== 'object') {
    return <div style={{ color: 'var(--color-text-tertiary)' }}>(no structured data)</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {Object.entries(data).map(([key, value]) => (
        <StructuredField key={key} label={key} value={value} />
      ))}
    </div>
  )
}

function StructuredField({ label, value }: { label: string; value: any }) {
  const prettyLabel = label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const labelStyle: CSSProperties = {
    fontSize: '11px',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--color-text-tertiary)',
    marginBottom: '4px',
  }

  // Null / undefined / empty
  if (value === null || value === undefined || value === '') {
    return (
      <div>
        <div style={labelStyle}>{prettyLabel}</div>
        <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>—</div>
      </div>
    )
  }

  // Array of strings
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return (
      <div>
        <div style={labelStyle}>{prettyLabel}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {value.map((v, i) => (
            <Badge key={i}>{String(v)}</Badge>
          ))}
        </div>
      </div>
    )
  }

  // Array of objects
  if (Array.isArray(value)) {
    return (
      <div>
        <div style={labelStyle}>{prettyLabel} ({value.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {value.map((item, i) => (
            <div
              key={i}
              style={{
                fontSize: '12px',
                padding: '6px 10px',
                background: 'var(--color-bg-subtle)',
                borderRadius: 'var(--radius-input)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Nested object
  if (typeof value === 'object') {
    return (
      <div>
        <div style={labelStyle}>{prettyLabel}</div>
        <pre
          style={{
            fontSize: '11px',
            lineHeight: 1.5,
            fontFamily: 'var(--font-mono)',
            background: 'var(--color-bg-subtle)',
            padding: '8px',
            borderRadius: 'var(--radius-input)',
            overflowX: 'auto',
            margin: 0,
          }}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    )
  }

  // Scalar string/number/bool
  return (
    <div>
      <div style={labelStyle}>{prettyLabel}</div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap' }}>
        {String(value)}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* Search Scopes card (Round 1 NAICS + PSC)                                   */
/* ========================================================================== */

type ScopeSortKey = 'correlation' | 'dollars' | 'awards' | 'tier' | 'name'

function SearchScopesCard({
  scopes,
  onGenerate,
  onDelete,
  onTogglePin,
  generating,
}: {
  scopes: SearchScope[]
  onGenerate: () => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, nextPinned: boolean) => void
  generating: boolean
}) {
  const [sortKey, setSortKey] = useState<ScopeSortKey>('correlation')
  const [hideLowCorrelation, setHideLowCorrelation] = useState(false)

  const activeScopes = scopes.filter((s) => !s.archived)
  const visibleScopes = hideLowCorrelation
    ? activeScopes.filter((s) => (s.correlation_score ?? 0) >= 5)
    : activeScopes

  const tierRank: Record<string, number> = { primary: 0, secondary: 1, exploratory: 2 }

  const sorted = [...visibleScopes].sort((a, b) => {
    // Pinned always on top
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    switch (sortKey) {
      case 'correlation':
        return (b.correlation_score ?? 0) - (a.correlation_score ?? 0)
      case 'dollars':
        return (b.estimated_annual_dollars ?? 0) - (a.estimated_annual_dollars ?? 0)
      case 'awards':
        return (b.estimated_annual_awards ?? 0) - (a.estimated_annual_awards ?? 0)
      case 'tier':
        return (tierRank[a.tier] ?? 99) - (tierRank[b.tier] ?? 99)
      case 'name':
        return a.name.localeCompare(b.name)
      default:
        return 0
    }
  })

  const anyScopes = activeScopes.length > 0

  return (
    <div
      style={{
        marginTop: '40px',
        paddingTop: '32px',
        borderTop: '1px solid var(--color-hairline)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '24px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '24px',
                fontWeight: 600,
                letterSpacing: '-0.015em',
                margin: 0,
              }}
            >
              Round 1 Search Scopes
            </h2>
            <Badge tone="info">Starting point</Badge>
          </div>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              margin: '6px 0 0',
              maxWidth: '720px',
            }}
          >
            Real federal taxonomy — NAICS codes cross-pollinated with PSC prefixes. Each scope
            carries a correlation score (1–10) and a market-size estimate. Search the highest
            correlation × dollar-volume first; stop when marginal return falls off.
          </p>
        </div>
        {anyScopes && (
          <Button size="small" onClick={onGenerate} disabled={generating}>
            {generating ? 'Regenerating…' : 'Regenerate'}
          </Button>
        )}
      </div>

      {!anyScopes ? (
        <Card padding="standard">
          <div
            style={{
              textAlign: 'center',
              padding: '20px 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', maxWidth: '560px' }}>
              No scopes generated yet. Click below and the system will propose 6–10 NAICS+PSC
              combinations scored by correlation to the company and sized by estimated market.
            </div>
            <Button onClick={onGenerate} disabled={generating}>
              {generating ? 'Generating…' : 'Generate Round 1 scopes'}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Sort by
              </span>
              <SortPill active={sortKey === 'correlation'} onClick={() => setSortKey('correlation')}>
                Correlation
              </SortPill>
              <SortPill active={sortKey === 'dollars'} onClick={() => setSortKey('dollars')}>
                Est. $ volume
              </SortPill>
              <SortPill active={sortKey === 'awards'} onClick={() => setSortKey('awards')}>
                Est. awards
              </SortPill>
              <SortPill active={sortKey === 'tier'} onClick={() => setSortKey('tier')}>
                Tier
              </SortPill>
              <SortPill active={sortKey === 'name'} onClick={() => setSortKey('name')}>
                Name
              </SortPill>
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={hideLowCorrelation}
                onChange={(e) => setHideLowCorrelation(e.target.checked)}
              />
              Hide correlation &lt; 5
            </label>
          </div>

          {/* Scope list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sorted.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                No scopes match the current filter.
              </div>
            ) : (
              sorted.map((scope) => (
                <ScopeRow
                  key={scope.id}
                  scope={scope}
                  onDelete={() => onDelete(scope.id)}
                  onTogglePin={() => onTogglePin(scope.id, !scope.pinned)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SortPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: '12px',
        padding: '4px 10px',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-input)',
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'white' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  )
}

function ScopeRow({
  scope,
  onDelete,
  onTogglePin,
}: {
  scope: SearchScope
  onDelete: () => void
  onTogglePin: () => void
}) {
  const naicsParam = scope.naics_codes.join(',')
  const pscParam = scope.psc_prefixes.join(',')
  const higherGovUrl = `https://www.highergov.com/search/?naics=${encodeURIComponent(naicsParam)}&psc=${encodeURIComponent(pscParam)}`

  const lowCorrelation =
    scope.correlation_score !== null && scope.correlation_score !== undefined && scope.correlation_score < 5

  const hasActual = scope.actual_award_count !== null && scope.actual_award_count !== undefined

  return (
    <Card padding="standard">
      {lowCorrelation && (
        <div
          style={{
            marginBottom: '10px',
            padding: '6px 10px',
            background: 'rgba(212, 146, 10, 0.08)',
            color: 'var(--color-warning)',
            borderRadius: 'var(--radius-input)',
            fontSize: '12px',
            border: '1px solid rgba(212, 146, 10, 0.2)',
          }}
        >
          ⚠ Low correlation ({scope.correlation_score}/10) — consider before searching.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
              {scope.name}
            </h4>
            {scope.pinned && <Badge tone="warning">Pinned</Badge>}
            <TierBadge tier={scope.tier} />
            <code
              style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-tertiary)',
                background: 'var(--color-bg-subtle)',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              #{scope.scope_tag}
            </code>
          </div>
          {scope.rationale && (
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
              {scope.rationale}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <CorrelationBadge score={scope.correlation_score} />
          <IconBtn onClick={onTogglePin} title={scope.pinned ? 'Unpin' : 'Pin'}>
            {scope.pinned ? '★' : '☆'}
          </IconBtn>
          <IconBtn onClick={onDelete} title="Delete" danger>
            ×
          </IconBtn>
        </div>
      </div>

      {scope.correlation_rationale && (
        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginBottom: '10px', fontStyle: 'italic' }}>
          {scope.correlation_rationale}
        </div>
      )}

      {/* Metrics row */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '10px', flexWrap: 'wrap', padding: '8px 10px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-input)' }}>
        <Metric
          label={hasActual ? 'Actual awards' : 'Est. awards/yr'}
          value={
            hasActual
              ? formatInt(scope.actual_award_count)
              : formatInt(scope.estimated_annual_awards)
          }
          tone={hasActual ? 'success' : 'default'}
        />
        <Metric
          label={hasActual ? 'Actual $ volume' : 'Est. $ volume/yr'}
          value={
            hasActual
              ? formatDollars(scope.actual_dollar_volume)
              : formatDollars(scope.estimated_annual_dollars)
          }
          tone={hasActual ? 'success' : 'default'}
        />
        {scope.estimated_size_label && (
          <Metric label="Size" value={scope.estimated_size_label} />
        )}
        {hasActual && scope.last_imported_at && (
          <Metric label="Imported" value={new Date(scope.last_imported_at).toLocaleDateString()} />
        )}
      </div>

      {/* NAICS + PSC chips */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <div>
          <div style={miniLabelStyle}>NAICS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {scope.naics_codes.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>—</span>
            ) : (
              scope.naics_codes.map((code) => <Badge key={code}>{code}</Badge>)
            )}
          </div>
        </div>
        <div>
          <div style={miniLabelStyle}>PSC</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {scope.psc_prefixes.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>—</span>
            ) : (
              scope.psc_prefixes.map((p) => <Badge key={p}>{p}</Badge>)
            )}
          </div>
        </div>
      </div>

      {scope.keyword_layers && scope.keyword_layers.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <div style={miniLabelStyle}>Optional keyword layers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {scope.keyword_layers.map((k, i) => (
              <Badge key={i} tone="neutral">{k}</Badge>
            ))}
          </div>
        </div>
      )}

      {scope.strategic_angle && (
        <div style={{ marginBottom: '10px', padding: '8px 10px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-input)' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontWeight: 500, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Strategic angle
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>
            {scope.strategic_angle}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <a href={higherGovUrl} target="_blank" rel="noopener noreferrer" style={extLinkStyle}>
          Search on HigherGov →
        </a>
      </div>
    </Card>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, { tone: 'success' | 'info' | 'neutral'; label: string }> = {
    primary: { tone: 'success', label: 'Primary' },
    secondary: { tone: 'info', label: 'Secondary' },
    exploratory: { tone: 'neutral', label: 'Exploratory' },
  }
  const m = map[tier] || { tone: 'neutral' as const, label: tier }
  return <Badge tone={m.tone}>{m.label}</Badge>
}

function CorrelationBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return (
      <div
        style={{
          fontSize: '11px',
          color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono)',
          minWidth: '48px',
          textAlign: 'center',
          padding: '4px 8px',
          background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-input)',
        }}
      >
        —
      </div>
    )
  }
  const color = score >= 8 ? '#34C759' : score >= 6 ? '#007AFF' : score >= 4 ? '#D4920A' : '#FF3B30'
  const bg = score >= 8 ? 'rgba(52,199,89,0.12)' : score >= 6 ? 'rgba(0,122,255,0.12)' : score >= 4 ? 'rgba(212,146,10,0.12)' : 'rgba(255,59,48,0.12)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '4px 10px',
        background: bg,
        border: `1px solid ${color}40`,
        borderRadius: 'var(--radius-input)',
        minWidth: '56px',
      }}
      title={`Correlation score: ${score}/10`}
    >
      <div style={{ fontSize: '15px', fontFamily: 'var(--font-mono)', fontWeight: 600, color, lineHeight: 1 }}>
        {score}
      </div>
      <div style={{ fontSize: '9px', color, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>
        /10
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success'
}) {
  return (
    <div>
      <div style={miniLabelStyle}>{label}</div>
      <div
        style={{
          fontSize: '13px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          color: tone === 'success' ? 'var(--color-success)' : 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function IconBtn({
  onClick,
  title,
  danger,
  children,
}: {
  onClick: () => void
  title: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        color: danger ? 'var(--color-danger)' : 'var(--color-text-tertiary)',
        cursor: 'pointer',
        padding: '4px 8px',
        fontSize: '14px',
        fontFamily: 'inherit',
        lineHeight: 1,
        borderRadius: 'var(--radius-input)',
      }}
    >
      {children}
    </button>
  )
}

function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}

function formatDollars(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

const miniLabelStyle: CSSProperties = {
  fontSize: '10px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  marginBottom: '4px',
}

const extLinkStyle: CSSProperties = {
  fontSize: '12px',
  padding: '5px 12px',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
  background: 'transparent',
  whiteSpace: 'nowrap',
}
