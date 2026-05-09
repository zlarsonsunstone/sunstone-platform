/**
 * PrelimReview - consultant-facing cleanup UI for an auto-generated prelim profile.
 *
 * Flow:
 *   1. A prospect submits PublicIntakeForm at /start.
 *   2. That writes to v2.public_intake_submission.
 *   3. The convert_intake_to_profile() RPC builds an initial v2.prelim_profile.
 *   4. THIS COMPONENT lets a consultant:
 *        - Read the raw submission alongside the auto-generated prelim
 *        - Edit every prelim field (company_overview, capabilities, past_performance,
 *          target_agencies, current_naics, recommended_naics, certifications, narrative_final)
 *        - Click "Approve & Send to Prospect"
 *   5. Approve mints sign_off_token (Dana gate - token NEVER auto-issued on submission),
 *      stamps approved_at + approved_by, surfaces the prospect-facing URL.
 *
 * URL: /prelim/review?submission_id=<uuid>   (mounted inside the auth-gated <App />)
 *
 * Auth: requires a logged-in Supabase session. RLS on v2.prelim_profile and
 * v2.public_intake_submission must permit consultant-role reads/updates.
 *
 * Style: matches PublicIntakeForm palette (cream / espresso / amber).
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { generateProspectViewToken } from '@/lib/claude'

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

interface PublicIntakeSubmission {
  id: string
  full_name: string
  email: string
  phone: string | null
  industry_sector: string | null
  referred_by: string | null
  catalyst: string | null
  company_name: string | null
  company_website: string | null
  year_founded: number | null
  headcount: string | null
  revenue_range: string | null
  capabilities: string | null
  customers: string | null
  geographic_footprint: string[] | null
  differentiator: string | null
  linkedin_url: string | null
  federal_path: string | null
  federal_answers: Record<string, any> | null
  submitted_at: string
}

interface PrelimProfile {
  id: string
  strategic_profile_id: string | null
  tenant_id: string | null
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
  narrative_draft: string | null
  narrative_final: string | null
  status: string | null
  sent_to_prospect_at: string | null
  completed_at: string | null
  sign_off_token: string | null
  sign_off_token_expires_at: string | null
  approved_at: string | null
  approved_by: string | null
  signed_at: string | null
  signed_name: string | null
  created_at: string
  updated_at: string | null
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
  maxWidth: '1280px',
  margin: '0 auto',
  padding: '40px 32px',
}

const headerStyle: CSSProperties = {
  marginBottom: '32px',
  paddingBottom: '20px',
  borderBottom: `1px solid ${palette.hairline}`,
}

const eyebrowStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
  marginBottom: '8px',
}

const h1Style: CSSProperties = {
  fontSize: '32px',
  fontWeight: 700,
  margin: 0,
  marginBottom: '8px',
  color: palette.espresso,
}

const subtitleStyle: CSSProperties = {
  fontSize: '15px',
  color: palette.textSecondary,
  margin: 0,
}

const twoColumnStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '380px 1fr',
  gap: '32px',
  alignItems: 'flex-start',
}

const cardStyle: CSSProperties = {
  background: palette.white,
  border: `1px solid ${palette.hairline}`,
  borderRadius: '12px',
  padding: '24px',
}

const sectionLabelStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
  marginBottom: '6px',
}

const fieldGroupStyle: CSSProperties = {
  marginBottom: '20px',
}

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: palette.espresso,
  marginBottom: '8px',
}

const fieldHintStyle: CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: palette.textTertiary,
  marginTop: '4px',
  fontStyle: 'italic',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '14px',
  fontFamily: 'inherit',
  border: `1.5px solid ${palette.hairline}`,
  borderRadius: '6px',
  background: palette.white,
  color: palette.espresso,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: '110px',
  resize: 'vertical',
  lineHeight: 1.5,
}

const primaryButtonStyle: CSSProperties = {
  padding: '12px 24px',
  fontSize: '15px',
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
  padding: '12px 24px',
  fontSize: '15px',
  fontFamily: 'inherit',
  background: 'transparent',
  color: palette.textSecondary,
  border: `1.5px solid ${palette.hairline}`,
  borderRadius: '8px',
  cursor: 'pointer',
}

const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  color: palette.danger,
  borderColor: palette.danger,
}

const submissionFieldStyle: CSSProperties = {
  fontSize: '13px',
  marginBottom: '12px',
  lineHeight: 1.5,
}

const submissionLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
  marginBottom: '2px',
}

const submissionValueStyle: CSSProperties = {
  display: 'block',
  color: palette.espresso,
  whiteSpace: 'pre-wrap',
}

const empty = { color: palette.textTertiary, fontStyle: 'italic' as const }

// =============================================================================
// HELPERS
// =============================================================================

/** Convert a multi-line string -> string[] (trim, drop empties). */
function linesToArray(s: string): string[] {
  return s.split('\n').map(l => l.trim()).filter(Boolean)
}

