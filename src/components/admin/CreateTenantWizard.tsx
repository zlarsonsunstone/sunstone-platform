import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Tenant, TenantTemplate } from '@/lib/types'
import { Button } from '../Button'

type WizardStep = 'choose-path' | 'pick-template' | 'pick-clone' | 'configure'

interface CreateTenantWizardProps {
  existingTenants: Tenant[]
  onClose: () => void
  onCreated: () => void
}

interface TenantDraft {
  id: string
  name: string
  client_color: string
  cobrand_name: string
  report_tagline: string
  template_id: string | null
  prompt_variant_enrichment: string
  prompt_variant_dna: string
  prompt_variant_gate: string
  value_threshold: number
  hidden_gem_score_threshold: number
  turn_count: number
  batch_size: number
  archive_age_days: number
}

const emptyDraft: TenantDraft = {
  id: '',
  name: '',
  client_color: '#D4920A',
  cobrand_name: '',
  report_tagline: '',
  template_id: null,
  prompt_variant_enrichment: '',
  prompt_variant_dna: '',
  prompt_variant_gate: '',
  value_threshold: 500000,
  hidden_gem_score_threshold: 7,
  turn_count: 4,
  batch_size: 100,
  archive_age_days: 180,
}

export function CreateTenantWizard({ existingTenants, onClose, onCreated }: CreateTenantWizardProps) {
  const [step, setStep] = useState<WizardStep>('choose-path')
  const [templates, setTemplates] = useState<TenantTemplate[]>([])
  const [draft, setDraft] = useState<TenantDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('tenant_templates')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setTemplates((data as TenantTemplate[]) || []))
  }, [])

  const chooseTemplate = (template: TenantTemplate) => {
    setDraft({
      ...emptyDraft,
      template_id: template.id,
      prompt_variant_enrichment: template.default_prompt_variant_enrichment,
      prompt_variant_dna: template.default_prompt_variant_dna,
      prompt_variant_gate: template.default_prompt_variant_gate,
      value_threshold: template.default_value_threshold,
      hidden_gem_score_threshold: template.default_hidden_gem_score,
      turn_count: template.default_turn_count,
      batch_size: template.default_batch_size,
      archive_age_days: template.default_archive_age_days,
    })
    setStep('configure')
  }

  const chooseClone = (source: Tenant) => {
    setDraft({
      ...emptyDraft,
      template_id: source.template_id,
      prompt_variant_enrichment: source.prompt_variant_enrichment,
      prompt_variant_dna: source.prompt_variant_dna,
      prompt_variant_gate: source.prompt_variant_gate,
      value_threshold: source.value_threshold,
      hidden_gem_score_threshold: source.hidden_gem_score_threshold,
      turn_count: source.turn_count,
      batch_size: source.batch_size,
      archive_age_days: source.archive_age_days,
      client_color: source.client_color,
      cobrand_name: source.cobrand_name || '',
    })
    setStep('configure')
  }

  const chooseBlank = () => {
    // Need valid defaults for prompt variants — just pick the first of each use case
    supabase
      .from('prompt_variants')
      .select('id, use_case')
      .eq('is_active', true)
      .then(({ data }) => {
        if (!data) return
        const enrichment = data.find((v: any) => v.use_case === 'enrichment')?.id || ''
        const dna = data.find((v: any) => v.use_case === 'dna')?.id || ''
        const gate = data.find((v: any) => v.use_case === 'gate')?.id || ''
        setDraft({
          ...emptyDraft,
          prompt_variant_enrichment: enrichment,
          prompt_variant_dna: dna,
          prompt_variant_gate: gate,
        })
        setStep('configure')
      })
  }

  const save = async () => {
    setError(null)

    // Validate
    if (!draft.id.trim() || !draft.name.trim()) {
      setError('Both slug and name are required.')
      return
    }
    if (!/^[a-z0-9-]+$/.test(draft.id)) {
      setError('Slug must be lowercase letters, numbers, and hyphens only.')
      return
    }
    if (!draft.prompt_variant_enrichment || !draft.prompt_variant_dna || !draft.prompt_variant_gate) {
      setError('All three prompt variants must be selected.')
      return
    }

    setSaving(true)
    const { error: insertError } = await supabase.from('tenants').insert({
      id: draft.id,
      name: draft.name,
      status: 'active',
      client_color: draft.client_color,
      cobrand_name: draft.cobrand_name || null,
      report_tagline: draft.report_tagline || null,
      template_id: draft.template_id,
      prompt_variant_enrichment: draft.prompt_variant_enrichment,
      prompt_variant_dna: draft.prompt_variant_dna,
      prompt_variant_gate: draft.prompt_variant_gate,
      value_threshold: draft.value_threshold,
      hidden_gem_score_threshold: draft.hidden_gem_score_threshold,
      turn_count: draft.turn_count,
      batch_size: draft.batch_size,
      archive_age_days: draft.archive_age_days,
    })

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onCreated()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 400,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 24px',
        overflow: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-modal)',
          padding: '32px',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {step === 'choose-path' && <ChoosePathStep existingTenants={existingTenants}
          onPickTemplate={() => setStep('pick-template')}
          onPickBlank={chooseBlank}
          onPickClone={() => setStep('pick-clone')}
          onClose={onClose}
        />}

        {step === 'pick-template' && (
          <PickTemplateStep
            templates={templates}
            onPick={chooseTemplate}
            onBack={() => setStep('choose-path')}
          />
        )}

        {step === 'pick-clone' && (
          <PickCloneStep
            tenants={existingTenants}
            onPick={chooseClone}
            onBack={() => setStep('choose-path')}
          />
        )}

        {step === 'configure' && (
          <ConfigureStep
            draft={draft}
            setDraft={setDraft}
            templates={templates}
            saving={saving}
            error={error}
            onSave={save}
            onBack={() => setStep('choose-path')}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================
// Step: Choose path
// ============================================================

function ChoosePathStep({ existingTenants, onPickTemplate, onPickBlank, onPickClone, onClose }: {
  existingTenants: Tenant[]
  onPickTemplate: () => void
  onPickBlank: () => void
  onPickClone: () => void
  onClose: () => void
}) {
  const canClone = existingTenants.length > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.011em', margin: 0 }}>
          New tenant
        </h2>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '0 8px', lineHeight: 1 }}>×</button>
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', marginBottom: '32px' }}>
        How do you want to start?
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <PathCard
          title="Pick a template"
          description="Start from an industry preset. Fastest."
          onClick={onPickTemplate}
        />
        <PathCard
          title="Start blank"
          description="Configure every field manually."
          onClick={onPickBlank}
        />
        <PathCard
          title="Clone existing"
          description={canClone ? 'Copy settings from another tenant.' : 'Need at least one existing tenant.'}
          onClick={onPickClone}
          disabled={!canClone}
        />
      </div>
    </div>
  )
}

