/**
 * PublicIntakeForm - the public-facing /start page
 *
 * Typeform-style single-question-at-a-time intake. Replaces 5-10 min discovery calls.
 * No auth, no login, no payment. Free-form data collection only.
 *
 * Flow:
 *   Welcome -> Contact (3 fields) -> Section 0 (3 Q's) -> Section 1 (8 Q's)
 *   -> Section 2 (gate + 4-5 adaptive Q's by federal_path) -> Submitted
 *
 * On submit: writes to v2.public_intake_submission via anon Supabase client.
 * Sends email to Zack via Netlify function.
 *
 * Saves progress to localStorage on every step. Refresh recovers.
 */
import { useState, useEffect, CSSProperties } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const supabasePublic = createClient(supabaseUrl, supabaseAnonKey)

const LOCAL_STORAGE_KEY = 'sunstone_public_intake_v1'

// =============================================================================
// TYPES
// =============================================================================

type Section = 'welcome' | 'contact' | 'section0' | 'section1' | 'section2' | 'submitting' | 'submitted' | 'error'
type FederalPath = 'none' | 'some' | 'sub' | 'limited_prime' | 'established_prime' | ''

interface FormData {
  full_name: string
  email: string
  phone: string
  industry_sector: string
  referred_by: string
  catalyst: string
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
// QUESTION DEFINITIONS
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
  section: 'contact' | '0' | '1' | '2'
  federalPath?: FederalPath[]
}