/** Convert string[] -> multi-line string for textarea editing. */
function arrayToLines(a: string[] | null | undefined): string {
  return (a || []).join('\n')
}

// =============================================================================
// COMPONENT
// =============================================================================

interface PrelimReviewProps {
  /** Submission UUID. If not provided, reads from ?submission_id= URL param. */
  submissionId?: string
  /** Optional callback when approve completes (for navigation/refresh). */
  onApproved?: (token: string, prospectUrl: string) => void
}

type Stage = 'loading' | 'ready' | 'saving' | 'approving' | 'approved' | 'error'

export function PrelimReview({ submissionId: propSubmissionId, onApproved }: PrelimReviewProps) {
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState<string | null>(null)
  const [submission, setSubmission] = useState<PublicIntakeSubmission | null>(null)
  const [prelim, setPrelim] = useState<PrelimProfile | null>(null)

  // Editable form state
  const [companyOverview, setCompanyOverview] = useState('')
  const [capabilities, setCapabilities] = useState('')        // newline-delimited in textarea
  const [pastPerformance, setPastPerformance] = useState('')
  const [targetAgencies, setTargetAgencies] = useState('')
  const [currentNaics, setCurrentNaics] = useState('')
  const [recommendedNaics, setRecommendedNaics] = useState('')
  const [currentPsc, setCurrentPsc] = useState('')
  const [recommendedPsc, setRecommendedPsc] = useState('')
  const [currentKeywords, setCurrentKeywords] = useState('')
  const [recommendedKeywords, setRecommendedKeywords] = useState('')
  const [certifications, setCertifications] = useState('')
  const [narrativeDraft, setNarrativeDraft] = useState('')   // read-only context, what convert_intake produced
  const [narrativeFinal, setNarrativeFinal] = useState('')

  // Approve outcome
  const [approvedToken, setApprovedToken] = useState<string | null>(null)
  const [copyConfirm, setCopyConfirm] = useState(false)

  // Resolve submission_id from prop or URL param
  const submissionId = propSubmissionId || (() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('submission_id')
  })()

  // -------------------------------------------------------------------------
  // INITIAL LOAD
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!submissionId) {
      setError('No submission_id provided. Open this page with ?submission_id=<uuid>.')
      setStage('error')
      return
    }
    void loadSubmissionAndPrelim(submissionId)
  }, [submissionId])

  async function loadSubmissionAndPrelim(id: string) {
    setStage('loading')
    setError(null)

    try {
      // 1. Load the public intake submission.
      const { data: subRow, error: subErr } = await supabase
        .schema('v2')
        .from('public_intake_submission')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (subErr) throw new Error(`Submission fetch failed: ${subErr.message}`)
      if (!subRow) throw new Error('No submission found with that id.')
      setSubmission(subRow as PublicIntakeSubmission)

      // 2. Look for existing prelim_profile via the strategic_profile chain:
      //    submission.converted_strategic_profile_id -> prelim_profile.strategic_profile_id
      const strategicProfileId: string | null = (subRow as any).converted_strategic_profile_id || null

      let prelimRow: PrelimProfile | null = null

      if (strategicProfileId) {
        const { data: prelimRows, error: prelimErr } = await supabase
          .schema('v2')
          .from('prelim_profile')
          .select('*')
          .eq('strategic_profile_id', strategicProfileId)
          .order('created_at', { ascending: false })
          .limit(1)

        if (prelimErr) throw new Error(`Prelim fetch failed: ${prelimErr.message}`)
        prelimRow = (prelimRows && prelimRows[0]) || null
      }

      // 3. If no prelim exists yet, run the convert RPC to bootstrap one.
      if (!prelimRow) {
        // Get the logged-in consultant for the reviewer audit field.
        const { data: { user } } = await supabase.auth.getUser()

        // Public intake submissions don't carry a tenant_id, so we route them
        // into a default 'sunstone' tenant per the project decision. Adjust
        // here later if multi-tenant prospect routing is added.
        const { data: rpcResult, error: rpcErr } = await supabase
          .schema('v2')
          .rpc('convert_intake_to_profile', {
            p_submission_id: id,
            p_tenant_id: 'sunstone',
            p_reviewer_id: user?.id || null,
          })

        if (rpcErr) throw new Error(`convert_intake_to_profile RPC failed: ${rpcErr.message}`)

        // RPC may return the new id (uuid) OR the whole row. Handle both.
        let newPrelimId: string | null = null
        if (typeof rpcResult === 'string') {
          newPrelimId = rpcResult
        } else if (rpcResult && typeof rpcResult === 'object') {
          newPrelimId = (rpcResult as any).id || null
        }

        if (!newPrelimId) {
          throw new Error('convert_intake_to_profile returned an unexpected shape; could not find new prelim id.')
        }

        const { data: freshPrelim, error: freshErr } = await supabase
          .schema('v2')
          .from('prelim_profile')
          .select('*')
          .eq('id', newPrelimId)
          .maybeSingle()

        if (freshErr) throw new Error(`Fresh prelim fetch failed: ${freshErr.message}`)
        prelimRow = freshPrelim as PrelimProfile
      }

      if (!prelimRow) throw new Error('Could not load or create a prelim profile.')

      setPrelim(prelimRow)
      // Hydrate editable state
      setCompanyOverview(prelimRow.company_overview || '')
      setCapabilities(arrayToLines(prelimRow.capabilities))
      setPastPerformance(arrayToLines(prelimRow.past_performance))
      setTargetAgencies(arrayToLines(prelimRow.target_agencies))
      setCurrentNaics(arrayToLines(prelimRow.current_naics))
      setRecommendedNaics(arrayToLines(prelimRow.recommended_naics))
      setCurrentPsc(arrayToLines(prelimRow.current_psc))
      setRecommendedPsc(arrayToLines(prelimRow.recommended_psc))
      setCurrentKeywords(arrayToLines(prelimRow.current_keywords))
      setRecommendedKeywords(arrayToLines(prelimRow.recommended_keywords))
      setCertifications(arrayToLines(prelimRow.certifications))
      setNarrativeDraft(prelimRow.narrative_draft || '')
      // Default narrative_final from draft on first review if final is empty.
      // This gives the consultant a starting point to edit, instead of a blank.
      setNarrativeFinal(prelimRow.narrative_final || prelimRow.narrative_draft || '')

      // If already approved, surface the existing token so consultant can re-copy.
      if (prelimRow.sign_off_token) {
        setApprovedToken(prelimRow.sign_off_token)
      }

      setStage('ready')
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
      setStage('error')
    }
  }

  // -------------------------------------------------------------------------
  // SAVE (without approving)
  // -------------------------------------------------------------------------
  async function handleSave(): Promise<boolean> {
    if (!prelim) return false
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
        .eq('id', prelim.id)

      if (updErr) throw new Error(`Save failed: ${updErr.message}`)

      setStage('ready')
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed')
      setStage('ready')
      return false
    }
  }

  // -------------------------------------------------------------------------
  // APPROVE & SEND - Dana gate. This is where the prospect-facing token is
  // minted. NEVER happens automatically on submission.
  // -------------------------------------------------------------------------
  async function handleApprove() {
    if (!prelim) return

    // Save current edits first so they're locked in BEFORE the prospect can see.
    const saved = await handleSave()
    if (!saved) return

    setStage('approving')
    setError(null)

    try {
      const token = generateProspectViewToken()
      const { data: { user } } = await supabase.auth.getUser()
      const now = new Date()
      // Token expires 30 days from now. If sign_off_token_expires_at is enforced
      // by RLS or app logic elsewhere, this keeps the link alive long enough for
      // the prospect to act, short enough that abandoned reviews self-close.
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      const { error: updErr } = await supabase
        .schema('v2')
        .from('prelim_profile')
        .update({
          sign_off_token: token,
          sign_off_token_expires_at: expiresAt.toISOString(),
          approved_at: now.toISOString(),
          approved_by: user?.id || null,
          sent_to_prospect_at: now.toISOString(),
          status: 'sent_to_prospect',
        })
        .eq('id', prelim.id)

      if (updErr) throw new Error(`Approve failed: ${updErr.message}`)

      setApprovedToken(token)
      setStage('approved')

      const prospectUrl = `${window.location.origin}/prelim/${token}`
      if (onApproved) onApproved(token, prospectUrl)
    } catch (e: any) {
      setError(e?.message || 'Approve failed')
      setStage('ready')
    }
  }

  // -------------------------------------------------------------------------
  // REVOKE - if a token was issued in error (Dana incident lesson).
  // Clears the token. Prospect-facing link stops working immediately.
  // -------------------------------------------------------------------------
  async function handleRevoke() {
    if (!prelim) return
    if (!confirm('Revoke this prospect link? The /prelim/{token} URL will stop working immediately.')) return

    setStage('saving')
    setError(null)

    try {
      const { error: updErr } = await supabase
        .schema('v2')
        .from('prelim_profile')
        .update({
          sign_off_token: null,
          sign_off_token_expires_at: null,
          approved_at: null,
          approved_by: null,
          sent_to_prospect_at: null,
          status: 'draft',
        })
        .eq('id', prelim.id)

      if (updErr) throw new Error(`Revoke failed: ${updErr.message}`)

      setApprovedToken(null)
      setStage('ready')
    } catch (e: any) {
      setError(e?.message || 'Revoke failed')
      setStage('ready')
    }
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  if (stage === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <p style={{ color: palette.textSecondary }}>Loading submission...</p>
        </div>
      </div>
    )
  }

  if (stage === 'error') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <h1 style={h1Style}>Error</h1>
          <p style={{ color: palette.danger }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!submission || !prelim) {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <p style={{ color: palette.textSecondary }}>No data.</p>
        </div>
      </div>
    )
  }

  const isAlreadySigned = !!prelim.signed_at
  const prospectUrl = approvedToken ? `${window.location.origin}/prelim/${approvedToken}` : null

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        {/* HEADER */}
        <div style={headerStyle}>
          <div style={eyebrowStyle}>Prelim Review</div>
          <h1 style={h1Style}>
            {submission.company_name || submission.full_name}
          </h1>
          <p style={subtitleStyle}>
            {submission.full_name} &middot; {submission.email}
            {submission.phone ? `  -  ${submission.phone}` : ''}
            {'  -  submitted '}
            {new Date(submission.submitted_at).toLocaleString()}
          </p>
          {isAlreadySigned && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#EAF4ED', border: `1px solid ${palette.success}`, borderRadius: '6px', fontSize: '13px', color: palette.success }}>
              <strong>Signed by prospect</strong> on {new Date(prelim.signed_at!).toLocaleString()}
              {prelim.signed_name ? ` (signed name: ${prelim.signed_name})` : ''}
            </div>
          )}
        </div>

        {/* TWO COLUMN: SUBMISSION (left) | PRELIM EDITOR (right) */}
        <div style={twoColumnStyle}>

          {/* LEFT: read-only submission */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>What they told us</div>
            <h3 style={{ fontSize: '16px', margin: 0, marginBottom: '16px', color: palette.espresso }}>
              Public intake form
            </h3>

            <SubmissionField label="Industry sector" value={submission.industry_sector} />
            <SubmissionField label="Company website" value={submission.company_website} link />
            <SubmissionField label="Year founded" value={submission.year_founded?.toString() || null} />
            <SubmissionField label="Headcount" value={submission.headcount} />
            <SubmissionField label="Revenue range" value={submission.revenue_range} />
            <SubmissionField label="Geographic footprint" value={(submission.geographic_footprint || []).join(', ') || null} />
            <SubmissionField label="Catalyst" value={submission.catalyst} />
            <SubmissionField label="Capabilities (their words)" value={submission.capabilities} />
            <SubmissionField label="Customers" value={submission.customers} />
            <SubmissionField label="Differentiator" value={submission.differentiator} />
            <SubmissionField label="LinkedIn" value={submission.linkedin_url} link />
            <SubmissionField label="Referred by" value={submission.referred_by} />

            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${palette.hairline}` }}>
              <div style={sectionLabelStyle}>Federal posture</div>
              <SubmissionField label="Path" value={submission.federal_path} />
              {submission.federal_answers && Object.keys(submission.federal_answers).length > 0 && (
                <div style={submissionFieldStyle}>
                  <span style={submissionLabelStyle}>Federal answers</span>
                  <pre style={{
                    fontSize: '12px',
                    background: palette.cream,
                    padding: '10px',
                    borderRadius: '4px',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    color: palette.espresso,
                  }}>
                    {JSON.stringify(submission.federal_answers, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: editable prelim profile */}
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Prelim profile - editable</div>
            <h3 style={{ fontSize: '16px', margin: 0, marginBottom: '4px', color: palette.espresso }}>
              Clean this up before sending to the prospect
            </h3>
            <p style={{ fontSize: '13px', color: palette.textSecondary, marginTop: 0, marginBottom: '20px' }}>
              The prospect will see (and be able to edit) everything below. They will <strong>not</strong> see what's on the left.
            </p>

            <Field label="Company overview" hint="2-3 sentence narrative the prospect signs off on.">
              <textarea
                value={companyOverview}
                onChange={(e) => setCompanyOverview(e.target.value)}
                style={textareaStyle}
              />
            </Field>

            <Field label="Capabilities" hint="One per line. These are the capabilities we'll tell the prospect we see.">
              <textarea
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
                style={textareaStyle}
                placeholder={'e.g.\nIndustrial cleaning services\nHazmat remediation\n24/7 emergency response'}
              />
            </Field>

            <Field label="Past performance" hint="One per line. Notable contracts or commercial work worth surfacing.">
              <textarea
                value={pastPerformance}
                onChange={(e) => setPastPerformance(e.target.value)}
                style={textareaStyle}
              />
            </Field>

            <Field label="Target agencies" hint="One per line. Agencies the prospect is or should be pursuing.">
              <textarea
                value={targetAgencies}
                onChange={(e) => setTargetAgencies(e.target.value)}
                style={textareaStyle}
                placeholder={'e.g.\nDoD - Army\nVA\nGSA'}
              />
            </Field>

            <Field label="Current NAICS" hint="One per line. NAICS codes the prospect is currently registered under.">
              <textarea
                value={currentNaics}
                onChange={(e) => setCurrentNaics(e.target.value)}
                style={textareaStyle}
                placeholder={'e.g.\n562910\n541330'}
              />
            </Field>

            <Field label="Recommended NAICS" hint="One per line. Additional NAICS we recommend they add.">
              <textarea
                value={recommendedNaics}
                onChange={(e) => setRecommendedNaics(e.target.value)}
                style={textareaStyle}
              />
            </Field>

            <Field label="Current PSC codes" hint="One per line. Product Service Codes the prospect already operates under.">
              <textarea
                value={currentPsc}
                onChange={(e) => setCurrentPsc(e.target.value)}
                style={textareaStyle}
                placeholder={'e.g.\nR425\nR499'}
              />
            </Field>

            <Field label="Recommended PSC codes" hint="One per line. Additional PSCs we recommend.">
              <textarea
                value={recommendedPsc}
                onChange={(e) => setRecommendedPsc(e.target.value)}
                style={textareaStyle}
              />
            </Field>

            <Field label="Current keywords" hint="One per line. Search keywords / capability tags currently used.">
              <textarea
                value={currentKeywords}
                onChange={(e) => setCurrentKeywords(e.target.value)}
                style={textareaStyle}
              />
            </Field>

            <Field label="Recommended keywords" hint="One per line. Keywords we recommend adding to capture more opportunities.">
              <textarea
                value={recommendedKeywords}
                onChange={(e) => setRecommendedKeywords(e.target.value)}
                style={textareaStyle}
              />
            </Field>

            <Field label="Certifications" hint="One per line. Small business / socioeconomic certifications.">
              <textarea
                value={certifications}
                onChange={(e) => setCertifications(e.target.value)}
                style={textareaStyle}
                placeholder={'e.g.\n8(a)\nSDVOSB'}
              />
            </Field>

            {narrativeDraft && (
              <Field label="Narrative draft (auto-generated)" hint="Read-only. This is what convert_intake_to_profile produced. Use as a starting point for the final narrative below.">
                <div style={{
                  ...textareaStyle,
                  minHeight: 'unset',
                  background: palette.cream,
                  color: palette.textSecondary,
                  whiteSpace: 'pre-wrap',
                  cursor: 'default',
                  fontStyle: 'italic',
                }}>
                  {narrativeDraft}
                </div>
              </Field>
            )}

            <Field label="Narrative (final)" hint="The longer-form story we tell. Used in the recon brief.">
              <textarea
                value={narrativeFinal}
                onChange={(e) => setNarrativeFinal(e.target.value)}
                style={{ ...textareaStyle, minHeight: '200px' }}
              />
            </Field>

            {error && (
              <div style={{ color: palette.danger, fontSize: '13px', marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {/* ACTIONS */}
            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: `1px solid ${palette.hairline}`, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              {!approvedToken && (
                <>
                  <button
                    onClick={handleSave}
                    disabled={stage === 'saving' || stage === 'approving'}
                    style={secondaryButtonStyle}
                  >
                    {stage === 'saving' ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={stage === 'saving' || stage === 'approving'}
                    style={primaryButtonStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.background = palette.amberHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = palette.amber)}
                  >
                    {stage === 'approving' ? 'Approving...' : 'Approve & Send to Prospect'}
                  </button>
                  <span style={{ fontSize: '12px', color: palette.textTertiary, marginLeft: 'auto' }}>
                    No prospect link exists yet.
                  </span>
                </>
              )}

              {approvedToken && (
                <>
                  <button
                    onClick={handleSave}
                    disabled={stage === 'saving'}
                    style={secondaryButtonStyle}
                  >
                    {stage === 'saving' ? 'Saving...' : 'Save Edits'}
                  </button>
                  <button
                    onClick={handleRevoke}
                    disabled={stage === 'saving' || isAlreadySigned}
                    style={dangerButtonStyle}
                    title={isAlreadySigned ? 'Already signed - cannot revoke' : 'Invalidate the prospect-facing link'}
                  >
                    Revoke Link
                  </button>
                </>
              )}
            </div>

            {/* APPROVED - show prospect-facing URL */}
            {approvedToken && prospectUrl && (
              <div style={{ marginTop: '20px', padding: '16px 18px', background: '#FFF8E8', border: `1.5px solid ${palette.amber}`, borderRadius: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '8px' }}>
                  Prospect-facing sign-off URL
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '8px 10px',
                    background: palette.white,
                    border: `1px solid ${palette.hairline}`,
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                    color: palette.espresso,
                    overflow: 'auto',
                    whiteSpace: 'nowrap',
                  }}>
                    {prospectUrl}
                  </code>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(prospectUrl)
                        setCopyConfirm(true)
                        setTimeout(() => setCopyConfirm(false), 1800)
                      } catch {
                        // ignore - older browsers
                      }
                    }}
                    style={{ ...secondaryButtonStyle, padding: '8px 14px', fontSize: '13px' }}
                  >
                    {copyConfirm ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: palette.textSecondary, marginTop: '10px', lineHeight: 1.5 }}>
                  Paste this into your email to {submission.full_name}. The prospect can edit any field
                  and sign off; their changes will save back to this profile.
                </div>
              </div>
            )}
          </div>
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

function SubmissionField({ label, value, link }: { label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div style={submissionFieldStyle}>
      <span style={submissionLabelStyle}>{label}</span>
      {value ? (
        link ? (
          <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer"
            style={{ ...submissionValueStyle, color: palette.amber, textDecoration: 'underline' }}>
            {value}
          </a>
        ) : (
          <span style={submissionValueStyle}>{value}</span>
        )
      ) : (
        <span style={{ ...submissionValueStyle, ...empty }}>-</span>
      )}
    </div>
  )
}

export default PrelimReview
