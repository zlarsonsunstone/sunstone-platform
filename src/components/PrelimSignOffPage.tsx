/**
 * PrelimSignOffPage - prospect-facing /prelim/:token route.
 *
 * Anonymous (no login). Loaded via main.tsx path-string router.
 *
 * Flow:
 *   1. Token in URL: /prelim/<sign_off_token>
 *   2. RLS on v2.prelim_profile (added 0037) lets anon SELECT/UPDATE rows where
 *      sign_off_token matches.
 *   3. Prospect reads the prelim, edits any field, types their name, clicks Sign.
 *   4. Sign sets signed_at + signed_name. Token stays valid (so they can re-open
 *      and still see what they signed) but submitted state locks the form.
 *
 * Style matches PublicIntakeForm (cream / espresso / amber).
 *
 * No internal cross-reference findings, no consultant signal scores - the
 * prospect MUST NOT see those (Sunstone doctrine: intake findings are INTERNAL).
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

// =============================================================================
// PALETTE - matches PublicIntakeForm
// =============================================================================

const palette = {
  cream: '#FBF7F0',
  espresso: '#2A2622',
  amber: '#F0A742',
  amberHover: '#E69828',
  hairline: '#E8E1D5',
  textSecondary: '#5C5249',
  textTertiary: '#8B7E70',
  success: '#4A7C59',
  danger: '#C0392B',
  white: '#FFFFFF',
}

// =============================================================================
// TYPES
// =============================================================================

interface PrelimProfile {
  id: string
  company_overview: string | null
  capabilities: string[] | null
  past_performance: string[] | null
  target_agencies: string[] | null
  current_naics: string[] | null
  recommended_naics: string[] | null
  current_psc: string[] | null
  recommended_psc: string[] | null
  current_keywords: string[] | null
  recommended_keywords: string[] | null
  certifications: string[] | null
  narrative_final: string | null
  signed_at: string | null
  signed_name: string | null
}

// =============================================================================
// STYLES
// =============================================================================

const containerStyle: CSSProperties = {
  minHeight: '100vh',
  background: palette.cream,
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  color: palette.espresso,
}

const innerStyle: CSSProperties = {
  maxWidth: '760px',
  margin: '0 auto',
  padding: '48px 24px',
}

const eyebrowStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
  marginBottom: '12px',
}

const h1Style: CSSProperties = {
  fontSize: '36px',
  fontWeight: 700,
  lineHeight: 1.2,
  color: palette.espresso,
  margin: 0,
  marginBottom: '12px',
}

const introStyle: CSSProperties = {
  fontSize: '16px',
  color: palette.textSecondary,
  lineHeight: 1.6,
  marginBottom: '32px',
}

const fieldGroupStyle: CSSProperties = {
  marginBottom: '28px',
}

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
  marginBottom: '8px',
}

const fieldHintStyle: CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: palette.textTertiary,
  marginTop: '6px',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  fontSize: '16px',
  fontFamily: 'inherit',
  border: `1.5px solid ${palette.hairline}`,
  borderRadius: '8px',
  background: palette.white,
  color: palette.espresso,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
  lineHeight: 1.5,
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: '120px',
  resize: 'vertical',
}

const primaryButtonStyle: CSSProperties = {
  padding: '14px 28px',
  fontSize: '16px',
  fontWeight: 600,
  fontFamily: 'inherit',
  background: palette.amber,
  color: palette.espresso,
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'background 0.15s',
}

const secondaryButtonStyle: CSSProperties = {
  padding: '14px 24px',
  fontSize: '15px',
  fontFamily: 'inherit',
  background: 'transparent',
  color: palette.textSecondary,
  border: `1.5px solid ${palette.hairline}`,
  borderRadius: '8px',
  cursor: 'pointer',
}

// =============================================================================
// HELPERS
// =============================================================================

function linesToArray(s: string): string[] {
  return s.split('\n').map(l => l.trim()).filter(Boolean)
}

function arrayToLines(a: string[] | null | undefined): string {
  return (a || []).join('\n')
}

/** Extract token from /prelim/<token> in window.location.pathname. */
function extractToken(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/^\/prelim\/([^/?#]+)/)
  return match ? match[1] : null
}

// =============================================================================
// COMPONENT
// =============================================================================

type Stage = 'loading' | 'editing' | 'saving' | 'signing' | 'signed' | 'error'

export function PrelimSignOffPage() {
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState<string | null>(null)
  const [prelim, setPrelim] = useState<PrelimProfile | null>(null)
  const [token, setToken] = useState<string | null>(null)

  // Editable form state
  const [companyOverview, setCompanyOverview] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [pastPerformance, setPastPerformance] = useState('')
  const [targetAgencies, setTargetAgencies] = useState('')
  const [currentNaics, setCurrentNaics] = useState('')
  const [recommendedNaics, setRecommendedNaics] = useState('')
  const [currentPsc, setCurrentPsc] = useState('')
  const [recommendedPsc, setRecommendedPsc] = useState('')
  const [currentKeywords, setCurrentKeywords] = useState('')
  const [recommendedKeywords, setRecommendedKeywords] = useState('')
  const [certifications, setCertifications] = useState('')
  const [narrativeFinal, setNarrativeFinal] = useState('')

  // Sign state
  const [typedName, setTypedName] = useState('')
  const [savedConfirm, setSavedConfirm] = useState(false)

  // -------------------------------------------------------------------------
  // LOAD
  // -------------------------------------------------------------------------
  useEffect(() => {
    const t = extractToken()
    if (!t) {
      setError('No sign-off token in URL.')
      setStage('error')
      return
    }
    setToken(t)
    void loadByToken(t)
  }, [])

  async function loadByToken(t: string) {
    setStage('loading')
    setError(null)
    try {
      const { data, error: selErr } = await supabase
        .schema('v2')
        .from('prelim_profile')
        .select('id, company_overview, capabilities, past_performance, target_agencies, current_naics, recommended_naics, current_psc, recommended_psc, current_keywords, recommended_keywords, certifications, narrative_final, signed_at, signed_name')
        .eq('sign_off_token', t)
        .maybeSingle()

      if (selErr) throw new Error(`Could not load: ${selErr.message}`)
      if (!data) {
        throw new Error('This sign-off link is invalid or has been revoked. Please contact Sunstone.')
      }

      const row = data as PrelimProfile
      setPrelim(row)
      setCompanyOverview(row.company_overview || '')
      setCapabilities(arrayToLines(row.capabilities))
      setPastPerformance(arrayToLines(row.past_performance))
      setTargetAgencies(arrayToLines(row.target_agencies))
      setCurrentNaics(arrayToLines(row.current_naics))
      setRecommendedNaics(arrayToLines(row.recommended_naics))
      setCurrentPsc(arrayToLines(row.current_psc))
      setRecommendedPsc(arrayToLines(row.recommended_psc))
      setCurrentKeywords(arrayToLines(row.current_keywords))
      setRecommendedKeywords(arrayToLines(row.recommended_keywords))
      setCertifications(arrayToLines(row.certifications))
      setNarrativeFinal(row.narrative_final || '')

      if (row.signed_at) {
        setStage('signed')
        setTypedName(row.signed_name || '')
      } else {
        setStage('editing')
      }
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
      setStage('error')
    }
  }

  // -------------------------------------------------------------------------
  // SAVE EDITS (without signing)
  // -------------------------------------------------------------------------
  async function handleSave(): Promise<boolean> {
    if (!prelim || !token) return false
    setStage('saving')
    setError(null)
    try {
      const updates = {
        company_overview: companyOverview.trim() || null,
        capabilities: linesToArray(capabilities),
        past_performance: linesToArray(pastPerformance),
        target_agencies: linesToArray(targetAgencies),
        current_naics: linesToArray(currentNaics),
        recommended_naics: linesToArray(recommendedNaics),
        current_psc: linesToArray(currentPsc),
        recommended_psc: linesToArray(recommendedPsc),
        current_keywords: linesToArray(currentKeywords),
        recommended_keywords: linesToArray(recommendedKeywords),
        certifications: linesToArray(certifications),
        narrative_final: narrativeFinal.trim() || null,
      }

      const { error: updErr } = await supabase
        .schema('v2')
        .from('prelim_profile')
        .update(updates)
        .eq('sign_off_token', token)

      if (updErr) throw new Error(`Save failed: ${updErr.message}`)

      setSavedConfirm(true)
      setTimeout(() => setSavedConfirm(false), 2400)
      setStage('editing')
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed')
      setStage('editing')
      return false
    }
  }

  // -------------------------------------------------------------------------
  // SIGN - locks the profile, stamps signed_at + signed_name + audit info.
  // -------------------------------------------------------------------------
  async function handleSign() {
    if (!prelim || !token) return
    if (!typedName.trim()) {
      setError('Please type your name to sign off.')
      return
    }

    // Save the latest edits BEFORE signing so the signed state is what they see.
    const saved = await handleSave()
    if (!saved) return

    setStage('signing')
    setError(null)
    try {
      const { error: updErr } = await supabase
        .schema('v2')
        .from('prelim_profile')
        .update({
          signed_at: new Date().toISOString(),
          signed_name: typedName.trim(),
          signed_user_agent: navigator.userAgent,
          completed_at: new Date().toISOString(),
          status: 'signed',
          // signed_ip is best collected server-side; we leave null here.
        })
        .eq('sign_off_token', token)

      if (updErr) throw new Error(`Sign failed: ${updErr.message}`)

      setStage('signed')
    } catch (e: any) {
      setError(e?.message || 'Sign failed')
      setStage('editing')
    }
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  if (stage === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <p style={{ color: palette.textSecondary }}>Loading...</p>
        </div>
      </div>
    )
  }

  if (stage === 'error') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <div style={eyebrowStyle}>Sunstone Advisory Group</div>
          <h1 style={h1Style}>This link is no longer active.</h1>
          <p style={introStyle}>{error}</p>
          <p style={introStyle}>
            Please email <strong>zack@sunstoneag.com</strong> and we'll send you a fresh link.
          </p>
        </div>
      </div>
    )
  }

  // SIGNED state - read-only confirmation
  if (stage === 'signed' && prelim) {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <div style={eyebrowStyle}>Signed</div>
          <h1 style={h1Style}>Thanks, {(prelim.signed_name || typedName).split(' ')[0] || 'there'}.</h1>
          <p style={introStyle}>
            You signed off on this preliminary profile on {new Date(prelim.signed_at!).toLocaleString()}.
            We'll be in touch shortly to schedule the 30-minute Zoom intake.
          </p>

          <div style={{ background: palette.white, border: `1px solid ${palette.hairline}`, borderRadius: '12px', padding: '28px' }}>
            <ReadOnlyField label="Company overview" value={companyOverview} />
            <ReadOnlyField label="Capabilities" value={capabilities} multiline />
            <ReadOnlyField label="Past performance" value={pastPerformance} multiline />
            <ReadOnlyField label="Target agencies" value={targetAgencies} multiline />
            <ReadOnlyField label="Current NAICS" value={currentNaics} multiline />
            <ReadOnlyField label="Recommended NAICS" value={recommendedNaics} multiline />
            <ReadOnlyField label="Current PSC" value={currentPsc} multiline />
            <ReadOnlyField label="Recommended PSC" value={recommendedPsc} multiline />
            <ReadOnlyField label="Current keywords" value={currentKeywords} multiline />
            <ReadOnlyField label="Recommended keywords" value={recommendedKeywords} multiline />
            <ReadOnlyField label="Certifications" value={certifications} multiline />
            <ReadOnlyField label="Narrative" value={narrativeFinal} />
          </div>

          <p style={{ ...introStyle, marginTop: '24px', fontSize: '14px' }}>
            If something on this profile needs changing, email us at{' '}
            <strong>zack@sunstoneag.com</strong> and we'll re-open it.
          </p>
        </div>
      </div>
    )
  }

  // EDITING state
  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <div style={eyebrowStyle}>Sunstone Advisory Group</div>
        <h1 style={h1Style}>Sign off on your preliminary profile.</h1>
        <p style={introStyle}>
          This is what we put together about your business so far. Read it through, fix anything we got wrong,
          and sign at the bottom. Once you sign, we'll schedule the 30-minute Zoom intake and start building
          your free RECON report.
        </p>

        <Field label="Company overview" hint="A 2-3 sentence summary of your business. Edit freely.">
          <textarea
            value={companyOverview}
            onChange={(e) => setCompanyOverview(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Capabilities" hint="One per line. The things your company does well.">
          <textarea
            value={capabilities}
            onChange={(e) => setCapabilities(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Past performance" hint="One per line. Notable contracts or commercial work.">
          <textarea
            value={pastPerformance}
            onChange={(e) => setPastPerformance(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Target agencies" hint="One per line. Federal agencies you're pursuing or want to pursue.">
          <textarea
            value={targetAgencies}
            onChange={(e) => setTargetAgencies(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Current NAICS codes" hint="One per line. NAICS codes you're currently registered under in SAM.gov.">
          <textarea
            value={currentNaics}
            onChange={(e) => setCurrentNaics(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Recommended NAICS codes" hint="One per line. Additional codes we recommend you add. Edit if you disagree.">
          <textarea
            value={recommendedNaics}
            onChange={(e) => setRecommendedNaics(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Current PSC codes" hint="One per line. Product Service Codes you currently work under.">
          <textarea
            value={currentPsc}
            onChange={(e) => setCurrentPsc(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Recommended PSC codes" hint="One per line. Additional PSCs we recommend you add.">
          <textarea
            value={recommendedPsc}
            onChange={(e) => setRecommendedPsc(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Current keywords" hint="One per line. Capability keywords currently associated with your business.">
          <textarea
            value={currentKeywords}
            onChange={(e) => setCurrentKeywords(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Recommended keywords" hint="One per line. Additional keywords we recommend.">
          <textarea
            value={recommendedKeywords}
            onChange={(e) => setRecommendedKeywords(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Certifications" hint="One per line. 8(a), HUBZone, WOSB, SDVOSB, etc.">
          <textarea
            value={certifications}
            onChange={(e) => setCertifications(e.target.value)}
            style={textareaStyle}
          />
        </Field>

        <Field label="Narrative" hint="The longer story we'll tell about your company.">
          <textarea
            value={narrativeFinal}
            onChange={(e) => setNarrativeFinal(e.target.value)}
            style={{ ...textareaStyle, minHeight: '200px' }}
          />
        </Field>

        {error && (
          <div style={{ color: palette.danger, fontSize: '14px', marginBottom: '16px' }}>{error}</div>
        )}

        {/* SAVE BUTTON */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '32px' }}>
          <button
            onClick={handleSave}
            disabled={stage === 'saving' || stage === 'signing'}
            style={secondaryButtonStyle}
          >
            {stage === 'saving' ? 'Saving...' : 'Save Edits'}
          </button>
          {savedConfirm && (
            <span style={{ fontSize: '13px', color: palette.success }}>Saved.</span>
          )}
        </div>

        {/* SIGN-OFF BLOCK */}
        <div style={{ background: palette.white, border: `1.5px solid ${palette.amber}`, borderRadius: '12px', padding: '28px', marginTop: '12px' }}>
          <div style={eyebrowStyle}>Sign off</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: palette.espresso, margin: 0, marginBottom: '8px' }}>
            Type your name to confirm.
          </h2>
          <p style={{ fontSize: '14px', color: palette.textSecondary, lineHeight: 1.5, marginTop: 0, marginBottom: '20px' }}>
            By typing your name and clicking Sign, you confirm this profile accurately represents your
            company. We'll use it as the basis for your recon report and intake call.
          </p>

          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Your full name"
            style={inputStyle}
          />

          <button
            onClick={handleSign}
            disabled={!typedName.trim() || stage === 'saving' || stage === 'signing'}
            style={{
              ...primaryButtonStyle,
              marginTop: '20px',
              opacity: (!typedName.trim() || stage === 'saving' || stage === 'signing') ? 0.5 : 1,
              cursor: (!typedName.trim() || stage === 'saving' || stage === 'signing') ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (typedName.trim() && stage === 'editing') e.currentTarget.style.background = palette.amberHover
            }}
            onMouseLeave={(e) => {
              if (typedName.trim() && stage === 'editing') e.currentTarget.style.background = palette.amber
            }}
          >
            {stage === 'signing' ? 'Signing...' : 'Sign and Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// SMALL HELPERS
// =============================================================================

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={fieldGroupStyle}>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
      {hint && <span style={fieldHintStyle}>{hint}</span>}
    </div>
  )
}

function ReadOnlyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <span style={{
        display: 'block',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: palette.textTertiary,
        marginBottom: '6px',
      }}>{label}</span>
      <div style={{
        fontSize: '14px',
        color: palette.espresso,
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        lineHeight: 1.5,
      }}>
        {value || <span style={{ color: palette.textTertiary, fontStyle: 'italic' }}>-</span>}
      </div>
    </div>
  )
}

export default PrelimSignOffPage