const ALL_QUESTIONS: Question[] = [
  // CONTACT
  { id: 'C1', field: 'full_name', label: 'What\'s your name?', hint: 'First and last is fine.', type: 'text', required: true, section: 'contact', placeholder: 'Jane Smith' },
  { id: 'C2', field: 'email', label: 'What\'s your email?', hint: 'We use this only to send your recon report and follow up. Never sold, never shared.', type: 'email', required: true, section: 'contact', placeholder: 'jane@yourcompany.com' },
  { id: 'C3', field: 'phone', label: 'And your phone?', hint: 'Optional. We only call if you say yes to a follow-up call.', type: 'phone', section: 'contact', placeholder: '(555) 123-4567' },

  // SECTION 0 - About you
  { id: 'Q01', field: 'industry_sector', label: 'What industry sector best describes your business?', hint: 'Use your own words. Doesn\'t need to be a NAICS code.', type: 'text', required: true, section: '0', placeholder: 'e.g., Industrial cleaning, Cybersecurity software, Medical devices' },
  { id: 'Q02', field: 'referred_by', label: 'Who pointed you to Sunstone?', hint: 'A name, a company, a podcast, an article - whatever you\'ve got. Or skip if you came on your own.', type: 'text', section: '0', placeholder: 'Optional' },
  { id: 'Q03', field: 'catalyst', label: 'What\'s prompting this conversation right now?', hint: 'What happened in your business that made federal contracting worth a real conversation? Skip if you\'d rather tell us live.', type: 'textarea', section: '0', placeholder: 'Optional' },

  // SECTION 1 - Commercial
  { id: 'Q11A', field: 'company_name', label: 'What\'s the legal name of your company?', type: 'text', required: true, section: '1' },
  { id: 'Q11B', field: 'company_website', label: 'Company website?', hint: 'We use this to round out the public picture of your business.', type: 'url', required: true, section: '1', placeholder: 'https://yourcompany.com' },
  { id: 'Q12A', field: 'year_founded', label: 'What year did you start the business?', type: 'number', required: true, section: '1', placeholder: '2018' },
  { id: 'Q12B', field: 'headcount', label: 'How many people work there today?', type: 'select', required: true, section: '1',
    options: [
      { value: '1', label: 'Just me' },
      { value: '2-5', label: '2-5' },
      { value: '6-15', label: '6-15' },
      { value: '16-50', label: '16-50' },
      { value: '51-200', label: '51-200' },
      { value: '201-500', label: '201-500' },
      { value: '500+', label: '500+' },
    ] },
  { id: 'Q13', field: 'revenue_range', label: 'What\'s your approximate annual revenue?', hint: 'Ballpark is fine. Helps us scope the recon right.', type: 'select', required: true, section: '1',
    options: [
      { value: 'under_500k', label: 'Under $500k' },
      { value: '500k_2m', label: '$500k - $2M' },
      { value: '2m_10m', label: '$2M - $10M' },
      { value: '10m_50m', label: '$10M - $50M' },
      { value: '50m_plus', label: '$50M+' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ] },
  { id: 'Q14', field: 'capabilities', label: 'Describe the three things your company does best.', hint: 'Use the words your customers would use, not industry jargon. One per line is great.', type: 'textarea', required: true, section: '1', placeholder: '1. ...\n2. ...\n3. ...' },
  { id: 'Q15', field: 'customers', label: 'Who are your three most important customer types or named customers?', hint: 'Companies, types of buyers, industries - whatever fits.', type: 'textarea', required: true, section: '1' },
  { id: 'Q16', field: 'geographic_footprint', label: 'Where do you operate?', hint: 'Check all that apply.', type: 'multiselect', section: '1',
    options: [
      { value: 'local', label: 'Local' },
      { value: 'regional', label: 'Regional' },
      { value: 'national', label: 'National' },
      { value: 'international', label: 'International' },
    ] },
  { id: 'Q17', field: 'differentiator', label: 'What can you do that your competitors can\'t?', hint: 'Or that you do meaningfully better than they do. Be specific.', type: 'textarea', required: true, section: '1' },
  { id: 'Q18', field: 'linkedin_url', label: 'Company LinkedIn URL?', hint: 'Optional but helpful.', type: 'url', section: '1', placeholder: 'https://linkedin.com/company/...' },

  // SECTION 2 - Federal posture (gate)
  { id: 'Q20', field: 'federal_path', label: 'Which best describes your federal contracting experience?', hint: 'Pick the closest fit. We adapt the rest of the questions based on this.', type: 'radio', required: true, section: '2',
    options: [
      { value: 'none', label: 'None - we\'ve never bid federal' },
      { value: 'some', label: 'Some - we\'ve bid but not won, or won state/local that\'s federally funded' },
      { value: 'sub', label: 'Sub experience - worked under primes but never as a prime' },
      { value: 'limited_prime', label: 'Limited prime - one or two federal prime awards' },
      { value: 'established_prime', label: 'Established prime - multiple federal awards, real part of business' },
    ] },

  // PATH A: None
  { id: 'Q2A1', field: 'federal_answers.sam_registered', label: 'Are you registered in SAM.gov?', type: 'radio', section: '2', federalPath: ['none'],
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'dont_know', label: 'Don\'t know' },
    ] },
  { id: 'Q2A2', field: 'federal_answers.certifications', label: 'Do you hold any small-business socioeconomic certifications?', hint: 'Check all that apply.', type: 'multiselect', section: '2', federalPath: ['none','some','sub','limited_prime','established_prime'],
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
  { id: 'Q2A3', field: 'federal_answers.budget', label: 'What budget would you allocate to federal market entry in the next 6-12 months?', type: 'radio', section: '2', federalPath: ['none','some'],
    options: [
      { value: 'under_10k', label: 'Under $10k' },
      { value: '10k_25k', label: '$10k - $25k' },
      { value: '25k_50k', label: '$25k - $50k' },
      { value: '50k_100k', label: '$50k - $100k' },
      { value: '100k_plus', label: '$100k+' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ] },
  { id: 'Q2A4', field: 'federal_answers.imagined_first_win', label: 'Two years from now, you\'ve won your first federal contract. Describe it briefly.', hint: 'Who\'s the customer? What did they buy? Skip if not yet sure.', type: 'textarea', section: '2', federalPath: ['none'] },
  { id: 'Q2A5', field: 'federal_answers.cycle_reaction', label: 'What\'s your reaction to "18-36 month sales cycle for new federal entrants"?', type: 'radio', section: '2', federalPath: ['none'],
    options: [
      { value: 'fine', label: 'That\'s fine' },
      { value: 'longer', label: 'That\'s longer than I hoped' },
      { value: 'problem', label: 'That\'s a problem' },
      { value: 'disbelief', label: 'I don\'t believe it' },
    ] },

  // PATH B: Some
  { id: 'Q2B1', field: 'federal_answers.sam_status', label: 'SAM.gov registration status?', type: 'radio', section: '2', federalPath: ['some','sub','limited_prime','established_prime'],
    options: [
      { value: 'active', label: 'Yes - active' },
      { value: 'expired', label: 'Yes - expired' },
      { value: 'registered_inactive', label: 'Registered but not active' },
      { value: 'no', label: 'No' },
    ] },
  { id: 'Q2B3', field: 'federal_answers.proposals_recent', label: 'Federal proposals submitted in the last two years?', hint: 'Wins, losses, no-bids - all welcome.', type: 'textarea', section: '2', federalPath: ['some'] },
  { id: 'Q2B4', field: 'federal_answers.why_no_win', label: 'Why didn\'t you win? Your honest read.', type: 'textarea', section: '2', federalPath: ['some'] },
  { id: 'Q2B5', field: 'federal_answers.blocker', label: 'What\'s stopping you from going harder at federal?', type: 'radio', section: '2', federalPath: ['some'],
    options: [
      { value: 'capital', label: 'Capital' },
      { value: 'knowledge', label: 'Knowledge' },
      { value: 'past_performance', label: 'Past performance gap' },
      { value: 'time', label: 'Time' },
      { value: 'bandwidth', label: 'Bandwidth' },
      { value: 'other', label: 'Other' },
    ] },

  // PATH C: Sub
  { id: 'Q2C1', field: 'federal_answers.primes_subbed_under', label: 'Names of primes you\'ve subbed under in the last 3 years.', type: 'textarea', required: true, section: '2', federalPath: ['sub'] },
  { id: 'Q2C2', field: 'federal_answers.why_not_prime', label: 'Why haven\'t you become a prime yet? Your honest read.', type: 'textarea', section: '2', federalPath: ['sub'] },
  { id: 'Q2C4', field: 'federal_answers.ceiling', label: 'What\'s the ceiling holding you back?', type: 'radio', section: '2', federalPath: ['sub'],
    options: [
      { value: 'past_performance', label: 'Past performance' },
      { value: 'bonding', label: 'Bonding' },
      { value: 'working_capital', label: 'Working capital' },
      { value: 'capability', label: 'Capability' },
      { value: 'relationships', label: 'Relationships' },
      { value: 'other', label: 'Other' },
    ] },
  { id: 'Q2C5', field: 'federal_answers.prime_promise_followthrough', label: 'If a prime promised to "help you become a prime," have they followed through?', type: 'radio', section: '2', federalPath: ['sub'],
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'sort_of', label: 'Sort of' },
      { value: 'no', label: 'No' },
      { value: 'never_promised', label: 'Never been promised' },
    ] },

  // PATH D: Limited prime
  { id: 'Q2D1', field: 'federal_answers.contracts_held', label: 'What contracts do you currently hold, and what agencies?', type: 'textarea', section: '2', federalPath: ['limited_prime'] },
  { id: 'Q2D2', field: 'federal_answers.largest_contract', label: 'Largest contract value you\'ve ever held?', type: 'select', section: '2', federalPath: ['limited_prime'],
    options: [
      { value: 'under_100k', label: 'Under $100k' },
      { value: '100k_500k', label: '$100k - $500k' },
      { value: '500k_2m', label: '$500k - $2M' },
      { value: '2m_10m', label: '$2M - $10M' },
      { value: '10m_plus', label: '$10M+' },
    ] },
  { id: 'Q2D3', field: 'federal_answers.biggest_risk_18mo', label: 'Largest single risk to your federal book in the next 18 months?', type: 'textarea', section: '2', federalPath: ['limited_prime'] },
  { id: 'Q2D4', field: 'federal_answers.next_capability_or_contract', label: 'What capability or contract do you want next?', type: 'textarea', section: '2', federalPath: ['limited_prime'] },
  { id: 'Q2D5', field: 'federal_answers.past_performance_type', label: 'Past performance type?', type: 'radio', section: '2', federalPath: ['limited_prime'],
    options: [
      { value: 'set_aside_only', label: 'Small business set-aside only' },
      { value: 'full_open_only', label: 'Full and open only' },
      { value: 'both', label: 'Both' },
    ] },

  // PATH E: Established prime
  { id: 'Q2E1', field: 'federal_answers.federal_revenue_range', label: 'Approximate annual federal revenue range?', type: 'select', section: '2', federalPath: ['established_prime'],
    options: [
      { value: 'under_2m', label: 'Under $2M' },
      { value: '2m_10m', label: '$2M - $10M' },
      { value: '10m_25m', label: '$10M - $25M' },
      { value: '25m_75m', label: '$25M - $75M' },
      { value: '75m_plus', label: '$75M+' },
    ] },
  { id: 'Q2E2', field: 'federal_answers.top_3_agencies', label: 'Top 3 federal customers (agencies)?', type: 'textarea', section: '2', federalPath: ['established_prime'] },
  { id: 'Q2E3', field: 'federal_answers.largest_contract_or_vehicle', label: 'Largest single contract or vehicle?', type: 'textarea', section: '2', federalPath: ['established_prime'] },
  { id: 'Q2E4', field: 'federal_answers.market_change_2yrs', label: 'What\'s changing in your federal market that wasn\'t true two years ago?', type: 'textarea', section: '2', federalPath: ['established_prime'] },
  { id: 'Q2E5', field: 'federal_answers.actively_pivoting', label: 'Are you actively pivoting toward a new vertical or capability?', type: 'radio', section: '2', federalPath: ['established_prime'],
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

function getActiveQuestions(form: FormData): Question[] {
  return ALL_QUESTIONS.filter(q => {
    if (q.section === 'contact') return true
    if (q.section === '0') return true
    if (q.section === '1') return true
    if (q.section === '2') {
      if (!q.federalPath) return true  // Q20 is the gate, no federalPath
      if (!form.federal_path) return false
      return q.federalPath.includes(form.federal_path)
    }
    return false
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
// SUNSTONE PALETTE STYLES
// =============================================================================

const palette = {
  cream: '#FBF7F0',
  espresso: '#2A2622',
  espressoSoft: '#3D3631',
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
  color: selected ? palette.espresso : palette.espresso,
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
        if (parsed.questionIndex !== undefined) setQuestionIndex(parsed.questionIndex)
      }
    } catch {
      // ignore
    }
  }, [])

  // Persist on every change (except submitted state)
  useEffect(() => {
    if (section === 'submitted' || section === 'submitting') return
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ form, section, questionIndex }))
    } catch {
      // ignore
    }
  }, [form, section, questionIndex])

  const activeQuestions = getActiveQuestions(form)
  const sectionQuestions = activeQuestions.filter(q => {
    if (section === 'contact') return q.section === 'contact'
    if (section === 'section0') return q.section === '0'
    if (section === 'section1') return q.section === '1'
    if (section === 'section2') return q.section === '2'
    return false
  })
  const currentQuestion = sectionQuestions[questionIndex]
  const totalSectionQuestions = sectionQuestions.length

  // Overall progress
  const totalQuestions = activeQuestions.length
  const questionsCompletedBefore = activeQuestions.findIndex(q => q.id === currentQuestion?.id)
  const overallProgress = currentQuestion
    ? Math.round(((questionsCompletedBefore + 1) / totalQuestions) * 100)
    : section === 'submitted' ? 100 : 0

  function handleNext() {
    setError(null)
    if (!currentQuestion) return
    const value = getValue(form, currentQuestion.field)
    if (!isValid(currentQuestion, value)) {
      setError('This question is required.')
      return
    }
    if (questionIndex < sectionQuestions.length - 1) {
      setQuestionIndex(questionIndex + 1)
    } else {
      // End of section - advance
      if (section === 'contact') { setSection('section0'); setQuestionIndex(0) }
      else if (section === 'section0') { setSection('section1'); setQuestionIndex(0) }
      else if (section === 'section1') { setSection('section2'); setQuestionIndex(0) }
      else if (section === 'section2') { handleSubmit() }
    }
  }

  function handleBack() {
    setError(null)
    if (questionIndex > 0) {
      setQuestionIndex(questionIndex - 1)
    } else {
      if (section === 'contact') setSection('welcome')
      else if (section === 'section0') {
        setSection('contact')
        const contactQs = activeQuestions.filter(q => q.section === 'contact')
        setQuestionIndex(contactQs.length - 1)
      }
      else if (section === 'section1') {
        setSection('section0')
        const s0Qs = activeQuestions.filter(q => q.section === '0')
        setQuestionIndex(s0Qs.length - 1)
      }
      else if (section === 'section2') {
        setSection('section1')
        const s1Qs = activeQuestions.filter(q => q.section === '1')
        setQuestionIndex(s1Qs.length - 1)
      }
    }
  }

  function handleSkip() {
    if (currentQuestion?.required) return
    if (questionIndex < sectionQuestions.length - 1) {
      setQuestionIndex(questionIndex + 1)
    } else {
      if (section === 'contact') { setSection('section0'); setQuestionIndex(0) }
      else if (section === 'section0') { setSection('section1'); setQuestionIndex(0) }
      else if (section === 'section1') { setSection('section2'); setQuestionIndex(0) }
      else if (section === 'section2') { handleSubmit() }
    }
  }

  async function handleSubmit() {
    setSection('submitting')
    setError(null)
    try {
      // Capture UTM and referrer
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

      const { data, error: insertError } = await supabasePublic
        .from('public_intake_submission')
        .insert(submission)
        .select()
        .single()

      if (insertError) throw new Error(insertError.message)

      localStorage.removeItem(LOCAL_STORAGE_KEY)

      // Fire notification email (best-effort)
      try {
        await fetch('/.netlify/functions/notify-public-intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submission_id: data?.id }),
        })
      } catch {
        // notification failure is non-fatal
      }

      setSection('submitted')
    } catch (e: any) {
      setError(`Submission failed: ${e?.message || 'unknown error'}. Please try again or email zack@sunstoneadvisory.co directly.`)
      setSection('section2')
    }
  }

  // ==========================================
  // RENDER
  // ==========================================

  if (section === 'welcome') {
    return <Welcome onStart={() => { setSection('contact'); setQuestionIndex(0) }} />
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
    return <Submitted form={form} />
  }

  if (!currentQuestion) {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <h1>Loading...</h1>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <ProgressBar progress={overallProgress} />
      <SectionLabel section={section} />
      <div style={innerStyle}>
        <QuestionIndicator current={questionIndex + 1} total={totalSectionQuestions} />
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
              {(section === 'section2' && questionIndex === sectionQuestions.length - 1) ? 'Submit' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '24px' }}>
          Sunstone Advisory Group
        </div>
        <h1 style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1.15, marginBottom: '24px', color: palette.espresso }}>
          Let's see if federal contracting is right for your business.
        </h1>
        <p style={{ fontSize: '17px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '32px' }}>
          Filling this out gets you two things:
        </p>
        <ol style={{ fontSize: '17px', color: palette.espresso, lineHeight: 1.7, marginBottom: '32px', paddingLeft: '20px' }}>
          <li style={{ marginBottom: '12px' }}>
            <strong>A more specific, tailored conversation</strong> about your market - instead of generic "tell me about your business" Q&amp;A.
          </li>
          <li>
            <strong>A free preliminary RECON report</strong> based on what you share, showing you what your federal market actually looks like for a company like yours. <em>This is intelligence we normally charge for.</em>
          </li>
        </ol>

        <div style={{ background: 'white', border: `1px solid ${palette.hairline}`, borderRadius: '8px', padding: '20px 24px', marginBottom: '32px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '8px' }}>What to expect</div>
          <p style={{ fontSize: '15px', color: palette.espresso, lineHeight: 1.6, margin: 0 }}>
            About 10 minutes. Two sections - <strong>Commercial</strong> (your business today) and <strong>Federal</strong> (your federal experience and posture). Around 8-12 questions per section. Questions adapt to your answers, so what you see depends on what you tell us.
          </p>
        </div>

        <div style={{ background: 'white', border: `1px solid ${palette.hairline}`, borderRadius: '8px', padding: '20px 24px', marginBottom: '40px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '8px' }}>Privacy</div>
          <p style={{ fontSize: '14px', color: palette.textSecondary, lineHeight: 1.6, margin: 0 }}>
            Your contact info is used by Sunstone Advisory Group to communicate with you about your RECON report and follow-up. We never sell your data. We never share it with anyone outside Sunstone. Period.
          </p>
        </div>

        <button onClick={onStart} style={{ ...primaryButtonStyle, fontSize: '17px', padding: '18px 36px' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = palette.amberHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = palette.amber)}>
          Get started
        </button>
      </div>
    </div>
  )
}

function Submitted({ form }: { form: FormData }) {
  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '24px' }}>
          Submission received
        </div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2, marginBottom: '20px' }}>
          Thanks, {form.full_name.split(' ')[0]}.
        </h1>
        <p style={{ fontSize: '17px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '24px' }}>
          We'll get back to you within 2 business days at <strong>{form.email}</strong> with your free preliminary RECON report.
        </p>
        <p style={{ fontSize: '15px', color: palette.textSecondary, lineHeight: 1.6, marginBottom: '40px' }}>
          If we have any clarifying questions, we'll email first. No surprise calls.
        </p>
        <div style={{ background: 'white', border: `1px solid ${palette.hairline}`, borderRadius: '8px', padding: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: palette.textTertiary, marginBottom: '12px' }}>What happens next</div>
          <ol style={{ fontSize: '15px', color: palette.espresso, lineHeight: 1.7, paddingLeft: '20px', margin: 0 }}>
            <li style={{ marginBottom: '8px' }}>We synthesize your inputs with public data (SAM, USASpending, web).</li>
            <li style={{ marginBottom: '8px' }}>We send you a draft Preliminary Profile to review and edit.</li>
            <li style={{ marginBottom: '8px' }}>Once you confirm it's accurate, we schedule a 30-min Zoom intake.</li>
            <li>After the Zoom, your free RECON report is built and delivered.</li>
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

function SectionLabel({ section }: { section: Section }) {
  const labels: Record<Section, string> = {
    welcome: '',
    contact: 'Contact',
    section0: 'About you',
    section1: 'Commercial',
    section2: 'Federal',
    submitting: '',
    submitted: '',
    error: '',
  }
  const label = labels[section]
  if (!label) return null
  return (
    <div style={{ width: '100%', maxWidth: '720px', margin: '24px auto 0', padding: '0 24px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.textTertiary }}>
        {label}
      </div>
    </div>
  )
}

function QuestionIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ fontSize: '13px', color: palette.textTertiary, marginBottom: '24px', width: '100%' }}>
      Question {current} of {total}
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

  if (question.type === 'select') {
    return (
      <div style={{ width: '100%' }}>
        {(question.options || []).map(opt => (
          <button key={opt.value} onClick={() => { onChange(opt.value); setTimeout(onSubmit, 200) }}
            style={optionButtonStyle(value === opt.value)}>{opt.label}</button>
        ))}
      </div>
    )
  }

  if (question.type === 'radio') {
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
