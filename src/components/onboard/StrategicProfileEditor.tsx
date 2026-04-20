import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { Field, TextInput, TextArea } from '@/components/FormInputs'
import { supabase } from '@/lib/supabase'
import type { StrategicProfile } from '@/lib/types'

interface Props {
  mode: 'new' | 'edit'
  profile?: StrategicProfile
  tenantId: string
  onClose: () => void
  onSaved: () => void
}

export function StrategicProfileEditor({ mode, profile, tenantId, onClose, onSaved }: Props) {
  const [name, setName] = useState(profile?.name || '')
  const [description, setDescription] = useState(profile?.description || '')
  const [positioning, setPositioning] = useState(profile?.positioning || '')
  const [agencies, setAgencies] = useState((profile?.target_agencies || []).join(', '))
  const [naics, setNaics] = useState((profile?.target_naics || []).join(', '))
  const [psc, setPsc] = useState((profile?.target_psc || []).join(', '))
  const [isDefault, setIsDefault] = useState(profile?.is_default || false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const parsed = {
        tenant_id: tenantId,
        name: name.trim(),
        description: description.trim() || null,
        positioning: positioning.trim() || null,
        target_agencies: splitList(agencies),
        target_naics: splitList(naics),
        target_psc: splitList(psc),
        is_default: isDefault,
        updated_at: new Date().toISOString(),
      }

      if (isDefault) {
        await supabase
          .from('strategic_profiles')
          .update({ is_default: false })
          .eq('tenant_id', tenantId)
          .is('deleted_at', null)
      }

      if (mode === 'new') {
        await supabase.from('strategic_profiles').insert(parsed)
      } else if (profile) {
        await supabase.from('strategic_profiles').update(parsed).eq('id', profile.id)
      }
      onSaved()
    } catch (e: any) {
      setErr(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={mode === 'new' ? 'New strategic profile' : 'Edit strategic profile'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : mode === 'new' ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {err && <div style={{ fontSize: '12px', color: 'var(--color-danger)' }}>{err}</div>}

        <Field label="Profile name" hint='e.g., "CBP glove manufacturing", "VA medical devices"'>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Description" hint="One-line summary of the lane">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field
          label="Positioning narrative"
          hint="How the company pitches into THIS specific federal lane"
        >
          <TextArea
            value={positioning}
            onChange={(e) => setPositioning(e.target.value)}
            rows={5}
          />
        </Field>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          <Field label="Target agencies" hint="Comma-separated">
            <TextInput
              value={agencies}
              onChange={(e) => setAgencies(e.target.value)}
              placeholder="CBP, VA, DHS"
            />
          </Field>
          <Field label="Target NAICS" hint="Comma-separated">
            <TextInput
              value={naics}
              onChange={(e) => setNaics(e.target.value)}
              placeholder="339113, 325199"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Field>
          <Field label="Target PSC" hint="Comma-separated">
            <TextInput
              value={psc}
              onChange={(e) => setPsc(e.target.value)}
              placeholder="6515, 6505"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Field>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            color: 'var(--color-text-primary)',
          }}
        >
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Make this the default profile for enrichment runs
        </label>
      </div>
    </Modal>
  )
}

function splitList(s: string): string[] | null {
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length ? parts : null
}
