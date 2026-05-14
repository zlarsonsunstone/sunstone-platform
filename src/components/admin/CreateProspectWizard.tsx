import { useState } from 'react'

type WizardStep = 1 | 2 | 3 | 4 | 5

interface CreateProspectWizardProps {
  onClose: () => void
  onCreated: (result: CreateResult) => void
}

interface ProspectDraft {
  // Step 1 - identity
  company_name: string
  display_name: string
  client_color: string
  // Step 2 - contact
  contact_name: string
  contact_email: string
  // Step 3 - engagement context
  referral_source: string
  catalyst_quote: string
  intake_mode: 'we_talked' | 'public_only'
  industry: string
  revenue_band: string
  headcount: string
  // Step 4 - federal posture
  uei: string
  cage: string
  year_founded: string
  hq_city: string
  certifications: string[]
  self_stated_capabilities: string
  // Step 5 - data source
  contracts_csv_content: string
  idvs_csv_content: string
  contracts_csv_name: string
  idvs_csv_name: string
}

interface CreateResult {
  tenant_id: string
  user_id: string
  email: string
  temp_password: string
  login_url: string
  errors?: string[]
  recon_job_id?: string
}

const CERT_OPTIONS = ['SDVOSB', 'WOSB', 'EDWOSB', '8(a)', 'HUBZone', 'SDB', 'VOSB', 'Small Business']
const REVENUE_BANDS = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$25M', '$25M-$50M', '$50M+']
const HEADCOUNT_BANDS = ['1-10', '11-50', '51-100', '101-250', '251-500', '500+']

const emptyDraft: ProspectDraft = {
  company_name: '',
  display_name: '',
  client_color: '#C5933A',
  contact_name: '',
  contact_email: '',
  referral_source: '',
  catalyst_quote: '',
  intake_mode: 'we_talked',
  industry: '',
  revenue_band: '',
  headcount: '',
  uei: '',
  cage: '',
  year_founded: '',
  hq_city: '',
  certifications: [],
  self_stated_capabilities: '',
  contracts_csv_content: '',
  idvs_csv_content: '',
  contracts_csv_name: '',
  idvs_csv_name: '',
}

