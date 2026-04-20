import { useEffect, useState, CSSProperties } from 'react'
import { useStore } from '@/store/useStore'
import { supabase } from '@/lib/supabase'
import { fetchJson } from '@/lib/fetchJson'
import { TabPage } from '@/components/TabPage'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import type {
  ProfileSource,
  SourceType,
  SourceBucket,
  Reconciliation,
  StrategicProfile,
} from '@/lib/types'
import { AddSourceModal } from '@/components/onboard/AddSourceModal'
import { StrategicProfileEditor } from '@/components/onboard/StrategicProfileEditor'

export function OnboardTab() {
  const activeTenant = useStore((s) => s.activeTenant)
  const commercialProfile = useStore((s) => s.commercialProfile)
  const federalProfile = useStore((s) => s.federalProfile)
  const reconciliation = useStore((s) => s.reconciliation)
  const strategicProfiles = useStore((s) => s.strategicProfiles)
  const loadProfileData = useStore((s) => s.loadProfileData)

  const [sources, setSources] = useState<ProfileSource[]>([])
  const [addSourceOpen, setAddSourceOpen] = useState<{ bucket: SourceBucket } | null>(null)
  const [building, setBuilding] = useState<'commercial' | 'federal' | 'reconcile' | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [stratEditor, setStratEditor] = useState<
    { mode: 'new' | 'edit'; profile?: StrategicProfile } | null
  >(null)

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

      // Separate text sources from PDF document sources
      const textSources = bucketSources.filter((s) => {
        const needsExtraction = (s.metadata as any)?.needs_extraction === true
        return !needsExtraction
      })
      const pdfSources = bucketSources.filter((s) => {
        const needsExtraction = (s.metadata as any)?.needs_extraction === true
        return needsExtraction
      })

      // Fetch PDFs from storage and convert to base64
      const documents: { label: string; pdf_base64: string }[] = []
      for (const pdfSrc of pdfSources) {
        const meta = pdfSrc.metadata as any
        const path = meta?.storage_path
        const storageBucket = meta?.storage_bucket || 'profile-documents'
        if (!path) continue
        try {
          const { data: blob, error: dlErr } = await supabase.storage
            .from(storageBucket)
            .download(path)
          if (dlErr) {
            console.warn(`Failed to download ${path}:`, dlErr.message)
            continue
          }
          const b64 = await blobToBase64(blob)
          documents.push({ label: pdfSrc.label, pdf_base64: b64 })
        } catch (e) {
          console.warn(`Skipping PDF ${pdfSrc.label}:`, e)
        }
      }

      const endpoint =
        bucket === 'commercial'
          ? '/.netlify/functions/build-commercial-profile'
          : '/.netlify/functions/build-federal-profile'

      const body: any = {
        tenant_name: activeTenant.name,
        sources: textSources.map((s) => ({
          label: s.label,
          source_type: s.source_type,
          extracted_text: s.extracted_text,
          raw_content: s.raw_content,
        })),
        documents,
        prompt_template: variant.prompt_template,
      }
      if (bucket === 'commercial') {
        const web = bucketSources.find((s) => s.source_type === 'website' && s.url)
        body.tenant_website = web?.url || undefined
      }

      const resp = await fetchJson<{ narrative: string; structured: any }>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok || !resp.data) throw new Error(resp.error || 'Build failed')
      const data = resp.data

      if (bucket === 'commercial') {
        await supabase
          .from('commercial_profile')
          .upsert(
            {
              tenant_id: activeTenant.id,
              synthesized_text: data.narrative,
              structured_data: data.structured,
              source_count: bucketSources.length,
              last_built_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id' }
          )
      } else {
        const s = data.structured || {}
        await supabase.from('federal_profile').upsert(
          {
            tenant_id: activeTenant.id,
            synthesized_text: data.narrative,
            structured_data: data.structured,
            naics_codes: s.naics_codes || null,
            certifications: s.certifications || null,
            psc_codes: s.psc_codes || null,
            uei: s.uei || null,
            cage: s.cage || null,
            source_count: bucketSources.length,
            last_built_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id' }
        )
      }

      await loadProfileData(activeTenant.id)
    } catch (err: any) {
      setBuildError(err.message || 'Build failed')
    } finally {
      setBuilding(null)
    }
  }

  async function runReconciliation() {
    if (!activeTenant) return
    setBuilding('reconcile')
    setBuildError(null)
    try {
      // Decide mode based on federal_posture
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

      const body = isFramework
        ? {
            tenant_name: activeTenant.name,
            commercial_profile_text: commercialProfile?.synthesized_text || '',
            prompt_template: variant.prompt_template,
          }
        : {
            tenant_name: activeTenant.name,
            commercial_profile_text: commercialProfile?.synthesized_text || '',
            federal_profile_text: federalProfile?.synthesized_text || '',
            prompt_template: variant.prompt_template,
          }

      const resp = await fetchJson<{
        alignment?: string
        divergence?: string
        suggestions?: string
        narrative?: string
        structured?: any
      }>('/.netlify/functions/reconcile-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok || !resp.data) throw new Error(resp.error || 'Reconciliation failed')
      const data = resp.data

      const nextVersion = (reconciliation?.version || 0) + 1

      // Framework mode packs everything into "suggestions"; alignment/divergence are null
      await supabase.from('reconciliation').insert({
        tenant_id: activeTenant.id,
        mode: isFramework ? 'framework' : 'reconcile',
        alignment: isFramework ? null : data.alignment || null,
        divergence: isFramework ? null : data.divergence || null,
        suggestions: isFramework ? data.narrative || data.suggestions || '' : data.suggestions || null,
        structured_data: data.structured,
        version: nextVersion,
        last_built_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      await loadProfileData(activeTenant.id)
    } catch (err: any) {
      setBuildError(err.message || 'Reconciliation failed')
    } finally {
      setBuilding(null)
    }
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
          building={building === 'commercial'}
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
          building={building === 'federal'}
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
  building,
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
  building: boolean
  profileBuilt: boolean
  lastBuiltAt: string | null
  profileText: string | null
  buildLabel: string
}) {
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
      <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '0 0 16px' }}>{subtitle}</p>

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
          sources.map((s) => <SourceRow key={s.id} source={s} onDelete={() => onDelete(s.id)} />)
        )}
      </div>

      <Button variant="secondary" size="small" onClick={onAdd} style={{ width: '100%', marginBottom: '8px' }}>
        + Add source
      </Button>
      <Button
        size="small"
        onClick={onBuild}
        disabled={sources.length === 0 || building}
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
        </div>
      )}
    </Card>
  )
}

function SourceRow({ source, onDelete }: { source: ProfileSource; onDelete: () => void }) {
  const hasContent = !!(source.extracted_text || source.raw_content)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '8px 10px',
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--color-hairline)',
        fontSize: '13px',
      }}
    >
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
          }}
        >
          <span>{sourceTypeLabel(source.source_type)}</span>
          <Badge tone={hasContent ? 'success' : 'warning'} style={{ fontSize: '10px' }}>
            {hasContent ? 'Content' : 'Empty'}
          </Badge>
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
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '240px', overflowY: 'auto' }}>
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
  building,
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
  building: boolean
  profileBuilt: boolean
  lastBuiltAt: string | null
  profileText: string | null
}) {
  const [showPostureInfo] = useState(posture === 'unknown')

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
              sources.map((s) => <SourceRow key={s.id} source={s} onDelete={() => onDelete(s.id)} />)
            )}
          </div>

          <Button variant="secondary" size="small" onClick={onAdd} style={{ width: '100%', marginBottom: '8px' }}>
            + Add source
          </Button>
          <Button
            size="small"
            onClick={onBuild}
            disabled={sources.length === 0 || building}
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

// Helper: convert a Blob to base64 string (without data URL prefix)
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
