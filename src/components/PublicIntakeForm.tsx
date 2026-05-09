/**
 * PublicIntakeForm - the public-facing /start page (v2)
 *
 * Typeform-style intake. Replaces 5-10 min discovery calls.
 *
 * Welcome page lets prospect choose their time investment:
 *   - 2 min Quick Look (~6 Q's)  -> minimum viable profile
 *   - 5 min Standard (~15 Q's)   -> rich prelim profile
 *   - 10 min Deep (~30 Q's)      -> full intake
 *
 * The longer they spend, the richer the recon report they get.
 *
 * On submit: writes to v2.public_intake_submission via shared supabase client.
 * Sends notification to Zack via Netlify function.
 *
 * Saves progress to localStorage on every step. Refresh recovers.
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

const LOCAL_STORAGE_KEY = 'sunstone_public_intake_v2'

// =============================================================================
// TYPES
// =============================================================================

type Section = 'welcome' | 'questions' | 'submitting' | 'submitted'
type TimeTier = 'quick' | 'standard' | 'deep'
type FederalPath = 'none' | 'some' | 'sub' | 'limited_prime' | 'established_prime' | ''

interface FormData {
  // contact
  full_name: string
  email: string
  phone: string
  // about you
  industry_sector: string
  referred_by: string
  catalyst: string
  // commercial
  company_name: string
  company_website: string
  year_founded: string
  headcount: string
  revenue_range: string
  capabilities: string
  customers: string
  geographic_footprint: string[]
  differentiator: string
  linkedin_url: string
  // federal
  federal_path: FederalPath
  federal_answers: Record<string, any>
}

const INITIAL_FORM: FormData = {
  full_name: '', email: '', phone: '',
  industry_sector: '', referred_by: '', catalyst: '',
  company_name: '', company_website: '', year_founded: '',
  headcount: '', revenue_range: '', capabilities: '',
  customers: '', geographic_footprint: [], differentiator: '',
  linkedin_url: '', federal_path: '', federal_answers: {},
}

// =============================================================================
// QUESTION DEFINITIONS - tagged by time tier
// =============================================================================

interface Question {
  id: string
  field: string
  label: string
  hint?: string
  type: 'text' | 'textarea' | 'email' | 'phone' | 'url' | 'number' | 'select' | 'multiselect' | 'radio'
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  // tier inclusion: which tiers this question appears in
  tiers: TimeTier[]
  federalPath?: FederalPath[]  // adaptive Section 2 questions
}

const ALL_QUESTIONS: Question[] = [
  // CORE CONTACT - all tiers
  { id: 'C1', field: 'full_name', label: 'What\'s your name?', type: 'text', required: true,
    tiers: ['quick', 'standard', 'deep'], placeholder: 'Jane Smith' },
  { id: 'C2', field: 'email', label: 'What\'s your email?',
    hint: 'For your recon report and follow-up. Never sold, never shared.',
    type: 'email', required: true, tiers: ['quick', 'standard', 'deep'], placeholder: 'jane@yourcompany.com' },
  { id: 'C3', field: 'phone', label: 'And your phone?',
    hint: 'Optional. We only call if you say yes to a follow-up.',
    type: 'phone', tiers: ['standard', 'deep'], placeholder: '(555) 123-4567' },

  // CORE COMPANY - all tiers
  { id: 'CO1', field: 'company_name', label: 'Company name?', type: 'text', required: true,
    tiers: ['quick', 'standard', 'deep'] },
  { id: 'CO2', field: 'industry_sector', label: 'What industry sector?',
    hint: 'Use your own words. Doesn\'t need to be a NAICS code.',
    type: 'text', required: true, tiers: ['quick', 'standard', 'deep'],
    placeholder: 'e.g., Industrial cleaning, Cybersecurity, Medical devices' },

  // STANDARD+ COMPANY
  { id: 'CO3', field: 'company_website', label: 'Company website?',
    hint: 'We use this to round out the public picture.',
    type: 'url', required: true, tiers: ['standard', 'deep'], placeholder: 'https://yourcompany.com' },
  { id: 'CO4', field: 'year_founded', label: 'What year did you start the business?',
    type: 'number', required: true, tiers: ['standard', 'deep'], placeholder: '2018' },
  { id: 'CO5', field: 'headcount', label: 'How many people work there today?',
    type: 'select', required: true, tiers: ['standard', 'deep'],
    options: [
      { value: '1', label: 'Just me' },
      { value: '2-5', label: '2-5' },
      { value: '6-15', label: '6-15' },
      { value: '16-50', label: '16-50' },
      { value: '51-200', label: '51-200' },
      { value: '201-500', label: '201-500' },
      { value: '500+', label: '500+' },
    ] },
  { id: 'CO6', field: 'revenue_range', label: 'Approximate annual revenue?',
    hint: 'Ballpark is fine. Helps us scope right.',
    type: 'select', required: true, tiers: ['standard', 'deep'],
    options: [
      { value: 'under_500k', label: 'Under $500k' },
      { value: '500k_2m', label: '$500k - $2M' },
      { value: '2m_10m', label: '$2M - $10M' },
      { value: '10m_50m', label: '$10M - $50M' },
      { value: '50m_plus', label: '$50M+' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ] },
  { id: 'CO7', field: 'capabilities', label: 'What are the three things your company does best?',
    hint: 'Use the words your customers would use, not industry jargon.',
    type: 'textarea', required: true, tiers: ['standard', 'deep'],
    placeholder: '1. ...\n2. ...\n3. ...' },

  // DEEP COMPANY
  { id: 'CO8', field: 'customers', label: 'Who are your three most important customer types?',
    hint: 'Companies, types of buyers, industries - whatever fits.',
    type: 'textarea', tiers: ['deep'] },
  { id: 'CO9', field: 'geographic_footprint', label: 'Where do you operate?',
    hint: 'Check all that apply.',
    type: 'multiselect', tiers: ['deep'],
    options: [
      { value: 'local', label: 'Local' },
      { value: 'regional', label: 'Regional' },
      { value: 'national', label: 'National' },
      { value: 'international', label: 'International' },
    ] },
  { id: 'CO10', field: 'differentiator', label: 'What can you do that your competitors can\'t?',
    hint: 'Or what you do meaningfully better than they do. Be specific.',
    type: 'textarea', tiers: ['deep'] },
  { id: 'CO11', field: 'linkedin_url', label: 'Company LinkedIn URL?',
    hint: 'Optional but helpful.',
    type: 'url', tiers: ['deep'], placeholder: 'https://linkedin.com/company/...' },

  // CATALYST + REFERRAL
  { id: 'CAT', field: 'catalyst', label: 'What\'s prompting this conversation?',
    hint: 'What happened in your business that made federal contracting worth a real conversation?',
    type: 'textarea', tiers: ['quick', 'standard', 'deep'] },
  { id: 'REF', field: 'referred_by', label: 'Who pointed you to Sunstone?',
    hint: 'A name, company, podcast, anything. Or skip if you came on your own.',
    type: 'text', tiers: ['standard', 'deep'] },

  // FEDERAL POSTURE GATE - all tiers
  { id: 'FP', field: 'federal_path', label: 'Federal contracting experience?',
    hint: 'Pick the closest fit.',
    type: 'radio', required: true, tiers: ['quick', 'standard', 'deep'],
    options: [
      { value: 'none', label: 'None - never bid federal' },
      { value: 'some', label: 'Some - bid but not won, or won state/local that\'s federally funded' },
      { value: 'sub', label: 'Sub experience - worked under primes but never as a prime' },
      { value: 'limited_prime', label: 'Limited prime - one or two federal awards' },
      { value: 'established_prime', label: 'Established prime - real part of business' },
    ] },

  // STANDARD federal - lighter
  { id: 'FS1', field: 'federal_answers.sam_status', label: 'SAM.gov registration?',
    type: 'radio', tiers: ['standard', 'deep'],
    federalPath: ['none', 'some', 'sub', 'limited_prime', 'established_prime'],
    options: [
      { value: 'active', label: 'Yes - active' },
      { value: 'expired', label: 'Yes - expired' },
      { value: 'no', label: 'No' },
      { value: 'dont_know', label: 'Don\'t know' },
    ] },
  { id: 'FS2', field: 'federal_answers.certifications', label: 'Small business / socioeconomic certifications?',
    hint: 'Check all that apply.',
    type: 'multiselect', tiers: ['standard', 'deep'],
    federalPath: ['none', 'some', 'sub', 'limited_prime', 'established_prime'],
    options: [
      { value: '8a', label: '8(a)' },
      { value: 'hubzone', label: 'HUBZone' },
      { value: 'wosb', label: 'WOSB' },
      { value: 'edwosb', label: 'EDWOSB' },
      { value: 'vosb', label: 'VOSB' },
      { value: 'sdvosb', label: 'SDVOSB' },
      { value: 'none', label: 'None' },
      { value: 'dont_know', label: 'Don\'t know what these are' },
    ] },

  // DEEP federal - path-specific probes

  // PATH: none
  { id: 'FD_N1', field: 'federal_answers.budget', label: 'Budget for federal market entry next 6-12 months?',
    type: 'radio', tiers: ['deep'], federalPath: ['none'],
    options: [
      { value: 'under_10k', label: 'Under $10k' },
      { value: '10k_25k', label: '$10k - $25k' },
      { value: '25k_50k', label: '$25k - $50k' },
      { value: '50k_100k', label: '$50k - $100k' },
      { value: '100k_plus', label: '$100k+' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ] },
  { id: 'FD_N2', field: 'federal_answers.imagined_first_win', label: 'Two years from now, you\'ve won your first federal contract. Describe it briefly.',
    hint: 'Who\'s the customer? What did they buy? Skip if not yet sure.',
    type: 'textarea', tiers: ['deep'], federalPath: ['none'] },
  { id: 'FD_N3', field: 'federal_answers.cycle_reaction', label: 'Reaction to "18-36 month sales cycle for new federal entrants"?',
    type: 'radio', tiers: ['deep'], federalPath: ['none'],
    options: [
      { value: 'fine', label: 'That\'s fine' },
      { value: 'longer', label: 'Longer than I hoped' },
      { value: 'problem', label: 'That\'s a problem' },
      { value: 'disbelief', label: 'I don\'t believe it' },
    ] },

  // PATH: some
  { id: 'FD_S1', field: 'federal_answers.proposals_recent', label: 'Federal proposals submitted in the last two years?',
    hint: 'Wins, losses, no-bids - all welcome.',
    type: 'textarea', tiers: ['deep'], federalPath: ['some'] },
  { id: 'FD_S2', field: 'federal_answers.why_no_win', label: 'Why didn\'t you win? Your honest read.',
    type: 'textarea', tiers: ['deep'], federalPath: ['some'] },
  { id: 'FD_S3', field: 'federal_answers.blocker', label: 'What\'s stopping you from going harder at federal?',
    type: 'radio', tiers: ['deep'], federalPath: ['some'],
    options: [
      { value: 'capital', label: 'Capital' },
      { value: 'knowledge', label: 'Knowledge' },
      { value: 'past_performance', label: 'Past performance gap' },
      { value: 'time', label: 'Time' },
      { value: 'bandwidth', label: 'Bandwidth' },
      { value: 'other', label: 'Other' },
    ] },

  // PATH: sub
  { id: 'FD_C1', field: 'federal_answers.primes_subbed_under', label: 'Primes you\'ve subbed under in the last 3 years.',
    type: 'textarea', tiers: ['deep'], federalPath: ['sub'] },
  { id: 'FD_C2', field: 'federal_answers.why_not_prime', label: 'Why haven\'t you become a prime yet?',
    type: 'textarea', tiers: ['deep'], federalPath: ['sub'] },
  { id: 'FD_C3', field: 'federal_answers.ceiling', label: 'What\'s the ceiling holding you back?',
    type: 'radio', tiers: ['deep'], federalPath: ['sub'],
    options: [
      { value: 'past_performance', label: 'Past performance' },
      { value: 'bonding', label: 'Bonding' },
      { value: 'working_capital', label: 'Working capital' },
      { value: 'capability', label: 'Capability' },
      { value: 'relationships', label: 'Relationships' },
      { value: 'other', label: 'Other' },
    ] },

  // PATH: limited_prime
  { id: 'FD_L1', field: 'federal_answers.contracts_held', label: 'Contracts currently held + agencies?',
    type: 'textarea', tiers: ['deep'], federalPath: ['limited_prime'] },
  { id: 'FD_L2', field: 'federal_answers.largest_contract', label: 'Largest contract value ever held?',
    type: 'select', tiers: ['deep'], federalPath: ['limited_prime'],
    options: [
      { value: 'under_100k', label: 'Under $100k' },
      { value: '100k_500k', label: '$100k - $500k' },
      { value: '500k_2m', label: '$500k - $2M' },
      { value: '2m_10m', label: '$2M - $10M' },
      { value: '10m_plus', label: '$10M+' },
    ] },
  { id: 'FD_L3', field: 'federal_answers.next_capability_or_contract', label: 'What capability or contract do you want next?',
    type: 'textarea', tiers: ['deep'], federalPath: ['limited_prime'] },

  // PATH: established_prime
  { id: 'FD_E1', field: 'federal_answers.federal_revenue_range', label: 'Annual federal revenue range?',
    type: 'select', tiers: ['deep'], federalPath: ['established_prime'],
    options: [
      { value: 'under_2m', label: 'Under $2M' },
      { value: '2m_10m', label: '$2M - $10M' },
      { value: '10m_25m', label: '$10M - $25M' },
      { value: '25m_75m', label: '$25M - $75M' },
      { value: '75m_plus', label: '$75M+' },
    ] },
  { id: 'FD_E2', field: 'federal_answers.top_3_agencies', label: 'Top 3 federal customers?',
    type: 'textarea', tiers: ['deep'], federalPath: ['established_prime'] },
  { id: 'FD_E3', field: 'federal_answers.market_change_2yrs', label: 'What\'s changing in your federal market that wasn\'t true two years ago?',
    type: 'textarea', tiers: ['deep'], federalPath: ['established_prime'] },
  { id: 'FD_E4', field: 'federal_answers.actively_pivoting', label: 'Pivoting toward a new vertical or capability?',
    type: 'radio', tiers: ['deep'], federalPath: ['established_prime'],
    options: [
      { value: 'yes_describe', label: 'Yes - I\'ll describe live' },
      { value: 'no_defending', label: 'No - defending current position' },
      { value: 'considering', label: 'Considering it' },
    ] },
]

// =============================================================================
// HELPERS
// =============================================================================

function getValue(form: FormData, field: string): any {
  if (field.startsWith('federal_answers.')) {
    const key = field.replace('federal_answers.', '')
    return (form.federal_answers || {})[key]
  }
  return (form as any)[field]
}

function setValue(form: FormData, field: string, value: any): FormData {
  if (field.startsWith('federal_answers.')) {
    const key = field.replace('federal_answers.', '')
    return { ...form, federal_answers: { ...form.federal_answers, [key]: value } }
  }
  return { ...form, [field]: value }
}

function getActiveQuestions(form: FormData, tier: TimeTier): Question[] {
  return ALL_QUESTIONS.filter(q => {
    if (!q.tiers.includes(tier)) return false
    if (q.federalPath) {
      if (!form.federal_path) return false
      return q.federalPath.includes(form.federal_path)
    }
    return true
  })
}

function isValid(question: Question, value: any): boolean {
  if (!question.required) return true
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

// =============================================================================
// STYLES
// =============================================================================

const palette = {
  cream: '#FBF7F0',
  espresso: '#2A2622',
  amber: '#F0A742',
  amberHover: '#E69828',
  hairline: '#E8E1D5',
  textSecondary: '#5C5249',
  textTertiary: '#8B7E70',
}

const containerStyle: CSSProperties = {
  minHeight: '100vh',
  background: palette.cream,
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  color: palette.espresso,
  display: 'flex',
  flexDirection: 'column',
}

const innerStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 24px',
  width: '100%',
  maxWidth: '720px',
  margin: '0 auto',
}

const labelStyle: CSSProperties = {
  fontSize: '32px',
  fontWeight: 600,
  lineHeight: 1.25,
  color: palette.espresso,
  marginBottom: '16px',
  textAlign: 'left',
  width: '100%',
}

const hintStyle: CSSProperties = {
  fontSize: '15px',
  color: palette.textSecondary,
  marginBottom: '32px',
  width: '100%',
  lineHeight: 1.5,
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '16px 18px',
  fontSize: '18px',
  fontFamily: 'inherit',
  border: `2px solid ${palette.hairline}`,
  borderRadius: '8px',
  background: 'white',
  color: palette.espresso,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: '120px',
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
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
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'underline',
}

const optionButtonStyle = (selected: boolean): CSSProperties => ({
  padding: '14px 18px',
  fontSize: '16px',
  fontFamily: 'inherit',
  background: selected ? palette.amber : 'white',
  color: palette.espresso,
  border: `2px solid ${selected ? palette.amber : palette.hairline}`,
  borderRadius: '8px',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  marginBottom: '10px',
  transition: 'all 0.15s',
  fontWeight: selected ? 600 : 400,
})

// =============================================================================
// COMPONENT
// =============================================================================

export function PublicIntakeForm() {
  const [section, setSection] = useState<Section>('welcome')
  const [tier, setTier] = useState<TimeTier | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [form, setForm] = useState<FormData>(INITIAL_FORM)
  const [error, setError] = useState<string | null>(null)

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.form) setForm(parsed.form)
        if (parsed.section) setSection(parsed.section)
        if (parsed.tier) setTier(parsed.tier)
        if (parsed.questionIndex !== undefined) setQuestionIndex(parsed.questionIndex)
      }
    } catch {
      // ignore
    }
  }, [])

  // Persist on every change (except submitted)
  useEffect(() => {
    if (section === 'submitted' || section === 'submitting') return
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ form, section, tier, questionIndex }))
    } catch {
      // ignore
    }
  }, [form, section, tier, questionIndex])

  const activeQuestions = tier ? getActiveQuestions(form, tier) : []
  const currentQuestion = activeQuestions[questionIndex]
  const totalQuestions = activeQuestions.length
  const overallProgress = currentQuestion
    ? Math.round(((questionIndex + 1) / totalQuestions) * 100)
    : section === 'submitted' ? 100 : 0

  function handleStart(chosenTier: TimeTier) {
    setTier(chosenTier)
    setSection('questions')
    setQuestionIndex(0)
  }

  function handleNext() {
    setError(null)
    if (!currentQuestion) return
    const value = getValue(form, currentQuestion.field)
    if (!isValid(currentQuestion, value)) {
      setError('This question is required.')
      return
    }
    if (questionIndex < activeQuestions.length - 1) {
      setQuestionIndex(questionIndex + 1)
    } else {
      handleSubmit()
    }
  }

  function handleBack() {
    setError(null)
    if (questionIndex > 0) {
      setQuestionIndex(questionIndex - 1)
    } else {
      setSection('welcome')
      setTier(null)
    }
  }

  function handleSkip() {
    if (currentQuestion?.required) return
    if (questionIndex < activeQuestions.length - 1) {
      setQuestionIndex(questionIndex + 1)
    } else {
      handleSubmit()
    }
  }

  async function handleSubmit() {
    setSection('submitting')
    setError(null)
    try {
      const params = new URLSearchParams(window.location.search)
      const submission = {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        industry_sector: form.industry_sector.trim() || null,
        referred_by: form.referred_by.trim() || null,
        catalyst: form.catalyst.trim() || null,
        company_name: form.company_name.trim() || null,
        company_website: form.company_website.trim() || null,
        year_founded: form.year_founded ? parseInt(form.year_founded, 10) : null,
        headcount: form.headcount || null,
        revenue_range: form.revenue_range || null,
        capabilities: form.capabilities.trim() || null,
        customers: form.customers.trim() || null,
        geographic_footprint: form.geographic_footprint.length > 0 ? form.geographic_footprint : null,
        differentiator: form.differentiator.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        federal_path: form.federal_path || null,
        federal_answers: form.federal_answers && Object.keys(form.federal_answers).length > 0 ? form.federal_answers : null,
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
        referrer_url: document.referrer || null,
        user_agent: navigator.userAgent,
      }

      const { data, error: insertError } = await supabase
        .from('public_intake_submission')
        .insert(submission)
        .select()
        .single()

      if (insertError) throw new Error(insertError.message)

      localStorage.removeItem(LOCAL_STORAGE_KEY)

      try {
        await fetch('/.netlify/functions/notify-public-intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submission_id: data?.id }),
        })
      } catch {
        // notification failure non-fatal
      }

      setSection('submitted')
    } catch (e: any) {
      setError(`Submission failed: ${e?.message || 'unknown'}. Please try again or email zack@sunstoneadvisory.co directly.`)
      setSection('questions')
    }
  }

  // RENDER

  if (section === 'welcome') {
    return <Welcome onStart={handleStart} />
  }

  if (section === 'submitting') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '12px' }}>Submitting...</h1>
          <p style={{ fontSize: '16px', color: palette.textSecondary }}>One moment.</p>
        </div>
      </div>
    )
  }

  if (section === 'submitted') {
    return <Submitted firstName={form.full_name.split(' ')[0] || 'there'} email={form.email} tier={tier} />
  }

  if (!currentQuestion) {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}><h1>Loading...</h1></div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <ProgressBar progress={overallProgress} />
      <div style={innerStyle}>
        <div style={{ fontSize: '13px', color: palette.textTertiary, marginBottom: '24px', width: '100%' }}>
          Question {questionIndex + 1} of {totalQuestions}
        </div>
        <h1 style={labelStyle}>{currentQuestion.label}</h1>
        {currentQuestion.hint && <p style={hintStyle}>{currentQuestion.hint}</p>}

        <QuestionInput
          question={currentQuestion}
          value={getValue(form, currentQuestion.field)}
          onChange={(v) => setForm(setValue(form, currentQuestion.field, v))}
          onSubmit={handleNext}
        />

        {error && <div style={{ color: '#C0392B', marginTop: '12px', fontSize: '14px' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '32px', width: '100%' }}>
          <button onClick={handleBack} style={secondaryButtonStyle}>Back</button>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {!currentQuestion.required && (
              <button onClick={handleSkip} style={secondaryButtonStyle}>Skip</button>
            )}
            <button onClick={handleNext} style={primaryButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = palette.amberHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = palette.amber)}>
              {questionIndex === activeQuestions.length - 1 ? 'Submit' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// WELCOME
// =============================================================================

function Welcome({ onStart }: { onStart: (tier: TimeTier) => void }) {
  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '24px' }}>
          Sunstone Advisory Group
        </div>
        <h1 style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1.15, marginBottom: '24px', color: palette.espresso }}>
          Let's see if federal contracting is right for your business.
        </h1>
        <p style={{ fontSize: '17px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '20px' }}>
          You give us your inputs, we give you a free preliminary RECON report. Intelligence we normally charge for. <strong>The longer you spend, the richer the analysis.</strong>
        </p>
        <p style={{ fontSize: '15px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '40px' }}>
          Pick your time investment.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', marginBottom: '32px' }}>
          <TierCard
            title="2 minutes"
            subtitle="Quick Look"
            description="Just enough for us to tell you whether federal contracting is even a sensible fit for your business. Light report."
            onClick={() => onStart('quick')}
          />
          <TierCard
            title="5 minutes"
            subtitle="Standard Profile"
            description="The sweet spot. Real prelim profile, tailored Zoom intake on the other side, and a customized RECON report."
            onClick={() => onStart('standard')}
            recommended
          />
          <TierCard
            title="10 minutes"
            subtitle="Deep Profile"
            description="Maximum signal. The richer your inputs, the sharper the recon. Worth it if federal is a real strategic priority."
            onClick={() => onStart('deep')}
          />
        </div>

        <div style={{ background: 'white', border: `1px solid ${palette.hairline}`, borderRadius: '8px', padding: '16px 20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '6px' }}>Privacy</div>
          <p style={{ fontSize: '13px', color: palette.textSecondary, lineHeight: 1.6, margin: 0 }}>
            Your contact info is used by Sunstone to communicate with you about your RECON report and follow-up. We never sell your data. We never share it outside Sunstone.
          </p>
        </div>
      </div>
    </div>
  )
}

function TierCard({ title, subtitle, description, onClick, recommended }: {
  title: string
  subtitle: string
  description: string
  onClick: () => void
  recommended?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '20px 24px',
        background: 'white',
        border: `2px solid ${recommended ? palette.amber : palette.hairline}`,
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = palette.amber)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = recommended ? palette.amber : palette.hairline)}>
      {recommended && (
        <div style={{ position: 'absolute', top: '-10px', right: '20px', background: palette.amber, color: palette.espresso, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: '4px' }}>
          Recommended
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '6px' }}>
        <span style={{ fontSize: '24px', fontWeight: 700, color: palette.espresso }}>{title}</span>
        <span style={{ fontSize: '15px', fontWeight: 600, color: palette.textSecondary }}>{subtitle}</span>
      </div>
      <div style={{ fontSize: '14px', color: palette.textSecondary, lineHeight: 1.5 }}>{description}</div>
    </button>
  )
}

function Submitted({ firstName, email, tier }: { firstName: string; email: string; tier: TimeTier | null }) {
  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '24px' }}>
          Submission received
        </div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2, marginBottom: '20px' }}>
          Thanks, {firstName}.
        </h1>
        <p style={{ fontSize: '17px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '24px' }}>
          We'll get back to you within 2 business days at <strong>{email}</strong> with your free preliminary RECON report.
        </p>
        <p style={{ fontSize: '15px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '40px' }}>
          {tier === 'quick' && 'For a richer analysis, you can always come back and complete the longer version.'}
          {tier === 'standard' && 'If we have any clarifying questions, we\'ll email first. No surprise calls.'}
          {tier === 'deep' && 'Thanks for the depth - it lets us produce a much sharper recon.'}
        </p>
        <div style={{ background: 'white', border: `1px solid ${palette.hairline}`, borderRadius: '8px', padding: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '12px' }}>What happens next</div>
          <ol style={{ fontSize: '15px', color: palette.espresso, lineHeight: 1.7, paddingLeft: '20px', margin: 0 }}>
            <li style={{ marginBottom: '8px' }}>We synthesize your inputs with public data (SAM, USASpending, web).</li>
            <li style={{ marginBottom: '8px' }}>We send you a draft Preliminary Profile to review and edit.</li>
            <li style={{ marginBottom: '8px' }}>If it makes sense, we schedule a 30-min Zoom intake.</li>
            <li>Your free RECON report is built and delivered.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div style={{ position: 'sticky', top: 0, height: '4px', background: palette.hairline, width: '100%', zIndex: 10 }}>
      <div style={{ height: '100%', background: palette.amber, width: `${progress}%`, transition: 'width 0.3s' }} />
    </div>
  )
}

function QuestionInput({
  question, value, onChange, onSubmit,
}: {
  question: Question
  value: any
  onChange: (v: any) => void
  onSubmit: () => void
}) {
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && question.type !== 'textarea') {
      e.preventDefault()
      onSubmit()
    }
  }

  if (question.type === 'text' || question.type === 'email' || question.type === 'phone' || question.type === 'url' || question.type === 'number') {
    const inputType = question.type === 'phone' ? 'tel' : question.type === 'number' ? 'number' : question.type
    return (
      <input type={inputType} value={value || ''} onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey} placeholder={question.placeholder} style={inputStyle} autoFocus
        onFocus={(e) => (e.currentTarget.style.borderColor = palette.amber)}
        onBlur={(e) => (e.currentTarget.style.borderColor = palette.hairline)} />
    )
  }

  if (question.type === 'textarea') {
    return (
      <textarea value={value || ''} onChange={(e) => onChange(e.target.value)}
        placeholder={question.placeholder} style={textareaStyle} autoFocus
        onFocus={(e) => (e.currentTarget.style.borderColor = palette.amber)}
        onBlur={(e) => (e.currentTarget.style.borderColor = palette.hairline)} />
    )
  }

  if (question.type === 'select' || question.type === 'radio') {
    return (
      <div style={{ width: '100%' }}>
        {(question.options || []).map(opt => (
          <button key={opt.value} onClick={() => { onChange(opt.value); setTimeout(onSubmit, 200) }}
            style={optionButtonStyle(value === opt.value)}>{opt.label}</button>
        ))}
      </div>
    )
  }

  if (question.type === 'multiselect') {
    const selected: string[] = Array.isArray(value) ? value : []
    return (
      <div style={{ width: '100%' }}>
        {(question.options || []).map(opt => {
          const isSelected = selected.includes(opt.value)
          return (
            <button key={opt.value} onClick={() => {
              if (isSelected) onChange(selected.filter(v => v !== opt.value))
              else onChange([...selected, opt.value])
            }} style={optionButtonStyle(isSelected)}>
              <span style={{ marginRight: '8px' }}>{isSelected ? '\u2713' : '\u00A0\u00A0'}</span>{opt.label}
            </button>
          )
        })}
      </div>
    )
  }

  return null
}
