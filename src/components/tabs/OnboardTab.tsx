import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { TabPage } from '../TabPage'
import { Card } from '../Card'
import { Button } from '../Button'

interface OnboardingRow {
  tenant_id: string
  company_name: string | null
  website: string | null
  core_description: string | null
  naics_codes: string[] | null
  certifications: string[] | null
}

export function OnboardTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [companyName, setCompanyName] = useState('')
  const [website, setWebsite] = useState('')
  const [coreDescription, setCoreDescription] = useState('')
  const [naicsCodes, setNaicsCodes] = useState('')
  const [certifications, setCertifications] = useState('')

  useEffect(() => {
    if (!tenant) return
    supabase
      .from('onboarding_sessions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as OnboardingRow | null
        if (row) {
          setCompanyName(row.company_name || '')
          setWebsite(row.website || '')
          setCoreDescription(row.core_description || '')
          setNaicsCodes((row.naics_codes || []).join(', '))
          setCertifications((row.certifications || []).join(', '))
        } else {
          // Prefill from tenant name
          setCompanyName(tenant.name || '')
        }
        setLoading(false)
      })
  }, [tenant?.id])

  const save = async () => {
    if (!tenant) return
    setSaving(true)
    setError(null)

    const row = {
      tenant_id: tenant.id,
      company_name: companyName || null,
      website: website || null,
      core_description: coreDescription || null,
      naics_codes: naicsCodes
        ? naicsCodes.split(',').map((s) => s.trim()).filter(Boolean)
        : null,
      certifications: certifications
        ? certifications.split(',').map((s) => s.trim()).filter(Boolean)
        : null,
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await supabase
      .from('onboarding_sessions')
      .upsert(row, { onConflict: 'tenant_id' })

    setSaving(false)
    if (upsertError) {
      setError(upsertError.message)
    } else {
      setSavedAt(new Date().toLocaleTimeString())
    }
  }

  if (!tenant) return null

  return (
    <TabPage
      eyebrow="Tenant setup"
      title="Onboarding"
      description="Capture the client profile that feeds every enrichment prompt. All of this is editable any time."
      actions={
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      }
    >
      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading profile…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px', maxWidth: '760px' }}>
          <Card padding="large">
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.008em',
                marginBottom: '4px',
              }}
            >
              Client profile
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              Values here fill <code style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{`{{placeholders}}`}</code> in every enrichment prompt.
            </p>

            <Field label="Company name">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Website">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." style={inputStyle} />
            </Field>
            <Field label="Core capability description">
              <textarea
                value={coreDescription}
                onChange={(e) => setCoreDescription(e.target.value)}
                rows={4}
                placeholder="What the company actually does, in its own words."
                style={{ ...inputStyle, resize: 'vertical', minHeight: '96px', fontFamily: 'inherit' }}
              />
            </Field>
            <Field label="NAICS codes (comma-separated)">
              <input
                value={naicsCodes}
                onChange={(e) => setNaicsCodes(e.target.value)}
                placeholder="339113, 336991"
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              />
            </Field>
            <Field label="Certifications (comma-separated)">
              <input
                value={certifications}
                onChange={(e) => setCertifications(e.target.value)}
                placeholder="WOSB, HUBZone, ISO 9001"
                style={inputStyle}
              />
            </Field>

            {error && (
              <div
                style={{
                  background: 'rgba(255, 59, 48, 0.1)',
                  color: 'var(--color-danger)',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-input)',
                  fontSize: '13px',
                  marginTop: '16px',
                }}
              >
                {error}
              </div>
            )}

            {savedAt && (
              <p style={{ fontSize: '13px', color: 'var(--color-success)', marginTop: '16px' }}>
                Saved at {savedAt}
              </p>
            )}
          </Card>

          <Card padding="large">
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.008em',
                marginBottom: '4px',
              }}
            >
              Tenant configuration
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              These come from the tenant record. Edit in Admin → Tenants.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Stat label="Value threshold" value={`$${tenant.value_threshold.toLocaleString()}`} />
              <Stat label="Turn count" value={String(tenant.turn_count)} />
              <Stat label="Batch size" value={String(tenant.batch_size)} />
              <Stat label="Hidden gem score" value={`≥ ${tenant.hidden_gem_score_threshold}`} />
            </div>

            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '0.5px solid var(--color-hairline)' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.015em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-tertiary)',
                  marginBottom: '8px',
                }}
              >
                Prompt variants
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
                <div>enrichment → {tenant.prompt_variant_enrichment}</div>
                <div>dna → {tenant.prompt_variant_dna}</div>
                <div>gate → {tenant.prompt_variant_gate}</div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </TabPage>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  fontSize: '14px',
  boxSizing: 'border-box',
  marginBottom: '16px',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          marginBottom: '6px',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.015em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '17px', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}