export function CreateProspectWizard({ onClose, onCreated }: CreateProspectWizardProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [draft, setDraft] = useState<ProspectDraft>(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateResult | null>(null)

  const upd = <K extends keyof ProspectDraft>(k: K, v: ProspectDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const toggleCert = (c: string) => {
    setDraft((d) => ({
      ...d,
      certifications: d.certifications.includes(c)
        ? d.certifications.filter((x) => x !== c)
        : [...d.certifications, c],
    }))
  }

  const handleFile = (kind: 'contracts' | 'idvs', file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = String(e.target?.result || '')
      if (kind === 'contracts') {
        upd('contracts_csv_content', content)
        upd('contracts_csv_name', file.name)
      } else {
        upd('idvs_csv_content', content)
        upd('idvs_csv_name', file.name)
      }
    }
    reader.readAsText(file)
  }

  const validateStep = (s: WizardStep): string | null => {
    if (s === 1) {
      if (!draft.company_name.trim()) return 'Company name is required'
    }
    if (s === 2) {
      if (!draft.contact_name.trim()) return 'Primary contact name is required'
      if (!draft.contact_email.trim()) return 'Primary contact email is required'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact_email)) return 'Invalid email format'
    }
    return null
  }

  const next = () => {
    const err = validateStep(step)
    if (err) { setError(err); return }
    setError(null)
    if (step < 5) setStep((step + 1) as WizardStep)
  }

  const back = () => {
    setError(null)
    if (step > 1) setStep((step - 1) as WizardStep)
  }

  const submit = async () => {
    const err = validateStep(2) || validateStep(1)
    if (err) { setError(err); setStep(err.includes('email') || err.includes('contact') ? 2 : 1); return }
    setError(null)
    setSubmitting(true)
    try {
      // 1. Create prospect (tenant + user + seed rows)
      const createResp = await fetch('/.netlify/functions/create-prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: {
            name: draft.company_name,
            display_name: draft.display_name || draft.company_name,
            client_color: draft.client_color,
            intake_metadata: {
              industry: draft.industry || null,
              revenue_band: draft.revenue_band || null,
              headcount: draft.headcount || null,
              uei: draft.uei || null,
              cage: draft.cage || null,
              year_founded: draft.year_founded ? Number(draft.year_founded) : null,
              hq_city: draft.hq_city || null,
              certifications: draft.certifications,
              self_stated_capabilities: draft.self_stated_capabilities || null,
              referral_source: draft.referral_source || null,
              catalyst_quote: draft.catalyst_quote || null,
              intake_mode: draft.intake_mode,
            },
          },
          primary_contact: {
            full_name: draft.contact_name,
            email: draft.contact_email,
          },
          created_by: 'admin',
        }),
      })
      const created = await createResp.json()
      if (!createResp.ok) throw new Error(created.error || 'Prospect creation failed')

      // 2. If CSVs uploaded, kick off recon data processing
      let reconJobId: string | undefined
      if (draft.contracts_csv_content || draft.idvs_csv_content) {
        const reconResp = await fetch('/.netlify/functions/process-recon-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: created.tenant_id,
            contracts_csv: draft.contracts_csv_content,
            idvs_csv: draft.idvs_csv_content,
            tenant_profile: {
              core_naics: [], core_psc: [], core_capabilities: [], tier_strong: [],
            },
          }),
        })
        const reconData = await reconResp.json().catch(() => ({}))
        reconJobId = reconData.job_id
      }

      const finalResult: CreateResult = { ...created, recon_job_id: reconJobId }
      setResult(finalResult)
      onCreated(finalResult)
    } catch (e: any) {
      setError(e?.message || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  // After successful creation, show summary screen
  if (result) {
    return (
      <Modal onClose={onClose}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 22, fontWeight: 600 }}>Prospect created</h2>
        <p style={{ marginTop: 0, color: '#666', fontSize: 13 }}>
          Share these credentials with the prospect. The password is shown once.
        </p>
        <div style={{ background: '#F8F4EA', padding: 16, borderRadius: 8, marginTop: 16 }}>
          <KV k="Login URL" v={result.login_url} mono />
          <KV k="Email" v={result.email} mono />
          <KV k="Temporary password" v={result.temp_password} mono highlight />
          <KV k="Tenant ID" v={result.tenant_id} mono />
        </div>
        {result.recon_job_id && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
            Recon data processing job {result.recon_job_id} started. The prospect's
            Dartboard Tool will populate when the job completes (~2-5 min).
          </div>
        )}
        {result.errors && result.errors.length > 0 && (
          <div style={{ marginTop: 12, padding: 10, background: '#FEF6E7', border: '1px solid #F6CE6A', borderRadius: 6, fontSize: 12 }}>
            <strong>Warnings:</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btnPrimary}>Done</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Add new prospect</h2>
        <div style={{ fontSize: 12, color: '#888' }}>Step {step} of 5</div>
      </div>
      <Progress step={step} />

      {step === 1 && (
        <Section title="Identity">
          <Field label="Company name *">
            <input style={inp} value={draft.company_name} onChange={(e) => upd('company_name', e.target.value)} placeholder="e.g. Wicked Bionic" />
          </Field>
          <Field label="Display name (optional)">
            <input style={inp} value={draft.display_name} onChange={(e) => upd('display_name', e.target.value)} placeholder="Defaults to Company name" />
          </Field>
          <Field label="Brand color">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={draft.client_color} onChange={(e) => upd('client_color', e.target.value)} style={{ width: 48, height: 36, border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
              <input style={{ ...inp, flex: 1 }} value={draft.client_color} onChange={(e) => upd('client_color', e.target.value)} />
            </div>
          </Field>
        </Section>
      )}

      {step === 2 && (
        <Section title="Primary contact">
          <Field label="Full name *">
            <input style={inp} value={draft.contact_name} onChange={(e) => upd('contact_name', e.target.value)} placeholder="e.g. Dana C. Arnett" />
          </Field>
          <Field label="Email *">
            <input style={inp} value={draft.contact_email} onChange={(e) => upd('contact_email', e.target.value)} placeholder="dana@wickedbionic.com" />
          </Field>
        </Section>
      )}

      {step === 3 && (
        <Section title="Engagement context">
          <Field label="Referral source">
            <input style={inp} value={draft.referral_source} onChange={(e) => upd('referral_source', e.target.value)} placeholder="Who introduced this prospect?" />
          </Field>
          <Field label="Catalyst quote">
            <textarea style={{ ...inp, minHeight: 60 }} value={draft.catalyst_quote} onChange={(e) => upd('catalyst_quote', e.target.value)} placeholder='e.g. "Federal contracting as effective revenue stream to scale to $10M in 4 years."' />
          </Field>
          <Field label="Intake mode">
            <div style={{ display: 'flex', gap: 12 }}>
              <Pill active={draft.intake_mode === 'we_talked'} onClick={() => upd('intake_mode', 'we_talked')}>
                We talked to them
              </Pill>
              <Pill active={draft.intake_mode === 'public_only'} onClick={() => upd('intake_mode', 'public_only')}>
                Public data only (test of capabilities)
              </Pill>
            </div>
          </Field>
          <FieldRow>
            <Field label="Industry">
              <input style={inp} value={draft.industry} onChange={(e) => upd('industry', e.target.value)} placeholder="e.g. Marketing & Communications" />
            </Field>
            <Field label="Revenue band">
              <select style={inp} value={draft.revenue_band} onChange={(e) => upd('revenue_band', e.target.value)}>
                <option value="">—</option>
                {REVENUE_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Headcount">
              <select style={inp} value={draft.headcount} onChange={(e) => upd('headcount', e.target.value)}>
                <option value="">—</option>
                {HEADCOUNT_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          </FieldRow>
        </Section>
      )}

      {step === 4 && (
        <Section title="Federal posture">
          <FieldRow>
            <Field label="UEI"><input style={inp} value={draft.uei} onChange={(e) => upd('uei', e.target.value.toUpperCase())} /></Field>
            <Field label="CAGE"><input style={inp} value={draft.cage} onChange={(e) => upd('cage', e.target.value.toUpperCase())} /></Field>
          </FieldRow>
          <FieldRow>
            <Field label="Year founded"><input style={inp} value={draft.year_founded} onChange={(e) => upd('year_founded', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} /></Field>
            <Field label="HQ city"><input style={inp} value={draft.hq_city} onChange={(e) => upd('hq_city', e.target.value)} placeholder="e.g. Los Angeles, CA" /></Field>
          </FieldRow>
          <Field label="Certifications">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CERT_OPTIONS.map((c) => (
                <Pill key={c} active={draft.certifications.includes(c)} onClick={() => toggleCert(c)} small>{c}</Pill>
              ))}
            </div>
          </Field>
          <Field label="Self-stated capabilities">
            <textarea style={{ ...inp, minHeight: 80 }} value={draft.self_stated_capabilities} onChange={(e) => upd('self_stated_capabilities', e.target.value)} placeholder="Brief description of what the company does. Use their own language when possible." />
          </Field>
        </Section>
      )}

      {step === 5 && (
        <Section title="Reconnaissance data">
          <p style={{ fontSize: 13, color: '#555', marginTop: 0 }}>
            Upload HigherGov CSV exports to bootstrap the Dartboard Tool with award data.
            Both CSVs are optional — you can also load this data later.
          </p>
          <Field label="Contracts CSV">
            <FilePick name={draft.contracts_csv_name} onPick={(f) => handleFile('contracts', f)} />
          </Field>
          <Field label="IDVs CSV">
            <FilePick name={draft.idvs_csv_name} onPick={(f) => handleFile('idvs', f)} />
          </Field>
        </Section>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: '#FEEBEB', border: '1px solid #E5808A', borderRadius: 6, color: '#7A1F2A', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button onClick={step === 1 ? onClose : back} style={btnSecondary}>{step === 1 ? 'Cancel' : 'Back'}</button>
        {step < 5
          ? <button onClick={next} style={btnPrimary}>Continue</button>
          : <button onClick={submit} disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Creating...' : 'Create prospect'}</button>}
      </div>
    </Modal>
  )
}

// --- Small UI primitives ---

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { background: '#1F3A52', color: 'white', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnSecondary: React.CSSProperties = { background: 'transparent', color: '#444', border: '1px solid #ccc', borderRadius: 6, padding: '9px 14px', fontSize: 13, cursor: 'pointer' }

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 12, padding: 28, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#444', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4, fontWeight: 600, letterSpacing: '0.02em' }}>{label}</div>
      {children}
    </label>
  )
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>{children}</div>
}

function Pill({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? '4px 10px' : '7px 14px',
      borderRadius: 999, border: '1px solid', borderColor: active ? '#1F3A52' : '#ddd',
      background: active ? '#1F3A52' : 'transparent', color: active ? 'white' : '#444',
      fontSize: small ? 11 : 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  )
}

function FilePick({ name, onPick }: { name: string; onPick: (f: File) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <label style={{ ...btnSecondary, display: 'inline-block', cursor: 'pointer' }}>
        Choose file
        <input type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => {
          const f = e.target.files?.[0]; if (f) onPick(f)
        }} />
      </label>
      <span style={{ fontSize: 12, color: '#666' }}>{name || 'No file selected'}</span>
    </div>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {[1,2,3,4,5].map((s) => (
        <div key={s} style={{ height: 3, flex: 1, borderRadius: 2, background: s <= step ? '#1F3A52' : '#e6e6e6' }} />
      ))}
    </div>
  )
}

function KV({ k, v, mono, highlight }: { k: string; v: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #EFE7D6', fontSize: 13 }}>
      <span style={{ color: '#666' }}>{k}</span>
      <span style={{ fontFamily: mono ? 'monospace' : 'inherit', fontWeight: highlight ? 700 : 500, background: highlight ? '#FEF3C7' : 'transparent', padding: highlight ? '2px 6px' : 0, borderRadius: 4 }}>{v}</span>
    </div>
  )
}
