/**
 * AdminSubmissionsPage - list all public intake submissions.
 *
 * SuperAdmin / Admin only. Lists every row in v2.public_intake_submission
 * with key context (name, company, email, federal path, status, when).
 * Each row has a "Review" button that opens PrelimReview for that submission.
 *
 * Auth-gated. RLS policy added in migration 0039 lets SuperAdmin/Admin
 * SELECT and UPDATE every row regardless of tenant.
 *
 * URL: /admin/submissions  (mounted inside <App /> via path intercept)
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

// =============================================================================
// PALETTE - matches PrelimReview / PublicIntakeForm
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

interface Submission {
  id: string
  full_name: string
  email: string
  company_name: string | null
  industry_sector: string | null
  federal_path: string | null
  status: string | null
  submitted_at: string
  reviewed_at: string | null
  converted_strategic_profile_id: string | null
  referred_by: string | null
}

type StatusFilter = 'all' | 'new' | 'converted' | 'dismissed'

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

const filterRowStyle: CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '20px',
  flexWrap: 'wrap',
}

const filterButtonStyle = (active: boolean): CSSProperties => ({
  padding: '8px 14px',
  fontSize: '13px',
  fontWeight: active ? 600 : 400,
  fontFamily: 'inherit',
  background: active ? palette.amber : palette.white,
  color: palette.espresso,
  border: `1.5px solid ${active ? palette.amber : palette.hairline}`,
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'all 0.15s',
})

const tableWrapperStyle: CSSProperties = {
  background: palette.white,
  border: `1px solid ${palette.hairline}`,
  borderRadius: '12px',
  overflow: 'hidden',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '14px 16px',
  background: palette.cream,
  borderBottom: `1px solid ${palette.hairline}`,
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
}

const tdStyle: CSSProperties = {
  padding: '14px 16px',
  borderBottom: `1px solid ${palette.hairline}`,
  fontSize: '14px',
  color: palette.espresso,
  verticalAlign: 'top',
}

const reviewButtonStyle: CSSProperties = {
  padding: '8px 14px',
  fontSize: '13px',
  fontWeight: 600,
  fontFamily: 'inherit',
  background: palette.amber,
  color: palette.espresso,
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
}

const statusBadgeStyle = (status: string | null): CSSProperties => {
  let bg = '#EAE3D5'
  let fg = palette.textSecondary
  if (status === 'converted_to_profile') {
    bg = '#EAF4ED'
    fg = palette.success
  } else if (status === 'dismissed') {
    bg = '#F7E6E3'
    fg = palette.danger
  } else if (status === 'new' || status === null) {
    bg = '#FFF8E8'
    fg = '#8B5A1A'
  }
  return {
    display: 'inline-block',
    padding: '3px 10px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    background: bg,
    color: fg,
    borderRadius: '12px',
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AdminSubmissionsPage() {
  const [stage, setStage] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [filter, setFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStage('loading')
    setError(null)
    try {
      const { data, error: selErr } = await supabase
        .schema('v2')
        .from('public_intake_submission')
        .select('id, full_name, email, company_name, industry_sector, federal_path, status, submitted_at, reviewed_at, converted_strategic_profile_id, referred_by')
        .order('submitted_at', { ascending: false })
        .limit(500)

      if (selErr) throw new Error(`Submissions fetch failed: ${selErr.message}`)
      setSubmissions((data || []) as Submission[])
      setStage('ready')
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
      setStage('error')
    }
  }

  function filteredSubmissions(): Submission[] {
    if (filter === 'all') return submissions
    if (filter === 'new') {
      return submissions.filter(s => !s.status || s.status === 'new')
    }
    if (filter === 'converted') {
      return submissions.filter(s => s.status === 'converted_to_profile')
    }
    if (filter === 'dismissed') {
      return submissions.filter(s => s.status === 'dismissed')
    }
    return submissions
  }

  const list = filteredSubmissions()

  // Counts for filter buttons
  const countAll = submissions.length
  const countNew = submissions.filter(s => !s.status || s.status === 'new').length
  const countConverted = submissions.filter(s => s.status === 'converted_to_profile').length
  const countDismissed = submissions.filter(s => s.status === 'dismissed').length

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>

        {/* HEADER */}
        <div style={headerStyle}>
          <div style={eyebrowStyle}>Admin</div>
          <h1 style={h1Style}>Public intake submissions</h1>
          <p style={{ fontSize: '15px', color: palette.textSecondary, margin: 0 }}>
            All submissions from the /start form. Click Review to open or convert.
          </p>
        </div>

        {/* FILTERS */}
        <div style={filterRowStyle}>
          <button onClick={() => setFilter('all')} style={filterButtonStyle(filter === 'all')}>
            All ({countAll})
          </button>
          <button onClick={() => setFilter('new')} style={filterButtonStyle(filter === 'new')}>
            New ({countNew})
          </button>
          <button onClick={() => setFilter('converted')} style={filterButtonStyle(filter === 'converted')}>
            Converted ({countConverted})
          </button>
          <button onClick={() => setFilter('dismissed')} style={filterButtonStyle(filter === 'dismissed')}>
            Dismissed ({countDismissed})
          </button>
          <button onClick={load} style={{ ...filterButtonStyle(false), marginLeft: 'auto' }}>
            Refresh
          </button>
        </div>

        {/* CONTENT */}
        {stage === 'loading' && (
          <p style={{ color: palette.textSecondary }}>Loading submissions...</p>
        )}

        {stage === 'error' && (
          <div style={{ padding: '20px', background: '#F7E6E3', border: `1px solid ${palette.danger}`, borderRadius: '8px', color: palette.danger }}>
            {error}
          </div>
        )}

        {stage === 'ready' && list.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: palette.textTertiary, background: palette.white, border: `1px solid ${palette.hairline}`, borderRadius: '12px' }}>
            No submissions match this filter.
          </div>
        )}

        {stage === 'ready' && list.length > 0 && (
          <div style={tableWrapperStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Submitted</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Federal path</th>
                  <th style={thStyle}>Referred by</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map(s => (
                  <tr key={s.id}>
                    <td style={tdStyle}>
                      {new Date(s.submitted_at).toLocaleDateString()}
                      <div style={{ fontSize: '11px', color: palette.textTertiary }}>
                        {new Date(s.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s.full_name || '-'}</td>
                    <td style={tdStyle}>
                      {s.company_name || <span style={{ color: palette.textTertiary, fontStyle: 'italic' }}>not provided</span>}
                      {s.industry_sector && (
                        <div style={{ fontSize: '12px', color: palette.textTertiary, marginTop: '2px' }}>
                          {s.industry_sector}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '13px' }}>{s.email || '-'}</td>
                    <td style={tdStyle}>
                      {s.federal_path ? (
                        <span style={{ fontSize: '12px', color: palette.textSecondary }}>{s.federal_path}</span>
                      ) : (
                        <span style={{ color: palette.textTertiary, fontStyle: 'italic', fontSize: '12px' }}>-</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '13px' }}>
                      {s.referred_by || <span style={{ color: palette.textTertiary, fontStyle: 'italic' }}>-</span>}
                    </td>
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(s.status)}>
                        {s.status || 'new'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <a
                        href={`/prelim/review?submission_id=${s.id}`}
                        style={reviewButtonStyle}
                      >
                        Review
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  )
}

export default AdminSubmissionsPage