function PathCard({ title, description, onClick, disabled }: {
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'var(--color-bg-subtle)',
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-card)',
        padding: '24px',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'var(--transition-default)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-primary)' }}>
        {title}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
        {description}
      </div>
    </button>
  )
}

// ============================================================
// Step: Pick template
// ============================================================

function PickTemplateStep({ templates, onPick, onBack }: {
  templates: TenantTemplate[]
  onPick: (template: TenantTemplate) => void
  onBack: () => void
}) {
  return (
    <div>
      <BackHeader title="Pick a template" onBack={onBack} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            style={{
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-card)',
              padding: '24px',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'var(--transition-default)',
            }}
          >
            <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '6px' }}>{t.name}</div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.4, marginBottom: '16px' }}>
              {t.description}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <Chip label={`$${t.default_value_threshold.toLocaleString()}`} />
              <Chip label={`${t.default_turn_count} turns`} />
              <Chip label={`batch ${t.default_batch_size}`} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// Step: Pick clone source
// ============================================================

function PickCloneStep({ tenants, onPick, onBack }: {
  tenants: Tenant[]
  onPick: (t: Tenant) => void
  onBack: () => void
}) {
  return (
    <div>
      <BackHeader title="Clone from existing tenant" onBack={onBack} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {tenants.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: '0.5px solid var(--color-hairline)',
              padding: '16px 0',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '15px', fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                template: {t.template_id || 'custom'} · ${t.value_threshold.toLocaleString()} · {t.turn_count} turns
              </div>
            </div>
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '18px' }}>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// Step: Configure
// ============================================================

function ConfigureStep({ draft, setDraft, templates, saving, error, onSave, onBack, onClose }: {
  draft: TenantDraft
  setDraft: (d: TenantDraft) => void
  templates: TenantTemplate[]
  saving: boolean
  error: string | null
  onSave: () => void
  onBack: () => void
  onClose: () => void
}) {
  const update = (patch: Partial<TenantDraft>) => setDraft({ ...draft, ...patch })

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const handleNameChange = (name: string) => {
    const autoId = !draft.id || draft.id === autoSlug(draft.name) ? autoSlug(name) : draft.id
    update({ name, id: autoId })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.011em', margin: 0 }}>
          Configure tenant
        </h2>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '0 8px', lineHeight: 1 }}>×</button>
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
        Defaults come from your selection. Everything here is editable later.
      </p>

      {/* Identity */}
      <Section label="Identity">
        <Field label="Company name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Manifold Labs, Inc."
            style={inputStyle}
          />
        </Field>
        <Field label="Slug (URL identifier)">
          <input
            type="text"
            value={draft.id}
            onChange={(e) => update({ id: e.target.value })}
            placeholder="manifold-labs"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
        </Field>
      </Section>

      {/* Branding */}
      <Section label="Branding">
        <Field label="Primary color">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="color"
              value={draft.client_color}
              onChange={(e) => update({ client_color: e.target.value })}
              style={{ width: '40px', height: '40px', border: 'none', borderRadius: '8px', cursor: 'pointer', background: 'transparent' }}
            />
            <input
              type="text"
              value={draft.client_color}
              onChange={(e) => update({ client_color: e.target.value })}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', flex: 1 }}
            />
          </div>
        </Field>
        <Field label="Co-brand partner (optional)">
          <input
            type="text"
            value={draft.cobrand_name}
            onChange={(e) => update({ cobrand_name: e.target.value })}
            placeholder="Steptoe LLP"
            style={inputStyle}
          />
        </Field>
        <Field label="Report tagline (optional)">
          <input
            type="text"
            value={draft.report_tagline}
            onChange={(e) => update({ report_tagline: e.target.value })}
            placeholder="Federal Market Intelligence"
            style={inputStyle}
          />
        </Field>
      </Section>

      {/* Configuration */}
      <Section label="Configuration">
        <Field label="Template">
          <select
            value={draft.template_id || ''}
            onChange={(e) => update({ template_id: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">Custom (no template)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Value threshold ($)">
          <input
            type="number"
            value={draft.value_threshold}
            onChange={(e) => update({ value_threshold: parseInt(e.target.value) || 0 })}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
        </Field>
        <Field label="Turn count">
          <input
            type="number"
            value={draft.turn_count}
            onChange={(e) => update({ turn_count: parseInt(e.target.value) || 4 })}
            min="1"
            max="10"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
        </Field>
        <Field label="Batch size">
          <input
            type="number"
            value={draft.batch_size}
            onChange={(e) => update({ batch_size: parseInt(e.target.value) || 100 })}
            min="10"
            max="500"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
        </Field>
      </Section>

      {error && (
        <div
          style={{
            background: 'rgba(255, 59, 48, 0.1)',
            color: 'var(--color-danger)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            marginBottom: '16px',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '24px' }}>
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          ← Back
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Creating…' : 'Create tenant'}
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  fontSize: '14px',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.015em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
          marginBottom: '12px',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        {children}
      </div>
    </div>
  )
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

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <button
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-secondary)',
          fontSize: '14px',
          cursor: 'pointer',
          padding: '0',
          marginBottom: '12px',
          fontFamily: 'inherit',
        }}
      >
        ← Back
      </button>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.011em', margin: 0 }}>
        {title}
      </h2>
    </div>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: '3px 8px',
        background: 'var(--color-bg-subtle)',
        color: 'var(--color-text-secondary)',
        borderRadius: '6px',
        fontSize: '11px',
        fontWeight: 500,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {label}
    </span>
  )
}
