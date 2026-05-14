import { useState } from 'react'

// Public-facing intake form at /start. No auth required.
// On submit: calls create-prospect Netlify function with created_by='public'.
// Receives login + temp password back, displays them to the prospect, and shows next steps.

type Step = 1 | 2 | 3 | 4

interface Form {
  company_name: string
  display_name: string
  contact_name: string
  contact_email: string
  industry: string
  revenue_band: string
  headcount: string
  uei: string
  cage: string
  hq_city: string
  certifications: string[]
  self_stated_capabilities: string
  catalyst_quote: string
  referral_source: string
}

const empty: Form = {
  company_name: '', display_name: '',
  contact_name: '', contact_email: '',
  industry: '', revenue_band: '', headcount: '',
  uei: '', cage: '', hq_city: '', certifications: [], self_stated_capabilities: '',
  catalyst_quote: '', referral_source: '',
}

const CERTS = ['SDVOSB','WOSB','EDWOSB','8(a)','HUBZone','SDB','VOSB','Small Business']
const REV = ['<$1M','$1M-$5M','$5M-$10M','$10M-$25M','$25M-$50M','$50M+']
const HC  = ['1-10','11-50','51-100','101-250','251-500','500+']

export default function PublicIntake() {
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<Form>(empty)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleCert = (c: string) => upd('certifications',
    form.certifications.includes(c) ? form.certifications.filter((x) => x !== c) : [...form.certifications, c])

  const validate = (s: Step): string | null => {
    if (s === 1 && !form.company_name.trim()) return 'Company name is required'
    if (s === 2) {
      if (!form.contact_name.trim()) return 'Your name is required'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) return 'Valid email is required'
    }
    return null
  }

  const next = () => {
    const e = validate(step); if (e) { setError(e); return }
    setError(null); if (step < 4) setStep((step + 1) as Step)
  }
  const back = () => { setError(null); if (step > 1) setStep((step - 1) as Step) }

  const submit = async () => {
    const e = validate(1) || validate(2); if (e) { setError(e); return }
    setSubmitting(true); setError(null)
    try {
      const resp = await fetch('/.netlify/functions/create-prospect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: {
            name: form.company_name,
            display_name: form.display_name || form.company_name,
            client_color: '#C5933A',
            intake_metadata: {
              industry: form.industry || null,
              revenue_band: form.revenue_band || null,
              headcount: form.headcount || null,
              uei: form.uei || null,
              cage: form.cage || null,
              hq_city: form.hq_city || null,
              certifications: form.certifications,
              self_stated_capabilities: form.self_stated_capabilities || null,
              referral_source: form.referral_source || null,
              catalyst_quote: form.catalyst_quote || null,
              intake_mode: 'public_only',
            },
          },
          primary_contact: { full_name: form.contact_name, email: form.contact_email },
          created_by: 'public',
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Submission failed')
      setResult(data)
    } catch (e: any) {
      setError(e?.message || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <Page>
        <Hero>
          <div style={{ fontSize: 14, fontFamily: 'var(--font-display, Georgia, serif)', color: '#C5933A', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Welcome aboard</div>
          <h1 style={{ fontFamily: 'var(--font-display, Georgia, serif)', fontSize: 42, fontWeight: 600, margin: '8px 0 12px 0', letterSpacing: '-0.02em' }}>Your Captain's Log is ready</h1>
          <p style={{ fontSize: 17, color: '#555', maxWidth: 540, lineHeight: 1.55, margin: 0 }}>
            Sunstone has provisioned your workspace. Use the credentials below to sign in
            and begin reviewing your federal reconnaissance.
          </p>
        </Hero>
        <div style={{ background: '#F8F4EA', borderRadius: 12, padding: 24, maxWidth: 540, margin: '32px auto' }}>
          <KV k="Login URL" v={result.login_url} mono />
          <KV k="Email" v={result.email} mono />
          <KV k="Temporary password" v={result.temp_password} mono highlight />
        </div>
        <div style={{ maxWidth: 540, margin: '0 auto', textAlign: 'center' }}>
          <a href={result.login_url} style={btnPrimary}>Sign in to Sunstone</a>
          <p style={{ fontSize: 12, color: '#888', marginTop: 16 }}>
            Save your temporary password — it will not be shown again. You can change it
            once you're inside.
          </p>
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <Hero>
        <div style={{ fontSize: 14, fontFamily: 'var(--font-display, Georgia, serif)', color: '#C5933A', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Begin your voyage</div>
        <h1 style={{ fontFamily: 'var(--font-display, Georgia, serif)', fontSize: 42, fontWeight: 600, margin: '8px 0 12px 0', letterSpacing: '-0.02em' }}>Start a federal reconnaissance</h1>
        <p style={{ fontSize: 17, color: '#555', maxWidth: 600, lineHeight: 1.55, margin: 0 }}>
          Tell us about your company. Sunstone will build your validated federal market — every award
          you should have known about, clustered into your capability lanes.
        </p>
      </Hero>

      <div style={{ maxWidth: 640, margin: '24px auto 0', background: 'white', border: '1px solid #ECE3CD', borderRadius: 12, padding: 28, boxShadow: '0 2px 16px rgba(60,40,10,0.04)' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {[1,2,3,4].map((s) => (
            <div key={s} style={{ height: 3, flex: 1, borderRadius: 2, background: s <= step ? '#C5933A' : '#ECE3CD' }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 18, textAlign: 'right' }}>Step {step} of 4</div>

        {step === 1 && (
          <Section title="Who are you">
            <Field label="Company name *">
              <input style={inp} value={form.company_name} onChange={(e) => upd('company_name', e.target.value)} placeholder="Legal company name" />
            </Field>
            <Field label="Display name (optional)">
              <input style={inp} value={form.display_name} onChange={(e) => upd('display_name', e.target.value)} placeholder="What you go by, if different" />
            </Field>
            <Field label="Brief description">
              <textarea style={{ ...inp, minHeight: 90 }} value={form.self_stated_capabilities} onChange={(e) => upd('self_stated_capabilities', e.target.value)} placeholder="What does your company do? Use your own language." />
            </Field>
          </Section>
        )}

        {step === 2 && (
          <Section title="How we reach you">
            <Field label="Your full name *">
              <input style={inp} value={form.contact_name} onChange={(e) => upd('contact_name', e.target.value)} />
            </Field>
            <Field label="Your work email *">
              <input style={inp} value={form.contact_email} onChange={(e) => upd('contact_email', e.target.value)} placeholder="name@company.com" />
            </Field>
            <Field label="Who referred you (optional)">
              <input style={inp} value={form.referral_source} onChange={(e) => upd('referral_source', e.target.value)} />
            </Field>
          </Section>
        )}

        {step === 3 && (
          <Section title="Company shape">
            <FieldRow>
              <Field label="Industry"><input style={inp} value={form.industry} onChange={(e) => upd('industry', e.target.value)} placeholder="e.g. Marketing" /></Field>
              <Field label="Revenue">
                <select style={inp} value={form.revenue_band} onChange={(e) => upd('revenue_band', e.target.value)}>
                  <option value="">—</option>{REV.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Headcount">
                <select style={inp} value={form.headcount} onChange={(e) => upd('headcount', e.target.value)}>
                  <option value="">—</option>{HC.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="UEI"><input style={inp} value={form.uei} onChange={(e) => upd('uei', e.target.value.toUpperCase())} /></Field>
              <Field label="CAGE"><input style={inp} value={form.cage} onChange={(e) => upd('cage', e.target.value.toUpperCase())} /></Field>
              <Field label="HQ city"><input style={inp} value={form.hq_city} onChange={(e) => upd('hq_city', e.target.value)} placeholder="Los Angeles, CA" /></Field>
            </FieldRow>
            <Field label="Certifications">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CERTS.map((c) => (
                  <button key={c} type="button" onClick={() => toggleCert(c)} style={{
                    padding: '5px 12px', borderRadius: 999,
                    border: '1px solid', borderColor: form.certifications.includes(c) ? '#C5933A' : '#ddd',
                    background: form.certifications.includes(c) ? '#C5933A' : 'transparent',
                    color: form.certifications.includes(c) ? 'white' : '#444',
                    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{c}</button>
                ))}
              </div>
            </Field>
          </Section>
        )}

        {step === 4 && (
          <Section title="Why now">
            <Field label="What's catalyzing this conversation">
              <textarea style={{ ...inp, minHeight: 110 }} value={form.catalyst_quote} onChange={(e) => upd('catalyst_quote', e.target.value)} placeholder="One or two sentences. Why are you exploring federal contracting now?" />
            </Field>
            <p style={{ fontSize: 13, color: '#666', lineHeight: 1.55 }}>
              When you click <strong>Begin reconnaissance</strong>, Sunstone provisions your workspace
              and prepares your validated federal market. You'll receive login credentials on the next screen.
            </p>
          </Section>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: 10, background: '#FEEBEB', border: '1px solid #E5808A', borderRadius: 6, color: '#7A1F2A', fontSize: 13 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button onClick={back} disabled={step === 1} style={{ ...btnSecondary, opacity: step === 1 ? 0.4 : 1 }}>Back</button>
          {step < 4
            ? <button onClick={next} style={btnPrimary}>Continue</button>
            : <button onClick={submit} disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Provisioning...' : 'Begin reconnaissance'}</button>}
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#999' }}>
        Sunstone Advisory Group · Federal market intelligence
      </div>
    </Page>
  )
}

// --- UI primitives ---

const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
const btnPrimary: React.CSSProperties = { background: '#1F3A52', color: 'white', border: 'none', borderRadius: 6, padding: '10px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-block', fontFamily: 'inherit' }
const btnSecondary: React.CSSProperties = { background: 'transparent', color: '#444', border: '1px solid #ccc', borderRadius: 6, padding: '10px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }

function Page({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #FBF7EA 0%, #ffffff 220px, #ffffff 100%)', padding: '60px 24px 80px' }}>{children}</div>
}
function Hero({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>{children}</div>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 style={{ margin: '0 0 14px 0', fontSize: 13, fontWeight: 600, color: '#666', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</h3>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 14 }}>
    <div style={{ fontSize: 11, color: '#666', marginBottom: 4, fontWeight: 600 }}>{label}</div>{children}
  </label>
}
function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>{children}</div>
}
function KV({ k, v, mono, highlight }: { k: string; v: string; mono?: boolean; highlight?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #EFE7D6', fontSize: 14 }}>
    <span style={{ color: '#666' }}>{k}</span>
    <span style={{ fontFamily: mono ? 'monospace' : 'inherit', fontWeight: highlight ? 700 : 500, background: highlight ? '#FEF3C7' : 'transparent', padding: highlight ? '3px 8px' : 0, borderRadius: 4 }}>{v}</span>
  </div>
}
