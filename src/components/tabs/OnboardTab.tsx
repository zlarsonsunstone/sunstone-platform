import { useEffect, useState, CSSProperties } from 'react'
import { useStore } from '@/store/useStore'
import { supabase } from '@/lib/supabase'
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

      const endpoint =
        bucket === 'commercial'
          ? '/.netlify/functions/build-commercial-profile'
          : '/.netlify/functions/build-federal-profile'

      const body: any = {
        tenant_name: activeTenant.name,
        sources: bucketSources.map((s) => ({
          label: s.label,
          source_type: s.source_type,
          extracted_text: s.extracted_text,
          raw_content: s.raw_content,
        })),
        prompt_template: variant.prompt_template,
      }
      if (bucket === 'commercial') {
        const web = bucketSources.find((s) => s.source_type === 'website' && s.url)
        body.tenant_website = web?.url || undefined
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || `${resp.status}`)

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
      const { data: variant } = await supabase
        .from('prompt_variants')
        .select('prompt_template')
        .eq('id', 'reconciliation_v1')
        .single()
      if (!variant) throw new Error('Reconciliation prompt variant not found — run migration 0002')

      const resp = await fetch('/.netlify/functions/reconcile-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_name: activeTenant.name,
          commercial_profile_text: commercialProfile?.synthesized_text || '',
          federal_profile_text: federalProfile?.synthesized_text || '',
          prompt_template: variant.prompt_template,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || `${resp.status}`)

      const nextVersion = (reconciliation?.version || 0) + 1
      await supabase.from('reconciliation').insert({
        tenant_id: activeTenant.id,
        alignment: data.alignment,
        divergence: data.divergence,
        suggestions: data.suggestions,
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

        <ProfileColumn
          title="Federal"
          subtitle="What exists in federal systems of record"
          sources={federalSources}
          onAdd={() => setAddSourceOpen({ bucket: 'federal' })}
          onDelete={deleteSource}
          onBuild={() => buildProfile('federal')}
          building={building === 'federal'}
          profileBuilt={!!federalProfile?.synthesized_text}
          lastBuiltAt={federalProfile?.last_built_at || null}
          profileText={federalProfile?.synthesized_text || null}
          buildLabel="Build federal profile"
        />

        <ReconciliationColumn
          commercialReady={!!commercialProfile?.synthesized_text}
          federalReady={!!federalProfile?.synthesized_text}
          reconciliation={reconciliation}
          onBuild={runReconciliation}
          building={building === 'reconcile'}
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
  commercialReady,
  federalReady,
  reconciliation,
  onBuild,
  building,
}: {
  commercialReady: boolean
  federalReady: boolean
  reconciliation: Reconciliation | null
  onBuild: () => void
  building: boolean
}) {
  const canBuild = commercialReady || federalReady

  return (
    <Card padding="standard" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, letterSpacing: '-0.011em', margin: '0 0 4px' }}>
        Reconciliation
      </h3>
      <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '0 0 16px' }}>
        Alignment, divergence, and strategic suggestions
      </p>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <PrerequisiteRow label="Commercial profile" ready={commercialReady} />
        <PrerequisiteRow label="Federal profile" ready={federalReady} />
        {!federalReady && commercialReady && (
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

        {reconciliation && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '240px', overflowY: 'auto' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              v{reconciliation.version}
              {reconciliation.last_built_at &&
                ' · ' + new Date(reconciliation.last_built_at).toLocaleString()}
            </div>
            {reconciliation.alignment && <Section title="Alignment" tone="success" text={reconciliation.alignment} />}
            {reconciliation.divergence && <Section title="Divergence" tone="warning" text={reconciliation.divergence} />}
            {reconciliation.suggestions && <Section title="Suggestions" tone="info" text={reconciliation.suggestions} />}
          </div>
        )}
      </div>

      <Button
        size="small"
        onClick={onBuild}
        disabled={!canBuild || building}
        style={{ width: '100%', marginTop: '16px' }}
      >
        {building ? 'Running…' : reconciliation ? 'Re-run reconciliation' : 'Run reconciliation'}
      </Button>
    </Card>
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
